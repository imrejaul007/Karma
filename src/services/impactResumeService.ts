// @ts-nocheck
// @ts-ignore
/**
 * Impact Resume Service — generates a structured Impact Resume JSON document.
 *
 * This extends reportService.ts by adding:
 * - Skills inference based on category participation
 * - Journey milestones (level-ups)
 * - Top events by karma earned
 * - Endorsement data (future-ready)
 * - Streak data
 * - Achievement tracking
 *
 * The structured JSON is used for:
 * - LinkedIn sharing
 * - College applications
 * - CSR reporting
 * - Job resumes
 */
import mongoose from 'mongoose';
import { KarmaProfile, EarnRecord } from '../models/index.js';
import { computeKarmaScore, getBandMetadata } from '../engines/karmaScoreEngine.js';
import { getConversionRate } from '../engines/karmaEngine.js';
import { startOfDayIST } from '../utils/istTime.js';
import { logger } from '../config/logger.js';
import type { KarmaLevel as Level } from '../shared-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImpactResumeMilestone {
  date: string;
  level: string;
  karmaAtMilestone: number;
  event: string | null;
}

export interface ImpactResumeCategory {
  category: string;
  events: number;
  hours: number;
  karma: number;
  percentage: number;
}

export interface ImpactResumeBadge {
  id: string;
  name: string;
  icon: string;
  earnedAt: string;
  description: string;
}

export interface ImpactResumeEvent {
  name: string;
  date: string;
  karma: number;
  hours: number;
  category: string;
}

export interface ImpactResumeEndorsements {
  totalEndorsements: number;
  topEndorser: string | null;
}

export interface ImpactResumeStreakData {
  currentStreak: number;
  longestStreak: number;
  streakDays: number;
}

export interface ImpactResume {
  userId: string;
  generatedAt: string;
  summary: {
    volunteerSince: string;
    lifetimeKarma: number;
    activeKarma: number;
    eventsCompleted: number;
    totalHours: number;
    trustScore: number;
    karmaScore: number;
    percentile: number;
    level: string;
    conversionRate: number;
  };
  journey: {
    startDate: string;
    milestones: ImpactResumeMilestone[];
  };
  impactByCategory: ImpactResumeCategory[];
  badges: ImpactResumeBadge[];
  topEvents: ImpactResumeEvent[];
  skills: string[];
  achievements: string[];
  endorsements: ImpactResumeEndorsements;
  streakData: ImpactResumeStreakData;
}

// ---------------------------------------------------------------------------
// Skills Inference Engine
// ---------------------------------------------------------------------------

const CATEGORY_SKILL_MAP: Record<string, string> = {
  environment: 'Environmental Stewardship',
  food: 'Food Distribution',
  health: 'Healthcare Support',
  education: 'Education & Mentorship',
  community: 'Community Leadership',
};

const DIFFICULTY_SKILL_MAP: Record<string, string> = {
  hard: 'Crisis Response',
  medium: 'Project Coordination',
  easy: 'Volunteer Support',
};

const ACHIEVEMENT_THRESHOLDS = {
  FIRST_EVENT: { events: 1, label: 'First Steps — Completed first volunteer event' },
  FIVE_EVENTS: { events: 5, label: 'Getting Started — 5 events completed' },
  TEN_EVENTS: { events: 10, label: 'Rising Star — 10 events completed' },
  TWENTY_FIVE_EVENTS: { events: 25, label: 'Impact Maker — 25 events completed' },
  HUNDRED_HOURS: { hours: 100, label: 'Century Club — 100+ volunteer hours' },
  FIVE_HUNDRED_HOURS: { hours: 500, label: 'Dedication Champion — 500+ volunteer hours' },
  TRUST_SCORE_90: { trust: 90, label: 'Trusted Volunteer — 90%+ trust score' },
  TRUST_SCORE_100: { trust: 100, label: 'Perfect Trust — 100% trust score' },
  ALL_CATEGORIES: { categories: 5, label: 'Universal Impact — participated in all 5 categories' },
  LEVEL_4: { level: 'L4', label: 'Tree — reached maximum level' },
  STREAK_30: { streak: 30, label: 'Committed — 30-day activity streak' },
  STREAK_100: { streak: 100, label: 'Unstoppable — 100-day activity streak' },
};

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function inferSkills(categoryBreakdown: ImpactResumeCategory[]): string[] {
  const skills: Set<string> = new Set();

  for (const cat of categoryBreakdown) {
    if (cat.events >= 1) {
      const skill = CATEGORY_SKILL_MAP[cat.category.toLowerCase()];
      if (skill) skills.add(skill);
    }
  }

  // Add leadership if user has many events
  const totalEvents = categoryBreakdown.reduce((sum, c) => sum + c.events, 0);
  if (totalEvents >= 10) skills.add('Event Leadership');

  // Add mentoring if in education
  const educationCat = categoryBreakdown.find(
    (c) => c.category.toLowerCase() === 'education',
  );
  if (educationCat && educationCat.events >= 3) skills.add('Mentoring');

  // Add coordination if in multiple categories
  if (categoryBreakdown.length >= 3) skills.add('Cross-functional Coordination');

  return Array.from(skills);
}

function computeAchievements(
  profile: Record<string, unknown>,
  streakData: ImpactResumeStreakData,
  categoryCount: number,
): string[] {
  const achievements: string[] = [];
  const events = (profile.eventsCompleted as number) ?? 0;
  const hours = (profile.totalHours as number) ?? 0;
  const trust = (profile.trustScore as number) ?? 0;
  const level = (profile.level as string) ?? 'L1';

  if (events >= ACHIEVEMENT_THRESHOLDS.FIRST_EVENT.events) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.FIRST_EVENT.label);
  }
  if (events >= ACHIEVEMENT_THRESHOLDS.FIVE_EVENTS.events) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.FIVE_EVENTS.label);
  }
  if (events >= ACHIEVEMENT_THRESHOLDS.TEN_EVENTS.events) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.TEN_EVENTS.label);
  }
  if (events >= ACHIEVEMENT_THRESHOLDS.TWENTY_FIVE_EVENTS.events) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.TWENTY_FIVE_EVENTS.label);
  }
  if (hours >= ACHIEVEMENT_THRESHOLDS.HUNDRED_HOURS.hours) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.HUNDRED_HOURS.label);
  }
  if (hours >= ACHIEVEMENT_THRESHOLDS.FIVE_HUNDRED_HOURS.hours) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.FIVE_HUNDRED_HOURS.label);
  }
  if (trust >= ACHIEVEMENT_THRESHOLDS.TRUST_SCORE_90.trust) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.TRUST_SCORE_90.label);
  }
  if (trust >= ACHIEVEMENT_THRESHOLDS.TRUST_SCORE_100.trust) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.TRUST_SCORE_100.label);
  }
  if (categoryCount >= ACHIEVEMENT_THRESHOLDS.ALL_CATEGORIES.categories) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.ALL_CATEGORIES.label);
  }
  if (level === ACHIEVEMENT_THRESHOLDS.LEVEL_4.level) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.LEVEL_4.label);
  }
  if (streakData.currentStreak >= ACHIEVEMENT_THRESHOLDS.STREAK_30.streak) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.STREAK_30.label);
  }
  if (streakData.currentStreak >= ACHIEVEMENT_THRESHOLDS.STREAK_100.streak) {
    achievements.push(ACHIEVEMENT_THRESHOLDS.STREAK_100.label);
  }

  return achievements;
}

function calculateStreakData(activityHistory: Date[]): ImpactResumeStreakData {
  if (!activityHistory || activityHistory.length === 0) {
    return { currentStreak: 0, longestStreak: 0, streakDays: 0 };
  }

  // Sort activity dates (most recent first)
  const sortedDates = activityHistory
    .map((d) => startOfDayIST(new Date(d)).getTime())
    .sort((a, b) => b - a);

  const uniqueDates = [...new Set(sortedDates)];
  const today = startOfDayIST().getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  let currentStreak = 0;
  let longestStreak = 0;
  let streakDays = 0;

  // Calculate current streak (must include today or yesterday)
  const mostRecentDate = uniqueDates[0] as number;
  const daysSinceLastActivity = Math.floor((today - mostRecentDate) / oneDayMs);

  if (daysSinceLastActivity <= 1) {
    // Active today or yesterday
    for (let i = 0; i < uniqueDates.length; i++) {
      const expectedDate = mostRecentDate - i * oneDayMs;
      if (uniqueDates[i] === expectedDate) {
        currentStreak++;
        streakDays++;
      } else {
        break;
      }
    }
  }

  // Calculate longest streak
  let tempStreak = 1;
  for (let i = 1; i < uniqueDates.length; i++) {
    const diff = ((uniqueDates[i - 1] as number) - (uniqueDates[i] as number)) / oneDayMs;
    if (diff === 1) {
      tempStreak++;
      longestStreak = Math.max(longestStreak, tempStreak);
    } else {
      tempStreak = 1;
    }
  }
  longestStreak = Math.max(longestStreak, currentStreak, tempStreak);

  return { currentStreak, longestStreak, streakDays };
}

// ---------------------------------------------------------------------------
// Main Service Function
// ---------------------------------------------------------------------------

/**
 * Generates a comprehensive Impact Resume for a user.
 * Reuses gatherReportData() patterns from reportService.ts and extends
 * with skills inference, journey milestones, and achievement tracking.
 */
export async function generateImpactResume(userId: string): Promise<ImpactResume> {
  const profile = await KarmaProfile.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();

  if (!profile) {
    throw new Error('Karma profile not found');
  }

  const profileData = profile as Record<string, unknown>;

  // KarmaScore computation
  let karmaScore = 0;
  let scoreBand = 'starter';
  let percentile = 0;
  try {
    const scoreResult = await computeKarmaScore(userId, true);
    if (scoreResult) {
      karmaScore = scoreResult.total;
      scoreBand = scoreResult.band;
      percentile = scoreResult.percentile ?? 0;
    }
  } catch {
    // Non-fatal — score may not exist yet
  }

  // Category breakdown
  const categoryKeys = [
    { key: 'environmentEvents', label: 'environment' },
    { key: 'foodEvents', label: 'food' },
    { key: 'healthEvents', label: 'health' },
    { key: 'educationEvents', label: 'education' },
    { key: 'communityEvents', label: 'community' },
  ];

  const totalCategoryEvents = categoryKeys.reduce((sum, c) => {
    return sum + ((profileData[c.key] as number) ?? 0);
  }, 0);

  const impactByCategory: ImpactResumeCategory[] = categoryKeys
    .map((c) => ({
      category: c.label.charAt(0).toUpperCase() + c.label.slice(1),
      events: (profileData[c.key] as number) ?? 0,
      hours: Math.round(((profileData[c.key] as number) ?? 0) * 2.5), // Estimate ~2.5 hrs/event
      karma: ((profileData[c.key] as number) ?? 0) * 50, // Estimate ~50 karma/event
      percentage: 0,
    }))
    .filter((c) => c.events > 0)
    .map((c) => ({
      ...c,
      percentage:
        totalCategoryEvents > 0
          ? Math.round((c.events / totalCategoryEvents) * 100)
          : 0,
    }))
    .sort((a, b) => b.events - a.events);

  // Top events by karma earned (from EarnRecord)
  interface EarnRecordDoc {
    eventName?: string;
    karmaEarned: number;
    createdAt: Date;
    status: string;
  }

  const topRecords = await EarnRecord.find({
    userId: userId as unknown as mongoose.Types.ObjectId,
    status: 'CONVERTED',
  })
    .sort({ karmaEarned: -1 })
    .limit(5)
    .lean() as unknown as EarnRecordDoc[];

  const topEvents: ImpactResumeEvent[] = topRecords.map((r) => ({
    name: r.eventName ?? 'Impact Event',
    date: formatDate(r.createdAt),
    karma: r.karmaEarned,
    hours: Math.round(r.karmaEarned / 20), // Estimate ~20 karma/hour
    category: 'Impact',
  }));

  // Journey milestones from level history
  const levelHistory = (profileData.levelHistory as Array<{
    level: string;
    earnedAt: Date | string;
    droppedAt?: Date | string;
  }> | undefined) ?? [];

  const milestones: ImpactResumeMilestone[] = levelHistory
    .filter((entry) => !entry.droppedAt) // Only include active level-ups
    .map((entry) => ({
      date: formatDate(entry.earnedAt),
      level: entry.level,
      karmaAtMilestone: (profileData.activeKarma as number) ?? 0, // Simplified; actual karma at milestone would need historical tracking
      event: null,
    }));

  // Add current level as final milestone if not already there
  const currentLevel = (profileData.level as string) ?? 'L1';
  const hasCurrentLevel = milestones.some((m) => m.level === currentLevel);
  if (!hasCurrentLevel) {
    milestones.push({
      date: formatDate(profileData.updatedAt as Date | string ?? new Date()),
      level: currentLevel,
      karmaAtMilestone: (profileData.activeKarma as number) ?? 0,
      event: null,
    });
  }

  // Badges with descriptions
  const badgeDescriptions: Record<string, string> = {
    'first-event': 'Completed first volunteer event',
    'streak-7': '7-day activity streak',
    'streak-30': '30-day activity streak',
    'environment-hero': 'Contributed to environmental causes',
    'food-champion': 'Helped fight food insecurity',
    'health-ally': 'Supported health initiatives',
    'education-mentor': 'Mentored students',
    'community-pillar': 'Strengthened community bonds',
    'top-performer': 'Ranked in top 10% this month',
    'verified-volunteer': '100% verified activity',
  };

  const badges: ImpactResumeBadge[] = ((profileData.badges as Array<{
    id?: string;
    name?: string;
    icon?: string;
    earnedAt?: Date | string;
  }>) ?? []).map((b) => ({
    id: b.id ?? '',
    name: b.name ?? '',
    icon: b.icon ?? '',
    earnedAt: b.earnedAt ? formatDate(b.earnedAt) : '',
    description: badgeDescriptions[b.id ?? ''] ?? 'Earned badge',
  }));

  // Skills inference
  const skills = inferSkills(impactByCategory);

  // Streak data
  const activityHistory = (profileData.activityHistory as Date[] | undefined) ?? [];
  const streakData = calculateStreakData(activityHistory);

  // Achievements
  const achievements = computeAchievements(
    profileData,
    streakData,
    impactByCategory.length,
  );

  // Endorsements (future-ready placeholder)
  const endorsements: ImpactResumeEndorsements = {
    totalEndorsements: 0,
    topEndorser: null,
  };

  // Build summary
  const level: Level = (profileData.level as Level) ?? 'L1';
  const conversionRate = getConversionRate(level);

  return {
    userId,
    generatedAt: new Date().toISOString(),
    summary: {
      volunteerSince: profileData.createdAt
        ? new Date(profileData.createdAt as Date).toLocaleDateString('en-IN', {
            month: 'long',
            year: 'numeric',
          })
        : 'Recently',
      lifetimeKarma: (profileData.lifetimeKarma as number) ?? 0,
      activeKarma: (profileData.activeKarma as number) ?? 0,
      eventsCompleted: (profileData.eventsCompleted as number) ?? 0,
      totalHours: (profileData.totalHours as number) ?? 0,
      trustScore: Math.round((profileData.trustScore as number) ?? 0),
      karmaScore,
      percentile,
      level: currentLevel,
      conversionRate,
    },
    journey: {
      startDate: profileData.createdAt
        ? formatDate(profileData.createdAt as Date)
        : formatDate(new Date()),
      milestones,
    },
    impactByCategory,
    badges,
    topEvents,
    skills,
    achievements,
    endorsements,
    streakData,
  };
}
