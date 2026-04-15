"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWeeklyBatch = createWeeklyBatch;
exports.createBatchForPool = createBatchForPool;
exports.getBatchPreview = getBatchPreview;
exports.executeBatch = executeBatch;
exports.applyCapsToRecord = applyCapsToRecord;
exports.checkBatchAnomalies = checkBatchAnomalies;
exports.pauseAllPendingBatches = pauseAllPendingBatches;
exports.notifyUsersOfConversion = notifyUsersOfConversion;
/**
 * Batch Service — weekly batch conversion pipeline for Karma by ReZ
 *
 * Handles:
 * - Weekly batch creation (grouped by CSR pool)
 * - Batch preview with cap enforcement and anomaly detection
 * - Atomic per-record execution with idempotency
 * - Guardrails: pool checks, per-user weekly caps, anomaly flags
 * - Kill switch to pause all pending batches
 * - User notification after conversion
 */
const moment_1 = __importDefault(require("moment"));
const mongoose_1 = require("mongoose");
const EarnRecord_js_1 = require("../models/EarnRecord.js");
const Batch_js_1 = require("../models/Batch.js");
const CSRPool_js_1 = require("../models/CSRPool.js");
const KarmaProfile_js_1 = require("../models/KarmaProfile.js");
const walletIntegration_js_1 = require("./walletIntegration.js");
const auditService_js_1 = require("./auditService.js");
const karmaEngine_js_1 = require("../engines/karmaEngine.js");
const logger_js_1 = require("../config/logger.js");
const log = (0, logger_js_1.createServiceLogger)('batchService');
// ── Weekly Batch Creation ───────────────────────────────────────────────────────
/**
 * Create weekly batches for all CSR pools with pending earn records.
 * Groups records by csrPoolId and creates one batch per pool.
 *
 * @returns Array of created Batch documents
 */
async function createWeeklyBatch() {
    const now = new Date();
    const weekStart = (0, moment_1.default)(now).subtract(7, 'days').startOf('day').toDate();
    const weekEnd = (0, moment_1.default)(now).startOf('day').toDate();
    // Aggregate pending records grouped by CSR pool
    const groups = await EarnRecord_js_1.EarnRecord.aggregate([
        {
            $match: {
                status: 'APPROVED_PENDING_CONVERSION',
                approvedAt: { $gte: weekStart, $lt: weekEnd },
            },
        },
        {
            $group: {
                _id: '$csrPoolId',
                records: { $push: { _id: '$_id' } },
                totalKarma: { $sum: '$karmaEarned' },
                totalCoinsEstimated: {
                    $sum: { $multiply: ['$karmaEarned', '$conversionRateSnapshot'] },
                },
                count: { $sum: 1 },
            },
        },
    ]);
    if (groups.length === 0) {
        log.info('createWeeklyBatch: no pending records found for this week');
        return [];
    }
    log.info('createWeeklyBatch: found groups', { groupCount: groups.length });
    const createdBatches = [];
    for (const group of groups) {
        const batch = await createBatchForPool(group._id, weekStart, weekEnd, group);
        if (batch) {
            createdBatches.push(batch);
        }
    }
    return createdBatches;
}
/**
 * Create a single batch for a specific CSR pool.
 * Checks pool availability and creates a READY batch if sufficient coins remain.
 *
 * @param csrPoolId - CSR Pool ID
 * @param weekStart - Week start date
 * @param weekEnd - Week end date
 * @param group - Pre-computed aggregate group data (optional)
 */
async function createBatchForPool(csrPoolId, weekStart, weekEnd, group) {
    // Compute group data if not provided
    const groupData = group ??
        (await EarnRecord_js_1.EarnRecord.aggregate([
            {
                $match: {
                    status: 'APPROVED_PENDING_CONVERSION',
                    csrPoolId,
                    approvedAt: { $gte: weekStart, $lt: weekEnd },
                },
            },
            {
                $group: {
                    _id: '$csrPoolId',
                    records: { $push: { _id: '$_id' } },
                    totalKarma: { $sum: '$karmaEarned' },
                    totalCoinsEstimated: {
                        $sum: { $multiply: ['$karmaEarned', '$conversionRateSnapshot'] },
                    },
                    count: { $sum: 1 },
                },
            },
        ]))[0];
    if (!groupData || groupData.records.length === 0) {
        return null;
    }
    const pool = await CSRPool_js_1.CSRPool.findById(csrPoolId).lean();
    if (!pool) {
        log.warn('createBatchForPool: pool not found', { csrPoolId });
        return null;
    }
    const totalCoins = Math.floor(groupData.totalCoinsEstimated);
    // Check pool availability
    if (pool.coinPoolRemaining < totalCoins) {
        log.warn('createBatchForPool: insufficient pool coins', {
            csrPoolId,
            required: totalCoins,
            available: pool.coinPoolRemaining,
        });
    }
    const anomalyFlags = [];
    // Detect anomalies immediately — use a temporary batch ID for the anomaly check
    const tempBatchId = new mongoose_1.Types.ObjectId();
    const anomalies = await checkBatchAnomalies(tempBatchId.toString(), csrPoolId, weekStart, weekEnd);
    if (anomalies.length > 0) {
        anomalyFlags.push(...anomalies);
    }
    const batch = new Batch_js_1.Batch({
        weekStart,
        weekEnd,
        csrPoolId,
        totalEarnRecords: groupData.count,
        totalKarma: groupData.totalKarma,
        totalRezCoinsEstimated: totalCoins,
        totalRezCoinsExecuted: 0,
        status: pool.coinPoolRemaining >= totalCoins ? 'READY' : 'DRAFT',
        anomalyFlags,
    });
    await batch.save();
    // Associate earn records with this batch
    const recordIds = groupData.records.map((r) => new mongoose_1.Types.ObjectId(r._id));
    await EarnRecord_js_1.EarnRecord.updateMany({ _id: { $in: recordIds } }, { $set: { batchId: batch._id } });
    log.info('Batch created', {
        batchId: batch._id.toString(),
        csrPoolId,
        totalRecords: groupData.count,
        totalCoins: totalCoins,
        status: batch.status,
    });
    return batch;
}
// ── Batch Preview ───────────────────────────────────────────────────────────────
/**
 * Get a full preview of a batch including pool info, capped records, summary, and anomalies.
 */
async function getBatchPreview(batchId) {
    const batch = await Batch_js_1.Batch.findById(batchId).lean();
    if (!batch)
        return null;
    const pool = await CSRPool_js_1.CSRPool.findById(batch.csrPoolId).lean();
    if (!pool)
        return null;
    // Fetch all records for this batch and compute caps
    const records = await EarnRecord_js_1.EarnRecord.find({ batchId: batch._id.toString() }).lean();
    const recordsWithCap = await Promise.all(records.map(async (r) => {
        const rawCoins = Math.floor(r.karmaEarned * r.conversionRateSnapshot);
        const weeklyUsed = await getWeeklyCoinsUsed(r.userId, r.approvedAt);
        const capped = applyCapsToRecord({ karmaEarned: r.karmaEarned, conversionRateSnapshot: r.conversionRateSnapshot }, weeklyUsed);
        return {
            _id: r._id.toString(),
            userId: String(r.userId),
            karmaEarned: r.karmaEarned,
            conversionRateSnapshot: r.conversionRateSnapshot,
            status: r.status,
            estimatedCoins: rawCoins,
            cappedCoins: capped,
        };
    }));
    const totalEstimated = recordsWithCap.reduce((sum, r) => sum + r.estimatedCoins, 0);
    const totalCapped = recordsWithCap.reduce((sum, r) => sum + r.cappedCoins, 0);
    const anomalies = await checkBatchAnomalies(batchId, batch.csrPoolId, batch.weekStart, batch.weekEnd);
    return {
        batch: {
            _id: batch._id.toString(),
            weekStart: batch.weekStart,
            weekEnd: batch.weekEnd,
            csrPoolId: batch.csrPoolId,
            status: batch.status,
            totalEarnRecords: batch.totalEarnRecords,
            totalKarma: batch.totalKarma,
            totalRezCoinsEstimated: batch.totalRezCoinsEstimated,
            anomalyFlags: batch.anomalyFlags,
        },
        pool: {
            _id: pool._id.toString(),
            name: pool.name,
            coinPoolRemaining: pool.coinPoolRemaining,
            status: pool.status,
        },
        records: recordsWithCap,
        summary: {
            totalRecords: recordsWithCap.length,
            totalKarma: batch.totalKarma,
            totalEstimated,
            totalCapped,
            poolRemaining: pool.coinPoolRemaining,
            exceedsPool: totalCapped > pool.coinPoolRemaining,
        },
        anomalies,
        recordsSample: recordsWithCap.slice(0, 50).map((r) => ({
            _id: r._id,
            userId: r.userId,
            karmaEarned: r.karmaEarned,
            estimatedCoins: r.estimatedCoins,
            cappedCoins: r.cappedCoins,
        })),
    };
}
// ── Batch Execution ─────────────────────────────────────────────────────────────
/**
 * Execute a batch: credit all pending earn records and update statuses.
 * Each record is processed atomically — individual failures do not block other records.
 * Uses idempotency keys to prevent double-crediting.
 */
async function executeBatch(batchId, adminId) {
    const batch = await Batch_js_1.Batch.findById(batchId);
    if (!batch) {
        return {
            success: false,
            batchId,
            processed: 0,
            succeeded: 0,
            failed: 0,
            totalCoinsIssued: 0,
            errors: ['Batch not found'],
        };
    }
    if (batch.status === 'EXECUTED') {
        return {
            success: false,
            batchId,
            processed: 0,
            succeeded: 0,
            failed: 0,
            totalCoinsIssued: 0,
            errors: ['Batch already executed'],
        };
    }
    // Pool guardrail: verify sufficient coins before starting
    const pool = await CSRPool_js_1.CSRPool.findById(batch.csrPoolId).lean();
    if (!pool) {
        return {
            success: false,
            batchId,
            processed: 0,
            succeeded: 0,
            failed: 0,
            totalCoinsIssued: 0,
            errors: ['CSR pool not found'],
        };
    }
    const preview = await getBatchPreview(batchId);
    if (preview && preview.summary.exceedsPool) {
        log.warn('executeBatch: pool shortage detected', {
            batchId,
            needed: preview.summary.totalCapped,
            available: pool.coinPoolRemaining,
        });
    }
    const records = await EarnRecord_js_1.EarnRecord.find({
        batchId: batch._id.toString(),
        status: 'APPROVED_PENDING_CONVERSION',
    });
    let succeeded = 0;
    let failed = 0;
    let totalCoinsIssued = 0;
    const errors = [];
    const auditMeta = {
        batchId,
        adminId,
        recordsProcessed: records.length,
    };
    for (const record of records) {
        const recordIdStr = record._id.toString();
        const idempotencyKey = `batch_execute_${batchId}_${recordIdStr}`;
        try {
            // Idempotency: skip already credited records
            const alreadyConverted = await EarnRecord_js_1.EarnRecord.findOne({
                _id: recordIdStr,
                status: 'CONVERTED',
                idempotencyKey,
            }).lean();
            if (alreadyConverted) {
                succeeded++;
                totalCoinsIssued += alreadyConverted.rezCoinsEarned ?? 0;
                continue;
            }
            // Compute capped coins
            const rawCoins = Math.floor(record.karmaEarned * record.conversionRateSnapshot);
            const weeklyUsed = await getWeeklyCoinsUsed(record.userId, record.approvedAt);
            const cappedCoins = applyCapsToRecord({ karmaEarned: record.karmaEarned, conversionRateSnapshot: record.conversionRateSnapshot }, weeklyUsed);
            // Credit wallet
            const creditResult = await (0, walletIntegration_js_1.creditUserWallet)({
                userId: record.userId,
                amount: cappedCoins,
                coinType: 'rez',
                source: 'karma_conversion',
                referenceId: recordIdStr,
                referenceModel: 'EarnRecord',
                description: `Karma conversion: ${record.karmaEarned} pts × ${record.conversionRateSnapshot * 100}%`,
                idempotencyKey,
            });
            if (!creditResult.success) {
                failed++;
                errors.push(`Record ${recordIdStr}: ${creditResult.error ?? 'wallet credit failed'}`);
                continue;
            }
            // Update record
            record.status = 'CONVERTED';
            record.convertedAt = new Date();
            record.convertedBy = adminId;
            record.rezCoinsEarned = cappedCoins;
            record.idempotencyKey = idempotencyKey;
            await record.save();
            // Decrement CSR pool atomically
            await CSRPool_js_1.CSRPool.updateOne({ _id: batch.csrPoolId }, { $inc: { coinPoolRemaining: -cappedCoins, issuedCoins: cappedCoins } });
            // Update KarmaProfile conversion history
            await KarmaProfile_js_1.KarmaProfile.updateOne({ userId: record.userId }, {
                $push: {
                    conversionHistory: {
                        karmaConverted: record.karmaEarned,
                        coinsEarned: cappedCoins,
                        rate: record.conversionRateSnapshot,
                        batchId: batch._id.toString(),
                        convertedAt: new Date(),
                    },
                },
            }, { upsert: false });
            succeeded++;
            totalCoinsIssued += cappedCoins;
        }
        catch (err) {
            failed++;
            errors.push(`Record ${recordIdStr}: ${err.message}`);
            log.error('executeBatch: record error', { recordId: recordIdStr, error: err.message });
        }
    }
    // Update batch status
    batch.status = failed > 0 ? 'PARTIAL' : 'EXECUTED';
    batch.totalRezCoinsExecuted = totalCoinsIssued;
    batch.executedAt = new Date();
    batch.executedBy = adminId;
    await batch.save();
    // Log audit
    await (0, auditService_js_1.logAudit)({
        action: 'BATCH_EXECUTE',
        adminId,
        batchId,
        timestamp: new Date(),
        metadata: {
            ...auditMeta,
            recordsSuccess: succeeded,
            recordsFailed: failed,
            totalCoinsIssued,
            totalKarmaConverted: batch.totalKarma,
            status: batch.status,
        },
    });
    // Notify users
    const convertedRecords = records.filter((r) => r.status === 'CONVERTED');
    await notifyUsersOfConversion(convertedRecords.map((r) => ({
        _id: r._id.toString(),
        userId: r.userId,
        karmaEarned: r.karmaEarned,
        conversionRateSnapshot: r.conversionRateSnapshot,
        status: r.status,
        estimatedCoins: 0,
        cappedCoins: r.rezCoinsEarned ?? 0,
    })));
    log.info('executeBatch: complete', { batchId, succeeded, failed, totalCoinsIssued });
    return {
        success: failed === 0,
        batchId,
        processed: records.length,
        succeeded,
        failed,
        totalCoinsIssued,
        errors,
    };
}
// ── Caps ─────────────────────────────────────────────────────────────────────────
/**
 * Apply the per-user weekly coin cap (300 coins) to a karma conversion.
 *
 * @param record - Earn record with karmaEarned and conversionRateSnapshot
 * @param weeklyUsed - Coins already used this week by the same user
 * @returns Coins to issue after cap enforcement
 */
function applyCapsToRecord(record, weeklyUsed) {
    const rawCoins = Math.floor(record.karmaEarned * record.conversionRateSnapshot);
    const weeklyRemaining = Math.max(0, karmaEngine_js_1.WEEKLY_COIN_CAP - weeklyUsed);
    return Math.min(rawCoins, weeklyRemaining);
}
/**
 * Get total ReZ coins issued to a user this week (ISO week).
 */
async function getWeeklyCoinsUsed(userId, weekOf) {
    const weekStart = (0, moment_1.default)(weekOf).startOf('isoWeek').toDate();
    const weekEnd = (0, moment_1.default)(weekOf).endOf('isoWeek').toDate();
    const result = await EarnRecord_js_1.EarnRecord.aggregate([
        {
            $match: {
                userId,
                status: 'CONVERTED',
                convertedAt: { $gte: weekStart, $lt: weekEnd },
            },
        },
        { $group: { _id: null, total: { $sum: '$rezCoinsEarned' } } },
    ]);
    return result[0]?.total ?? 0;
}
// ── Anomaly Detection ───────────────────────────────────────────────────────────
/**
 * Detect anomalies in a batch: high NGO concentration, suspicious timestamps, pool shortage.
 */
async function checkBatchAnomalies(batchId, csrPoolId, weekStart, weekEnd) {
    const flags = [];
    // Flag 1: Too many records from one NGO in the batch period
    const ngoCounts = await EarnRecord_js_1.EarnRecord.aggregate([
        {
            $match: {
                csrPoolId,
                status: 'APPROVED_PENDING_CONVERSION',
                approvedAt: { $gte: weekStart, $lt: weekEnd },
            },
        },
        {
            $lookup: {
                from: 'karma_events',
                localField: 'eventId',
                foreignField: '_id',
                as: 'event',
            },
        },
        { $unwind: { path: '$event', preserveNullAndEmptyArrays: true } },
        { $group: { _id: '$event.ngoId', count: { $sum: 1 } } },
        { $match: { count: { $gt: 50 } } },
    ]);
    if (ngoCounts.length > 0) {
        flags.push({
            type: 'too_many_from_one_ngo',
            count: ngoCounts.reduce((sum, g) => sum + g.count, 0),
            resolved: false,
        });
    }
    // Flag 2: Suspicious timestamps — identical approval times across many records
    const timestampCounts = await EarnRecord_js_1.EarnRecord.aggregate([
        {
            $match: {
                csrPoolId,
                status: 'APPROVED_PENDING_CONVERSION',
                approvedAt: { $gte: weekStart, $lt: weekEnd },
            },
        },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%dT%H:%M', date: '$approvedAt' } },
                count: { $sum: 1 },
            },
        },
        { $match: { count: { $gt: 10 } } },
    ]);
    if (timestampCounts.length > 0) {
        flags.push({
            type: 'suspicious_timestamps',
            count: timestampCounts.reduce((sum, g) => sum + g.count, 0),
            resolved: false,
        });
    }
    // Flag 3: Pool shortage
    const batch = await Batch_js_1.Batch.findOne({ _id: batchId }).lean();
    if (batch) {
        const pool = await CSRPool_js_1.CSRPool.findById(csrPoolId).lean();
        if (pool && pool.coinPoolRemaining < batch.totalRezCoinsEstimated) {
            flags.push({ type: 'pool_shortage', count: 1, resolved: false });
        }
    }
    return flags;
}
// ── Kill Switch ─────────────────────────────────────────────────────────────────
/**
 * Pause all READY/DRAFT batches. Used as a kill switch during emergencies.
 *
 * @param reason - Reason for pausing (logged in audit trail)
 * @returns Number of batches paused
 */
async function pauseAllPendingBatches(reason) {
    const result = await Batch_js_1.Batch.updateMany({ status: { $in: ['READY', 'DRAFT'] } }, {
        $set: {
            status: 'DRAFT',
            pauseReason: reason,
            pausedAt: new Date(),
        },
    });
    log.warn('pauseAllPendingBatches: kill switch activated', {
        reason,
        pausedCount: result.modifiedCount,
    });
    return result.modifiedCount;
}
// ── Notifications ───────────────────────────────────────────────────────────────
/**
 * Notify users of successful coin conversion.
 * In Phase 1 this logs the notification. In Phase 2 this would send push + in-app notifications.
 */
async function notifyUsersOfConversion(records) {
    for (const record of records) {
        if (record.cappedCoins <= 0)
            continue;
        log.info('notifyUsersOfConversion: user notified', {
            userId: record.userId,
            coins: record.cappedCoins,
            karma: record.karmaEarned,
        });
        // In Phase 2: call notification service (push + in-app)
        // await notificationService.send(record.userId, {
        //   title: '+${record.cappedCoins} ReZ Coins from your impact this week',
        //   body: `You earned ${record.karmaEarned} karma points!`,
        // });
    }
}
//# sourceMappingURL=batchService.js.map