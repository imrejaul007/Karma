/**
 * Karma Routes — REST API endpoints
 *
 * Base path: /api/karma
 *
 * GET  /api/karma/user/:userId         — get full karma profile
 * GET  /api/karma/user/:userId/history — get conversion history
 * GET  /api/karma/user/:userId/level   — get level + conversion rate info
 * POST /api/karma/decay-all            — trigger decay for all profiles (admin)
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireAdminAuth as requireAdmin } from '../middleware/adminAuth.js';
import {
  getKarmaProfile,
  getLevelInfo,
  getKarmaHistory,
  applyDecayToAll,
} from '../services/karmaService.js';
import { nextLevelThreshold, karmaToNextLevel, getConversionRate } from '../engines/karmaEngine.js';
import type { Level } from '../types/index.js';
import { logger } from '../config/logger.js';

const router = Router();

/**
 * GET /api/karma/user/:userId
 * Returns the full karma profile for a user.
 */
router.get('/user/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    // KARMA-P1 FIX: Verify the authenticated user owns this karma profile.
    // Without this, any authenticated user can read any other user's karma.
    if (req.userId !== userId) {
      res.status(403).json({ error: 'Access denied: you can only view your own karma profile' });
      return;
    }
    const profile = await getKarmaProfile(userId);

    if (!profile) {
      res.status(404).json({ error: 'Karma profile not found for this user' });
      return;
    }

    const level = (profile.level ?? 'L1') as import('../types/index.js').Level;
    const nextAt = nextLevelThreshold(level);
    const toNext = karmaToNextLevel(profile.activeKarma);

    // Compute decay warning: days since last activity
    let decayWarning: string | null = null;
    if (profile.lastActivityAt) {
      const daysSince = Math.floor(
        (Date.now() - new Date(profile.lastActivityAt).getTime()) / 86400000,
      );
      if (daysSince >= 30) {
        decayWarning = `No activity for ${daysSince} days. Your karma will start decaying soon.`;
      }
    }

    res.json({
      userId: profile.userId,
      lifetimeKarma: profile.lifetimeKarma,
      activeKarma: profile.activeKarma,
      level: profile.level,
      conversionRate: getConversionRate(profile.level as Level),
      eventsCompleted: profile.eventsCompleted,
      totalHours: profile.totalHours,
      trustScore: profile.trustScore,
      badges: profile.badges,
      nextLevelAt: nextAt,
      karmaToNextLevel: toNext,
      decayWarning,
      levelHistory: profile.levelHistory,
    });
  } catch (err) {
    logger.error('Error fetching karma profile', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/karma/user/:userId/history
 * Returns the conversion history for a user, most recent first.
 */
router.get(
  '/user/:userId/history',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      // KARMA-P1 FIX: Verify ownership.
      if (req.userId !== userId) {
        res.status(403).json({ error: 'Access denied: you can only view your own conversion history' });
        return;
      }
      let limit = parseInt(String(req.query.limit ?? '20'), 10);
      // MED-18 FIX: Validate parseInt result and enforce bounds
      if (isNaN(limit) || limit < 1) limit = 20;
      if (limit > 100) limit = 100;
      const history = await getKarmaHistory(userId, limit);
      res.json({ history });
    } catch (err) {
      logger.error('Error fetching karma history', { error: err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * GET /api/karma/user/:userId/level
 * Returns level, conversion rate, and next-level threshold for a user.
 */
router.get(
  '/user/:userId/level',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { userId } = req.params;
      // KARMA-P1 FIX: Verify ownership.
      if (req.userId !== userId) {
        res.status(403).json({ error: 'Access denied: you can only view your own level info' });
        return;
      }
      const levelInfo = await getLevelInfo(userId);
      res.json(levelInfo);
    } catch (err) {
      logger.error('Error fetching level info', { error: err });
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

/**
 * POST /api/karma/decay-all
 * Admin-only: trigger decay across all profiles.
 */
router.post('/decay-all', requireAdmin, async (_req: Request, res: Response) => {
  try {
    logger.info('Manual decay job triggered via API');
    const result = await applyDecayToAll();
    res.json({
      success: true,
      processed: result.processed,
      decayed: result.decayed,
      levelDrops: result.levelDrops,
    });
  } catch (err) {
    logger.error('Error running decay job', { error: err });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
