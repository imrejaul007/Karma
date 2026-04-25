/**
 * Tests for CSR Cloud Service
 *
 * Tests the Corporate Social Responsibility functionality:
 * - Karma credit allocation with budget validation
 * - Employee program management
 * - Corporate dashboard data
 * - CSR report generation
 * - Partner slug generation
 */

// Set required environment variables before importing modules
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!';
process.env.REDIS_URL = 'redis://localhost:6379';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  allocateKarmaCredits,
  addEmployeeToProgram,
  getCorporateDashboard,
  generateCsrReport,
  getEmployeeStats,
  addSponsoredEvent,
} from '../src/services/csrService';
import { CorporatePartner } from '../src/models/CorporatePartner';
import { CsrAllocation } from '../src/models/CsrAllocation';
import { KarmaProfile } from '../src/models/KarmaProfile';
import { KarmaEvent } from '../src/models/KarmaEvent';
import { EarnRecord } from '../src/models/EarnRecord';

// ─── Setup ────────────────────────────────────────────────────────────────────

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

beforeEach(async () => {
  jest.clearAllMocks();
  await CorporatePartner.deleteMany({});
  await CsrAllocation.deleteMany({});
  await KarmaProfile.deleteMany({});
  await KarmaEvent.deleteMany({});
  await EarnRecord.deleteMany({});
});

// ─── Helper functions ─────────────────────────────────────────────────────────

function createMockUserId(): string {
  return new mongoose.Types.ObjectId().toString();
}

async function createCorporatePartner(data: {
  companyName: string;
  companySlug: string;
  creditsBudget?: number;
  creditsUsed?: number;
  employeeIds?: mongoose.Types.ObjectId[];
  sponsoredEvents?: mongoose.Types.ObjectId[];
  tier?: 'bronze' | 'silver' | 'gold' | 'platinum';
}): Promise<mongoose.Document> {
  return CorporatePartner.create({
    companyName: data.companyName,
    companySlug: data.companySlug,
    logoUrl: `https://example.com/${data.companySlug}.png`,
    contactEmail: `contact@${data.companySlug}.com`,
    tier: data.tier || 'bronze',
    creditsBudget: data.creditsBudget ?? 10000,
    creditsUsed: data.creditsUsed ?? 0,
    employeeIds: data.employeeIds || [],
    sponsoredEvents: data.sponsoredEvents || [],
    stats: {
      totalEvents: 0,
      totalVolunteers: 0,
      totalHours: 0,
      totalKarma: 0,
    },
    reports: [],
  });
}

async function createKarmaProfile(userId: string): Promise<void> {
  await KarmaProfile.create({
    userId: new mongoose.Types.ObjectId(userId),
    lifetimeKarma: 500,
    activeKarma: 400,
    level: 'L2',
    eventsCompleted: 5,
    eventsJoined: 5,
    totalHours: 20,
    trustScore: 80,
    badges: [],
    lastActivityAt: new Date(),
    levelHistory: [],
    conversionHistory: [],
    thisWeekKarmaEarned: 50,
    avgEventDifficulty: 0.5,
    avgConfidenceScore: 0.8,
    checkIns: 5,
    approvedCheckIns: 4,
    activityHistory: [new Date()],
  });
}

async function createKarmaEvent(
  category: string = 'environment',
  status: string = 'completed',
): Promise<mongoose.Document> {
  return KarmaEvent.create({
    merchantEventId: new mongoose.Types.ObjectId(),
    ngoId: new mongoose.Types.ObjectId(),
    category,
    impactUnit: 'trees',
    impactMultiplier: 1.5,
    difficulty: 'medium',
    expectedDurationHours: 4,
    baseKarmaPerHour: 80,
    maxKarmaPerEvent: 400,
    qrCodes: {
      checkIn: `qi_${Date.now()}_checkin`,
      checkOut: `qo_${Date.now()}_checkout`,
    },
    gpsRadius: 150,
    maxVolunteers: 30,
    confirmedVolunteers: 10,
    status,
  });
}

// ─── allocateKarmaCredits Tests ───────────────────────────────────────────────

describe('allocateKarmaCredits', () => {
  it('validates partnerId format', async () => {
    const recipientId = createMockUserId();

    await expect(
      allocateKarmaCredits('invalid-id', recipientId, 100),
    ).rejects.toThrow('Invalid partnerId');
  });

  it('validates recipientUserId format', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(
      allocateKarmaCredits(partner._id.toString(), 'invalid-id', 100),
    ).rejects.toThrow('Invalid recipientUserId');
  });

  it('validates amount is positive', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });
    const recipientId = createMockUserId();

    await expect(
      allocateKarmaCredits(partner._id.toString(), recipientId, 0),
    ).rejects.toThrow('Invalid amount');

    await expect(
      allocateKarmaCredits(partner._id.toString(), recipientId, -100),
    ).rejects.toThrow('Invalid amount');
  });

  it('creates allocation when within budget', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      creditsBudget: 1000,
      creditsUsed: 0,
    });
    const recipientId = createMockUserId();

    const allocation = await allocateKarmaCredits(
      partner._id.toString(),
      recipientId,
      500,
    );

    expect(allocation._id).toBeDefined();
    expect(allocation.amount).toBe(500);
    expect(allocation.corporatePartnerId.toString()).toBe(partner._id.toString());
    expect(allocation.recipientUserId.toString()).toBe(recipientId);
    expect(allocation.status).toBe('approved');
  });

  it('updates partner creditsUsed after allocation', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      creditsBudget: 1000,
      creditsUsed: 200,
    });
    const recipientId = createMockUserId();

    await allocateKarmaCredits(partner._id.toString(), recipientId, 300);

    const updated = await CorporatePartner.findById(partner._id);
    expect(updated?.creditsUsed).toBe(500); // 200 + 300
  });

  it('rejects allocation exceeding available budget', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      creditsBudget: 1000,
      creditsUsed: 800, // Only 200 available
    });
    const recipientId = createMockUserId();

    await expect(
      allocateKarmaCredits(partner._id.toString(), recipientId, 500),
    ).rejects.toThrow('Insufficient credits');
  });

  it('accepts allocation equal to available budget', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      creditsBudget: 1000,
      creditsUsed: 800, // Exactly 200 available
    });
    const recipientId = createMockUserId();

    const allocation = await allocateKarmaCredits(
      partner._id.toString(),
      recipientId,
      200,
    );

    expect(allocation.amount).toBe(200);
  });

  it('throws error for non-existent partner', async () => {
    const fakePartnerId = new mongoose.Types.ObjectId().toString();
    const recipientId = createMockUserId();

    await expect(
      allocateKarmaCredits(fakePartnerId, recipientId, 100),
    ).rejects.toThrow('Corporate partner not found');
  });

  it('validates eventId if provided', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });
    const recipientId = createMockUserId();

    // Invalid eventId
    await expect(
      allocateKarmaCredits(partner._id.toString(), recipientId, 100, 'invalid'),
    ).rejects.toThrow('Invalid eventId');

    // Non-existent eventId
    await expect(
      allocateKarmaCredits(
        partner._id.toString(),
        recipientId,
        100,
        new mongoose.Types.ObjectId().toString(),
      ),
    ).rejects.toThrow('Karma event not found');
  });

  it('validates event is sponsored by partner', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      sponsoredEvents: [], // No sponsored events
    });
    const recipientId = createMockUserId();

    // Create an event not sponsored by partner
    const event = await createKarmaEvent();

    await expect(
      allocateKarmaCredits(partner._id.toString(), recipientId, 100, event._id.toString()),
    ).rejects.toThrow(`Event ${event._id} is not sponsored by this partner`);
  });

  it('creates allocation with approved event', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });
    const recipientId = createMockUserId();

    const event = await createKarmaEvent();

    // First add the event as sponsored by the partner
    await addSponsoredEvent(partner._id.toString(), event._id.toString());

    const allocation = await allocateKarmaCredits(
      partner._id.toString(),
      recipientId,
      100,
      event._id.toString(),
    );

    expect(allocation.eventId.toString()).toBe(event._id.toString());
  });

  it('generates new ObjectId for eventId when not provided', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });
    const recipientId = createMockUserId();

    const allocation = await allocateKarmaCredits(
      partner._id.toString(),
      recipientId,
      100,
    );

    expect(allocation.eventId).toBeDefined();
  });
});

// ─── addEmployeeToProgram Tests ─────────────────────────────────────────────

describe('addEmployeeToProgram', () => {
  it('adds employee to partner program', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [],
    });
    const employeeId = createMockUserId();

    await addEmployeeToProgram(partner._id.toString(), employeeId);

    const updated = await CorporatePartner.findById(partner._id);
    expect(
      updated?.employeeIds.some((id) => id.toString() === employeeId),
    ).toBe(true);
  });

  it('validates partnerId format', async () => {
    const employeeId = createMockUserId();

    await expect(
      addEmployeeToProgram('invalid-id', employeeId),
    ).rejects.toThrow('Invalid partnerId');
  });

  it('validates employeeUserId format', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(
      addEmployeeToProgram(partner._id.toString(), 'invalid-id'),
    ).rejects.toThrow('Invalid employeeUserId');
  });

  it('throws error for non-existent partner', async () => {
    const fakePartnerId = new mongoose.Types.ObjectId().toString();
    const employeeId = createMockUserId();

    await expect(
      addEmployeeToProgram(fakePartnerId, employeeId),
    ).rejects.toThrow('Corporate partner not found');
  });

  it('is idempotent - adding same employee twice does not duplicate', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [],
    });
    const employeeId = createMockUserId();

    await addEmployeeToProgram(partner._id.toString(), employeeId);
    await addEmployeeToProgram(partner._id.toString(), employeeId);

    const updated = await CorporatePartner.findById(partner._id);
    const count = updated?.employeeIds.filter(
      (id) => id.toString() === employeeId,
    ).length;

    expect(count).toBe(1);
  });
});

// ─── getCorporateDashboard Tests ─────────────────────────────────────────────

describe('getCorporateDashboard', () => {
  it('returns partner stats', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const dashboard = await getCorporateDashboard(partner._id.toString());

    expect(dashboard.partner.companyName).toBe('Test Corp');
    expect(dashboard.ytdStats).toBeDefined();
    expect(dashboard.employeeLeaderboard).toBeDefined();
    expect(dashboard.recentActivity).toBeDefined();
  });

  it('validates partnerId format', async () => {
    await expect(getCorporateDashboard('invalid-id')).rejects.toThrow(
      'Invalid partnerId',
    );
  });

  it('throws error for non-existent partner', async () => {
    const fakePartnerId = new mongoose.Types.ObjectId().toString();

    await expect(getCorporateDashboard(fakePartnerId)).rejects.toThrow(
      'Corporate partner not found',
    );
  });

  it('returns empty employee leaderboard for partner with no employees', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [],
    });

    const dashboard = await getCorporateDashboard(partner._id.toString());

    expect(dashboard.employeeLeaderboard).toEqual([]);
  });

  it('returns employee leaderboard sorted by karma', async () => {
    const employee1Id = new mongoose.Types.ObjectId();
    const employee2Id = new mongoose.Types.ObjectId();

    // Create profiles with different karma
    await KarmaProfile.create({
      userId: employee1Id,
      lifetimeKarma: 300,
      activeKarma: 200,
      level: 'L2',
      eventsCompleted: 3,
      eventsJoined: 3,
      totalHours: 15,
      trustScore: 70,
      badges: [],
      lastActivityAt: new Date(),
      levelHistory: [],
      conversionHistory: [],
      thisWeekKarmaEarned: 30,
      avgEventDifficulty: 0.5,
      avgConfidenceScore: 0.8,
      checkIns: 3,
      approvedCheckIns: 2,
      activityHistory: [new Date()],
    });

    await KarmaProfile.create({
      userId: employee2Id,
      lifetimeKarma: 800,
      activeKarma: 600,
      level: 'L3',
      eventsCompleted: 8,
      eventsJoined: 8,
      totalHours: 40,
      trustScore: 90,
      badges: [],
      lastActivityAt: new Date(),
      levelHistory: [],
      conversionHistory: [],
      thisWeekKarmaEarned: 100,
      avgEventDifficulty: 0.6,
      avgConfidenceScore: 0.9,
      checkIns: 8,
      approvedCheckIns: 7,
      activityHistory: [new Date()],
    });

    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [employee1Id, employee2Id],
    });

    const dashboard = await getCorporateDashboard(partner._id.toString());

    expect(dashboard.employeeLeaderboard).toHaveLength(2);
    expect(dashboard.employeeLeaderboard[0].karma).toBe(800);
    expect(dashboard.employeeLeaderboard[0].rank).toBe(1);
    expect(dashboard.employeeLeaderboard[1].karma).toBe(300);
    expect(dashboard.employeeLeaderboard[1].rank).toBe(2);
  });

  it('includes top causes in YTD stats', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const dashboard = await getCorporateDashboard(partner._id.toString());

    expect(Array.isArray(dashboard.ytdStats.topCauses)).toBe(true);
  });

  it('includes monthly trend data', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const dashboard = await getCorporateDashboard(partner._id.toString());

    expect(Array.isArray(dashboard.ytdStats.monthlyTrend)).toBe(true);
  });
});

// ─── generateCsrReport Tests ─────────────────────────────────────────────────

describe('generateCsrReport', () => {
  it('generates report with all sections', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const report = await generateCsrReport(partner._id.toString(), 2026, 1);

    expect(report.companyName).toBe('Test Corp');
    expect(report.period).toBeDefined();
    expect(report.period.start).toBe('2026-01-01');
    expect(report.period.end).toBe('2026-03-31');
    expect(report.executiveSummary).toBeDefined();
    expect(report.impactByCategory).toBeDefined();
    expect(report.employeeParticipation).toBeDefined();
    expect(report.eventList).toBeDefined();
  });

  it('validates partnerId format', async () => {
    await expect(generateCsrReport('invalid-id', 2026, 1)).rejects.toThrow(
      'Invalid partnerId',
    );
  });

  it('throws error for non-existent partner', async () => {
    const fakePartnerId = new mongoose.Types.ObjectId().toString();

    await expect(generateCsrReport(fakePartnerId, 2026, 1)).rejects.toThrow(
      'Corporate partner not found',
    );
  });

  it('validates quarter is 1-4', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(generateCsrReport(partner._id.toString(), 2026, 0)).rejects.toThrow(
      'Invalid quarter',
    );

    await expect(generateCsrReport(partner._id.toString(), 2026, 5)).rejects.toThrow(
      'Invalid quarter',
    );
  });

  it('calculates period boundaries correctly for each quarter', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    // Q1: Jan-Mar
    const report1 = await generateCsrReport(partner._id.toString(), 2026, 1);
    expect(report1.period.start).toBe('2026-01-01');
    expect(report1.period.end).toBe('2026-03-31');

    // Q2: Apr-Jun
    const report2 = await generateCsrReport(partner._id.toString(), 2026, 2);
    expect(report2.period.start).toBe('2026-04-01');
    expect(report2.period.end).toBe('2026-06-30');

    // Q3: Jul-Sep
    const report3 = await generateCsrReport(partner._id.toString(), 2026, 3);
    expect(report3.period.start).toBe('2026-07-01');
    expect(report3.period.end).toBe('2026-09-30');

    // Q4: Oct-Dec
    const report4 = await generateCsrReport(partner._id.toString(), 2026, 4);
    expect(report4.period.start).toBe('2026-10-01');
    expect(report4.period.end).toBe('2026-12-31');
  });

  it('calculates impact metrics', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const report = await generateCsrReport(partner._id.toString(), 2026, 1);

    expect(report.executiveSummary).toHaveProperty('carbonOffset');
    expect(report.executiveSummary).toHaveProperty('mealsDonated');
    expect(report.executiveSummary).toHaveProperty('treesPlanted');
  });

  it('calculates employee participation rate', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [],
    });

    const report = await generateCsrReport(partner._id.toString(), 2026, 1);

    expect(report.employeeParticipation).toBeDefined();
    expect(report.employeeParticipation.totalEmployees).toBe(0);
    expect(report.employeeParticipation.participationRate).toBe(0);
  });

  it('returns empty event list when no events in period', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    const report = await generateCsrReport(partner._id.toString(), 2026, 1);

    expect(Array.isArray(report.eventList)).toBe(true);
  });
});

// ─── Partner slug tests ───────────────────────────────────────────────────────

describe('Corporate partner slug', () => {
  it('creates URL-safe slug', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Company Inc.',
      companySlug: 'test-company-inc',
    });

    expect((partner as any).companySlug).toBe('test-company-inc');
    expect((partner as any).companySlug).toMatch(/^[a-z0-9-]+$/);
  });

  it('slug is lowercase', async () => {
    const partner = await createCorporatePartner({
      companyName: 'UPPERCASE Corp',
      companySlug: 'uppercase-corp',
    });

    const slug = (partner as any).companySlug;
    expect(slug).toBe(slug.toLowerCase());
  });

  it('slug does not contain spaces', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Company With Spaces',
      companySlug: 'company-with-spaces',
    });

    expect((partner as any).companySlug).not.toContain(' ');
  });

  it('enforces unique slug constraint', async () => {
    await createCorporatePartner({
      companyName: 'First Company',
      companySlug: 'same-slug',
    });

    // Second company with same slug should fail
    await expect(
      createCorporatePartner({
        companyName: 'Second Company',
        companySlug: 'same-slug',
      }),
    ).rejects.toThrow();
  });
});

// ─── getEmployeeStats Tests ───────────────────────────────────────────────────

describe('getEmployeeStats', () => {
  it('returns employee statistics', async () => {
    const employeeId = new mongoose.Types.ObjectId();

    await KarmaProfile.create({
      userId: employeeId,
      lifetimeKarma: 1000,
      activeKarma: 800,
      level: 'L3',
      eventsCompleted: 10,
      eventsJoined: 10,
      totalHours: 50,
      trustScore: 85,
      badges: [],
      lastActivityAt: new Date(),
      levelHistory: [],
      conversionHistory: [],
      thisWeekKarmaEarned: 100,
      avgEventDifficulty: 0.6,
      avgConfidenceScore: 0.85,
      checkIns: 10,
      approvedCheckIns: 9,
      activityHistory: [new Date()],
    });

    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [employeeId],
    });

    const stats = await getEmployeeStats(partner._id.toString(), employeeId.toString());

    expect(stats.userId).toBe(employeeId.toString());
    expect(stats.karma).toBe(1000);
    expect(stats.events).toBe(10);
    expect(stats.hours).toBe(50);
    expect(stats.rank).toBeGreaterThanOrEqual(1);
  });

  it('validates partnerId format', async () => {
    const employeeId = createMockUserId();

    await expect(
      getEmployeeStats('invalid-id', employeeId),
    ).rejects.toThrow('Invalid partnerId');
  });

  it('validates employeeUserId format', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(
      getEmployeeStats(partner._id.toString(), 'invalid-id'),
    ).rejects.toThrow('Invalid employeeUserId');
  });

  it('throws error for employee not in program', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [],
    });
    const employeeId = createMockUserId();

    await expect(
      getEmployeeStats(partner._id.toString(), employeeId),
    ).rejects.toThrow('not in partner');
  });

  it('returns zeros for employee without karma profile', async () => {
    const employeeId = new mongoose.Types.ObjectId(); // No karma profile created

    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      employeeIds: [employeeId],
    });

    const stats = await getEmployeeStats(partner._id.toString(), employeeId.toString());

    expect(stats.karma).toBe(0);
    expect(stats.events).toBe(0);
    expect(stats.hours).toBe(0);
  });
});

// ─── addSponsoredEvent Tests ──────────────────────────────────────────────────

describe('addSponsoredEvent', () => {
  it('adds sponsored event to partner', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      sponsoredEvents: [],
    });

    const event = await createKarmaEvent();

    await addSponsoredEvent(partner._id.toString(), event._id.toString());

    const updated = await CorporatePartner.findById(partner._id);
    expect(
      updated?.sponsoredEvents.some((e) => e.toString() === event._id.toString()),
    ).toBe(true);
  });

  it('validates partnerId format', async () => {
    const event = await createKarmaEvent();

    await expect(
      addSponsoredEvent('invalid-id', event._id.toString()),
    ).rejects.toThrow('Invalid partnerId');
  });

  it('validates eventId format', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(
      addSponsoredEvent(partner._id.toString(), 'invalid-id'),
    ).rejects.toThrow('Invalid eventId');
  });

  it('throws error for non-existent partner', async () => {
    const fakePartnerId = new mongoose.Types.ObjectId().toString();
    const event = await createKarmaEvent();

    await expect(
      addSponsoredEvent(fakePartnerId, event._id.toString()),
    ).rejects.toThrow('Corporate partner not found');
  });

  it('throws error for invalid eventId format', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });

    await expect(
      addSponsoredEvent(partner._id.toString(), 'invalid-id'),
    ).rejects.toThrow('Invalid eventId');
  });

  it('adds event without validating event existence (current implementation)', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
    });
    const fakeEventId = new mongoose.Types.ObjectId().toString();

    // Current implementation doesn't validate event existence
    await expect(
      addSponsoredEvent(partner._id.toString(), fakeEventId),
    ).resolves.not.toThrow();
  });

  it('is idempotent - adding same event twice does not duplicate', async () => {
    const partner = await createCorporatePartner({
      companyName: 'Test Corp',
      companySlug: 'test-corp',
      sponsoredEvents: [],
    });

    const event = await createKarmaEvent();

    await addSponsoredEvent(partner._id.toString(), event._id.toString());
    await addSponsoredEvent(partner._id.toString(), event._id.toString());

    const updated = await CorporatePartner.findById(partner._id);
    const count = updated?.sponsoredEvents.filter(
      (e) => e.toString() === event._id.toString(),
    ).length;

    expect(count).toBe(1);
  });
});
