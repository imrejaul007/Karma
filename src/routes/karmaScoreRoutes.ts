// @ts-nocheck
// @ts-ignore
/**
 * KarmaScore Routes — REST API endpoints
 *
 * Base path: /api/karma/score
 *
 * GET  /api/karma/score                    — get current user's KarmaScore
 * GET  /api/karma/score/history            — get score history (last 90 days)
 * GET  /api/karma/score/leaderboard       — get top karma scores
 * GET  /api/karma/score/leaderboard/my-rank — get current user's rank
 * GET  /api/karma/score/band/:band        — get band metadata
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { computeKarmaScore, getBandMetadata, getKarmaScoreBand } from '../engines/karmaScoreEngine.js';
import { getStabilitySnapshot, applyStabilityBuffer } from '../utils/scoreStabilityBuffer.js';
import { ScoreHistory } from '../models/ScoreHistory.js';
import { redis } from '../config/redis.js';
import { logger } from '../config/logger.js';

const router = Router();

// GET /api/karma/score
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const scoreResult = await computeKarmaScore(userId, true);
    if (!scoreResult) {
      res.status(404).json({ success: false, message: 'Karma profile not found' });
      return;
    }

    // Apply stability buffer to get display score
    const display = await applyStabilityBuffer(userId, scoreResult.total);

    const snapshot = await getStabilitySnapshot(userId);

    res.json({
      success: true,
      data: {
        userId,
        total: scoreResult.total,
        display,
        raw: scoreResult.total,
        components: scoreResult.components,
        band: scoreResult.band,
        bandMeta: getBandMetadata(scoreResult.band),
        percentile: scoreResult.percentile,
        trustGrade: scoreResult.trustGrade,
        momentumLabel: scoreResult.momentumLabel,
        stability: snapshot
          ? { raw: snapshot.raw, display: snapshot.display, lastRawAt: snapshot.lastRawAt }
          : null,
      },
    });
  } catch (err) {
    logger.error('[KarmaScoreRoutes] GET /score error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/karma/score/history
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const days = Math.min(90, Math.max(1, parseInt((req.query.days as string) || '30', 10)));
    const startDate = new Date(Date.now() - days * 86400000);

    const history = await ScoreHistory.find({
      userId: userId,
      date: { $gte: startDate },
    })
      .sort({ date: 1 })
      .limit(90)
      .lean();

    res.json({
      success: true,
      data: {
        days,
        entries: history.map(h => ({
          date: h.date,
          rawScore: h.rawScore,
          displayScore: h.displayScore,
          band: h.band,
          percentile: h.percentile,
          components: h.components,
          activeKarma: h.activeKarma,
          lifetimeKarma: h.lifetimeKarma,
        })),
      },
    });
  } catch (err) {
    logger.error('[KarmaScoreRoutes] GET /score/history error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/karma/score/leaderboard
router.get('/leaderboard', async (_req: Request, res: Response) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt((_req.query.limit as string) || '20', 10)));
    const offset = Math.max(0, parseInt((_req.query.offset as string) || '0', 10));

    // Read from Redis ZSET sorted by raw score
    const results = await redis.zrevrange(
      'karma:rankings:activeKarma',
      offset,
      offset + limit - 1,
      'WITHSCORES',
    );

    const entries: Array<{
      rank: number;
      userId: string;
      activeKarma: number;
    }> = [];

    for (let i = 0; i < results.length; i += 2) {
      entries.push({
        rank: offset + Math.floor(i / 2) + 1,
        userId: results[i],
        activeKarma: parseInt(results[i + 1], 10),
      });
    }

    const total = await redis.zcard('karma:rankings:activeKarma');

    res.json({
      success: true,
      data: {
        entries,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (err) {
    logger.error('[KarmaScoreRoutes] GET /score/leaderboard error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/karma/score/leaderboard/my-rank
router.get('/leaderboard/my-rank', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const rank = await redis.zrevrank('karma:rankings:activeKarma', userId);
    const total = await redis.zcard('karma:rankings:activeKarma');
    const score = await redis.zscore('karma:rankings:activeKarma', userId);

    if (rank === null) {
      res.json({
        success: true,
        data: { rank: null, total: 0, score: 0, percentile: 0 },
      });
      return;
    }

    const percentile = total > 0 ? ((total - rank - 1) / total) * 100 : 0;

    res.json({
      success: true,
      data: {
        rank: rank + 1,
        total,
        score: parseInt(score ?? '0', 10),
        percentile: Math.round(percentile * 100) / 100,
      },
    });
  } catch (err) {
    logger.error('[KarmaScoreRoutes] GET /score/leaderboard/my-rank error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// GET /api/karma/score/band/:band
router.get('/band/:band', async (req: Request, res: Response) => {
  const { band } = req.params;
  const validBands = ['starter', 'active', 'performer', 'leader', 'elite', 'pinnacle'];
  if (!validBands.includes(band)) {
    res.status(400).json({ success: false, message: 'Invalid band' });
    return;
  }
  res.json({
    success: true,
    data: getBandMetadata(band as any),
  });
});

export default router;
