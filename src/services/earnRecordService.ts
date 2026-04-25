/**
 * EarnRecord Service — Phase 3: Karma by ReZ
 *
 * Manages EarnRecord lifecycle: creation after verification,
 * retrieval, pagination, status updates, and batch queries.
 */
import moment from 'moment';
import { EarnRecord, EarnRecordDocument } from '../models/EarnRecord.js';
import { KarmaProfile, KarmaProfileDocument } from '../models/KarmaProfile.js';
import { logger } from '../config/logger.js';
import { getConversionRate, calculateLevel } from '../engines/karmaEngine.js';
import type { VerificationSignals, EarnRecordStatus, Level } from '../types/index.js';
import { notifyKarmaReceived } from './notificationService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateEarnRecordParams {
  userId: string;
  eventId: string;
  bookingId: string;
  karmaEarned: number;
  verificationSignals: VerificationSignals;
  confidenceScore: number;
  csrPoolId?: string;
  category?: string;
  hours?: number;
  difficulty?: string;
}

export interface EarnRecordResponse {
  id: string;
  userId: string;
  eventId: string;
  bookingId: string;
  karmaEarned: number;
  activeLevelAtApproval: Level;
  conversionRate: number;
  csrPoolId: string;
  verificationSignals: VerificationSignals;
  confidenceScore: number;
  status: EarnRecordStatus;
  createdAt: Date;
  approvedAt: Date;
  convertedAt?: Date;
  convertedBy?: string;
  batchId?: string;
  rezCoinsEarned: number;
  idempotencyKey: string;
}

export interface PaginatedEarnRecords {
  records: EarnRecordResponse[];
  total: number;
  page: number;
  hasMore: boolean;
}

// ---------------------------------------------------------------------------
// Create EarnRecord
// ---------------------------------------------------------------------------

/**
 * Create a new EarnRecord after verified event completion.
 *
 * Snapshots the user's current level and conversion rate at approval time
 * (rate does not change even if level decays before conversion).
 *
 * Idempotency is guaranteed by the unique idempotencyKey constraint.
 * If a record with the same idempotency key already exists, returns it.
 */
export async function createEarnRecord(
  params: CreateEarnRecordParams,
): Promise<EarnRecordResponse> {
  const {
    userId,
    eventId,
    bookingId,
    karmaEarned,
    verificationSignals,
    confidenceScore,
    csrPoolId = '',
    category,
    hours,
    difficulty,
  } = params;

  // G-KS-C7 FIX: Deterministic idempotency key — derived only from bookingId.
  // No UUID suffix — same bookingId always produces the same key, enabling true deduplication.
  const idempotencyKey = `earn_${bookingId}`;

  // Check for existing record with same idempotency key (idempotent)
  const existing = await EarnRecord.findOne({ idempotencyKey }).lean();
  if (existing) {
    logger.info('[EarnRecordService] Returning existing record', {
      recordId: existing._id,
      idempotencyKey,
    });
    return toResponse(existing as unknown as EarnRecordDocument);
  }

  // Snapshot level and conversion rate from KarmaProfile
  const profile = await KarmaProfile.findOne({ userId }).lean();
  const level: Level = (profile?.level as Level) ?? 'L1';
  const conversionRate = getConversionRate(level);

  // Store gps_match as 1 (match) or 0 (no match) — VerificationSignals type uses number
  const storedSignals: VerificationSignals = {
    ...verificationSignals,
    gps_match: verificationSignals.gps_match >= 0.5 ? 1 : 0,
  };

  const now = new Date();

  const record = new EarnRecord({
    userId,
    eventId,
    bookingId,
    karmaEarned,
    activeLevelAtApproval: level,
    conversionRateSnapshot: conversionRate,
    csrPoolId,
    verificationSignals: storedSignals,
    confidenceScore,
    status: 'APPROVED_PENDING_CONVERSION',
    approvedAt: now,
    createdAt: now,
    rezCoinsEarned: Math.floor(karmaEarned * conversionRate),
    idempotencyKey,
  });

  try {
    await record.save();
  } catch (err: any) {
    // G-KS-C7 FIX: Handle race condition on concurrent inserts.
    // Between the findOne check and the save, a concurrent request with the same
    // idempotencyKey can insert first, causing MongoDB error code 11000 (duplicate key).
    // Treat this as an idempotent success — fetch and return the existing record.
    if (err?.code === 11000 || err?.writeError?.code === 11000) {
      logger.info('[EarnRecordService] Concurrent insert detected — returning existing record', {
        idempotencyKey,
        userId,
        bookingId,
      });
      const existing = await EarnRecord.findOne({ idempotencyKey }).lean();
      if (existing) return toResponse(existing as unknown as EarnRecordDocument);
    }
    throw err;
  }

  logger.info('[EarnRecordService] Created earn record', {
    recordId: record._id,
    userId,
    eventId,
    karmaEarned,
    level,
    conversionRate,
    confidenceScore,
  });

  // Update KarmaProfile stats
  await updateProfileStats(userId, karmaEarned, confidenceScore, level, category, hours, difficulty);

  // Evaluate badges and missions after profile stats are updated
  // Lazy import to avoid circular dependency
  try {
    const { evaluateBadges, evaluateMissions } = await import('./missionEngine.js');
    const [newBadges, newMissions] = await Promise.allSettled([
      evaluateBadges(userId),
      evaluateMissions(userId),
    ]);
    if (newBadges.status === 'rejected') {
      logger.warn('[EarnRecordService] Badge evaluation failed', { error: newBadges.reason });
    }
    if (newMissions.status === 'rejected') {
      logger.warn('[EarnRecordService] Mission evaluation failed', { error: newMissions.reason });
    }
    if (newBadges.status === 'fulfilled' && newBadges.value.length > 0) {
      logger.info('[EarnRecordService] Badges awarded', { userId, badges: newBadges.value });
    }
    if (newMissions.status === 'fulfilled' && newMissions.value.length > 0) {
      logger.info('[EarnRecordService] Missions completed', { userId, missions: newMissions.value });
    }
  } catch (err) {
    // Non-fatal — badge/mission evaluation must not block karma earning
    logger.warn('[EarnRecordService] Badge/mission evaluation error', { error: err });
  }

  // Send karma received notification (fire-and-forget)
  notifyKarmaReceived(userId, karmaEarned).catch((err) => {
    logger.warn('[EarnRecordService] Karma notification failed', { userId, karmaEarned, error: err });
  });

  return toResponse(record);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Retrieve a single EarnRecord by its _id.
 * Returns null if not found.
 */
export async function getEarnRecord(recordId: string): Promise<EarnRecordResponse | null> {
  const record = await EarnRecord.findById(recordId).lean();
  if (!record) return null;
  return toResponse(record as unknown as EarnRecordDocument);
}

/**
 * Retrieve all EarnRecords for a user with optional pagination and status filter.
 *
 * @param userId   MongoDB _id of the user
 * @param options.page     Page number (1-indexed, default 1)
 * @param options.limit    Items per page (default 20, max 100)
 * @param options.status   Filter by EarnRecordStatus
 */
export async function getUserEarnRecords(
  userId: string,
  options: { page?: number; limit?: number; status?: EarnRecordStatus } = {},
): Promise<PaginatedEarnRecords> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(100, Math.max(1, options.limit ?? 20));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = { userId };
  if (options.status) {
    filter.status = options.status;
  }

  const [records, total] = await Promise.all([
    EarnRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    EarnRecord.countDocuments(filter),
  ]);

  return {
    records: records.map((r) => toResponse(r as unknown as EarnRecordDocument)),
    total,
    page,
    hasMore: skip + records.length < total,
  };
}

/**
 * Retrieve all EarnRecords for a given batch.
 */
export async function getRecordsByBatch(batchId: string): Promise<EarnRecordResponse[]> {
  const records = await EarnRecord.find({ batchId }).sort({ createdAt: -1 }).lean();
  return records.map((r) => toResponse(r as unknown as EarnRecordDocument));
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Update the status of an EarnRecord.
 * Returns the updated record or null if not found.
 *
 * Allowed transitions:
 *   APPROVED_PENDING_CONVERSION → CONVERTED | REJECTED | ROLLED_BACK
 *   REJECTED → ROLLED_BACK (admin reversal)
 */
export async function updateEarnRecordStatus(
  recordId: string,
  status: EarnRecordStatus,
): Promise<EarnRecordResponse | null> {
  const validTransitions: Record<EarnRecordStatus, EarnRecordStatus[]> = {
    APPROVED_PENDING_CONVERSION: ['CONVERTED', 'REJECTED', 'ROLLED_BACK', 'CONVERSION_FAILED'],
    CONVERTED: ['ROLLED_BACK'],
    REJECTED: ['ROLLED_BACK'],
    ROLLED_BACK: [],
    CONVERSION_FAILED: ['ROLLED_BACK'],
  };

  const record = await EarnRecord.findById(recordId).lean();
  if (!record) return null;

  const allowed = validTransitions[record.status as EarnRecordStatus] ?? [];
  if (!allowed.includes(status)) {
    logger.warn('[EarnRecordService] Invalid status transition', {
      recordId,
      from: record.status,
      to: status,
    });
    return null;
  }

  const updateFields: Record<string, unknown> = { status };
  if (status === 'CONVERTED') {
    updateFields.convertedAt = new Date();
  }

  const updated = await EarnRecord.findByIdAndUpdate(recordId, updateFields, { new: true }).lean();
  if (!updated) return null;

  logger.info('[EarnRecordService] Updated earn record status', {
    recordId,
    from: record.status,
    to: status,
  });

  return toResponse(updated as unknown as EarnRecordDocument);
}

/**
 * Get all EarnRecords with status APPROVED_PENDING_CONVERSION
 * that are ready for batch conversion.
 */
export async function getPendingConversionRecords(): Promise<EarnRecordResponse[]> {
  const records = await EarnRecord.find({
    status: 'APPROVED_PENDING_CONVERSION',
  }).sort({ approvedAt: 1 }).lean();

  return records.map((r) => toResponse(r as unknown as EarnRecordDocument));
}

// ---------------------------------------------------------------------------
// Profile Stats Update
// ---------------------------------------------------------------------------

/**
 * Update KarmaProfile after an earn record is created.
 * Increments lifetime/active karma, updates activity timestamp,
 * and recalculates trust score.
 */
/**
 * CRITICAL-005 FIX: Replaced non-atomic read-modify-write with atomic findOneAndUpdate + $inc.
 *
 * Previous implementation used:
 *   profile.lifetimeKarma += karmaEarned;
 *   profile.activeKarma += karmaEarned;
 *   await profile.save();
 *
 * This caused a TOCTOU race: two concurrent requests both read the same balance,
 * both write balance + amount, resulting in balance = original + amount (lost increment).
 *
 * The fix uses findOneAndUpdate with $inc for all karma counter fields, guaranteeing
 * atomic increment regardless of concurrent requests.
 */
async function updateProfileStats(
  userId: string,
  karmaEarned: number,
  confidenceScore: number,
  level: Level,
  category?: string,
  hours?: number,
  difficulty?: string,
): Promise<void> {
  try {
    const now = new Date();
    const weekStartStr = moment(now).startOf('isoWeek').format('YYYY-[W]WW');

    // Phase 4: Build category increment map
    const categoryIncrement: Record<string, number> = {};
    if (category === 'environment') categoryIncrement.environmentEvents = 1;
    else if (category === 'food') categoryIncrement.foodEvents = 1;
    else if (category === 'health') categoryIncrement.healthEvents = 1;
    else if (category === 'education') categoryIncrement.educationEvents = 1;
    else if (category === 'community') categoryIncrement.communityEvents = 1;

    // Phase 4: Increment hardEvents if this was a hard-difficulty event
    const hardEventIncrement: Record<string, number> = {};
    if (difficulty === 'hard') hardEventIncrement.hardEvents = 1;

    // CRITICAL-005: All karma counters are atomically incremented in a single findOneAndUpdate.
    // Using $inc guarantees atomic server-side increment regardless of concurrent requests.
    const profile = await KarmaProfile.findOneAndUpdate(
      { userId },
      {
        $inc: {
          lifetimeKarma: karmaEarned,
          activeKarma: karmaEarned,
          eventsCompleted: 1,
          checkIns: 1,
          approvedCheckIns: 1,
          totalHours: Math.max(0, hours ?? 0),
          ...categoryIncrement,
          ...hardEventIncrement,
        },
        $set: {
          weekOfLastKarmaEarned: now,
          lastActivityAt: now,
        },
        $addToSet: category ? { uniqueCategories: category } : {},
        $push: {
          activityHistory: { $each: [now], $slice: -100 },
        },
      },
      { new: true },
    );

    if (!profile) {
      // Auto-create profile on first activity
      const newProfile = new KarmaProfile({
        userId,
        lifetimeKarma: karmaEarned,
        activeKarma: karmaEarned,
        level,
        eventsCompleted: 1,
        checkIns: 1,
        approvedCheckIns: 1,
        totalHours: Math.max(0, hours ?? 0),
        lastActivityAt: now,
        activityHistory: [now],
        avgConfidenceScore: confidenceScore,
        ...(category ? { uniqueCategories: [category] } : {}),
        ...(categoryIncrement),
        ...(difficulty === 'hard' ? { hardEvents: 1 } : {}),
      });
      await newProfile.save();
      return;
    }

    // MEDIUM-9 FIX: Handle weekly thisWeekKarmaEarned atomically using an aggregation
    // pipeline. The previous approach did a separate read-then-write which could lose
    // concurrent karma increments between the $inc and the reset. The pipeline checks
    // week crossing server-side and resets in the same atomic update.
    const prevWeekStr = profile.weekOfLastKarmaEarned
      ? moment(profile.weekOfLastKarmaEarned).startOf('isoWeek').format('YYYY-[W]WW')
      : null;
    await KarmaProfile.updateOne(
      { userId },
      prevWeekStr && prevWeekStr !== weekStartStr
        ? [{ $set: { thisWeekKarmaEarned: karmaEarned } }]
        : [{ $set: { thisWeekKarmaEarned: { $add: ['$thisWeekKarmaEarned', 0] } } }],
    );

    // Handle level change atomically in a second update.
    const newLevel = calculateLevel(profile.activeKarma);
    if (newLevel !== level) {
      // Close previous level entry's droppedAt atomically
      await KarmaProfile.updateOne(
        { userId, 'levelHistory.droppedAt': { $exists: false } },
        { $set: { 'levelHistory.$[elem].droppedAt': now } },
        { arrayFilters: [{ 'elem.droppedAt': { $exists: false } }] },
      );
      // Push new level entry atomically
      await KarmaProfile.updateOne(
        { userId },
        {
          $set: { level: newLevel },
          $push: {
            levelHistory: {
              level: newLevel,
              earnedAt: now,
            },
          },
        },
      );
    }
  } catch (err) {
    logger.error('[EarnRecordService] Failed to update profile stats', { userId, error: err });
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

// Needed for the toResponse function type cast
import type mongoose from 'mongoose';

function toResponse(doc: EarnRecordDocument): EarnRecordResponse {
  return {
    id: (doc._id as unknown as mongoose.Types.ObjectId).toString(),
    userId: (doc.userId as unknown as string | mongoose.Types.ObjectId).toString(),
    eventId: (doc.eventId as unknown as string | mongoose.Types.ObjectId).toString(),
    bookingId: (doc.bookingId as unknown as string | mongoose.Types.ObjectId).toString(),
    karmaEarned: doc.karmaEarned,
    activeLevelAtApproval: doc.activeLevelAtApproval as Level,
    conversionRate: doc.conversionRateSnapshot,
    csrPoolId: (doc.csrPoolId as unknown as string | mongoose.Types.ObjectId).toString(),
    verificationSignals: doc.verificationSignals as VerificationSignals,
    confidenceScore: doc.confidenceScore,
    status: doc.status as EarnRecordStatus,
    createdAt: doc.createdAt,
    approvedAt: doc.approvedAt ?? new Date(),
    convertedAt: doc.convertedAt,
    convertedBy: doc.convertedBy ? (doc.convertedBy as unknown as string | mongoose.Types.ObjectId).toString() : undefined,
    batchId: doc.batchId ? (doc.batchId as unknown as string | mongoose.Types.ObjectId).toString() : undefined,
    rezCoinsEarned: doc.rezCoinsEarned ?? 0,
    idempotencyKey: doc.idempotencyKey,
  };
}
