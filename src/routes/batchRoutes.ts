/**
 * Batch Routes — admin API endpoints for batch conversion management
 *
 * All write routes (POST) require admin authentication.
 * GET /stats is public for dashboards.
 */
import { Router, Request, Response } from 'express';
import { requireAdminAuth } from '../middleware/adminAuth.js';
import { Batch } from '../models/Batch.js';
import { EarnRecord } from '../models/EarnRecord.js';
import { CSRPool } from '../models/CSRPool.js';
import {
  createWeeklyBatch,
  getBatchPreview,
  executeBatch,
  pauseAllPendingBatches,
} from '../services/batchService.js';
import { logAudit, getAuditLogs } from '../services/auditService.js';
import { createServiceLogger } from '../config/logger.js';

const router = Router();
const log = createServiceLogger('batchRoutes');

/**
 * GET /api/karma/batch
 * List all batches with pagination. Admin only.
 */
router.get('/', requireAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(_req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(_req.query.limit as string, 10) || 20, 100);
    const skip = (page - 1) * limit;
    const status = _req.query.status as string | undefined;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;

    const [batches, total] = await Promise.all([
      Batch.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Batch.countDocuments(filter),
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
  } catch (err) {
    log.error('GET /batch: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/batch/:id
 * Get a single batch by ID.
 */
router.get('/:id', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const batch = await Batch.findById(req.params.id).lean();
    if (!batch) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    const pool = await CSRPool.findById(batch.csrPoolId).lean();

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
        pauseReason: (batch as Record<string, unknown>).pauseReason as string | undefined,
        pausedAt: (batch as Record<string, unknown>).pausedAt as Date | undefined,
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
  } catch (err) {
    log.error('GET /batch/:id: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/batch/:id/preview
 * Full admin preview: pool info, capped records, summary, anomalies, first 50 records.
 */
router.get('/:id/preview', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const preview = await getBatchPreview(req.params.id);
    if (!preview) {
      res.status(404).json({ success: false, message: 'Batch not found' });
      return;
    }

    res.json({ success: true, data: preview });
  } catch (err) {
    log.error('GET /batch/:id/preview: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/karma/batch/:id/execute
 * Execute a batch conversion. Admin only.
 * Credits wallets, marks records as converted, updates batch status.
 */
router.post('/:id/execute', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const batch = await Batch.findById(req.params.id);
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

    const result = await executeBatch(req.params.id, adminId);

    res.status(result.success ? 200 : 207).json({
      success: result.success,
      message: result.success
        ? 'Batch executed successfully'
        : 'Batch executed with errors',
      data: result,
    });
  } catch (err) {
    log.error('POST /batch/:id/execute: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/karma/batch/pause-all
 * Kill switch: pause all pending READY/DRAFT batches.
 * Admin only. Requires a reason in the request body.
 */
router.post('/pause-all', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const reason = (req.body?.reason as string) ?? 'No reason provided';
    const adminId = req.userId ?? 'unknown';

    const count = await pauseAllPendingBatches(reason);

    await logAudit({
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
  } catch (err) {
    log.error('POST /batch/pause-all: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/batch/stats
 * Overall batch statistics. Admin-only — exposes financial metrics.
 */
// G-KS-C5 FIX: requireAdmin was undefined (not exported from adminAuth).
// Use requireAdminAuth which calls requireAuth + role check.
// Exposing financial batch stats without auth is a critical information-disclosure risk.
router.get('/stats', requireAdminAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const [totalBatches, executedBatches, pendingBatches, partialBatches, recordStats, coinStats] =
      await Promise.all([
        Batch.countDocuments(),
        Batch.countDocuments({ status: 'EXECUTED' }),
        Batch.countDocuments({ status: 'READY' }),
        Batch.countDocuments({ status: 'PARTIAL' }),
        EarnRecord.aggregate<{ _id: null; total: number }>([
          { $count: 'total' },
        ]),
        Batch.aggregate<{ _id: null; totalCoins: number; totalKarma: number }>([
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
  } catch (err) {
    log.error('GET /batch/stats: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/batch/audit
 * Query audit logs. Admin only.
 */
router.get('/audit/logs', requireAdminAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const action = req.query.action as string | undefined;
    const adminId = req.query.adminId as string | undefined;
    const batchId = req.query.batchId as string | undefined;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : undefined;
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : undefined;

    const result = await getAuditLogs({
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
  } catch (err) {
    log.error('GET /batch/audit/logs: error', { error: (err as Error).message });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
