// -nocheck
/**
 * Score Stability Buffer — Phase 3: Karma by ReZ
 *
 * Prevents KarmaScore from jumping more than ±5 points per day
 * in the user's display score. The raw score always updates immediately;
 * only the displayed value is buffered.
 *
 * Flow:
 *   1. computeKarmaScore() writes raw score to Redis
 *   2. applyStabilityBuffer() returns the buffered display score
 *   3. getStabilitySnapshot() returns raw + display for API responses
 */
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

const STABILITY_TTL_SECONDS = 86400; // 24 hours

export interface StabilitySnapshot {
  raw: number;
  display: number;
  lastRawAt: number; // Unix ms
}

/**
 * Get the stability snapshot for a user.
 * Returns both raw score and the buffered display score.
 *
 * Display = clamp(raw, lastDisplay - 5, lastDisplay + 5)
 * If no prior display exists, display = raw.
 */
export async function getStabilitySnapshot(userId: string): Promise<StabilitySnapshot | null> {
  try {
    const [rawStr, lastDisplayStr, lastRawAtStr] = await Promise.all([
      redis.get(`karma:score:raw:${userId}`),
      redis.get(`karma:score:display:${userId}`),
      redis.get(`karma:score:lastRawAt:${userId}`),
    ]);

    const raw = rawStr ? parseInt(rawStr, 10) : null;
    if (raw === null) return null;

    const lastDisplay = lastDisplayStr ? parseInt(lastDisplayStr, 10) : null;
    const lastRawAt = lastRawAtStr ? parseInt(lastRawAtStr, 10) : 0;

    let display = raw;

    if (lastDisplay !== null && lastRawAt > 0) {
      // Apply ±5pt/day buffer from the last known display score
      const daysSinceLastRaw = (Date.now() - lastRawAt) / 86400000;
      const maxDailyMove = Math.max(5, Math.floor(daysSinceLastRaw * 5));

      const clamped = Math.min(
        lastDisplay + maxDailyMove,
        Math.max(lastDisplay - maxDailyMove, raw),
      );
      display = clamped;
    }

    return {
      raw,
      display,
      lastRawAt: lastRawAt || Date.now(),
    };
  } catch (err) {
    logger.error('[ScoreStabilityBuffer] getStabilitySnapshot error', { userId, error: err });
    return null;
  }
}

/**
 * Persist the display score snapshot after computing raw score.
 * Call this after computeKarmaScore() saves raw to Redis.
 */
export async function applyStabilityBuffer(
  userId: string,
  rawScore: number,
): Promise<number> {
  try {
    const snapshot = await getStabilitySnapshot(userId);
    let display = rawScore;

    if (snapshot) {
      const daysSinceLastRaw = (Date.now() - snapshot.lastRawAt) / 86400000;
      const maxDailyMove = Math.max(5, Math.floor(daysSinceLastRaw * 5));

      display = Math.min(
        snapshot.display + maxDailyMove,
        Math.max(snapshot.display - maxDailyMove, rawScore),
      );
    }

    // Store all three values atomically
    const pipeline = redis.multi()
      .set(`karma:score:display:${userId}`, display.toString(), 'EX', STABILITY_TTL_SECONDS)
      .set(`karma:score:lastRawAt:${userId}`, Date.now().toString(), 'EX', STABILITY_TTL_SECONDS);

    await pipeline.exec();

    return display;
  } catch (err) {
    logger.error('[ScoreStabilityBuffer] applyStabilityBuffer error', { userId, error: err });
    return rawScore;
  }
}

/**
 * Reset stability buffer for a user (admin use only).
 * Forces the display score to match the raw score on next read.
 */
export async function resetStabilityBuffer(userId: string): Promise<void> {
  try {
    await Promise.all([
      redis.del(`karma:score:display:${userId}`),
      redis.del(`karma:score:lastRawAt:${userId}`),
    ]);
  } catch (err) {
    logger.error('[ScoreStabilityBuffer] resetStabilityBuffer error', { userId, error: err });
  }
}
