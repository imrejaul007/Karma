/**
 * Civic Corps Routes — Namma Bengaluru Karma Corps (NBKC)
 *
 * API endpoints for civic membership, missions, and leaderboards.
 */
import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  joinCivicCorps,
  getCivicCorpsStatus,
  listMissions,
  getMission,
  enrollInMission,
  checkInToMission,
  completeMission,
  addGreenAction,
  getWardLeaderboard,
  getGlobalLeaderboard,
} from '../services/civicCorpsService.js';
import { z } from 'zod';
import { withRetry } from '../utils/retry.js';
import type { GreenActionType } from '../models/index.js';
import { logger } from '../config/logger.js';

const router = Router();

// ─── Membership ────────────────────────────────────────────────────────────────

const joinSchema = z.object({
  ward: z.string().min(1, 'Ward is required'),
  skills: z.array(z.string()).optional().default([]),
  hasVehicle: z.boolean().optional().default(false),
});

/**
 * POST /api/karma/civic-corps/join
 * Join NBKC as a citizen member.
 */
router.post('/join', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = joinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten() });
    }

    const result = await withRetry(() =>
      joinCivicCorps({
        userId: req.userId ?? '',
        ward: parsed.data.ward,
        skills: parsed.data.skills,
        hasVehicle: parsed.data.hasVehicle,
      })
    );

    return res.json({
      success: true,
      data: result,
      message: 'Welcome to Namma Bengaluru Karma Corps! Namma City. Namma Karma.',
    });
  } catch (err: any) {
    logger.error('[CivicRoutes] join error', { error: err.message, userId: req.userId });
    if (err.message.includes('Already a member')) {
      return res.status(409).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: 'Failed to join civic corps' });
  }
});

/**
 * GET /api/karma/civic-corps/status
 * Get current user's NBKC membership status and green scores.
 */
router.get('/status', requireAuth, async (req: Request, res: Response) => {
  try {
    const status = await withRetry(() => getCivicCorpsStatus(req.userId ?? ''));
    return res.json({ success: true, data: status });
  } catch (err: any) {
    logger.error('[CivicRoutes] status error', { error: err.message, userId: req.userId });
    return res.status(500).json({ success: false, message: 'Failed to get status' });
  }
});

// ─── Missions ─────────────────────────────────────────────────────────────────

/**
 * GET /api/karma/civic-corps/missions
 * List available civic missions.
 * Query: ward, category, limit, page
 */
router.get('/missions', async (req: Request, res: Response) => {
  try {
    const { ward, category, limit, page } = req.query;
    const result = await withRetry(() =>
      listMissions({
        ward: ward as string,
        category: category as string,
        limit: limit ? parseInt(limit as string, 10) : undefined,
        page: page ? parseInt(page as string, 10) : undefined,
      })
    );
    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('[CivicRoutes] list missions error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to list missions' });
  }
});

/**
 * GET /api/karma/civic-corps/missions/:id
 * Get mission details.
 */
router.get('/missions/:id', async (req: Request, res: Response) => {
  try {
    const mission = await withRetry(() => getMission(req.params.id));
    if (!mission) {
      return res.status(404).json({ success: false, message: 'Mission not found' });
    }
    return res.json({ success: true, data: mission });
  } catch (err: any) {
    logger.error('[CivicRoutes] get mission error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get mission' });
  }
});

/**
 * POST /api/karma/civic-corps/missions/:id/enroll
 * Enroll in a civic mission.
 */
router.post('/missions/:id/enroll', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await withRetry(() => enrollInMission(req.userId ?? '', req.params.id));
    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('[CivicRoutes] enroll error', { error: err.message, userId: req.userId });
    if (err.message.includes('not found') || err.message.includes('full')) {
      return res.status(400).json({ success: false, message: err.message });
    }
    return res.status(500).json({ success: false, message: 'Failed to enroll' });
  }
});

/**
 * POST /api/karma/civic-corps/missions/:id/checkin
 * Check in to a mission.
 */
router.post('/missions/:id/checkin', requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await withRetry(() => checkInToMission(req.userId ?? '', req.params.id));
    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('[CivicRoutes] checkin error', { error: err.message, userId: req.userId });
    return res.status(400).json({ success: false, message: err.message });
  }
});

const completeSchema = z.object({
  hoursVolunteered: z.number().min(0.5).max(24),
  verified: z.boolean().optional().default(false),
});

/**
 * POST /api/karma/civic-corps/missions/:id/complete
 * Complete a mission and receive karma + green score rewards.
 */
router.post('/missions/:id/complete', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten() });
    }

    const result = await withRetry(() =>
      completeMission(
        req.userId ?? '',
        req.params.id,
        parsed.data.hoursVolunteered,
        parsed.data.verified
      )
    );

    return res.json({
      success: true,
      data: result,
      message: 'Mission completed! Your karma and green score have been updated.',
    });
  } catch (err: any) {
    logger.error('[CivicRoutes] complete error', { error: err.message, userId: req.userId });
    return res.status(400).json({ success: false, message: err.message });
  }
});

// ─── Green Score ─────────────────────────────────────────────────────────────

const greenActionSchema = z.object({
  actionType: z.enum([
    'tree_adoption',
    'lake_cleanup',
    'composting',
    'waste_segregation',
    'plastic_cleanup',
    'sapling_planting',
    'water_conservation',
    'energy_saving',
  ] as [string, ...string[]]),
  ward: z.string().optional().default(''),
  verified: z.boolean().optional().default(false),
});

/**
 * POST /api/karma/civic-corps/green-action
 * Record a green action for green score tracking.
 */
router.post('/green-action', requireAuth, async (req: Request, res: Response) => {
  try {
    const parsed = greenActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, errors: parsed.error.flatten() });
    }

    const result = await withRetry(() =>
      addGreenAction(req.userId ?? '', {
        actionType: parsed.data.actionType as GreenActionType,
        ward: parsed.data.ward,
        verified: parsed.data.verified,
      })
    );

    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('[CivicRoutes] green action error', { error: err.message, userId: req.userId });
    return res.status(500).json({ success: false, message: 'Failed to record action' });
  }
});

// ─── Leaderboards ────────────────────────────────────────────────────────────

/**
 * GET /api/karma/civic-corps/leaderboard
 * Get ward or global NBKC leaderboard.
 * Query: ward (optional for ward-specific), limit
 */
router.get('/leaderboard', async (req: Request, res: Response) => {
  try {
    const { ward, limit } = req.query;
    const limitNum = limit ? parseInt(limit as string, 10) : 20;

    const result = ward
      ? await withRetry(() => getWardLeaderboard(ward as string, limitNum))
      : await withRetry(() => getGlobalLeaderboard(limitNum));

    return res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error('[CivicRoutes] leaderboard error', { error: err.message });
    return res.status(500).json({ success: false, message: 'Failed to get leaderboard' });
  }
});

export default router;
