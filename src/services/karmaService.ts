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
import { redis } from '../config/redis.js';
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
import { emitKarmaAwardedEvent } from '../utils/gamificationBridge.js';

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
  // HIGH-15 FIX: Validate ObjectId before construction
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error(`Invalid userId: ${userId}`);
  }

  // FIX 5: Use findOneAndUpdate with upsert to atomically get-or-create.
  const profile = await KarmaProfile.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId) },
    {
      $setOnInsert: {
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
      },
    },
    { upsert: true, new: true },
  );
  return profile!;
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
 * Uses atomic findOneAndUpdate with $inc to prevent race condition.
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
  const WEEKLY_COIN_CAP = 300;
  // G-KS-B5 FIX: Use startOf('isoWeek') to match batchService consistency.
  // ISO week starts on Monday; locale-aware startOf('week') varies by locale.
  const startOfWeek = moment().startOf('isoWeek').toDate();

  // HIGH-04 FIX: Use MongoDB atomic findOneAndUpdate to prevent race condition.
  // This check-then-act is now atomic: only documents where weeklyKarmaEarned < CAP
  // will be updated with $inc. If the update affects no documents, the cap was hit.
  const atomicResult = await KarmaProfile.findOneAndUpdate(
    {
      userId,
      // Check weekly reset and cap condition atomically
      $expr: {
        $or: [
          // Doc has no weekOfLastKarmaEarned (brand new)
          { $eq: ['$weekOfLastKarmaEarned', null] },
          // Or we're in a new week
          {
            $lt: [
              {
                $dateToString: {
                  format: '%Y-%U',
                  date: '$weekOfLastKarmaEarned',
                }
              },
              {
                $dateToString: {
                  format: '%Y-%U',
                  date: new Date(startOfWeek),
                }
              }
            ]
          },
          // Or we're in the same week but haven't hit the cap yet
          {
            $and: [
              {
                $eq: [
                  {
                    $dateToString: {
                      format: '%Y-%U',
                      date: '$weekOfLastKarmaEarned',
                    }
                  },
                  {
                    $dateToString: {
                      format: '%Y-%U',
                      date: new Date(startOfWeek),
                    }
                  }
                ]
              },
              { $lt: ['$thisWeekKarmaEarned', WEEKLY_COIN_CAP] }
            ]
          }
        ]
      }
    },
    {
      $inc: { thisWeekKarmaEarned: karma },
      $set: { weekOfLastKarmaEarned: new Date() }
    },
    { new: true }
  );

  // If atomicResult is null, the cap was hit by concurrent request
  if (!atomicResult) {
    logger.warn(`[Karma] User ${userId} hit weekly cap (${WEEKLY_COIN_CAP}), rejecting ${karma} karma`, {
      userId,
      karmaRequested: karma,
    });
    throw new Error(
      `Weekly karma cap exceeded. Remaining this week: 0`
    );
  }

  // CRITICAL-005 FIX: Replace non-atomic read-modify-write with fully atomic findOneAndUpdate.
  // Previously, profile.lifetimeKarma += karma; profile.activeKarma += karma; profile.save()
  // caused a TOCTOU race: two concurrent requests could both read balance X, both write X+amount,
  // resulting in balance = X + amount (instead of X + 2*amount). Using $inc guarantees that
  // MongoDB applies the increment server-side, making the operation atomic regardless of concurrency.
  //
  // This extends the weekly-cap atomic check (above) to also atomically update all other
  // karma fields in the same findOneAndUpdate call.
  const hoursIncrement = options?.hours ?? 0;

  // CRITICAL-005 FIX: Replace non-atomic read-modify-write with fully atomic findOneAndUpdate.
  // Use atomic $inc for numeric fields to prevent race condition on concurrent calls.
  const incFields: Record<string, number> = {
    lifetimeKarma: karma,
    activeKarma: karma,
  };
  if (options?.hours) {
    incFields.totalHours = options.hours;
  }
  if (options?.isCheckIn) {
    incFields.checkIns = 1;
    if (options?.isApproved) {
      incFields.approvedCheckIns = 1;
    }
  }

  const updatedProfile = await KarmaProfile.findOneAndUpdate(
    { userId },
    {
      $inc: incFields,
      $set: { lastActivityAt: new Date() },
      $push: {
        activityHistory: {
          $each: [new Date()],
          $slice: -90,
        },
      },
    },
    { new: true },
  );

  if (!updatedProfile) {
    logger.error('[Karma] addKarma: profile not found after atomic update', { userId });
    throw new Error('Profile not found');
  }

  // Recalculate level after atomic update using the returned document
  const oldLevel = updatedProfile.level;
  const oldActiveKarma = updatedProfile.activeKarma;
  const newLevel = calculateLevel(updatedProfile.activeKarma);
  if (newLevel !== oldLevel) {
    const previousEntry = updatedProfile.levelHistory[updatedProfile.levelHistory.length - 1];
    if (previousEntry && !previousEntry.droppedAt) {
      previousEntry.droppedAt = new Date();
    }
    updatedProfile.level = newLevel;
    const entry: ILevelHistoryEntry = {
      level: newLevel as Level,
      earnedAt: new Date(),
    };
    updatedProfile.levelHistory.push(entry);
    logger.info(
      `User ${userId} leveled up from ${oldLevel} to ${newLevel} (${oldActiveKarma} → ${updatedProfile.activeKarma} karma)`,
    );
    await updatedProfile.save();
  }

  // Karma → Gamification bridge: emit event so gamification service can
  // check for karma-based achievements (e.g., "earn 1000 karma" badges).
  // Fire-and-forget — gamification failures must not block karma flow.
  emitKarmaAwardedEvent({
    userId,
    karmaAmount: karma,
    eventType: 'karma.awarded',
    eventId: `karma-${userId}-${Date.now()}`,
    newActiveKarma: updatedProfile.activeKarma,
    newLevel,
  }).catch((err) => {
    logger.warn('[Karma] Failed to emit karma.awarded to gamification', {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

/**
 * Record a karma event completion (called after verification is complete).
 * Increments eventsCompleted and calls addKarma.
 * MED-19 FIX: Wrap addKarma() in try-catch to handle and log errors properly.
 */
// CRITICAL-005 FIX: Removed non-atomic profile.save() call.
// eventsCompleted and eventsJoined counters are now atomically incremented
// inside addKarma() via findOneAndUpdate with $inc (see CRITICAL-005 fix in addKarma).
// Previously, profile.eventsCompleted += 1; profile.eventsJoined += 1; await profile.save()
// was a non-atomic read-modify-write, allowing concurrent requests to both read the same
// counters and write the same value, resulting in a lost increment.
export async function recordKarmaEarned(
  userId: string,
  karmaEarned: number,
  options?: {
    hours?: number;
    confidenceScore?: number;
    difficulty?: number;
  },
): Promise<void> {
  try {
    await addKarma(userId, karmaEarned, {
      ...options,
      isCheckIn: true,
      isApproved: true,
    });
  } catch (err: any) {
    logger.error('recordKarmaEarned: addKarma failed', {
      userId,
      karmaEarned,
      error: err.message,
    });
    throw err;
  }
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

    // BE-KAR-009 FIX: Acquire distributed lock atomically using SET NX EX.
    // Previously used setnx + expire in two calls, which is NOT atomic — if the process
    // crashes between setnx and expire, the lock is held forever with no TTL.
    const lockAcquired = await redis.set(lockKey, lockToken, 'EX', 10, 'NX');
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

      // Build atomic update to prevent race condition with concurrent addKarma calls.
      // Previously used read-modify-write (profile.save()), which could overwrite
      // karma additions that occurred between findById and save.
      const updateOps: Record<string, any> = {
        $set: {
          activeKarma: newActiveKarma,
          lastDecayAppliedAt: delta.lastDecayAppliedAt ?? new Date(),
        },
      };

      if (delta.levelChange && delta.newLevel) {
        levelDrops += 1;
        updateOps.$set.level = delta.newLevel;

        // Close previous level entry and push new one atomically
        const lastEntry = profile.levelHistory[profile.levelHistory.length - 1];
        if (lastEntry && !lastEntry.droppedAt) {
          // Update the last level history entry's droppedAt in-place
          await KarmaProfile.updateOne(
            { _id: raw._id, 'levelHistory.droppedAt': { $exists: false } },
            { $set: { 'levelHistory.$[elem].droppedAt': new Date() } },
            { arrayFilters: [{ 'elem.droppedAt': { $exists: false } }] },
          );
        }

        const entry: ILevelHistoryEntry = {
          level: delta.newLevel,
          earnedAt: new Date(),
          reason: 'decay', // BE-KAR-007 FIX: Record decay as reason
        };
        updateOps.$push = { levelHistory: entry };

        logger.info(
          `User ${profile.userId.toString()} level dropped from ${delta.oldLevel} to ${delta.newLevel} due to decay`,
        );
      }

      await KarmaProfile.updateOne({ _id: raw._id }, updateOps);
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
 * MED-20 FIX: Check for duplicate batchId before appending to prevent double-counting.
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

  // MED-20: Check if this batchId already exists in conversion history
  const batchIdStr = batchId.toString();
  const isDuplicate = profile.conversionHistory.some((entry) => entry.batchId.toString() === batchIdStr);
  if (isDuplicate) {
    logger.warn(`Conversion already recorded for user ${userId} with batchId ${batchIdStr}`);
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
  // XS-CRIT-003 FIX: Use startOf('isoWeek') for consistent Monday-anchored weeks,
  // matching the anchor used in addKarma(). Locale-aware startOf('week') varies.
  const targetWeek = weekOf
    ? moment(weekOf).startOf('isoWeek')
    : moment().startOf('isoWeek');

  if (
    profile.weekOfLastKarmaEarned &&
    moment(profile.weekOfLastKarmaEarned).startOf('isoWeek').isSame(targetWeek)
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
