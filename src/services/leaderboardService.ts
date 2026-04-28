/**
 * Leaderboard Service — Karma by ReZ
 *
 * Provides leaderboard rankings across global, city, and cause scopes
 * with support for all-time, monthly, and weekly periods.
 *
 * Uses Redis caching (5-minute TTL) for performance.
 * Percentile calculated via MongoDB aggregation pipeline.
 */
import mongoose from 'mongoose';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { EarnRecord } from '../models/EarnRecord.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import { startOfDayIST } from '../utils/istTime.js';
import type { KarmaProfileDocument } from '../models/KarmaProfile.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LeaderboardScope = 'global' | 'city' | 'cause';
export type LeaderboardPeriod = 'all-time' | 'monthly' | 'weekly';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  karmaScore: number;
  level: string;
  activeKarma: number;
  eventsCompleted: number;
  percentile: number;
  topCause: string | null;
}

export interface LeaderboardResult {
  scope: LeaderboardScope;
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
  userRank: number | null;
  totalParticipants: number;
  updatedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// ─── Helper functions ─────────────────────────────────────────────────────────

/**
 * Get the date boundary for period filtering.
 */
function getPeriodBoundary(period: LeaderboardPeriod): Date | null {
  const now = new Date();

  if (period === 'all-time') {
    return null;
  }

  if (period === 'weekly') {
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - now.getDay());
    return startOfDayIST(startOfWeek);
  }

  if (period === 'monthly') {
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return startOfDayIST(startOfMonth);
  }

  return null;
}

/**
 * Determine top cause category from KarmaProfile.
 */
function getTopCause(profile: KarmaProfileDocument): string | null {
  const categoryCounts: Record<string, number> = {
    environment: profile.environmentEvents ?? 0,
    food: profile.foodEvents ?? 0,
    health: profile.healthEvents ?? 0,
    education: profile.educationEvents ?? 0,
    community: profile.communityEvents ?? 0,
  };

  let maxCount = 0;
  let topCause: string | null = null;

  for (const [category, count] of Object.entries(categoryCounts)) {
    if (count > maxCount) {
      maxCount = count;
      topCause = category;
    }
  }

  return topCause;
}

/**
 * Generate cache key for leaderboard.
 */
function getCacheKey(scope: LeaderboardScope, period: LeaderboardPeriod): string {
  return `leaderboard:${scope}:${period}`;
}

/**
 * Get cached leaderboard from Redis.
 */
async function getCachedLeaderboard(
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
  limit: number,
  offset: number,
  userId?: string,
): Promise<LeaderboardResult | null> {
  try {
    const cacheKey = getCacheKey(scope, period);
    const cached = await redis.get(cacheKey);

    if (cached) {
      const parsed: LeaderboardResult = JSON.parse(cached);

      // Slice cached results based on offset/limit
      const entries = parsed.entries.slice(offset, offset + limit);

      // Calculate user rank if userId provided
      let userRank: number | null = null;
      if (userId) {
        userRank = parsed.entries.findIndex((e) => e.userId === userId) + 1;
      }

      return {
        ...parsed,
        entries,
        userRank,
        updatedAt: parsed.updatedAt,
      };
    }
  } catch (err) {
    logger.error('[LeaderboardService] Cache read error', { error: err });
  }

  return null;
}

/**
 * Cache leaderboard result in Redis.
 */
async function cacheLeaderboard(
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
  result: LeaderboardResult,
): Promise<void> {
  try {
    const cacheKey = getCacheKey(scope, period);
    // Cache full result but trim to reasonable size
    const toCache: LeaderboardResult = {
      ...result,
      entries: result.entries.slice(0, MAX_LIMIT),
    };
    await redis.set(cacheKey, JSON.stringify(toCache), 'EX', CACHE_TTL_SECONDS);
  } catch (err) {
    logger.error('[LeaderboardService] Cache write error', { error: err });
  }
}

/**
 * Get user IDs who earned karma in a specific period.
 */
async function getUsersWithRecentActivity(
  period: LeaderboardPeriod,
): Promise<Set<string>> {
  const boundary = getPeriodBoundary(period);

  if (!boundary) {
    return new Set(); // Empty set means all users
  }

  try {
    const records = await EarnRecord.find({
      createdAt: { $gte: boundary },
      status: { $in: ['APPROVED_PENDING_CONVERSION', 'CONVERTED'] },
    })
      .select('userId')
      .lean();

    return new Set(records.map((r) => r.userId.toString()));
  } catch (err) {
    logger.error('[LeaderboardService] Error fetching recent users', { error: err });
    return new Set();
  }
}

/**
 * Calculate percentile for a given rank position and total count.
 */
function calculatePercentile(rank: number, total: number): number {
  if (total === 0) return 0;
  return Math.round(((total - rank) / total) * 10000) / 100;
}

/**
 * Build leaderboard entry from KarmaProfile document.
 */
function buildEntry(
  profile: KarmaProfileDocument,
  rank: number,
  total: number,
): LeaderboardEntry {
  return {
    rank,
    userId: profile.userId.toString(),
    karmaScore: profile.activeKarma, // Using activeKarma as the score
    level: profile.level ?? 'L1',
    activeKarma: profile.activeKarma ?? 0,
    eventsCompleted: profile.eventsCompleted ?? 0,
    percentile: calculatePercentile(rank, total),
    topCause: getTopCause(profile),
  };
}

// ─── Main service functions ────────────────────────────────────────────────────

/**
 * Get leaderboard entries for the specified scope and period.
 *
 * @param scope - 'global' | 'city' | 'cause'
 * @param period - 'all-time' | 'monthly' | 'weekly'
 * @param limit - Maximum number of entries to return (default 50, max 100)
 * @param offset - Number of entries to skip (default 0)
 * @param userId - Optional user ID to include their rank
 */
export async function getLeaderboard(
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
  limit: number = DEFAULT_LIMIT,
  offset: number = 0,
  userId?: string,
): Promise<LeaderboardResult> {
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT);

  // Check cache first
  const cached = await getCachedLeaderboard(scope, period, effectiveLimit, offset, userId);
  if (cached) {
    return cached;
  }

  try {
    // Build query based on scope and period
    const query: Record<string, unknown> = {};
    let sortField: string;
    let sortOrder: 1 | -1;

    // Sort always by activeKarma descending
    sortField = 'activeKarma';
    sortOrder = -1;

    // For period-filtered leaderboards, we need to filter by users with recent activity
    const recentUsers = await getUsersWithRecentActivity(period);

    if (period !== 'all-time' && recentUsers.size > 0) {
      // Filter to only users who earned karma in the period
      const userIdObjs = Array.from(recentUsers).map((id) => new mongoose.Types.ObjectId(id));
      query.userId = { $in: userIdObjs };
    }

    // Scope-specific filters
    if (scope === 'cause') {
      // For cause leaderboard, we don't filter here - we group by top cause in aggregation
      // This is a simplified implementation; full cause leaderboard uses category aggregation
    }
    // Note: 'city' scope requires city field on KarmaProfile which is not currently available.
    // For now, city leaderboard falls back to global ranking.

    // Execute aggregation pipeline for percentile calculation
    const pipeline: mongoose.PipelineStage[] = [
      { $match: query },
      { $sort: { [sortField]: sortOrder } },
      {
        $facet: {
          // Get total count
          totalCount: [{ $count: 'count' }],
          // Get paginated entries
          entries: [
            { $skip: offset },
            { $limit: effectiveLimit },
          ],
        },
      },
    ];

    const result = await KarmaProfile.aggregate(pipeline).exec();

    const totalCount = result[0]?.totalCount[0]?.count ?? 0;
    const profiles = result[0]?.entries ?? [];

    // Build leaderboard entries with ranks
    const entries: LeaderboardEntry[] = profiles.map((profile: KarmaProfileDocument, index: number) =>
      buildEntry(profile, offset + index + 1, totalCount),
    );

    // Calculate user's rank if userId provided
    let userRank: number | null = null;
    if (userId) {
      const rankResult = await getUserRank(userId, scope, period);
      userRank = rankResult;
    }

    const leaderboardResult: LeaderboardResult = {
      scope,
      period,
      entries,
      userRank,
      totalParticipants: totalCount,
      updatedAt: new Date().toISOString(),
    };

    // Cache the result
    await cacheLeaderboard(scope, period, leaderboardResult);

    return leaderboardResult;
  } catch (err) {
    logger.error('[LeaderboardService] getLeaderboard error', { scope, period, error: err });
    return {
      scope,
      period,
      entries: [],
      userRank: null,
      totalParticipants: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Get a specific user's rank in the leaderboard.
 *
 * @param userId - The user's ID
 * @param scope - 'global' | 'city' | 'cause'
 * @param period - 'all-time' | 'monthly' | 'weekly'
 * @returns The user's rank (1-indexed) or null if not found
 */
export async function getUserRank(
  userId: string,
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
): Promise<number | null> {
  try {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return null;
    }

    const query: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
    };

    // For period-filtered leaderboards, filter by users with recent activity
    const recentUsers = await getUsersWithRecentActivity(period);

    if (period !== 'all-time' && recentUsers.size > 0) {
      // Check if user is in the recent users set
      if (!recentUsers.has(userId)) {
        return null; // User didn't earn karma in this period
      }
    }

    // Count how many users have higher activeKarma
    const userProfile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) })
      .select('activeKarma')
      .lean();

    if (!userProfile) {
      return null;
    }

    const userScore = userProfile.activeKarma ?? 0;

    // Count users with higher karma
    const higherRankedCount = await KarmaProfile.countDocuments({
      ...query,
      activeKarma: { $gt: userScore },
    });

    return higherRankedCount + 1; // 1-indexed rank
  } catch (err) {
    logger.error('[LeaderboardService] getUserRank error', { userId, scope, period, error: err });
    return null;
  }
}

/**
 * Get total number of participants in a leaderboard scope.
 */
export async function getTotalParticipants(
  scope: LeaderboardScope,
  period: LeaderboardPeriod,
): Promise<number> {
  try {
    const query: Record<string, unknown> = {};

    // For period-filtered leaderboards
    const recentUsers = await getUsersWithRecentActivity(period);

    if (period !== 'all-time' && recentUsers.size > 0) {
      const userIdObjs = Array.from(recentUsers).map((id) => new mongoose.Types.ObjectId(id));
      query.userId = { $in: userIdObjs };
    }

    const count = await KarmaProfile.countDocuments(query);
    return count;
  } catch (err) {
    logger.error('[LeaderboardService] getTotalParticipants error', { scope, period, error: err });
    return 0;
  }
}

/**
 * Invalidate leaderboard cache (call after karma events).
 */
export async function invalidateCache(): Promise<void> {
  try {
    const scopes: LeaderboardScope[] = ['global', 'city', 'cause'];
    const periods: LeaderboardPeriod[] = ['all-time', 'monthly', 'weekly'];

    const keysToDelete: string[] = [];
    for (const scope of scopes) {
      for (const period of periods) {
        keysToDelete.push(getCacheKey(scope, period));
      }
    }

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
      logger.info('[LeaderboardService] Cache invalidated', { keys: keysToDelete });
    }
  } catch (err) {
    logger.error('[LeaderboardService] Cache invalidation error', { error: err });
  }
}
