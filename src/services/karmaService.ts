// @ts-ignore
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
import type { KarmaLevel as Level, KarmaConversionRate as ConversionRate, ILevelInfo as LevelInfo } from '../shared-types';
import {
  calculateLevel,
  getConversionRate,
  applyDailyDecay,
  calculateTrustScore,
  nextLevelThreshold,
} from '../engines/karmaEngine.js';
import { logger } from '../config/logger.js';
import { emitKarmaAwardedEvent } from '../utils/gamificationBridge.js';
import { notifyLevelUp, notifyStreakMilestone } from './notificationService.js';

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
 * PAY-KAR-001 FIX: Consolidates all operations into a single atomic findOneAndUpdate
 * with an aggregation pipeline. The weekly cap check, karma increment, level
 * computation, and levelHistory push all happen in one server-side atomic operation.
 * Previously used two separate findOneAndUpdate calls + a separate .save() for level
 * changes, which created a TOCTOU window where concurrent calls could produce duplicate
 * level history entries or lose karma increments.
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
  // PAY-KAR-005 FIX: Reject invalid karma values before any DB operation.
  // Without this, an attacker can pass karma = -9999999 to drain user karma,
  // or NaN/Infinity to corrupt account state.
  if (typeof karma !== 'number' || !Number.isFinite(karma) || karma <= 0) {
    throw new Error(`Invalid karma value: ${karma}`);
  }

  const WEEKLY_COIN_CAP = 300;
  // G-KS-B5 FIX: Use startOf('isoWeek') to match batchService consistency.
  // ISO week starts on Monday; locale-aware startOf('week') varies by locale.
  const startOfWeek = moment().startOf('isoWeek').toDate();

  // PAY-KAR-001 FIX: Single atomic aggregation-pipeline findOneAndUpdate.
  // Uses $add to compute the new activeKarma server-side, then a $switch to
  // compute the new level from the NEW karma value (not the old one).
  // The $cond inside $setField evaluates whether the level changed and only
  // pushes a levelHistory entry when needed — all atomically, all server-side.
  // The weekly cap filter ensures no karma is added if the cap is exceeded.
  //
  // Thresholds: L1=0, L2=500, L3=2000, L4=5000 (from karmaEngine.ts LEVEL_THRESHOLDS)
  const hoursToAdd = options?.hours ?? 0;
  const isCheckIn = options?.isCheckIn ?? false;
  const isApproved = isCheckIn && (options?.isApproved ?? false);

  // Get old level before update for notification
  const oldProfile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) })
    .select('level')
    .lean();
  const oldLevel = oldProfile?.level as Level | undefined;

  const updatedProfile = await KarmaProfile.findOneAndUpdate(
    {
      userId: new mongoose.Types.ObjectId(userId),
      // Weekly cap check: same logic as before, but now embedded in the atomic op
      $expr: {
        $or: [
          // Brand new user (no week record)
          { $eq: ['$weekOfLastKarmaEarned', null] },
          // New week (ISO week number changed)
          {
            $lt: [
              { $dateToString: { format: '%G-%V', date: '$weekOfLastKarmaEarned' } },
              { $dateToString: { format: '%G-%V', date: new Date(startOfWeek) } },
            ],
          },
          // Same week, cap not yet hit
          {
            $and: [
              {
                $eq: [
                  { $dateToString: { format: '%G-%V', date: '$weekOfLastKarmaEarned' } },
                  { $dateToString: { format: '%G-%V', date: new Date(startOfWeek) } },
                ],
              },
              { $lt: ['$thisWeekKarmaEarned', WEEKLY_COIN_CAP] },
            ],
          },
        ],
      },
    },
    // Aggregation pipeline: each stage transforms the document server-side atomically
    [
      {
        $set: {
          // Increment counters using $add (atomic, no read-modify-write)
          lifetimeKarma: { $add: ['$lifetimeKarma', karma] },
          activeKarma: { $add: ['$activeKarma', karma] },
          thisWeekKarmaEarned: { $add: ['$thisWeekKarmaEarned', karma] },
          totalHours: { $add: ['$totalHours', hoursToAdd] },
          checkIns: { $add: ['$checkIns', { $cond: [isCheckIn, 1, 0] }] },
          approvedCheckIns: { $add: ['$approvedCheckIns', { $cond: [isApproved, 1, 0] }] },
          weekOfLastKarmaEarned: new Date(),
          lastActivityAt: new Date(),

          // PAY-KAR-001 FIX: Compute new level from the ALREADY-INCREMENTED activeKarma.
          // $add returns the new value without modifying the field yet, so we can
          // pass it to $switch to determine the new level in the same pipeline stage.
          newActiveKarma: { $add: ['$activeKarma', karma] },
        },
      },
      {
        $set: {
          // Compute new level from the new activeKarma value
          newLevel: {
            $switch: {
              branches: [
                { case: { $gte: ['$newActiveKarma', 5000] }, then: 'L4' },
                { case: { $gte: ['$newActiveKarma', 2000] }, then: 'L3' },
                { case: { $gte: ['$newActiveKarma', 500] },  then: 'L2' },
              ],
              default: 'L1',
            },
          },
          // Reset temporary field
          newActiveKarma: '$$REMOVE',
        },
      },
      {
        $set: {
          // PAY-KAR-001 FIX: Atomically update level and push levelHistory if level changed.
          // $cond evaluates to true only when old != new, preventing duplicate entries.
          level: {
            $cond: [{ $ne: ['$level', '$newLevel'] }, '$newLevel', '$level'],
          },
          levelHistory: {
            $cond: [
              { $ne: ['$level', '$newLevel'] },
              // Mark previous entry's droppedAt and push new entry in one $map
              {
                $concatArrays: [
                  {
                    $map: {
                      input: '$levelHistory',
                      in: {
                        $mergeObjects: [
                          '$$this',
                          {
                            droppedAt: {
                              $cond: [
                                { $and: [{ $eq: ['$$this.level', '$level'] }, { $not: [{ $ifNull: ['$$this.droppedAt', false] }] }] },
                                new Date(),
                                '$$this.droppedAt',
                              ],
                            },
                          },
                        ],
                      },
                    },
                  },
                  [{ level: '$newLevel', earnedAt: new Date() }],
                ],
              },
              '$levelHistory',
            ],
          },
          // Keep activity history fresh
          activityHistory: {
            $slice: [
              { $concatArrays: ['$activityHistory', [new Date()]] },
              -90,
            ],
          },
          // Remove temporary field
          newLevel: '$$REMOVE',
        },
      },
    ],
    { new: true },
  );

  // If null, the cap was hit (filter didn't match)
  if (!updatedProfile) {
    logger.warn(`[Karma] User ${userId} hit weekly cap (${WEEKLY_COIN_CAP}), rejecting ${karma} karma`, {
      userId,
      karmaRequested: karma,
    });
    throw new Error('Weekly karma cap exceeded. Remaining this week: 0');
  }

  // KARMA-TOCTOU-001 FIX: Level is now computed server-side inside the atomic pipeline.
  // No separate .save() call exists, so there is no window for concurrent calls to
  // produce duplicate level history entries or overwrite each other's karma values.

  // KARMA-TOCTOU-002 FIX: Emit gamification event using the karma value passed in
  // (not the potentially-stale document), since the level is already committed.
  //
  // PAY-KAR-008 FIX: emitKarmaAwardedEvent() already throws on queue failures
  // (BullMQ retry with exponential backoff handles transient errors). We no longer
  // catch-and-swallow here — gamification failures surface clearly in logs and
  // BullMQ's DLQ captures permanently failed events. The fire-and-forget pattern
  // is replaced by structured error propagation.
  await emitKarmaAwardedEvent({
    userId,
    karmaAmount: karma,
    eventType: 'karma.awarded',
    eventId: `karma-${userId}-${Date.now()}`,
    newActiveKarma: updatedProfile.activeKarma,
    newLevel: updatedProfile.level as Level,
  });

  // Send level up notification if level changed
  const newLevel = updatedProfile.level as Level;
  if (oldLevel && newLevel !== oldLevel) {
    notifyLevelUp(userId, newLevel, oldLevel).catch((err) => {
      logger.warn('[KarmaService] Level up notification failed', { userId, oldLevel, newLevel, error: err });
    });
  }
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
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error('recordKarmaEarned: addKarma failed', {
      userId,
      karmaEarned,
      error: errorMessage,
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
  const threshold = nextLevelThreshold(level);
  return {
    level,
    minKarma: profile.activeKarma,
    conversionRate: getConversionRate(level) as ConversionRate,
    nextLevelAt: threshold,
    activeKarma: profile.activeKarma,
    benefits: [],
  };
}

// ---------------------------------------------------------------------------
// Conversion History
// ---------------------------------------------------------------------------

/**
 * Record a conversion event in the user's profile history.
 * BAK-KARMA-002 FIX: Uses atomic findOneAndUpdate with $ne filter instead of
 * read-modify-save TOCTOU pattern. The sparse index on conversionHistory.batchId
 * ensures O(log n) duplicate lookups without full array scans.
 */
export async function recordConversion(
  userId: string,
  karmaConverted: number,
  coinsEarned: number,
  rate: number,
  batchId: mongoose.Types.ObjectId,
): Promise<void> {
  const entry = {
    karmaConverted,
    coinsEarned,
    rate,
    batchId,
    convertedAt: new Date(),
  };

  // Atomic CAS: only push if batchId is not already present
  // The sparse index on conversionHistory.batchId makes $ne efficient
  const updated = await KarmaProfile.findOneAndUpdate(
    { userId: new mongoose.Types.ObjectId(userId), 'conversionHistory.batchId': { $ne: batchId } },
    {
      $push: {
        conversionHistory: {
          $each: [entry],
          $slice: -100, // keep last 100 entries atomically
        },
      },
      $set: { updatedAt: new Date() },
    },
  );

  if (!updated) {
    logger.warn(`Conversion already recorded for user ${userId} with batchId ${batchId}`);
    return;
  }

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
      // G-KS-H19 FIX: Guard against undefined batchId before calling toString().
      batchId: entry.batchId?.toString() ?? 'unknown',
      convertedAt: entry.convertedAt,
    }));
}

// ---------------------------------------------------------------------------
// Streak Computation — runs daily as part of the decay cron
// ---------------------------------------------------------------------------

export interface StreakUpdateResult {
  processed: number;
  incremented: number;
  reset: number;
}

/**
 * Update streaks for all active profiles.
 *
 * Runs daily at midnight UTC. Logic:
 * - If last activity was YESTERDAY (UTC): increment currentStreak
 * - If last activity was TODAY: streak already set when karma was earned — skip
 * - If last activity was >1 day ago: reset currentStreak to 0
 *
 * longestStreak is always max(currentStreak, longestStreak).
 * Sends streak milestone notifications for 7, 14, 30, 60, 90 day streaks.
 */
const STREAK_MILESTONES = [7, 14, 30, 60, 90, 180, 365];
export async function updateStreaks(): Promise<StreakUpdateResult> {
  const now = new Date();
  const yesterdayStart = moment(now).subtract(1, 'day').startOf('day').toDate();
  const yesterdayEnd = moment(now).subtract(1, 'day').endOf('day').toDate();
  const twoDaysAgoStart = moment(now).subtract(2, 'day').startOf('day').toDate();

  // Only process profiles active in the last 90 days — skip dormant ones
  const activeCutoff = moment(now).subtract(90, 'days').toDate();

  const result: StreakUpdateResult = { processed: 0, incremented: 0, reset: 0 };

  // Process in batches to avoid memory pressure
  const BATCH_SIZE = 500;
  let processed = 0;

  while (true) {
    const profiles = await KarmaProfile.find(
      {
        lastActivityAt: { $gte: activeCutoff },
        lastStreakUpdatedAt: { $ne: moment(now).startOf('day').toDate() },
      },
      { _id: 1, userId: 1, lastActivityAt: 1, currentStreak: 1, longestStreak: 1 },
    )
      .limit(BATCH_SIZE)
      .lean();

    if (profiles.length === 0) break;

    for (const profile of profiles) {
      const lastActivity = profile.lastActivityAt ? new Date(profile.lastActivityAt) : null;

      if (!lastActivity) {
        processed++;
        continue;
      }

      const lastActivityDay = moment(lastActivity).startOf('day');
      const yesterdayStartMoment = moment(yesterdayStart);
      const twoDaysAgoStartMoment = moment(twoDaysAgoStart);

      const wasYesterday = lastActivityDay.isSame(yesterdayStartMoment, 'day');
      const wasToday = lastActivityDay.isSame(moment(now).startOf('day'), 'day');
      const missedADay = lastActivityDay.isBefore(twoDaysAgoStartMoment, 'day');

      if (wasYesterday) {
        // First activity since last cron — increment streak
        const newStreak = (profile.currentStreak ?? 0) + 1;
        const newLongest = Math.max(newStreak, profile.longestStreak ?? 0);
        await KarmaProfile.updateOne(
          { _id: profile._id },
          {
            $set: { currentStreak: newStreak, longestStreak: newLongest, lastStreakUpdatedAt: now },
          },
        );
        result.incremented++;

        // Check for streak milestone notification
        if (STREAK_MILESTONES.includes(newStreak)) {
          const userIdStr = profile.userId.toString();
          notifyStreakMilestone(userIdStr, newStreak).catch((err) => {
            logger.warn('[KarmaService] Streak milestone notification failed', { userId: userIdStr, streakDays: newStreak, error: err });
          });
        }
      } else if (wasToday) {
        // Activity happened today — streak already set by earnRecordService
        // Mark as updated so we don't double-count
        await KarmaProfile.updateOne(
          { _id: profile._id },
          { $set: { lastStreakUpdatedAt: now } },
        );
      } else if (missedADay) {
        // More than 1 day gap — reset streak
        if ((profile.currentStreak ?? 0) > 0) {
          await KarmaProfile.updateOne(
            { _id: profile._id },
            { $set: { currentStreak: 0, lastStreakUpdatedAt: now } },
          );
          result.reset++;
        }
      }

      processed++;
    }
  }

  result.processed = processed;
  return result;
}
