import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { EarnRecord, Batch, CSRPool, KarmaProfile, KarmaEvent } from '../src/models';

let mongoServer: MongoMemoryServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  await EarnRecord.deleteMany({});
  await Batch.deleteMany({});
  await CSRPool.deleteMany({});
  await KarmaProfile.deleteMany({});
  await KarmaEvent.deleteMany({});
});

// ---------------------------------------------------------------------------
// EarnRecord
// ---------------------------------------------------------------------------

describe('EarnRecord model', () => {
  it('creates an earn record with required fields', async () => {
    const record = await EarnRecord.create({
      userId: new mongoose.Types.ObjectId(),
      eventId: new mongoose.Types.ObjectId(),
      bookingId: new mongoose.Types.ObjectId(),
      karmaEarned: 320,
      activeLevelAtApproval: 'L3',
      conversionRateSnapshot: 0.75,
      csrPoolId: new mongoose.Types.ObjectId(),
      verificationSignals: {
        qr_in: true,
        qr_out: true,
        gps_match: true,
        ngo_approved: true,
        photo_proof: false,
      },
      confidenceScore: 0.85,
      status: 'APPROVED_PENDING_CONVERSION',
      idempotencyKey: `test-earn-${Date.now()}`,
    });

    expect(record._id).toBeDefined();
    expect(record.karmaEarned).toBe(320);
    expect(record.activeLevelAtApproval).toBe('L3');
    expect(record.conversionRateSnapshot).toBe(0.75);
    expect(record.status).toBe('APPROVED_PENDING_CONVERSION');
    expect(record.confidenceScore).toBe(0.85);
    expect(record.verificationSignals.qr_in).toBe(true);
    expect(record.verificationSignals.photo_proof).toBe(false);
  });

  it('rejects invalid status values', async () => {
    const userId = new mongoose.Types.ObjectId();
    const eventId = new mongoose.Types.ObjectId();
    const bookingId = new mongoose.Types.ObjectId();
    const csrPoolId = new mongoose.Types.ObjectId();

    await expect(
      EarnRecord.create({
        userId,
        eventId,
        bookingId,
        karmaEarned: 100,
        activeLevelAtApproval: 'L1',
        conversionRateSnapshot: 0.25,
        csrPoolId,
        verificationSignals: {
          qr_in: false, qr_out: false, gps_match: false, ngo_approved: false, photo_proof: false,
        },
        confidenceScore: 0.5,
        status: 'INVALID_STATUS' as any,
        idempotencyKey: `test-${Date.now()}`,
      }),
    ).rejects.toThrow();
  });

  it('defaults status to APPROVED_PENDING_CONVERSION', async () => {
    const record = await EarnRecord.create({
      userId: new mongoose.Types.ObjectId(),
      eventId: new mongoose.Types.ObjectId(),
      bookingId: new mongoose.Types.ObjectId(),
      karmaEarned: 100,
      activeLevelAtApproval: 'L1',
      conversionRateSnapshot: 0.25,
      csrPoolId: new mongoose.Types.ObjectId(),
      verificationSignals: {
        qr_in: true, qr_out: true, gps_match: false, ngo_approved: false, photo_proof: false,
      },
      confidenceScore: 0.6,
      idempotencyKey: `test-default-status-${Date.now()}`,
    });

    expect(record.status).toBe('APPROVED_PENDING_CONVERSION');
  });

  it('requires unique idempotencyKey', async () => {
    const key = `duplicate-key-${Date.now()}`;
    const userId = new mongoose.Types.ObjectId();
    const eventId = new mongoose.Types.ObjectId();
    const bookingId = new mongoose.Types.ObjectId();
    const csrPoolId = new mongoose.Types.ObjectId();

    await EarnRecord.create({
      userId, eventId, bookingId,
      karmaEarned: 100,
      activeLevelAtApproval: 'L1',
      conversionRateSnapshot: 0.25,
      csrPoolId,
      verificationSignals: {
        qr_in: false, qr_out: false, gps_match: false, ngo_approved: false, photo_proof: false,
      },
      confidenceScore: 0.5,
      idempotencyKey: key,
    });

    await expect(
      EarnRecord.create({
        userId: new mongoose.Types.ObjectId(),
        eventId: new mongoose.Types.ObjectId(),
        bookingId: new mongoose.Types.ObjectId(),
        karmaEarned: 200,
        activeLevelAtApproval: 'L2',
        conversionRateSnapshot: 0.5,
        csrPoolId: new mongoose.Types.ObjectId(),
        verificationSignals: {
          qr_in: true, qr_out: true, gps_match: true, ngo_approved: true, photo_proof: true,
        },
        confidenceScore: 1.0,
        idempotencyKey: key,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Batch
// ---------------------------------------------------------------------------

describe('Batch model', () => {
  it('creates a batch with required fields', async () => {
    const now = new Date();
    const weekStart = new Date(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const batch = await Batch.create({
      weekStart,
      weekEnd,
      csrPoolId: new mongoose.Types.ObjectId(),
      totalEarnRecords: 50,
      totalKarma: 16000,
      totalRezCoinsEstimated: 12000,
      status: 'DRAFT',
    });

    expect(batch._id).toBeDefined();
    expect(batch.status).toBe('DRAFT');
    expect(batch.totalKarma).toBe(16000);
    expect(batch.totalEarnRecords).toBe(50);
  });

  it('supports all batch statuses including PAUSED', async () => {
    const statuses: Array<'DRAFT' | 'READY' | 'EXECUTED' | 'PARTIAL' | 'PAUSED'> = [
      'DRAFT', 'READY', 'EXECUTED', 'PARTIAL', 'PAUSED',
    ];

    for (const status of statuses) {
      const batch = await Batch.create({
        weekStart: new Date(),
        weekEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        csrPoolId: new mongoose.Types.ObjectId(),
        status,
      });
      expect(batch.status).toBe(status);
      await batch.deleteOne();
    }
  });

  it('stores anomaly flags correctly', async () => {
    const batch = await Batch.create({
      weekStart: new Date(),
      weekEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      csrPoolId: new mongoose.Types.ObjectId(),
      anomalyFlags: [
        { type: 'too_many_from_one_ngo', count: 15, resolved: false },
        { type: 'pool_shortage', count: 3, resolved: true },
      ],
    });

    expect(batch.anomalyFlags).toHaveLength(2);
    expect(batch.anomalyFlags[0].type).toBe('too_many_from_one_ngo');
    expect(batch.anomalyFlags[0].count).toBe(15);
    expect(batch.anomalyFlags[1].resolved).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSRPool
// ---------------------------------------------------------------------------

describe('CSRPool model', () => {
  it('creates a CSR pool with required fields', async () => {
    const pool = await CSRPool.create({
      name: 'Test CSR Pool',
      campaignId: new mongoose.Types.ObjectId(),
      corporateId: new mongoose.Types.ObjectId(),
      totalBudget: 500000,
      remainingBudget: 500000,
      coinPool: 10000,
      coinPoolRemaining: 10000,
      issuedCoins: 0,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      events: [],
    });

    expect(pool._id).toBeDefined();
    expect(pool.name).toBe('Test CSR Pool');
    expect(pool.status).toBe('active');
    expect(pool.coinPoolRemaining).toBe(10000);
  });

  it('supports all CSR pool statuses', async () => {
    const statuses: Array<'active' | 'depleted' | 'expired'> = [
      'active', 'depleted', 'expired',
    ];

    for (const status of statuses) {
      const pool = await CSRPool.create({
        name: `Pool ${status}`,
        campaignId: new mongoose.Types.ObjectId(),
        corporateId: new mongoose.Types.ObjectId(),
        totalBudget: 100000,
        remainingBudget: 100000,
        coinPool: 5000,
        coinPoolRemaining: 5000,
        issuedCoins: 0,
        status,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        events: [],
      });
      expect(pool.status).toBe(status);
      await pool.deleteOne();
    }
  });

  it('stores linked events', async () => {
    const eventIds = [
      new mongoose.Types.ObjectId(),
      new mongoose.Types.ObjectId(),
    ];

    const pool = await CSRPool.create({
      name: 'Pool with Events',
      campaignId: new mongoose.Types.ObjectId(),
      corporateId: new mongoose.Types.ObjectId(),
      totalBudget: 200000,
      remainingBudget: 200000,
      coinPool: 5000,
      coinPoolRemaining: 5000,
      issuedCoins: 0,
      status: 'active',
      startDate: new Date(),
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      events: eventIds,
    });

    expect(pool.events).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// KarmaProfile
// ---------------------------------------------------------------------------

describe('KarmaProfile model', () => {
  it('creates a karma profile with defaults', async () => {
    const profile = await KarmaProfile.create({
      userId: new mongoose.Types.ObjectId(),
    });

    expect(profile._id).toBeDefined();
    expect(profile.level).toBe('L1');
    expect(profile.lifetimeKarma).toBe(0);
    expect(profile.activeKarma).toBe(0);
    expect(profile.eventsCompleted).toBe(0);
    expect(profile.trustScore).toBe(0);
    expect(profile.badges).toHaveLength(0);
    expect(profile.levelHistory).toHaveLength(0);
    expect(profile.conversionHistory).toHaveLength(0);
  });

  it('stores badges correctly', async () => {
    const profile = await KarmaProfile.create({
      userId: new mongoose.Types.ObjectId(),
      badges: [
        { id: 'early-adopter', name: 'Early Adopter', earnedAt: new Date() },
        { id: 'tree-planter', name: 'Tree Planter', earnedAt: new Date() },
      ],
    });

    expect(profile.badges).toHaveLength(2);
    expect(profile.badges[0].id).toBe('early-adopter');
    expect(profile.badges[1].name).toBe('Tree Planter');
  });

  it('stores level history with drop tracking', async () => {
    const earnedAt = new Date('2024-01-01');
    const droppedAt = new Date('2024-06-01');

    const profile = await KarmaProfile.create({
      userId: new mongoose.Types.ObjectId(),
      levelHistory: [
        { level: 'L1', earnedAt, droppedAt: undefined },
        { level: 'L2', earnedAt: new Date('2024-02-01') },
      ],
    });

    expect(profile.levelHistory).toHaveLength(2);
    expect(profile.levelHistory[0].level).toBe('L1');
  });

  it('stores conversion history', async () => {
    const batchId = new mongoose.Types.ObjectId();
    const profile = await KarmaProfile.create({
      userId: new mongoose.Types.ObjectId(),
      conversionHistory: [
        {
          karmaConverted: 1000,
          coinsEarned: 750,
          rate: 0.75,
          batchId,
          convertedAt: new Date(),
        },
      ],
    });

    expect(profile.conversionHistory).toHaveLength(1);
    expect(profile.conversionHistory[0].karmaConverted).toBe(1000);
    expect(profile.conversionHistory[0].coinsEarned).toBe(750);
  });

  it('prevents duplicate userId', async () => {
    const userId = new mongoose.Types.ObjectId();

    await KarmaProfile.create({ userId });

    await expect(
      KarmaProfile.create({ userId }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// KarmaEvent
// ---------------------------------------------------------------------------

describe('KarmaEvent model', () => {
  it('creates a karma event with required fields', async () => {
    const event = await KarmaEvent.create({
      merchantEventId: new mongoose.Types.ObjectId(),
      ngoId: new mongoose.Types.ObjectId(),
      category: 'environment',
      impactUnit: 'trees',
      impactMultiplier: 1.5,
      difficulty: 'medium',
      expectedDurationHours: 4,
      baseKarmaPerHour: 80,
      maxKarmaPerEvent: 400,
      qrCodes: {
        checkIn: 'qi_test_checkin_001',
        checkOut: 'qi_test_checkout_001',
      },
      gpsRadius: 150,
      maxVolunteers: 30,
      confirmedVolunteers: 0,
      status: 'draft',
    });

    expect(event._id).toBeDefined();
    expect(event.category).toBe('environment');
    expect(event.impactUnit).toBe('trees');
    expect(event.difficulty).toBe('medium');
    expect(event.maxKarmaPerEvent).toBe(400);
    expect(event.status).toBe('draft');
    expect(event.qrCodes.checkIn).toBe('qi_test_checkin_001');
  });

  it('supports all event categories', async () => {
    const categories = ['environment', 'food', 'health', 'education', 'community'];

    for (const category of categories) {
      const event = await KarmaEvent.create({
        merchantEventId: new mongoose.Types.ObjectId(),
        ngoId: new mongoose.Types.ObjectId(),
        category,
        impactUnit: 'units',
        impactMultiplier: 1.0,
        difficulty: 'easy',
        expectedDurationHours: 2,
        baseKarmaPerHour: 50,
        maxKarmaPerEvent: 200,
        qrCodes: { checkIn: 'ci', checkOut: 'co' },
        gpsRadius: 100,
        maxVolunteers: 10,
        confirmedVolunteers: 0,
        status: 'published',
      });
      expect(event.category).toBe(category);
      await event.deleteOne();
    }
  });

  it('supports all event statuses', async () => {
    const statuses: Array<'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled'> = [
      'draft', 'published', 'ongoing', 'completed', 'cancelled',
    ];

    for (const status of statuses) {
      const event = await KarmaEvent.create({
        merchantEventId: new mongoose.Types.ObjectId(),
        ngoId: new mongoose.Types.ObjectId(),
        category: 'community',
        impactUnit: 'hours',
        impactMultiplier: 1.0,
        difficulty: 'easy',
        expectedDurationHours: 1,
        baseKarmaPerHour: 50,
        maxKarmaPerEvent: 100,
        qrCodes: { checkIn: 'ci2', checkOut: 'co2' },
        gpsRadius: 100,
        maxVolunteers: 10,
        confirmedVolunteers: 0,
        status,
      });
      expect(event.status).toBe(status);
      await event.deleteOne();
    }
  });
});
