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
import { getConversionRate } from '../engines/karmaEngine.js';
import type { VerificationSignals, EarnRecordStatus, Level } from '../types/index.js';

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

  await record.save();

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
  await updateProfileStats(userId, karmaEarned, confidenceScore, level);

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
    APPROVED_PENDING_CONVERSION: ['CONVERTED', 'REJECTED', 'ROLLED_BACK'],
    CONVERTED: ['ROLLED_BACK'],
    REJECTED: ['ROLLED_BACK'],
    ROLLED_BACK: [],
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
async function updateProfileStats(
  userId: string,
  karmaEarned: number,
  confidenceScore: number,
  level: Level,
): Promise<void> {
  try {
    const profile = await KarmaProfile.findOne({ userId });
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
        lastActivityAt: new Date(),
        activityHistory: [new Date()],
        avgConfidenceScore: confidenceScore,
      });
      await newProfile.save();
      return;
    }

    // Increment karma
    profile.lifetimeKarma += karmaEarned;
    profile.activeKarma += karmaEarned;
    profile.eventsCompleted += 1;
    profile.checkIns += 1;
    profile.avgConfidenceScore =
      (profile.avgConfidenceScore * (profile.checkIns - 1) + confidenceScore) / profile.checkIns;

    // Reset weekly tracking if needed
    const now = new Date();
    const weekStart = moment(now).startOf('isoWeek').toDate();
    if (!profile.weekOfLastKarmaEarned || moment(profile.weekOfLastKarmaEarned).startOf('isoWeek').toDate() < weekStart) {
      profile.thisWeekKarmaEarned = 0;
    }
    profile.thisWeekKarmaEarned += karmaEarned;
    profile.weekOfLastKarmaEarned = now;
    profile.lastActivityAt = now;
    profile.activityHistory = [...(profile.activityHistory ?? []), now].slice(-100); // keep last 100

    await profile.save();
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
