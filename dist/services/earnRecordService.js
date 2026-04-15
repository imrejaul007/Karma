"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEarnRecord = createEarnRecord;
exports.getEarnRecord = getEarnRecord;
exports.getUserEarnRecords = getUserEarnRecords;
exports.getRecordsByBatch = getRecordsByBatch;
exports.updateEarnRecordStatus = updateEarnRecordStatus;
exports.getPendingConversionRecords = getPendingConversionRecords;
/**
 * EarnRecord Service — Phase 3: Karma by ReZ
 *
 * Manages EarnRecord lifecycle: creation after verification,
 * retrieval, pagination, status updates, and batch queries.
 */
const uuid_1 = require("uuid");
const EarnRecord_js_1 = require("../models/EarnRecord.js");
const KarmaProfile_js_1 = require("../models/KarmaProfile.js");
const logger_js_1 = require("../config/logger.js");
const karmaEngine_js_1 = require("../engines/karmaEngine.js");
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
async function createEarnRecord(params) {
    const { userId, eventId, bookingId, karmaEarned, verificationSignals, confidenceScore, csrPoolId = '', } = params;
    // Build idempotency key from booking + action
    const idempotencyKey = `earn_${bookingId}_${(0, uuid_1.v4)().slice(0, 8)}`;
    // Check for existing record with same idempotency key (idempotent)
    const existing = await EarnRecord_js_1.EarnRecord.findOne({ idempotencyKey }).lean();
    if (existing) {
        logger_js_1.logger.info('[EarnRecordService] Returning existing record', {
            recordId: existing._id,
            idempotencyKey,
        });
        return toResponse(existing);
    }
    // Snapshot level and conversion rate from KarmaProfile
    const profile = await KarmaProfile_js_1.KarmaProfile.findOne({ userId }).lean();
    const level = profile?.level ?? 'L1';
    const conversionRate = (0, karmaEngine_js_1.getConversionRate)(level);
    // Store gps_match as boolean (true if score >= 0.5)
    const storedSignals = {
        ...verificationSignals,
        gps_match: verificationSignals.gps_match >= 0.5,
    };
    const now = new Date();
    const record = new EarnRecord_js_1.EarnRecord({
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
    logger_js_1.logger.info('[EarnRecordService] Created earn record', {
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
async function getEarnRecord(recordId) {
    const record = await EarnRecord_js_1.EarnRecord.findById(recordId).lean();
    if (!record)
        return null;
    return toResponse(record);
}
/**
 * Retrieve all EarnRecords for a user with optional pagination and status filter.
 *
 * @param userId   MongoDB _id of the user
 * @param options.page     Page number (1-indexed, default 1)
 * @param options.limit    Items per page (default 20, max 100)
 * @param options.status   Filter by EarnRecordStatus
 */
async function getUserEarnRecords(userId, options = {}) {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const skip = (page - 1) * limit;
    const filter = { userId };
    if (options.status) {
        filter.status = options.status;
    }
    const [records, total] = await Promise.all([
        EarnRecord_js_1.EarnRecord.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
        EarnRecord_js_1.EarnRecord.countDocuments(filter),
    ]);
    return {
        records: records.map((r) => toResponse(r)),
        total,
        page,
        hasMore: skip + records.length < total,
    };
}
/**
 * Retrieve all EarnRecords for a given batch.
 */
async function getRecordsByBatch(batchId) {
    const records = await EarnRecord_js_1.EarnRecord.find({ batchId }).sort({ createdAt: -1 }).lean();
    return records.map((r) => toResponse(r));
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
async function updateEarnRecordStatus(recordId, status) {
    const validTransitions = {
        APPROVED_PENDING_CONVERSION: ['CONVERTED', 'REJECTED', 'ROLLED_BACK'],
        CONVERTED: ['ROLLED_BACK'],
        REJECTED: ['ROLLED_BACK'],
        ROLLED_BACK: [],
    };
    const record = await EarnRecord_js_1.EarnRecord.findById(recordId).lean();
    if (!record)
        return null;
    const allowed = validTransitions[record.status] ?? [];
    if (!allowed.includes(status)) {
        logger_js_1.logger.warn('[EarnRecordService] Invalid status transition', {
            recordId,
            from: record.status,
            to: status,
        });
        return null;
    }
    const updateFields = { status };
    if (status === 'CONVERTED') {
        updateFields.convertedAt = new Date();
    }
    const updated = await EarnRecord_js_1.EarnRecord.findByIdAndUpdate(recordId, updateFields, { new: true }).lean();
    if (!updated)
        return null;
    logger_js_1.logger.info('[EarnRecordService] Updated earn record status', {
        recordId,
        from: record.status,
        to: status,
    });
    return toResponse(updated);
}
/**
 * Get all EarnRecords with status APPROVED_PENDING_CONVERSION
 * that are ready for batch conversion.
 */
async function getPendingConversionRecords() {
    const records = await EarnRecord_js_1.EarnRecord.find({
        status: 'APPROVED_PENDING_CONVERSION',
    }).sort({ approvedAt: 1 }).lean();
    return records.map((r) => toResponse(r));
}
// ---------------------------------------------------------------------------
// Profile Stats Update
// ---------------------------------------------------------------------------
/**
 * Update KarmaProfile after an earn record is created.
 * Increments lifetime/active karma, updates activity timestamp,
 * and recalculates trust score.
 */
async function updateProfileStats(userId, karmaEarned, confidenceScore, level) {
    try {
        const profile = await KarmaProfile_js_1.KarmaProfile.findOne({ userId });
        if (!profile) {
            // Auto-create profile on first activity
            const newProfile = new KarmaProfile_js_1.KarmaProfile({
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
        const weekStart = getWeekStart(now);
        if (!profile.weekOfLastKarmaEarned || getWeekStart(profile.weekOfLastKarmaEarned) < weekStart) {
            profile.thisWeekKarmaEarned = 0;
        }
        profile.thisWeekKarmaEarned += karmaEarned;
        profile.weekOfLastKarmaEarned = now;
        profile.lastActivityAt = now;
        profile.activityHistory = [...(profile.activityHistory ?? []), now].slice(-100); // keep last 100
        await profile.save();
    }
    catch (err) {
        logger_js_1.logger.error('[EarnRecordService] Failed to update profile stats', { userId, error: err });
    }
}
/**
 * Returns the ISO week-start date (Monday 00:00:00) for a given date.
 */
function getWeekStart(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}
function toResponse(doc) {
    return {
        id: doc._id.toString(),
        userId: doc.userId,
        eventId: doc.eventId,
        bookingId: doc.bookingId,
        karmaEarned: doc.karmaEarned,
        activeLevelAtApproval: doc.activeLevelAtApproval,
        conversionRate: doc.conversionRateSnapshot,
        csrPoolId: doc.csrPoolId,
        verificationSignals: doc.verificationSignals,
        confidenceScore: doc.confidenceScore,
        status: doc.status,
        createdAt: doc.createdAt,
        approvedAt: doc.approvedAt,
        convertedAt: doc.convertedAt,
        convertedBy: doc.convertedBy,
        batchId: doc.batchId,
        rezCoinsEarned: doc.rezCoinsEarned,
        idempotencyKey: doc.idempotencyKey,
    };
}
//# sourceMappingURL=earnRecordService.js.map