// @ts-nocheck
// @ts-nocheck
/**
 * ScoreRank Worker — nightly KarmaScore ranking job
 *
 * Runs at 1:10 AM UTC every day:
 *   1. Rebuilds Redis ZSET with all active karma profiles
 *   2. Computes percentile for every user
 *   3. Stores percentile back to Redis
 *   4. Snapshots daily score history
 *
 * Uses a distributed lock to prevent concurrent runs.
 */
import cron from 'node-cron';
import { KarmaProfile } from '../models/KarmaProfile.js';
import { ScoreHistory } from '../models/ScoreHistory.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';
import {
  computeKarmaScore,
  getKarmaScoreBand,
  getTrustGrade,
  getMomentumLabel,
  calculateImpactScore,
  calculateTrustScore,
  calculateRelativeRankScore,
} from '../engines/karmaScoreEngine.js';
import { applyStabilityBuffer } from '../utils/scoreStabilityBuffer.js';
import { startOfDayIST } from '../utils/istTime.js';
import type { KarmaProfileDocument } from '../models/KarmaProfile.js';

const RANKINGS_KEY = 'karma:rankings:activeKarma';
const LOCK_KEY = 'karma:scoreRankWorker:lock';
const LOCK_TTL_SECONDS = 3600; // 1 hour max

async function acquireLock(): Promise<boolean> {
  // Using SET NX EX for atomic lock acquisition (REZ-KARMA-WS FIX pattern)
  const result = await redis.set(LOCK_KEY, process.pid.toString(), 'EX', LOCK_TTL_SECONDS, 'NX');
  return result === 'OK';
}

async function releaseLock(): Promise<void> {
  await redis.del(LOCK_KEY);
}

async function rebuildRankings(): Promise<void> {
  logger.info('[ScoreRankWorker] Starting daily ranking rebuild');

  const batchSize = 500;
  let processed = 0;
  let cursor = 0;

  do {
    const profiles = await KarmaProfile.find({})
      .select('_id userId activeKarma')
      .skip(cursor)
      .limit(batchSize)
      .lean();

    if (profiles.length === 0) break;

    const pipeline = redis.multi();

    for (const profile of profiles) {
      const userId = (profile.userId as unknown as string).toString();
      pipeline.zadd(RANKINGS_KEY, profile.activeKarma, userId);
    }

    await pipeline.exec();
    processed += profiles.length;
    cursor += batchSize;

    logger.info(`[ScoreRankWorker] Processed ${processed} profiles`);
  } while (true);

  logger.info(`[ScoreRankWorker] Rankings rebuilt with ${processed} profiles`);
}

async function computePercentiles(): Promise<void> {
  const total = await redis.zcard(RANKINGS_KEY);
  if (total === 0) return;

  let cursor = 0;
  const batchSize = 200;

  while (true) {
    const results = await redis.zrevrange(RANKINGS_KEY, cursor, cursor + batchSize - 1, 'WITHSCORES');

    if (results.length === 0) break;

    const pipeline = redis.multi();

    for (let i = 0; i < results.length; i += 2) {
      const userId = results[i];
      const rank = Math.floor(i / 2) + cursor;
      const percentile = ((total - rank - 1) / total) * 100;
      pipeline.set(`karma:score:percentile:${userId}`, percentile.toFixed(4), 'EX', 86400 * 2);
    }

    await pipeline.exec();
    cursor += batchSize;

    if (cursor % 1000 === 0) {
      logger.info(`[ScoreRankWorker] Percentile update: ${cursor}/${total}`);
    }
  }

  logger.info('[ScoreRankWorker] Percentiles computed');
}

async function snapshotDailyScores(): Promise<void> {
  const today = startOfDayIST();

  let cursor = 0;
  const batchSize = 200;
  let saved = 0;

  while (true) {
    const profiles = await KarmaProfile.find({})
      .skip(cursor)
      .limit(batchSize)
      .lean() as unknown as KarmaProfileDocument[];

    if (profiles.length === 0) break;

    for (const profile of profiles) {
      const userId = (profile.userId as unknown as string).toString();

      const raw = await redis.get(`karma:score:raw:${userId}`);
      if (!raw) continue;

      const scoreNum = parseInt(raw, 10);
      const display = await applyStabilityBuffer(userId, scoreNum);

      const percentileStr = await redis.get(`karma:score:percentile:${userId}`);
      const percentile = percentileStr ? parseFloat(percentileStr) : 0;

      const impact = calculateImpactScore(profile.lifetimeKarma ?? 0);
      const trust = calculateTrustScore(profile);
      const relativeRank = calculateRelativeRankScore(percentile);
      const band = getKarmaScoreBand(scoreNum);
      const trustGrade = getTrustGrade(trust);
      const momentumLabel = getMomentumLabel(0); // Momentum recalculated on-demand

      try {
        await ScoreHistory.updateOne(
          { userId: profile._id, date: today },
          {
            $set: {
              rawScore: scoreNum,
              displayScore: display,
              components: { base: 300, impact, relativeRank, trust, momentum: 0 },
              band,
              percentile,
              trustGrade,
              momentumLabel,
              activeKarma: profile.activeKarma,
              lifetimeKarma: profile.lifetimeKarma,
            },
          },
          { upsert: true },
        );
        saved++;
      } catch (err) {
        logger.warn('[ScoreRankWorker] Failed to snapshot score', { userId, error: err });
      }
    }

    cursor += batchSize;
  }

  logger.info(`[ScoreRankWorker] Daily snapshots saved: ${saved}`);
}

async function runNightlyRanking(): Promise<void> {
  const lockAcquired = await acquireLock();
  if (!lockAcquired) {
    logger.warn('[ScoreRankWorker] Lock not acquired, another instance is running');
    return;
  }

  try {
    logger.info('[ScoreRankWorker] Nightly ranking job started');

    await rebuildRankings();
    await computePercentiles();
    await snapshotDailyScores();

    logger.info('[ScoreRankWorker] Nightly ranking job completed successfully');
  } catch (err) {
    logger.error('[ScoreRankWorker] Nightly ranking job failed', { error: err });
  } finally {
    await releaseLock();
  }
}

/**
 * Initialize the score rank worker.
 * Schedules the cron job at 1:10 AM UTC daily.
 */
export function initScoreRankWorker(): void {
  // 10 1 * * * = 1:10 AM UTC every day
  cron.schedule('10 1 * * *', runNightlyRanking, {
    timezone: 'UTC',
  });

  logger.info('[ScoreRankWorker] Score rank worker initialized (cron: 1:10 AM UTC)');
}

// Allow manual trigger for testing / catch-up
export { runNightlyRanking };
