// @ts-ignore
/**
 * KarmaScore Engine — Phase 3: Karma by ReZ
 *
 * Computes the 300-900 KarmaScore using 5 components:
 *   Base(300) + Impact(0-250) + RelativeRank(0-180) + Trust(0-100) + Momentum(0-70)
 *
 * Design principles:
 * - Impact/Trust/Momentum update per event (fast path, no Redis sort needed)
 * - RelativeRank is computed nightly in scoreRankWorker (batch, O(n log n))
 * - Raw score is stored; display score has ±5pt/day stability buffer
 * - 900 is mythology — normal max 890 (99.99th percentile required)
 */
import { KarmaProfile } from '../models/KarmaProfile.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { startOfDayIST } from '../utils/istTime.js';
import type { KarmaProfileDocument } from '../models/KarmaProfile.js';

// ─── Component limits ───────────────────────────────────────────────────────────
const BASE_SCORE = 300;
const MAX_IMPACT = 250;
const MAX_RANK = 180;
const MAX_TRUST = 100;
const MAX_MOMENTUM = 70;
const MYTHICAL_MAX = 900;
const NORMAL_MAX = 890;
const PERCENTILE_MYTHICAL_THRESHOLD = 99.99;

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface KarmaScoreComponents {
  base: number;
  impact: number;
  relativeRank: number;
  trust: number;
  momentum: number;
}

export interface KarmaScoreResult {
  total: number;
  display: number;
  components: KarmaScoreComponents;
  band: KarmaScoreBand;
  percentile: number;
  trustGrade: TrustGrade;
  momentumLabel: MomentumLabel;
}

export type KarmaScoreBand =
  | 'starter'    // 300-349
  | 'active'     // 350-449
  | 'performer'  // 450-599
  | 'leader'     // 600-749
  | 'elite'      // 750-819
  | 'pinnacle';  // 820-900

export type TrustGrade = 'D' | 'C' | 'B' | 'A' | 'S';
export type MomentumLabel = 'cold' | 'slow' | 'steady' | 'hot' | 'blazing';

// ─── Band definitions ───────────────────────────────────────────────────────────

export function getKarmaScoreBand(score: number): KarmaScoreBand {
  if (score >= 820) return 'pinnacle';
  if (score >= 750) return 'elite';
  if (score >= 600) return 'leader';
  if (score >= 450) return 'performer';
  if (score >= 350) return 'active';
  return 'starter';
}

export function getTrustGrade(trust: number): TrustGrade {
  if (trust >= 90) return 'S';
  if (trust >= 75) return 'A';
  if (trust >= 55) return 'B';
  if (trust >= 35) return 'C';
  return 'D';
}

export function getMomentumLabel(momentum: number): MomentumLabel {
  if (momentum >= 60) return 'blazing';
  if (momentum >= 45) return 'hot';
  if (momentum >= 25) return 'steady';
  if (momentum >= 10) return 'slow';
  return 'cold';
}

// ─── Component calculations ────────────────────────────────────────────────────

/**
 * Impact Score (0-250): based on lifetime karma earned.
 * Calibrated so 500 karma ≈ 50pts, 2000 ≈ 150pts, 5000 ≈ 220pts, 15000 ≈ 250pts.
 * Uses logarithmic scaling with a multiplier to reach max at ~15000 karma.
 */
export function calculateImpactScore(lifetimeKarma: number): number {
  if (lifetimeKarma <= 0) return 0;
  const score = Math.round(MAX_IMPACT * (Math.log(1 + lifetimeKarma / 100) / Math.log(151)));
  return Math.min(MAX_IMPACT, Math.max(0, score));
}

/**
 * Relative Rank Score (0-180): percentile-based from Redis ZSET.
 * Computed nightly by scoreRankWorker.  Reads from Redis cache.
 * Maps percentile to rank score:
 *   p99.99+  → 180 (pinnacle)
 *   p99+      → 170
 *   p95+      → 140
 *   p80+      → 110
 *   p50+      → 70
 *   p25+      → 30
 *   <25%      → 0
 */
export function calculateRelativeRankScore(percentile: number): number {
  if (percentile >= 99.99) return 180;
  if (percentile >= 99) return 170;
  if (percentile >= 95) return 140;
  if (percentile >= 80) return 110;
  if (percentile >= 50) return 70;
  if (percentile >= 25) return 30;
  return 0;
}

/**
 * Trust Score (0-100): derived from profile trust metrics.
 * Components:
 *   - avgConfidenceScore (0-1) → 40pts max
 *   - check-in rate (approvedCheckIns/checkIns) → 30pts max
 *   - recent activity (days since last decay) → 30pts max
 */
export function calculateTrustScore(profile: KarmaProfileDocument): number {
  const confWeight = 40;
  const rateWeight = 30;
  const recencyWeight = 30;

  const confScore = Math.round((profile.avgConfidenceScore ?? 0) * confWeight);
  const checkInRate = profile.checkIns > 0
    ? profile.approvedCheckIns / profile.checkIns
    : 0;
  const rateScore = Math.round(checkInRate * rateWeight);

  // Recency: 30pts if active in last 7 days, scales down to 0 at 60+ days
  const lastActivity = profile.lastActivityAt
    ? (Date.now() - new Date(profile.lastActivityAt).getTime()) / 86400000
    : 999;
  const recencyScore = Math.max(0, Math.round(((60 - Math.min(60, lastActivity)) / 60) * recencyWeight));

  return Math.min(MAX_TRUST, confScore + rateScore + recencyScore);
}

/**
 * Momentum Score (0-70): rate of karma earning in last 30 days.
 * Compares this month vs last month to detect trending.
 *   0 karma this week → 0-10 (cold/slow)
 *   trending up vs last month → up to 70 (blazing)
 *   stable → 25-35 (steady)
 *   declining → 10-20 (slow)
 */
export async function calculateMomentumScore(userId: string, profile: KarmaProfileDocument): Promise<number> {
  const now = new Date();
  const thisWeekStart = new Date(now);
  thisWeekStart.setDate(now.getDate() - now.getDay());
  const mondayIST = startOfDayIST(thisWeekStart);
  const mondayStart = new Date(mondayIST.getTime());
  const lastWeekStart = new Date(mondayIST.getTime() - 7 * 86400000);

  // Get weekly karma from activity history
  const activity30d = (profile.activityHistory ?? []).filter(d => {
    const date = new Date(d);
    return date >= new Date(now.getTime() - 30 * 86400000);
  });

  // Count activities in current week vs last week as proxy
  const thisWeekCount = activity30d.filter(d => new Date(d) >= mondayStart).length;
  const lastWeekCount = activity30d.filter(d => {
    const date = new Date(d);
    return date >= lastWeekStart && date < mondayStart;
  }).length;

  // Base score from this week's activity
  let base = 0;
  if (thisWeekCount >= 5) base = 35;
  else if (thisWeekCount >= 3) base = 25;
  else if (thisWeekCount >= 1) base = 15;
  else if (profile.lastActivityAt && (Date.now() - new Date(profile.lastActivityAt).getTime()) < 7 * 86400000) base = 5;

  // Trend modifier
  let trend = 0;
  if (lastWeekCount > 0) {
    const ratio = thisWeekCount / lastWeekCount;
    if (ratio >= 2) trend = 20;
    else if (ratio >= 1.5) trend = 12;
    else if (ratio >= 1.0) trend = 5;
    else if (ratio >= 0.5) trend = -5;
    else trend = -10;
  } else if (thisWeekCount > 0) {
    trend = 10; // new activity momentum
  }

  return Math.min(MAX_MOMENTUM, Math.max(0, base + trend));
}

// ─── Main computation ──────────────────────────────────────────────────────────

/**
 * Compute raw KarmaScore for a user.
 * Called: (a) after every karma event (fast path, rank from Redis), (b) nightly batch.
 *
 * @param userId       MongoDB user _id
 * @param useCachedRank  If false, recomputes rank from DB (nightly worker). If true, reads Redis cache.
 */
export async function computeKarmaScore(
  userId: string,
  useCachedRank = true,
): Promise<KarmaScoreResult | null> {
  try {
    const profile = await KarmaProfile.findOne({ userId }).lean() as KarmaProfileDocument | null;
    if (!profile) return null;

    const impact = calculateImpactScore(profile.lifetimeKarma ?? 0);
    const trust = calculateTrustScore(profile);

    let percentile = 0;
    let relativeRank = 0;

    if (useCachedRank) {
      // Fast path: read from Redis ZSET
      const rank = await redis.zrevrank(`karma:rankings:activeKarma`, userId);
      const total = await redis.zcard(`karma:rankings:activeKarma`);
      if (rank !== null && total > 0) {
        percentile = ((total - rank - 1) / total) * 100;
        relativeRank = calculateRelativeRankScore(percentile);
      }
    } else {
      // Batch path: percentile already computed and stored in Redis by scoreRankWorker
      const cachedPercentile = await redis.get(`karma:score:percentile:${userId}`);
      if (cachedPercentile !== null) {
        percentile = parseFloat(cachedPercentile);
        relativeRank = calculateRelativeRankScore(percentile);
      }
    }

    const momentum = await calculateMomentumScore(userId, profile);

    const components: KarmaScoreComponents = {
      base: BASE_SCORE,
      impact,
      relativeRank,
      trust,
      momentum,
    };

    let raw = BASE_SCORE + impact + relativeRank + trust + momentum;

    // 900 mythology: only if percentile >= 99.99 AND raw >= 890
    if (raw >= NORMAL_MAX && percentile >= PERCENTILE_MYTHICAL_THRESHOLD) {
      raw = MYTHICAL_MAX;
    } else {
      raw = Math.min(NORMAL_MAX, raw);
    }

    const band = getKarmaScoreBand(raw);
    const trustGrade = getTrustGrade(trust);
    const momentumLabel = getMomentumLabel(momentum);

    // Store raw score in Redis (used by stability buffer)
    await redis.set(`karma:score:raw:${userId}`, raw.toString(), 'EX', 86400);

    return {
      total: raw,
      display: raw, // will be adjusted by stability buffer on read
      components,
      band,
      percentile: Math.round(percentile * 100) / 100,
      trustGrade,
      momentumLabel,
    };
  } catch (err) {
    logger.error('[KarmaScoreEngine] computeKarmaScore error', { userId, error: err });
    return null;
  }
}

/**
 * Get percentile for a user from Redis cache.
 */
export async function getUserPercentile(userId: string): Promise<number> {
  const cached = await redis.get(`karma:score:percentile:${userId}`);
  return cached !== null ? parseFloat(cached) : 0;
}

/**
 * Get band metadata for display.
 */
export function getBandMetadata(band: KarmaScoreBand): {
  label: string;
  color: string;
  bgColor: string;
  minScore: number;
  maxScore: number;
  perks: string[];
} {
  const bands: Record<KarmaScoreBand, ReturnType<typeof getBandMetadata>> = {
    starter: {
      label: 'Starter',
      color: '#9CA3AF',
      bgColor: '#F3F4F6',
      minScore: 300,
      maxScore: 349,
      perks: ['Basic event access', '25% coin conversion'],
    },
    active: {
      label: 'Active',
      color: '#10B981',
      bgColor: '#D1FAE5',
      minScore: 350,
      maxScore: 449,
      perks: ['Standard event access', '40% coin conversion'],
    },
    performer: {
      label: 'Performer',
      color: '#3B82F6',
      bgColor: '#DBEAFE',
      minScore: 450,
      maxScore: 599,
      perks: ['Premium events', '60% coin conversion', 'Early bird access'],
    },
    leader: {
      label: 'Leader',
      color: '#8B5CF6',
      bgColor: '#EDE9FE',
      minScore: 600,
      maxScore: 749,
      perks: ['VIP events', '75% coin conversion', 'Dedicated support', 'Leaderboard badge'],
    },
    elite: {
      label: 'Elite',
      color: '#F59E0B',
      bgColor: '#FEF3C7',
      minScore: 750,
      maxScore: 819,
      perks: ['Exclusive events', '85% coin conversion', 'Priority support', 'Elite badge', 'Custom perks'],
    },
    pinnacle: {
      label: 'Pinnacle',
      color: '#EF4444',
      bgColor: '#FEE2E2',
      minScore: 820,
      maxScore: 900,
      perks: ['Invitation-only events', '100% coin conversion', 'White-glove support', 'Pinnacle badge', 'Premium perks', 'Influence status'],
    },
  };
  return bands[band];
}
