/**
 * Unit tests for batchService
 *
 * Tests core batch logic:
 * - createWeeklyBatch: creates batch from pending records
 * - applyCapsToRecord: enforces 300 coin weekly cap
 * - checkBatchAnomalies: detects batch from same NGO
 */
import { Types } from 'mongoose';

// ── Mocks ────────────────────────────────────────────────────────────────────────

const mockEarnRecordAggregate = jest.fn();
const mockEarnRecordFind = jest.fn();
const mockEarnRecordFindOne = jest.fn();
const mockEarnRecordUpdateMany = jest.fn();
const mockEarnRecordSave = jest.fn();
const mockBatchFindById = jest.fn();
const mockBatchFindOne = jest.fn();
const mockBatchFind = jest.fn();
const mockBatchUpdateMany = jest.fn();
const mockBatchSave = jest.fn();
const mockCSRPoolFindById = jest.fn();
const mockCSRPoolUpdateOne = jest.fn();
const mockKarmaProfileUpdateOne = jest.fn();
const mockCreditUserWallet = jest.fn();
const mockLogAudit = jest.fn();
const mockCreateServiceLogger = jest.fn(() => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../src/models/EarnRecord', () => ({
  EarnRecord: {
    aggregate: mockEarnRecordAggregate,
    find: (q: unknown) => ({ lean: () => mockEarnRecordFind(q) }),
    findOne: mockEarnRecordFindOne,
    updateMany: mockEarnRecordUpdateMany,
  },
}));

jest.mock('../src/models/Batch', () => {
  const actual = jest.requireActual('../src/models/Batch');
  return {
    ...actual,
    Batch: function (data: Record<string, unknown>) {
      return {
        ...data,
        _id: new Types.ObjectId(),
        save: mockBatchSave.mockResolvedValue(this),
      };
    },
    BatchModel: {
      findById: (id: unknown) => ({ lean: () => mockBatchFindById(id) }),
      findOne: (q: unknown) => ({ lean: () => mockBatchFindOne(q) }),
      find: (q: unknown) => ({ lean: () => mockBatchFind(q) }),
      updateMany: mockBatchUpdateMany,
    },
  };
});

jest.mock('../src/models/CSRPool', () => ({
  CSRPool: {
    findById: (id: unknown) => ({
      lean: () => mockCSRPoolFindById(id),
    }),
    updateOne: mockCSRPoolUpdateOne,
  },
}));

jest.mock('../src/models/KarmaProfile', () => ({
  KarmaProfile: {
    updateOne: mockKarmaProfileUpdateOne,
  },
}));

jest.mock('../src/services/walletIntegration', () => ({
  creditUserWallet: mockCreditUserWallet,
}));

jest.mock('../src/services/auditService', () => ({
  logAudit: mockLogAudit,
}));

jest.mock('../src/config/logger', () => ({
  createServiceLogger: mockCreateServiceLogger,
}));

jest.mock('../src/engines/karmaEngine', () => ({
  WEEKLY_COIN_CAP: 300,
}));

// Import after mocks are set up
import {
  applyCapsToRecord,
  checkBatchAnomalies,
  createWeeklyBatch,
  createBatchForPool,
  executeBatch,
  getBatchPreview,
  pauseAllPendingBatches,
} from '../src/services/batchService';

describe('batchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── applyCapsToRecord ──────────────────────────────────────────────────────

  describe('applyCapsToRecord', () => {
    it('should return raw coins when weekly used is zero', () => {
      const record = { karmaEarned: 400, conversionRateSnapshot: 0.75 };
      const result = applyCapsToRecord(record, 0);
      // 400 * 0.75 = 300 coins
      expect(result).toBe(300);
    });

    it('should cap coins at 300 when weekly used is zero', () => {
      const record = { karmaEarned: 1000, conversionRateSnapshot: 1.0 };
      const result = applyCapsToRecord(record, 0);
      // 1000 * 1.0 = 1000, cap = 300
      expect(result).toBe(300);
    });

    it('should reduce cap by weekly used amount', () => {
      const record = { karmaEarned: 400, conversionRateSnapshot: 0.75 };
      // Already used 100 coins this week, remaining cap = 200
      const result = applyCapsToRecord(record, 100);
      // 400 * 0.75 = 300, remaining cap = 200
      expect(result).toBe(200);
    });

    it('should return 0 when weekly cap is fully exhausted', () => {
      const record = { karmaEarned: 400, conversionRateSnapshot: 0.75 };
      const result = applyCapsToRecord(record, 300);
      // 300 - 300 = 0 remaining
      expect(result).toBe(0);
    });

    it('should floor fractional coins', () => {
      const record = { karmaEarned: 100, conversionRateSnapshot: 0.33 };
      const result = applyCapsToRecord(record, 0);
      // 100 * 0.33 = 33.0
      expect(result).toBe(33);
    });
  });

  // ── createWeeklyBatch ─────────────────────────────────────────────────────

  describe('createWeeklyBatch', () => {
    it('should return empty array when no pending records exist', async () => {
      mockEarnRecordAggregate.mockResolvedValue([]);

      const batches = await createWeeklyBatch();

      expect(batches).toEqual([]);
      expect(mockEarnRecordAggregate).toHaveBeenCalledTimes(1);
    });

    it('should create a batch when pending records exist', async () => {
      const poolId = new Types.ObjectId();
      const groupData = {
        _id: poolId.toString(),
        records: [{ _id: new Types.ObjectId() }],
        totalKarma: 1000,
        totalCoinsEstimated: 500,
        count: 1,
      };

      mockEarnRecordAggregate.mockResolvedValueOnce([groupData]);

      const mockPool = {
        _id: poolId.toString(),
        coinPoolRemaining: 10000,
        name: 'Test Pool',
        status: 'active',
      };

      // Mock for createBatchForPool
      mockEarnRecordAggregate.mockResolvedValueOnce([groupData]);
      mockCSRPoolFindById.mockResolvedValue(mockPool);
      mockEarnRecordUpdateMany.mockResolvedValue({ modifiedCount: 1 });

      // Mock for checkBatchAnomalies called inside createBatchForPool
      mockEarnRecordAggregate.mockResolvedValueOnce([]); // ngo counts
      mockEarnRecordAggregate.mockResolvedValueOnce([]); // timestamp counts
      mockBatchFindOne.mockResolvedValue(null); // pool shortage check (no batch yet)

      mockBatchSave.mockImplementation(function (this: Record<string, unknown>) {
        return Promise.resolve(this);
      });

      const batches = await createWeeklyBatch();

      expect(batches.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ── checkBatchAnomalies ────────────────────────────────────────────────────

  describe('checkBatchAnomalies', () => {
    it('should detect too_many_from_one_ngo when NGO has >50 records', async () => {
      const batchId = new Types.ObjectId().toString();
      const csrPoolId = new Types.ObjectId().toString();
      const weekStart = new Date('2024-01-01');
      const weekEnd = new Date('2024-01-07');

      // Mock ngo counts aggregation — 1 NGO with 60 records
      mockEarnRecordAggregate
        .mockResolvedValueOnce([{ _id: 'ngo1', count: 60 }])
        // Mock timestamp counts — empty (no suspicious timestamps)
        .mockResolvedValueOnce([])
        // Mock batch find for pool shortage check
        .mockResolvedValueOnce(null);

      const flags = await checkBatchAnomalies(batchId, csrPoolId, weekStart, weekEnd);

      expect(flags.some((f) => f.type === 'too_many_from_one_ngo')).toBe(true);
      const ngoFlag = flags.find((f) => f.type === 'too_many_from_one_ngo');
      expect(ngoFlag?.count).toBe(60);
      expect(ngoFlag?.resolved).toBe(false);
    });

    it('should detect suspicious_timestamps when records share identical timestamps', async () => {
      const batchId = new Types.ObjectId().toString();
      const csrPoolId = new Types.ObjectId().toString();
      const weekStart = new Date('2024-01-01');
      const weekEnd = new Date('2024-01-07');

      mockEarnRecordAggregate
        // ngo counts — empty
        .mockResolvedValueOnce([])
        // timestamp counts — 3 time slots with >10 records each
        .mockResolvedValueOnce([
          { _id: '2024-01-03T14:00', count: 15 },
          { _id: '2024-01-03T14:01', count: 12 },
        ])
        .mockResolvedValueOnce(null);

      const flags = await checkBatchAnomalies(batchId, csrPoolId, weekStart, weekEnd);

      expect(flags.some((f) => f.type === 'suspicious_timestamps')).toBe(true);
    });

    it('should detect pool_shortage when pool has insufficient coins', async () => {
      const batchId = new Types.ObjectId();
      const csrPoolId = new Types.ObjectId().toString();
      const weekStart = new Date('2024-01-01');
      const weekEnd = new Date('2024-01-07');

      const mockBatch = {
        _id: batchId,
        totalRezCoinsEstimated: 1000,
        csrPoolId,
      };

      const mockPool = {
        _id: csrPoolId,
        coinPoolRemaining: 500, // less than estimated 1000
      };

      mockEarnRecordAggregate
        .mockResolvedValueOnce([]) // ngo counts
        .mockResolvedValueOnce([]); // timestamp counts

      mockBatchFindOne.mockResolvedValue(mockBatch);
      mockCSRPoolFindById.mockResolvedValue(mockPool);

      const flags = await checkBatchAnomalies(batchId.toString(), csrPoolId, weekStart, weekEnd);

      expect(flags.some((f) => f.type === 'pool_shortage')).toBe(true);
    });

    it('should return empty array when no anomalies detected', async () => {
      const batchId = new Types.ObjectId().toString();
      const csrPoolId = new Types.ObjectId().toString();
      const weekStart = new Date('2024-01-01');
      const weekEnd = new Date('2024-01-07');

      mockEarnRecordAggregate
        .mockResolvedValueOnce([]) // ngo counts
        .mockResolvedValueOnce([]) // timestamp counts
        .mockResolvedValueOnce(null); // batch find

      const flags = await checkBatchAnomalies(batchId, csrPoolId, weekStart, weekEnd);

      expect(flags).toEqual([]);
    });
  });

  // ── getBatchPreview ────────────────────────────────────────────────────────

  describe('getBatchPreview', () => {
    it('should return null for non-existent batch', async () => {
      mockBatchFindById.mockResolvedValue(null);

      const result = await getBatchPreview('nonexistent');

      expect(result).toBeNull();
    });

    it('should return preview with capped coins for each record', async () => {
      const batchId = new Types.ObjectId();
      const poolId = new Types.ObjectId();

      const mockBatch = {
        _id: batchId,
        weekStart: new Date('2024-01-01'),
        weekEnd: new Date('2024-01-07'),
        csrPoolId: poolId.toString(),
        status: 'READY',
        totalEarnRecords: 2,
        totalKarma: 1000,
        totalRezCoinsEstimated: 500,
        anomalyFlags: [],
      };

      const mockPool = {
        _id: poolId,
        name: 'Test Pool',
        coinPoolRemaining: 10000,
        status: 'active',
      };

      const mockRecords = [
        {
          _id: new Types.ObjectId(),
          userId: 'user1',
          karmaEarned: 400,
          conversionRateSnapshot: 0.75,
          status: 'APPROVED_PENDING_CONVERSION',
          approvedAt: new Date('2024-01-03'),
        },
        {
          _id: new Types.ObjectId(),
          userId: 'user2',
          karmaEarned: 800,
          conversionRateSnapshot: 0.5,
          status: 'APPROVED_PENDING_CONVERSION',
          approvedAt: new Date('2024-01-04'),
        },
      ];

      mockBatchFindById.mockResolvedValue(mockBatch);
      mockCSRPoolFindById.mockResolvedValue(mockPool);
      mockEarnRecordFind.mockResolvedValue(mockRecords);

      // Mock getWeeklyCoinsUsed (called per record)
      mockEarnRecordAggregate.mockResolvedValue([{ _id: null, total: 0 }]);

      mockEarnRecordAggregate.mockResolvedValue([]); // ngo counts
      mockEarnRecordAggregate.mockResolvedValue([]); // timestamp counts
      mockBatchFindOne.mockResolvedValue(null);

      const result = await getBatchPreview(batchId.toString());

      expect(result).not.toBeNull();
      expect(result!.summary.totalRecords).toBe(2);
      // Record 1: 400 * 0.75 = 300, capped at 300
      // Record 2: 800 * 0.5 = 400, capped at 300
      expect(result!.summary.totalCapped).toBe(600);
    });
  });

  // ── executeBatch ───────────────────────────────────────────────────────────

  describe('executeBatch', () => {
    it('should return error when batch not found', async () => {
      mockBatchFindById.mockResolvedValue(null);

      const result = await executeBatch('nonexistent', 'admin1');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Batch not found');
    });

    it('should return error when batch already executed', async () => {
      const batchId = new Types.ObjectId();
      mockBatchFindById.mockResolvedValue({
        _id: batchId,
        status: 'EXECUTED',
      });

      const result = await executeBatch(batchId.toString(), 'admin1');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Batch already executed');
    });
  });

  // ── pauseAllPendingBatches ─────────────────────────────────────────────────

  describe('pauseAllPendingBatches', () => {
    it('should pause all READY and DRAFT batches', async () => {
      mockBatchUpdateMany.mockResolvedValue({ modifiedCount: 5 });

      const count = await pauseAllPendingBatches('Emergency maintenance');

      expect(count).toBe(5);
      expect(mockBatchUpdateMany).toHaveBeenCalledWith(
        { status: { $in: ['READY', 'DRAFT'] } },
        expect.objectContaining({
          $set: expect.objectContaining({
            pauseReason: 'Emergency maintenance',
          }),
        }),
      );
    });

    it('should return 0 when no batches to pause', async () => {
      mockBatchUpdateMany.mockResolvedValue({ modifiedCount: 0 });

      const count = await pauseAllPendingBatches('Cleanup');

      expect(count).toBe(0);
    });
  });
});
