"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Batch Routes — admin API endpoints for batch conversion management
 *
 * All write routes (POST) require admin authentication.
 * GET /stats is public for dashboards.
 */
const express_1 = require("express");
const adminAuth_js_1 = require("../middleware/adminAuth.js");
const Batch_js_1 = require("../models/Batch.js");
const EarnRecord_js_1 = require("../models/EarnRecord.js");
const CSRPool_js_1 = require("../models/CSRPool.js");
const batchService_js_1 = require("../services/batchService.js");
const auditService_js_1 = require("../services/auditService.js");
const logger_js_1 = require("../config/logger.js");
const router = (0, express_1.Router)();
const log = (0, logger_js_1.createServiceLogger)('batchRoutes');
/**
 * GET /api/karma/batch
 * List all batches with pagination. Admin only.
 */
router.get('/', adminAuth_js_1.requireAdminAuth, async (_req, res) => {
    try {
        const page = parseInt(_req.query.page, 10) || 1;
        const limit = Math.min(parseInt(_req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;
        const status = _req.query.status;
        const filter = {};
        if (status)
            filter.status = status;
        const [batches, total] = await Promise.all([
            Batch_js_1.Batch.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Batch_js_1.Batch.countDocuments(filter),
        ]);
        res.json({
            success: true,
            data: batches.map((b) => ({
                _id: b._id.toString(),
                weekStart: b.weekStart,
                weekEnd: b.weekEnd,
                csrPoolId: b.csrPoolId,
                status: b.status,
                totalEarnRecords: b.totalEarnRecords,
                totalKarma: b.totalKarma,
                totalRezCoinsEstimated: b.totalRezCoinsEstimated,
                totalRezCoinsExecuted: b.totalRezCoinsExecuted,
                anomalyFlags: b.anomalyFlags,
                executedAt: b.executedAt,
                createdAt: b.createdAt,
            })),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit),
            },
        });
    }
    catch (err) {
        log.error('GET /batch: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * GET /api/karma/batch/:id
 * Get a single batch by ID.
 */
router.get('/:id', adminAuth_js_1.requireAdminAuth, async (req, res) => {
    try {
        const batch = await Batch_js_1.Batch.findById(req.params.id).lean();
        if (!batch) {
            res.status(404).json({ success: false, message: 'Batch not found' });
            return;
        }
        const pool = await CSRPool_js_1.CSRPool.findById(batch.csrPoolId).lean();
        res.json({
            success: true,
            data: {
                _id: batch._id.toString(),
                weekStart: batch.weekStart,
                weekEnd: batch.weekEnd,
                csrPoolId: batch.csrPoolId,
                status: batch.status,
                totalEarnRecords: batch.totalEarnRecords,
                totalKarma: batch.totalKarma,
                totalRezCoinsEstimated: batch.totalRezCoinsEstimated,
                totalRezCoinsExecuted: batch.totalRezCoinsExecuted,
                anomalyFlags: batch.anomalyFlags,
                executedAt: batch.executedAt,
                pauseReason: batch.pauseReason,
                pausedAt: batch.pausedAt,
                createdAt: batch.createdAt,
                pool: pool
                    ? {
                        _id: pool._id.toString(),
                        name: pool.name,
                        coinPoolRemaining: pool.coinPoolRemaining,
                        status: pool.status,
                    }
                    : null,
            },
        });
    }
    catch (err) {
        log.error('GET /batch/:id: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * GET /api/karma/batch/:id/preview
 * Full admin preview: pool info, capped records, summary, anomalies, first 50 records.
 */
router.get('/:id/preview', adminAuth_js_1.requireAdminAuth, async (req, res) => {
    try {
        const preview = await (0, batchService_js_1.getBatchPreview)(req.params.id);
        if (!preview) {
            res.status(404).json({ success: false, message: 'Batch not found' });
            return;
        }
        res.json({ success: true, data: preview });
    }
    catch (err) {
        log.error('GET /batch/:id/preview: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * POST /api/karma/batch/:id/execute
 * Execute a batch conversion. Admin only.
 * Credits wallets, marks records as converted, updates batch status.
 */
router.post('/:id/execute', adminAuth_js_1.requireAdminAuth, async (req, res) => {
    try {
        const batch = await Batch_js_1.Batch.findById(req.params.id);
        if (!batch) {
            res.status(404).json({ success: false, message: 'Batch not found' });
            return;
        }
        if (batch.status === 'EXECUTED') {
            res.status(400).json({ success: false, message: 'Batch already executed' });
            return;
        }
        if (batch.status === 'DRAFT') {
            res.status(400).json({ success: false, message: 'Batch is not ready for execution' });
            return;
        }
        const adminId = req.userId ?? 'unknown';
        log.info('Batch execute requested', { batchId: req.params.id, adminId });
        const result = await (0, batchService_js_1.executeBatch)(req.params.id, adminId);
        res.status(result.success ? 200 : 207).json({
            success: result.success,
            message: result.success
                ? 'Batch executed successfully'
                : 'Batch executed with errors',
            data: result,
        });
    }
    catch (err) {
        log.error('POST /batch/:id/execute: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * POST /api/karma/batch/pause-all
 * Kill switch: pause all pending READY/DRAFT batches.
 * Admin only. Requires a reason in the request body.
 */
router.post('/pause-all', adminAuth_js_1.requireAdminAuth, async (req, res) => {
    try {
        const reason = req.body?.reason ?? 'No reason provided';
        const adminId = req.userId ?? 'unknown';
        const count = await (0, batchService_js_1.pauseAllPendingBatches)(reason);
        await (0, auditService_js_1.logAudit)({
            action: 'KILL_SWITCH',
            adminId,
            timestamp: new Date(),
            metadata: { reason, batchesPaused: count },
        });
        log.warn('Kill switch activated', { adminId, reason, batchesPaused: count });
        res.json({
            success: true,
            message: `Kill switch activated. ${count} batch(es) paused.`,
            data: { pausedCount: count, reason },
        });
    }
    catch (err) {
        log.error('POST /batch/pause-all: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * GET /api/karma/batch/stats
 * Overall batch statistics. Public (for dashboard).
 */
router.get('/stats', async (_req, res) => {
    try {
        const [totalBatches, executedBatches, pendingBatches, partialBatches, recordStats, coinStats] = await Promise.all([
            Batch_js_1.Batch.countDocuments(),
            Batch_js_1.Batch.countDocuments({ status: 'EXECUTED' }),
            Batch_js_1.Batch.countDocuments({ status: 'READY' }),
            Batch_js_1.Batch.countDocuments({ status: 'PARTIAL' }),
            EarnRecord_js_1.EarnRecord.aggregate([
                { $count: 'total' },
            ]),
            Batch_js_1.Batch.aggregate([
                {
                    $group: {
                        _id: null,
                        totalCoins: { $sum: '$totalRezCoinsExecuted' },
                        totalKarma: { $sum: '$totalKarma' },
                    },
                },
            ]),
        ]);
        const totalRecords = recordStats[0]?.total ?? 0;
        const totalCoins = coinStats[0]?.totalCoins ?? 0;
        const totalKarma = coinStats[0]?.totalKarma ?? 0;
        res.json({
            success: true,
            data: {
                totalBatches,
                executedBatches,
                pendingBatches,
                partialBatches,
                totalRecordsConverted: totalRecords,
                totalCoinsIssued: totalCoins,
                totalKarmaConverted: totalKarma,
            },
        });
    }
    catch (err) {
        log.error('GET /batch/stats: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
/**
 * GET /api/karma/batch/audit
 * Query audit logs. Admin only.
 */
router.get('/audit/logs', adminAuth_js_1.requireAdminAuth, async (req, res) => {
    try {
        const action = req.query.action;
        const adminId = req.query.adminId;
        const batchId = req.query.batchId;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const startDate = req.query.startDate ? new Date(req.query.startDate) : undefined;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : undefined;
        const result = await (0, auditService_js_1.getAuditLogs)({
            action,
            adminId,
            batchId,
            startDate,
            endDate,
            page,
            limit,
        });
        res.json({
            success: true,
            data: result.logs,
            pagination: {
                page: result.page,
                limit,
                total: result.total,
                hasMore: result.hasMore,
            },
        });
    }
    catch (err) {
        log.error('GET /batch/audit/logs: error', { error: err.message });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=batchRoutes.js.map