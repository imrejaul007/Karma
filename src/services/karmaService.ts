/**
 * Karma Service — main business logic layer
 *
 * Provides high-level operations on karma profiles, including:
 * - Profile retrieval and creation
 * - Karma accumulation with decay-aware updates
 * - Level information
 * - Batch conversion tracking
 * - Weekly usage tracking
 */
import moment from 'moment';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { redisClient as redis } from '../config/redis.js';
import {
  KarmaProfile,
  EarnRecord,
  Batch,
} from '../models/index.js';
import type {
  KarmaProfileDocument,
  IKarmaProfile,
  IBadge,
  ILevelHistoryEntry,
} from '../models/KarmaProfile.js';
import type {
  Level,
  ConversionRate,
  LevelInfo,
} from '../types/index.js';
import {
  calculateLevel,
  getConversionRate,
  applyDailyDecay,
  calculateTrustScore,
  nextLevelThreshold,
} from '../engines/karmaEngine.js';
import { logger } from '../utils/logger.js';

export { calculateLevel, getConversionRate };

// ---------------------------------------------------------------------------
// Profile Access
// ---------------------------------------------------------------------------

/**
 * Retrieve a user's karma profile by userId.
 * Returns null if not found.
 */
export async function getKarmaProfile(
  userId: string,
): Promise<KarmaProfileDocument | null> {
  // KARMA-P1 FIX: Wrap userId in ObjectId — schema defines userId as ObjectId,
  // but callers pass strings. Without this, every lookup throws a Mongoose CastError.
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    return null;
  }
  const result = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
  if (!result) return null;
  // Attach minimal virtuals/defaults that lean() strips
  return result as unknown as KarmaProfileDocument;
}

/**
 * Retrieve an existing karma profile, or create a new one if it doesn't exist.
 */
export async function getOrCreateProfile(
  userId: string,
): Promise<KarmaProfileDocument> {
  let profile = await KarmaProfile.findOne({ userId });
  if (!profile) {
    profile = await KarmaProfile.create({
      userId: new mongoose.Types.ObjectId(userId),
      lifetimeKarma: 0,
      activeKarma: 0,
      level: 'L1',
      eventsCompleted: 0,
      eventsJoined: 0,
      totalHours: 0,
      trustScore: 0,
      badges: [],
      lastActivityAt: null,
      levelHistory: [],
      conversionHistory: [],
      thisWeekKarmaEarned: 0,
      avgEventDifficulty: 0,
      avgConfidenceScore: 0,
      checkIns: 0,
      approvedCheckIns: 0,
      activityHistory: [],
    });
    logger.info(`Created karma profile for user ${userId}`);
  }
  return profile;
}

// ---------------------------------------------------------------------------
// Karma Accumulation
// ---------------------------------------------------------------------------

/**
 * Add karma to a user's profile.
 * Updates both activeKarma and lifetimeKarma.
 * Handles level-up: if the new activeKarma crosses a threshold,
 * the level is updated and a levelHistory entry is appended.
 *
 * BE-KAR-008 FIX: Enforces WEEKLY_COIN_CAP on karma accumulation.
 * If the user has already hit the weekly cap, the karma is rejected.
 */
export async function addKarma(
  userId: string,
  karma: number,
  options?: {
    hours?: number;
    confidenceScore?: number;
    difficulty?: number;
    isCheckIn?: boolean;
    isApproved?: boolean;
  },
): Promise<void> {
  const profile = await getOrCreateProfile(userId);

  const oldLevel = profile.level;
  const oldActiveKarma = profile.activeKarma;

  // BE-KAR-003 & BE-KAR-008 FIX: Check weekly karma cap before accepting karma
  const WEEKLY_COIN_CAP = 300; // Import this from karmaEngine or config
  const startOfWeek = moment().startOf('week').toDate();
  let weeklyKarmaEarned = profile.thisWeekKarmaEarned;

  // Reset if we've moved to a new week
  if (
    profile.weekOfLastKarmaEarned &&
    moment(profile.weekOfLastKarmaEarned).startOf('week').isBefore(startOfWeek)
  ) {
    weeklyKarmaEarned = 0;
  }

  // BE-KAR-008 FIX: Enforce weekly cap
  if (weeklyKarmaEarned >= WEEKLY_COIN_CAP) {
    logger.warn(`[Karma] User ${userId} has hit weekly cap (${WEEKLY_COIN_CAP}), rejecting ${karma} karma`, {
      userId,
      karmaRequested: karma,
      weeklyCapRemaining: WEEKLY_COIN_CAP - weeklyKarmaEarned,
    });
    throw new Error(
      `Weekly karma cap exceeded. Remaining this week: ${WEEKLY_COIN_CAP - weeklyKarmaEarned}`
    );
  }

  // Accumulate karma
  profile.lifetimeKarma += karma;
  profile.activeKarma += karma;
  profile.lastActivityAt = new Date();
  profile.totalHours += options?.hours ?? 0;

  // Update trust metrics
  if (options?.isCheckIn) {
    profile.checkIns += 1;
    if (options?.isApproved) {
      profile.approvedCheckIns += 1;
    }
  }

  // Update running averages for trust score
  const totalEvents = profile.eventsCompleted + 1;
  profile.avgEventDifficulty =
    ((profile.avgEventDifficulty * profile.eventsCompleted) +
      (options?.difficulty ?? 0)) /
    totalEvents;
  profile.avgConfidenceScore =
    ((profile.avgConfidenceScore * profile.eventsCompleted) +
      (options?.confidenceScore ?? 0)) /
    totalEvents;

  // Recalculate level
  const newLevel = calculateLevel(profile.activeKarma);
  if (newLevel !== oldLevel) {
    const previousEntry = profile.levelHistory[profile.levelHistory.length - 1];
    if (previousEntry && !previousEntry.droppedAt) {
      previousEntry.droppedAt = new Date();
    }
    profile.level = newLevel;
    const entry: ILevelHistoryEntry = {
      level: newLevel as Level,
      earnedAt: new Date(),
    };
    profile.levelHistory.push(entry);
    logger.info(
      `User ${userId} leveled ${newLevel === oldLevel ? 'maintained' : 'upgraded'} from ${oldLevel} to ${newLevel} (${oldActiveKarma} → ${profile.activeKarma} karma)`,
    );
  }

  // Track weekly karma earned for cap enforcement
  const startOfWeek = moment().startOf('week').toDate();
  if (
    !profile.weekOfLastKarmaEarned ||
    moment(profile.weekOfLastKarmaEarned).startOf('week').isBefore(startOfWeek)
  ) {
    profile.thisWeekKarmaEarned = karma;
    profile.weekOfLastKarmaEarned = new Date();
  } else {
    profile.thisWeekKarmaEarned += karma;
  }

  // Activity history (keep last 90 days)
  profile.activityHistory.push(new Date());
  if (profile.activityHistory.length > 90) {
    profile.activityHistory = profile.activityHistory.slice(-90) as typeof profile.activityHistory;
  }

  await profile.save();
}

/**
 * Record a karma event completion (called after verification is complete).
 * Increments eventsCompleted and calls addKarma.
 */
export async function recordKarmaEarned(
  userId: string,
  karmaEarned: number,
  options?: {
    hours?: number;
    confidenceScore?: number;
    difficulty?: number;
  },
): Promise<void> {
  const profile = await getOrCreateProfile(userId);
  profile.eventsCompleted += 1;
  await profile.save();
  await addKarma(userId, karmaEarned, {
    ...options,
    isCheckIn: true,
    isApproved: true,
  });
}

// ---------------------------------------------------------------------------
// Daily Decay
// ---------------------------------------------------------------------------

/**
 * Apply daily decay to all karma profiles.
 * Returns counts of processed and decayed profiles.
 * Skips profiles with no active karma or very recent activity.
 */
/**
 * Apply decay to all active karma profiles.
 *
 * BE-KAR-009 FIX: Uses a distributed lock (Redis) to prevent concurrent decay
 * applications on the same user profile. Each user gets locked during decay check
 * to prevent double-decay.
 */
export async function applyDecayToAll(): Promise<{
  processed: number;
  decayed: number;
  levelDrops: number;
}> {
  const profiles = await KarmaProfile.find({ activeKarma: { $gt: 0 } }).lean();

  let decayedCount = 0;
  let levelDrops = 0;

  for (const raw of profiles) {
    const userId = raw.userId.toString();
    const lockKey = `decay-lock:${userId}`;
    const lockToken = randomUUID();

    // BE-KAR-009 FIX: Acquire distributed lock (10s TTL)
    const lockAcquired = await redis.set(lockKey, lockToken, 'NX', 'EX', 10);
    if (!lockAcquired) {
      // Another process is decaying this user, skip
      logger.debug(`Decay lock contention on user ${userId}, skipping`);
      continue;
    }

    try {
      const profile = await KarmaProfile.findById(raw._id);
      if (!profile) continue;

      // Cast the document to a plain object compatible with applyDailyDecay
      const plainProfile = profile as unknown as {
        activeKarma: number;
        level: Level;
        lastActivityAt: Date | null;
        lastDecayAppliedAt?: Date | null;
        levelHistory: Array<{ level: string; earnedAt: Date; droppedAt?: Date }>;
      };
      const delta = applyDailyDecay(plainProfile as Parameters<typeof applyDailyDecay>[0], profile.userTimezone);

      if (delta.activeKarmaChange === 0) continue;

      decayedCount += 1;
      const newActiveKarma = Math.max(0, profile.activeKarma + delta.activeKarmaChange);
      profile.activeKarma = newActiveKarma;

      // BE-KAR-001 FIX: Persist lastDecayAppliedAt so decay is not reapplied today
      if (delta.lastDecayAppliedAt) {
        (profile as any).lastDecayAppliedAt = delta.lastDecayAppliedAt;
      }

      if (delta.levelChange && delta.newLevel) {
        levelDrops += 1;
        const lastEntry = profile.levelHistory[profile.levelHistory.length - 1];
        if (lastEntry && !lastEntry.droppedAt) {
          lastEntry.droppedAt = new Date();
        }
        profile.level = delta.newLevel;
        const entry: ILevelHistoryEntry = {
          level: delta.newLevel,
          earnedAt: new Date(),
          reason: 'decay', // BE-KAR-007 FIX: Record decay as reason
        };
        profile.levelHistory.push(entry);
        logger.info(
          `User ${profile.userId.toString()} level dropped from ${delta.oldLevel} to ${delta.newLevel} due to decay`,
        );
      }

      await profile.save();
    } finally {
      // BE-KAR-009 FIX: Always release the lock
      const lockStillHeld = await redis.get(lockKey);
      if (lockStillHeld === lockToken) {
        await redis.del(lockKey);
      }
    }
  }

  logger.info(
    `Decay job complete: processed=${profiles.length}, decayed=${decayedCount}, levelDrops=${levelDrops}`,
  );

  return {
    processed: profiles.length,
    decayed: decayedCount,
    levelDrops,
  };
}

// ---------------------------------------------------------------------------
// Level Info
// ---------------------------------------------------------------------------

/**
 * Get level information for a user including next level threshold.
 */
export async function getLevelInfo(userId: string): Promise<LevelInfo> {
  const profile = await getOrCreateProfile(userId);
  const level = profile.level as Level;
  return {
    level,
    conversionRate: getConversionRate(level) as ConversionRate,
    nextLevelAt: nextLevelThreshold(level),
    activeKarma: profile.activeKarma,
  };
}

// ---------------------------------------------------------------------------
// Conversion History
// ---------------------------------------------------------------------------

/**
 * Record a conversion event in the user's profile history.
 */
export async function recordConversion(
  userId: string,
  karmaConverted: number,
  coinsEarned: number,
  rate: number,
  batchId: mongoose.Types.ObjectId,
): Promise<void> {
  const profile = await KarmaProfile.findOne({ userId });
  if (!profile) {
    logger.warn(`Cannot record conversion: profile not found for user ${userId}`);
    return;
  }

  const entry = {
    karmaConverted,
    coinsEarned,
    rate,
    batchId,
    convertedAt: new Date(),
  };

  profile.conversionHistory.push(entry);

  // Keep last 100 conversion entries
  if (profile.conversionHistory.length > 100) {
    profile.conversionHistory = profile.conversionHistory.slice(-100) as typeof profile.conversionHistory;
  }

  await profile.save();
  logger.info(
    `Recorded conversion for ${userId}: ${karmaConverted} karma → ${coinsEarned} coins @ ${rate * 100}% (batch ${batchId})`,
  );
}

// ---------------------------------------------------------------------------
// Weekly Karma Tracking
// ---------------------------------------------------------------------------

/**
 * Get the total karma converted (used) by a user within a given week.
 * If weekOf is not provided, defaults to the current week.
 */
export async function getWeeklyKarmaUsed(
  userId: string,
  weekOf?: Date,
): Promise<number> {
  const profile = await getOrCreateProfile(userId);
  const targetWeek = weekOf
    ? moment(weekOf).startOf('week')
    : moment().startOf('week');

  if (
    profile.weekOfLastKarmaEarned &&
    moment(profile.weekOfLastKarmaEarned).startOf('week').isSame(targetWeek)
  ) {
    return profile.thisWeekKarmaEarned;
  }

  return 0;
}

// ---------------------------------------------------------------------------
// Karma History
// ---------------------------------------------------------------------------

/**
 * Get the conversion history for a user, most recent first.
 */
export async function getKarmaHistory(
  userId: string,
  limit = 20,
): Promise<Array<{ karmaConverted: number; coinsEarned: number; rate: number; batchId: string; convertedAt: Date }>> {
  const profile = await getOrCreateProfile(userId);
  return profile.conversionHistory
    .slice()
    .reverse()
    .slice(0, limit)
    .map((entry) => ({
      karmaConverted: entry.karmaConverted,
      coinsEarned: entry.coinsEarned,
      rate: entry.rate,
      batchId: entry.batchId.toString(),
      convertedAt: entry.convertedAt,
    }));
}
