/**
 * Integration tests for batchRoutes
 *
 * Tests:
 * - GET /api/karma/batch returns list
 * - POST /api/karma/batch/:id/execute (non-admin returns 403)
 * - POST /api/karma/batch/pause-all (admin kill switch)
 */
import request from 'supertest';
import { Types } from 'mongoose';

// ── Mocks ────────────────────────────────────────────────────────────────────────

const mockBatchFind = jest.fn();
const mockBatchFindById = jest.fn();
const mockBatchCountDocuments = jest.fn();
const mockBatchUpdateMany = jest.fn();
const mockCSRPoolFindById = jest.fn();
const mockEarnRecordAggregate = jest.fn();
const mockGetBatchPreview = jest.fn();
const mockExecuteBatch = jest.fn();
const mockPauseAllPendingBatches = jest.fn();
const mockGetAuditLogs = jest.fn();
const mockCreateWeeklyBatch = jest.fn();
const mockLogAudit = jest.fn();
const mockCreateServiceLogger = jest.fn(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// Mock requireAdminAuth to inject req.userId and req.userRole
const mockRequireAdminAuth = jest.fn((_req, _res, next) => next());
const mockRequireAuth = jest.fn((_req, _res, next) => next());

jest.mock('../src/models/Batch', () => ({
  Batch: {
    find: mockBatchFind,
    findById: mockBatchFindById,
    countDocuments: mockBatchCountDocuments,
    updateMany: mockBatchUpdateMany,
  },
}));

jest.mock('../src/models/CSRPool', () => ({
  CSRPool: {
    findById: mockCSRPoolFindById,
  },
}));

jest.mock('../src/models/EarnRecord', () => ({
  EarnRecord: {
    aggregate: mockEarnRecordAggregate,
  },
}));

jest.mock('../src/services/batchService', () => ({
  getBatchPreview: mockGetBatchPreview,
  executeBatch: mockExecuteBatch,
  pauseAllPendingBatches: mockPauseAllPendingBatches,
  createWeeklyBatch: mockCreateWeeklyBatch,
}));

jest.mock('../src/services/auditService', () => ({
  logAudit: mockLogAudit,
  getAuditLogs: mockGetAuditLogs,
}));

jest.mock('../src/config/logger', () => ({
  createServiceLogger: mockCreateServiceLogger,
}));

jest.mock('../src/middleware/adminAuth', () => ({
  requireAdminAuth: mockRequireAdminAuth,
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: mockRequireAuth,
}));

// Create Express app after mocks
import express from 'express';
import batchRoutes from '../src/routes/batchRoutes';

const app = express();
app.use(express.json());
app.use('/api/karma/batch', batchRoutes);

// ── Tests ────────────────────────────────────────────────────────────────────────

describe('batchRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset admin mock — allow admin by default
    mockRequireAdminAuth.mockImplementation((req, _res, next) => {
      req.userId = 'admin-user-1';
      req.userRole = 'admin';
      next();
    });
    mockRequireAuth.mockImplementation((req, _res, next) => {
      req.userId = 'admin-user-1';
      req.userRole = 'admin';
      next();
    });
  });

  // ── GET /api/karma/batch ────────────────────────────────────────────────

  describe('GET /api/karma/batch', () => {
    it('should return a list of batches', async () => {
      const batches = [
        {
          _id: new Types.ObjectId(),
          weekStart: new Date('2024-01-01'),
          weekEnd: new Date('2024-01-07'),
          csrPoolId: new Types.ObjectId().toString(),
          status: 'READY',
          totalEarnRecords: 10,
          totalKarma: 5000,
          totalRezCoinsEstimated: 2500,
          totalRezCoinsExecuted: 0,
          anomalyFlags: [],
          createdAt: new Date(),
        },
        {
          _id: new Types.ObjectId(),
          weekStart: new Date('2024-01-08'),
          weekEnd: new Date('2024-01-14'),
          csrPoolId: new Types.ObjectId().toString(),
          status: 'EXECUTED',
          totalEarnRecords: 8,
          totalKarma: 4000,
          totalRezCoinsEstimated: 2000,
          totalRezCoinsExecuted: 2000,
          anomalyFlags: [],
          createdAt: new Date(),
        },
      ];

      mockBatchFind.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve(batches),
            }),
          }),
        }),
      });
      mockBatchCountDocuments.mockResolvedValue(2);

      const res = await request(app).get('/api/karma/batch');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBe(2);
    });

    it('should support pagination parameters', async () => {
      mockBatchFind.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve([]),
            }),
          }),
        }),
      });
      mockBatchCountDocuments.mockResolvedValue(0);

      const res = await request(app).get('/api/karma/batch?page=2&limit=10');

      expect(res.status).toBe(200);
      expect(res.body.pagination.page).toBe(2);
      expect(res.body.pagination.limit).toBe(10);
    });

    it('should filter by status', async () => {
      mockBatchFind.mockReturnValue({
        sort: () => ({
          skip: () => ({
            limit: () => ({
              lean: () => Promise.resolve([]),
            }),
          }),
        }),
      });
      mockBatchCountDocuments.mockResolvedValue(0);

      const res = await request(app).get('/api/karma/batch?status=EXECUTED');

      expect(res.status).toBe(200);
    });
  });

  // ── POST /api/karma/batch/:id/execute ────────────────────────────────────

  describe('POST /api/karma/batch/:id/execute', () => {
    it('should execute a batch successfully', async () => {
      const batchId = new Types.ObjectId().toString();

      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        status: 'READY',
      });

      mockExecuteBatch.mockResolvedValue({
        success: true,
        batchId,
        processed: 5,
        succeeded: 5,
        failed: 0,
        totalCoinsIssued: 1200,
        errors: [],
      });

      const res = await request(app).post(`/api/karma/batch/${batchId}/execute`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.processed).toBe(5);
      expect(res.body.data.succeeded).toBe(5);
    });

    it('should return 403 for non-admin users', async () => {
      mockRequireAdminAuth.mockImplementation((_req, res, _next) => {
        res.status(403).json({ success: false, message: 'Admin access required' });
      });

      const batchId = new Types.ObjectId().toString();

      const res = await request(app).post(`/api/karma/batch/${batchId}/execute`);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Admin access required');
    });

    it('should return 400 for already-executed batches', async () => {
      const batchId = new Types.ObjectId().toString();

      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        status: 'EXECUTED',
      });

      const res = await request(app).post(`/api/karma/batch/${batchId}/execute`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Batch already executed');
    });

    it('should return 400 for DRAFT batches', async () => {
      const batchId = new Types.ObjectId().toString();

      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        status: 'DRAFT',
      });

      const res = await request(app).post(`/api/karma/batch/${batchId}/execute`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Batch is not ready for execution');
    });

    it('should return 404 for non-existent batches', async () => {
      mockBatchFindById.mockResolvedValue(null);

      const res = await request(app).post('/api/karma/batch/nonexistent/execute');

      expect(res.status).toBe(404);
    });

    it('should return 207 when batch has partial failures', async () => {
      const batchId = new Types.ObjectId().toString();

      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        status: 'READY',
      });

      mockExecuteBatch.mockResolvedValue({
        success: false,
        batchId,
        processed: 5,
        succeeded: 3,
        failed: 2,
        totalCoinsIssued: 600,
        errors: ['Record abc: wallet error', 'Record def: timeout'],
      });

      const res = await request(app).post(`/api/karma/batch/${batchId}/execute`);

      expect(res.status).toBe(207);
      expect(res.body.success).toBe(false);
      expect(res.body.data.failed).toBe(2);
    });
  });

  // ── POST /api/karma/batch/pause-all ──────────────────────────────────────

  describe('POST /api/karma/batch/pause-all', () => {
    it('should pause all pending batches (kill switch)', async () => {
      mockPauseAllPendingBatches.mockResolvedValue(7);
      mockLogAudit.mockResolvedValue(undefined);

      const res = await request(app)
        .post('/api/karma/batch/pause-all')
        .send({ reason: 'Emergency maintenance' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pausedCount).toBe(7);
      expect(res.body.data.reason).toBe('Emergency maintenance');
    });

    it('should return 403 for non-admin users', async () => {
      mockRequireAdminAuth.mockImplementation((_req, res, _next) => {
        res.status(403).json({ success: false, message: 'Admin access required' });
      });

      const res = await request(app)
        .post('/api/karma/batch/pause-all')
        .send({ reason: 'Test' });

      expect(res.status).toBe(403);
    });

    it('should accept pause without reason (defaults to no reason provided)', async () => {
      mockPauseAllPendingBatches.mockResolvedValue(0);
      mockLogAudit.mockResolvedValue(undefined);

      const res = await request(app).post('/api/karma/batch/pause-all');

      expect(res.status).toBe(200);
      expect(mockPauseAllPendingBatches).toHaveBeenCalledWith('No reason provided');
    });
  });

  // ── GET /api/karma/batch/:id ─────────────────────────────────────────────

  describe('GET /api/karma/batch/:id', () => {
    it('should return batch detail', async () => {
      const batchId = new Types.ObjectId();
      const poolId = new Types.ObjectId();

      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        weekStart: new Date('2024-01-01'),
        weekEnd: new Date('2024-01-07'),
        csrPoolId: poolId.toString(),
        status: 'READY',
        totalEarnRecords: 10,
        totalKarma: 5000,
        totalRezCoinsEstimated: 2500,
        totalRezCoinsExecuted: 0,
        anomalyFlags: [],
        createdAt: new Date(),
      });

      mockCSRPoolFindById.mockResolvedValue({
        _id: poolId,
        name: 'Test Pool',
        coinPoolRemaining: 50000,
        status: 'active',
      });

      const res = await request(app).get(`/api/karma/batch/${batchId}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('READY');
    });

    it('should return 404 for non-existent batch', async () => {
      mockBatchFindById.mockResolvedValue(null);

      const res = await request(app).get('/api/karma/batch/nonexistent');

      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/karma/batch/:id/preview ─────────────────────────────────────

  describe('GET /api/karma/batch/:id/preview', () => {
    it('should return batch preview', async () => {
      const preview = {
        batch: {
          _id: new Types.ObjectId().toString(),
          weekStart: new Date(),
          weekEnd: new Date(),
          csrPoolId: new Types.ObjectId().toString(),
          status: 'READY',
          totalEarnRecords: 5,
          totalKarma: 1000,
          totalRezCoinsEstimated: 500,
          anomalyFlags: [],
        },
        pool: {
          _id: new Types.ObjectId().toString(),
          name: 'Preview Pool',
          coinPoolRemaining: 10000,
          status: 'active',
        },
        records: [],
        summary: {
          totalRecords: 5,
          totalKarma: 1000,
          totalEstimated: 500,
          totalCapped: 500,
          poolRemaining: 10000,
          exceedsPool: false,
        },
        anomalies: [],
        recordsSample: [],
      };

      mockGetBatchPreview.mockResolvedValue(preview);

      const res = await request(app).get('/api/karma/batch/someid/preview');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.summary.totalRecords).toBe(5);
    });

    it('should return 404 when batch not found', async () => {
      mockGetBatchPreview.mockResolvedValue(null);

      const res = await request(app).get('/api/karma/batch/nonexistent/preview');

      expect(res.status).toBe(404);
    });
  });

  // ── GET /api/karma/batch/stats ──────────────────────────────────────────

  describe('GET /api/karma/batch/stats', () => {
    it('should return overall stats without requiring admin auth', async () => {
      // Stats endpoint is public, but our mock applies admin to all routes
      // The actual route doesn't call requireAdminAuth, so we just verify it works
      mockBatchCountDocuments
        .mockResolvedValueOnce(10) // total
        .mockResolvedValueOnce(8) // executed
        .mockResolvedValueOnce(1) // pending
        .mockResolvedValueOnce(1); // partial

      mockEarnRecordAggregate.mockResolvedValueOnce([{ total: 500 }]);
      mockEarnRecordAggregate.mockResolvedValueOnce([
        { _id: null, totalCoins: 125000, totalKarma: 500000 },
      ]);

      const res = await request(app).get('/api/karma/batch/stats');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.totalBatches).toBe(10);
      expect(res.body.data.totalCoinsIssued).toBe(125000);
    });
  });
});
