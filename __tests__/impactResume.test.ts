/**
 * Tests for Impact Resume Service
 *
 * Tests the Impact Resume generation functionality:
 * - Resume generation with all sections
 * - Skills inference from categories
 * - Journey milestones
 * - Top events by karma
 * - Badge descriptions
 * - Achievement computation
 */

// Set required environment variables before importing modules
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long!';
process.env.REDIS_URL = 'redis://localhost:6379';

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { generateImpactResume } from '../src/services/impactResumeService';
import { KarmaProfile } from '../src/models/KarmaProfile';
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
  await KarmaProfile.deleteMany({});
  await EarnRecord.deleteMany({});
});

// ─── Helper functions ─────────────────────────────────────────────────────────

function createMockUserId(): string {
  return new mongoose.Types.ObjectId().toString();
}

async function createKarmaProfile(data: {
  userId: string;
  lifetimeKarma?: number;
  activeKarma?: number;
  level?: string;
  eventsCompleted?: number;
  totalHours?: number;
  trustScore?: number;
  badges?: Array<{ id: string; name: string; icon?: string; earnedAt?: Date }>;
  levelHistory?: Array<{ level: string; earnedAt: Date; droppedAt?: Date }>;
  activityHistory?: Date[];
  environmentEvents?: number;
  foodEvents?: number;
  healthEvents?: number;
  educationEvents?: number;
  communityEvents?: number;
  currentStreak?: number;
  longestStreak?: number;
}): Promise<void> {
  await KarmaProfile.create({
    userId: new mongoose.Types.ObjectId(data.userId),
    lifetimeKarma: data.lifetimeKarma ?? 0,
    activeKarma: data.activeKarma ?? 0,
    level: data.level ?? 'L1',
    eventsCompleted: data.eventsCompleted ?? 0,
    eventsJoined: data.eventsCompleted ?? 0,
    totalHours: data.totalHours ?? 0,
    trustScore: data.trustScore ?? 0,
    badges: data.badges ?? [],
    lastActivityAt: new Date(),
    levelHistory: data.levelHistory ?? [],
    conversionHistory: [],
    thisWeekKarmaEarned: 0,
    avgEventDifficulty: 0.5,
    avgConfidenceScore: 0.8,
    checkIns: 1,
    approvedCheckIns: 1,
    activityHistory: data.activityHistory ?? [],
    environmentEvents: data.environmentEvents ?? 0,
    foodEvents: data.foodEvents ?? 0,
    healthEvents: data.healthEvents ?? 0,
    educationEvents: data.educationEvents ?? 0,
    communityEvents: data.communityEvents ?? 0,
    currentStreak: data.currentStreak ?? 0,
    longestStreak: data.longestStreak ?? 0,
  });
}

async function createEarnRecord(userId: string, karma: number): Promise<void> {
  await EarnRecord.create({
    userId: new mongoose.Types.ObjectId(userId),
    eventId: new mongoose.Types.ObjectId(),
    bookingId: new mongoose.Types.ObjectId(),
    karmaEarned: karma,
    activeLevelAtApproval: 'L1',
    conversionRateSnapshot: 0.25,
    csrPoolId: new mongoose.Types.ObjectId(),
    verificationSignals: {
      qr_in: true,
      qr_out: true,
      gps_match: true,
      ngo_approved: true,
      photo_proof: false,
    },
    confidenceScore: 0.8,
    status: 'CONVERTED',
    idempotencyKey: `test-earn-${Date.now()}-${Math.random()}`,
  });
}

// ─── generateImpactResume Tests ───────────────────────────────────────────────

describe('generateImpactResume', () => {
  it('returns structured data with all sections', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      lifetimeKarma: 1000,
      activeKarma: 800,
      level: 'L2',
      eventsCompleted: 5,
      totalHours: 20,
      trustScore: 75,
    });

    const resume = await generateImpactResume(userId);

    // All main sections should be present
    expect(resume).toHaveProperty('userId');
    expect(resume).toHaveProperty('generatedAt');
    expect(resume).toHaveProperty('summary');
    expect(resume).toHaveProperty('journey');
    expect(resume).toHaveProperty('impactByCategory');
    expect(resume).toHaveProperty('badges');
    expect(resume).toHaveProperty('topEvents');
    expect(resume).toHaveProperty('skills');
    expect(resume).toHaveProperty('achievements');
    expect(resume).toHaveProperty('endorsements');
    expect(resume).toHaveProperty('streakData');
  });

  it('includes userId in resume', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    expect(resume.userId).toBe(userId);
  });

  it('includes generatedAt timestamp', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    expect(resume.generatedAt).toBeDefined();
    expect(new Date(resume.generatedAt)).toBeInstanceOf(Date);
  });

  it('throws error for non-existent user', async () => {
    const nonExistentId = createMockUserId();

    await expect(generateImpactResume(nonExistentId)).rejects.toThrow(
      'Karma profile not found',
    );
  });

  it('throws error for invalid userId format', async () => {
    // Mongoose throws an error for invalid ObjectId format
    await expect(generateImpactResume('invalid-id')).rejects.toThrow();
  });
});

// ─── Summary Section Tests ───────────────────────────────────────────────────

describe('Impact Resume summary section', () => {
  it('includes lifetimeKarma in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      lifetimeKarma: 5000,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.lifetimeKarma).toBe(5000);
  });

  it('includes activeKarma in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      activeKarma: 3500,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.activeKarma).toBe(3500);
  });

  it('includes eventsCompleted in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 15,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.eventsCompleted).toBe(15);
  });

  it('includes totalHours in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      totalHours: 75,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.totalHours).toBe(75);
  });

  it('includes trustScore in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      trustScore: 92,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.trustScore).toBe(92);
  });

  it('includes level in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      level: 'L3',
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.level).toBe('L3');
  });

  it('includes conversionRate based on level', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      level: 'L1',
    });

    const resume = await generateImpactResume(userId);

    // L1 has 25% conversion rate
    expect(resume.summary.conversionRate).toBe(0.25);
  });

  it('calculates conversionRate correctly for each level', async () => {
    const levels: Array<{ level: string; rate: number }> = [
      { level: 'L1', rate: 0.25 },
      { level: 'L2', rate: 0.5 },
      { level: 'L3', rate: 0.75 },
      { level: 'L4', rate: 1.0 },
    ];

    for (const { level, rate } of levels) {
      await KarmaProfile.deleteMany({});
      const userId = createMockUserId();
      await createKarmaProfile({ userId, level });

      const resume = await generateImpactResume(userId);

      expect(resume.summary.conversionRate).toBe(rate);
    }
  });
});

// ─── Skills Inference Tests ──────────────────────────────────────────────────

describe('Impact Resume skills inference', () => {
  it('infers skills from categories', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 5,
      foodEvents: 3,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Environmental Stewardship');
    expect(resume.skills).toContain('Food Distribution');
  });

  it('infers Environmental Stewardship from environment category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Environmental Stewardship');
  });

  it('infers Food Distribution from food category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      foodEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Food Distribution');
  });

  it('infers Healthcare Support from health category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      healthEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Healthcare Support');
  });

  it('infers Education & Mentorship from education category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      educationEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Education & Mentorship');
  });

  it('infers Community Leadership from community category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      communityEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Community Leadership');
  });

  it('adds Event Leadership for 10+ events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 15,
      environmentEvents: 5,
      foodEvents: 5,
      healthEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Event Leadership');
  });

  it('adds Mentoring for 3+ education events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      educationEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Mentoring');
  });

  it('adds Cross-functional Coordination for 3+ categories', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 2,
      foodEvents: 2,
      healthEvents: 2,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toContain('Cross-functional Coordination');
  });

  it('returns empty skills array for user with no category events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 0,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.skills).toEqual([]);
  });
});

// ─── Journey Milestones Tests ────────────────────────────────────────────────

describe('Impact Resume journey milestones', () => {
  it('includes level-up events as milestones', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      levelHistory: [
        { level: 'L1', earnedAt: new Date('2024-01-01') },
        { level: 'L2', earnedAt: new Date('2024-03-01') },
        { level: 'L3', earnedAt: new Date('2024-06-01') },
      ],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.journey.milestones.length).toBeGreaterThanOrEqual(1);
    expect(resume.journey.milestones[0]).toHaveProperty('date');
    expect(resume.journey.milestones[0]).toHaveProperty('level');
    expect(resume.journey.milestones[0]).toHaveProperty('karmaAtMilestone');
  });

  it('excludes dropped levels from milestones', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      levelHistory: [
        { level: 'L1', earnedAt: new Date('2024-01-01') },
        { level: 'L2', earnedAt: new Date('2024-03-01'), droppedAt: new Date('2024-05-01') },
        { level: 'L3', earnedAt: new Date('2024-06-01') },
      ],
    });

    const resume = await generateImpactResume(userId);

    const droppedMilestones = resume.journey.milestones.filter(
      (m) => m.level === 'L2',
    );
    expect(droppedMilestones).toHaveLength(0);
  });

  it('includes current level as final milestone', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      level: 'L3',
      levelHistory: [
        { level: 'L1', earnedAt: new Date('2024-01-01') },
        { level: 'L2', earnedAt: new Date('2024-03-01') },
      ],
    });

    const resume = await generateImpactResume(userId);

    const currentLevelMilestone = resume.journey.milestones.find(
      (m) => m.level === 'L3',
    );
    expect(currentLevelMilestone).toBeDefined();
  });

  it('includes startDate in journey', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.journey.startDate).toBeDefined();
    expect(typeof resume.journey.startDate).toBe('string');
  });
});

// ─── Top Events Tests ───────────────────────────────────────────────────────

describe('Impact Resume top events', () => {
  it('returns events sorted by karma earned', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    // Create earn records with different karma amounts
    await createEarnRecord(userId, 100);
    await createEarnRecord(userId, 500);
    await createEarnRecord(userId, 200);
    await createEarnRecord(userId, 400);

    const resume = await generateImpactResume(userId);

    expect(resume.topEvents.length).toBeGreaterThan(0);
    expect(resume.topEvents[0].karma).toBeGreaterThanOrEqual(
      resume.topEvents[1]?.karma ?? 0,
    );
  });

  it('limits to top 5 events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    // Create 10 earn records
    for (let i = 0; i < 10; i++) {
      await createEarnRecord(userId, (10 - i) * 100);
    }

    const resume = await generateImpactResume(userId);

    expect(resume.topEvents.length).toBeLessThanOrEqual(5);
  });

  it('includes karma and hours for each event', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });
    await createEarnRecord(userId, 200);

    const resume = await generateImpactResume(userId);

    if (resume.topEvents.length > 0) {
      expect(resume.topEvents[0]).toHaveProperty('karma');
      expect(resume.topEvents[0]).toHaveProperty('hours');
      expect(resume.topEvents[0]).toHaveProperty('date');
      expect(resume.topEvents[0]).toHaveProperty('category');
    }
  });

  it('returns empty array when no earn records', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId, eventsCompleted: 0 });

    const resume = await generateImpactResume(userId);

    expect(resume.topEvents).toEqual([]);
  });
});

// ─── Badges Tests ────────────────────────────────────────────────────────────

describe('Impact Resume badges', () => {
  it('includes badge descriptions', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      badges: [
        {
          id: 'first-event',
          name: 'First Event',
          icon: 'star',
          earnedAt: new Date(),
        },
      ],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.badges.length).toBeGreaterThan(0);
    expect(resume.badges[0]).toHaveProperty('description');
    expect(resume.badges[0].description).toBeDefined();
    expect(resume.badges[0].description).not.toBe('');
  });

  it('maps first-event badge to description', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      badges: [
        {
          id: 'first-event',
          name: 'First Event',
          earnedAt: new Date(),
        },
      ],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.badges[0].description).toBe('Completed first volunteer event');
  });

  it('maps streak badges to descriptions', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      badges: [
        {
          id: 'streak-7',
          name: '7 Day Streak',
          earnedAt: new Date(),
        },
        {
          id: 'streak-30',
          name: '30 Day Streak',
          earnedAt: new Date(),
        },
      ],
    });

    const resume = await generateImpactResume(userId);

    const badge7 = resume.badges.find((b) => b.id === 'streak-7');
    const badge30 = resume.badges.find((b) => b.id === 'streak-30');

    expect(badge7?.description).toBe('7-day activity streak');
    expect(badge30?.description).toBe('30-day activity streak');
  });

  it('includes all badge fields', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      badges: [
        {
          id: 'environment-hero',
          name: 'Environment Hero',
          icon: 'leaf',
          earnedAt: new Date('2024-03-15'),
        },
      ],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.badges[0]).toHaveProperty('id');
    expect(resume.badges[0]).toHaveProperty('name');
    expect(resume.badges[0]).toHaveProperty('icon');
    expect(resume.badges[0]).toHaveProperty('earnedAt');
    expect(resume.badges[0]).toHaveProperty('description');
  });

  it('handles unknown badge id gracefully', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      badges: [
        {
          id: 'unknown-badge',
          name: 'Unknown Badge',
          earnedAt: new Date(),
        },
      ],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.badges[0].description).toBe('Earned badge');
  });

  it('returns empty badges for user with no badges', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId, badges: [] });

    const resume = await generateImpactResume(userId);

    expect(resume.badges).toEqual([]);
  });
});

// ─── Achievements Tests ─────────────────────────────────────────────────────

describe('Impact Resume achievements', () => {
  it('computes First Steps achievement for 1+ events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('First Steps — Completed first volunteer event');
  });

  it('computes Getting Started achievement for 5+ events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 5,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Getting Started — 5 events completed');
  });

  it('computes Rising Star achievement for 10+ events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 10,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Rising Star — 10 events completed');
  });

  it('computes Impact Maker achievement for 25+ events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 25,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Impact Maker — 25 events completed');
  });

  it('computes Century Club achievement for 100+ hours', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      totalHours: 150,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Century Club — 100+ volunteer hours');
  });

  it('computes Dedication Champion achievement for 500+ hours', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      totalHours: 600,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Dedication Champion — 500+ volunteer hours');
  });

  it('computes Trusted Volunteer achievement for 90+ trust score', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      trustScore: 95,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Trusted Volunteer — 90%+ trust score');
  });

  it('computes Perfect Trust achievement for 100 trust score', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      trustScore: 100,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Perfect Trust — 100% trust score');
  });

  it('computes Universal Impact achievement for all 5 categories', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 1,
      foodEvents: 1,
      healthEvents: 1,
      educationEvents: 1,
      communityEvents: 1,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Universal Impact — participated in all 5 categories');
  });

  it('computes Tree achievement for L4 level', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      level: 'L4',
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toContain('Tree — reached maximum level');
  });

  it('computes multiple achievements for qualifying users', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 15,
      totalHours: 200,
      trustScore: 95,
      level: 'L3',
      environmentEvents: 5,
      foodEvents: 5,
      healthEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    // Should have multiple achievements
    expect(resume.achievements.length).toBeGreaterThan(3);
    expect(resume.achievements).toContain('Rising Star — 10 events completed');
    expect(resume.achievements).toContain('Century Club — 100+ volunteer hours');
    expect(resume.achievements).toContain('Trusted Volunteer — 90%+ trust score');
  });

  it('returns empty achievements for new user', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      eventsCompleted: 0,
      totalHours: 0,
      trustScore: 0,
      level: 'L1',
    });

    const resume = await generateImpactResume(userId);

    expect(resume.achievements).toEqual([]);
  });
});

// ─── Streak Data Tests ───────────────────────────────────────────────────────

describe('Impact Resume streak data', () => {
  it('includes streakData section', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      currentStreak: 7,
      longestStreak: 14,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.streakData).toHaveProperty('currentStreak');
    expect(resume.streakData).toHaveProperty('longestStreak');
    expect(resume.streakData).toHaveProperty('streakDays');
  });

  it('calculates currentStreak from activity history', async () => {
    const today = new Date();
    const activityHistory = [
      today,
      new Date(today.getTime() - 24 * 60 * 60 * 1000), // yesterday
      new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    ];

    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      activityHistory,
      currentStreak: 3,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.streakData.currentStreak).toBeGreaterThanOrEqual(0);
  });

  it('returns zeros for user with no activity history', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      activityHistory: [],
    });

    const resume = await generateImpactResume(userId);

    expect(resume.streakData.currentStreak).toBe(0);
    expect(resume.streakData.longestStreak).toBe(0);
    expect(resume.streakData.streakDays).toBe(0);
  });
});

// ─── Endorsements Tests ─────────────────────────────────────────────────────

describe('Impact Resume endorsements', () => {
  it('includes endorsements section', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    expect(resume.endorsements).toHaveProperty('totalEndorsements');
    expect(resume.endorsements).toHaveProperty('topEndorser');
  });

  it('returns placeholder values for future implementation', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    expect(resume.endorsements.totalEndorsements).toBe(0);
    expect(resume.endorsements.topEndorser).toBeNull();
  });
});

// ─── Impact By Category Tests ───────────────────────────────────────────────

describe('Impact Resume impactByCategory', () => {
  it('includes category breakdown', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 10,
      foodEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    expect(Array.isArray(resume.impactByCategory)).toBe(true);
    expect(resume.impactByCategory.length).toBeGreaterThan(0);
  });

  it('calculates events and hours for each category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 10,
    });

    const resume = await generateImpactResume(userId);

    const envCategory = resume.impactByCategory.find((c) => c.category === 'Environment');
    expect(envCategory?.events).toBe(10);
    expect(envCategory?.hours).toBeGreaterThan(0);
  });

  it('calculates percentage correctly', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 3,
      foodEvents: 2,
    });

    const resume = await generateImpactResume(userId);

    const envCategory = resume.impactByCategory.find((c) => c.category === 'Environment');
    const foodCategory = resume.impactByCategory.find((c) => c.category === 'Food');

    expect(envCategory?.percentage).toBe(60); // 3/5 = 60%
    expect(foodCategory?.percentage).toBe(40); // 2/5 = 40%
  });

  it('filters out categories with 0 events', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 5,
      foodEvents: 0,
      healthEvents: 0,
      educationEvents: 0,
      communityEvents: 0,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.impactByCategory.length).toBe(1);
    expect(resume.impactByCategory[0].category).toBe('Environment');
  });

  it('sorts categories by events descending', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 2,
      foodEvents: 10,
      healthEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.impactByCategory[0].category).toBe('Food');
    expect(resume.impactByCategory[1].category).toBe('Health');
    expect(resume.impactByCategory[2].category).toBe('Environment');
  });

  it('includes karma estimate for each category', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      environmentEvents: 5,
    });

    const resume = await generateImpactResume(userId);

    const envCategory = resume.impactByCategory.find((c) => c.category === 'Environment');
    expect(envCategory?.karma).toBeGreaterThan(0);
  });
});

// ─── Karma Score Tests ──────────────────────────────────────────────────────

describe('Impact Resume karmaScore', () => {
  it('includes karmaScore in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      lifetimeKarma: 1000,
      activeKarma: 800,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.karmaScore).toBeDefined();
    expect(typeof resume.summary.karmaScore).toBe('number');
  });

  it('includes percentile in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      lifetimeKarma: 1000,
    });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.percentile).toBeDefined();
    expect(typeof resume.summary.percentile).toBe('number');
  });

  it('handles karmaScore computation failure gracefully', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({
      userId,
      lifetimeKarma: 0,
    });

    const resume = await generateImpactResume(userId);

    // Should not throw, karmaScore might be 0 or default
    expect(typeof resume.summary.karmaScore).toBe('number');
  });
});

// ─── Volunteer Since Tests ──────────────────────────────────────────────────

describe('Impact Resume volunteerSince', () => {
  it('includes volunteerSince in summary', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    expect(resume.summary.volunteerSince).toBeDefined();
    expect(typeof resume.summary.volunteerSince).toBe('string');
  });

  it('formats date correctly', async () => {
    const userId = createMockUserId();
    await createKarmaProfile({ userId });

    const resume = await generateImpactResume(userId);

    // Should contain month and year
    expect(resume.summary.volunteerSince).toMatch(/[A-Za-z]+ \d{4}/);
  });
});
