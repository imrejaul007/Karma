// -nocheck
// @ts-ignore
/**
 * Karma Routes — REST API endpoints
 *
 * Base path: /api/karma
 *
 * GET  /api/karma/user/:userId              — get full karma profile
 * GET  /api/karma/user/:userId/history      — get conversion history
 * GET  /api/karma/user/:userId/level        — get level + conversion rate info
 * POST /api/karma/decay-all                 — trigger decay for all profiles (admin)
 * POST /api/karma/admin/event               — create a karma event (NGO)
 * GET  /api/karma/my-bookings              — list user's joined events
 * PATCH /api/karma/booking/:bookingId/approve — NGO approves a booking
 * GET  /api/karma/report                   — generate Impact Report PDF
 * GET  /api/karma/resume                   — generate Impact Resume JSON
 * GET  /api/karma/resume/pdf               — generate Impact Resume PDF
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { requireAdminAuth as requireAdmin } from '../middleware/adminAuth.js';
import {
  getKarmaProfile,
  getLevelInfo,
  getKarmaHistory,
  applyDecayToAll,
} from '../services/karmaService.js';
import { generateImpactReportPDF } from '../services/reportService.js';
import { generateImpactResume } from '../services/impactResumeService.js';
import { generateImpactResumePDF } from '../templates/resumeTemplate.js';
import { nextLevelThreshold, karmaToNextLevel, getConversionRate } from '../engines/karmaEngine.js';
import type { KarmaLevel as Level } from '../shared-types';
import { KarmaProfile, CorporatePartner, CsrAllocation } from '../models/index.js';
import {
  getCorporateDashboard,
  allocateKarmaCredits,
  generateCsrReport,
  addEmployeeToProgram,
  getEmployeeStats,
} from '../services/csrService.js';
import { logger } from '../config/logger.js';
import {
  getLeaderboard,
  getUserRank,
  getTotalParticipants,
  type LeaderboardScope,
  type LeaderboardPeriod,
} from '../services/leaderboardService.js';
import {
  getAllCommunities,
  getCommunity,
  followCommunity,
  unfollowCommunity,
  getCommunityFeed,
  createPost,
  getRecommendedCommunities,
  getUserCommunities,
} from '../services/communityService.js';

const router = Router();

/**
 * GET /api/karma/user/:userId
 * Returns the full karma profile for a user.
 */
router.get('/user/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    let { userId } = req.params;
    // Resolve 'me' to the authenticated user's ID
    if (userId === 'me') userId = req.userId ?? '';
    // KARMA-P1 FIX: Verify the authenticated user owns this karma profile.
    // Without this, any authenticated user can read any other user's karma.
    if (req.userId !== userId) {
      res.status(403).json({ success: false, message: 'Access denied: you can only view your own karma profile' });
      return;
    }
    const profile = await getKarmaProfile(userId);

    if (!profile) {
      res.status(404).json({ success: false, message: 'Karma profile not found for this user' });
      return;
    }

    const level = (profile.level ?? 'L1') as Level;
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
    res.status(500).json({ success: false, message: 'Internal server error' });
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
      let { userId } = req.params;
      if (userId === 'me') userId = req.userId ?? '';
      // KARMA-P1 FIX: Verify ownership.
      if (req.userId !== userId) {
        res.status(403).json({ success: false, message: 'Access denied: you can only view your own conversion history' });
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
      res.status(500).json({ success: false, message: 'Internal server error' });
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
      let { userId } = req.params;
      if (userId === 'me') userId = req.userId ?? '';
      // KARMA-P1 FIX: Verify ownership.
      if (req.userId !== userId) {
        res.status(403).json({ success: false, message: 'Access denied: you can only view your own level info' });
        return;
      }
      const levelInfo = await getLevelInfo(userId);
      res.json(levelInfo);
    } catch (err) {
      logger.error('Error fetching level info', { error: err });
      res.status(500).json({ success: false, message: 'Internal server error' });
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
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/missions
 * Get active missions with progress for the authenticated user.
 */
router.get('/missions', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const { getActiveMissions } = await import('../services/missionEngine.js');
    const missions = await getActiveMissions(userId);
    res.json({ success: true, missions });
  } catch (err) {
    logger.error('GET /missions error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/badges
 * Get all earned badges for the authenticated user.
 */
router.get('/badges', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }
    const profile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    res.json({ success: true, badges: profile?.badges ?? [] });
  } catch (err) {
    logger.error('GET /badges error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/karma/report
 * Generate and return the user's Impact Report as a branded PDF.
 * Consumer passes userName in query (consumer has it from auth store).
 */
router.get('/report', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const userName = String(req.query.name ?? req.query.userName ?? 'ReZ Volunteer');
    const sanitizedName = userName.replace(/[^\w\s'-]/g, '').trim();
    if (!sanitizedName) {
      res.status(400).json({ success: false, message: 'userName is required' });
      return;
    }

    const pdfBuffer = await generateImpactReportPDF(userId, sanitizedName);
    const safeName = sanitizedName.replace(/\s+/g, '_');
    const filename = `ImpactReport_${safeName}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdfBuffer);
  } catch (err) {
    logger.error('GET /report error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to generate report' });
  }
});

/**
 * GET /api/karma/resume
 * Returns the user's Impact Resume as structured JSON.
 * Designed for LinkedIn, college applications, CSR reporting, or job resumes.
 */
router.get('/resume', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const resume = await generateImpactResume(userId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(resume);
  } catch (err) {
    logger.error('GET /resume error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to generate resume' });
  }
});

/**
 * GET /api/karma/resume/pdf
 * Returns the user's Impact Resume as a branded PDF.
 * Two-column layout: left = metrics/timeline, right = badges/skills.
 * Formatted for LinkedIn/CSR use.
 */
router.get('/resume/pdf', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const userName = String(req.query.name ?? req.query.userName ?? 'Volunteer');
    const sanitizedName = userName.replace(/[^\w\s'-]/g, '').trim();
    if (!sanitizedName) {
      res.status(400).json({ success: false, message: 'userName is required' });
      return;
    }

    const resume = await generateImpactResume(userId);
    const pdfBuffer = await generateImpactResumePDF(resume, { userName: sanitizedName });
    const safeName = sanitizedName.replace(/\s+/g, '_');
    const filename = `ImpactResume_${safeName}_${Date.now()}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.setHeader('Cache-Control', 'private, no-store');
    res.end(pdfBuffer);
  } catch (err) {
    logger.error('GET /resume/pdf error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to generate resume PDF' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/admin/event — NGO creates a karma event
// ---------------------------------------------------------------------------

router.post('/admin/event', requireAdmin, async (req: Request, res: Response) => {
  try {
    const {
      merchantEventId,
      ngoId,
      category,
      impactUnit,
      impactMultiplier,
      difficulty,
      expectedDurationHours,
      baseKarmaPerHour,
      maxKarmaPerEvent,
      gpsRadius,
      maxVolunteers,
    } = req.body as Record<string, unknown>;

    // Validate required fields
    if (!category || !difficulty || !expectedDurationHours || !baseKarmaPerHour || !maxKarmaPerEvent) {
      res.status(400).json({ success: false, message: 'Missing required fields: category, difficulty, expectedDurationHours, baseKarmaPerHour, maxKarmaPerEvent' });
      return;
    }

    const validCategories = ['environment', 'food', 'health', 'education', 'community'];
    if (!validCategories.includes(category as string)) {
      res.status(400).json({ success: false, message: `Invalid category. Must be one of: ${validCategories.join(', ')}` });
      return;
    }

    const validDifficulties = ['easy', 'medium', 'hard'];
    if (!validDifficulties.includes(difficulty as string)) {
      res.status(400).json({ success: false, message: `Invalid difficulty. Must be one of: ${validDifficulties.join(', ')}` });
      return;
    }

    // Generate QR codes for this event
    const { generateEventQRCodes } = await import('../engines/verificationEngine.js');
    let qrCodes;
    try {
      qrCodes = await generateEventQRCodes(merchantEventId as string || new mongoose.Types.ObjectId().toString());
    } catch (err: unknown) {
      logger.error('[karmaRoutes] Failed to generate QR codes', {
        path: req.path,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      res.status(500).json({ success: false, message: 'Failed to generate QR codes' });
      return;
    }

    const { KarmaEvent } = await import('../models/index.js');
    const { randomUUID } = await import('crypto');

    const event = new KarmaEvent({
      merchantEventId: merchantEventId ? new mongoose.Types.ObjectId(merchantEventId as string) : new mongoose.Types.ObjectId(),
      ngoId: ngoId ? new mongoose.Types.ObjectId(ngoId as string) : new mongoose.Types.ObjectId(),
      category: category as string,
      impactUnit: (impactUnit as string) || 'volunteer_hours',
      impactMultiplier: typeof impactMultiplier === 'number' ? impactMultiplier : 1.0,
      difficulty: difficulty as string,
      expectedDurationHours: Number(expectedDurationHours),
      baseKarmaPerHour: Number(baseKarmaPerHour),
      maxKarmaPerEvent: Number(maxKarmaPerEvent),
      qrCodes,
      gpsRadius: typeof gpsRadius === 'number' ? gpsRadius : 100,
      maxVolunteers: typeof maxVolunteers === 'number' ? maxVolunteers : 50,
      confirmedVolunteers: 0,
      status: 'draft',
    });

    await event.save();

    logger.info('[karmaRoutes] KarmaEvent created', { eventId: event._id, category, difficulty });

    res.status(201).json({
      success: true,
      event: {
        _id: (event._id as mongoose.Types.ObjectId).toString(),
        merchantEventId: (event.merchantEventId as mongoose.Types.ObjectId).toString(),
        ngoId: (event.ngoId as mongoose.Types.ObjectId).toString(),
        category: event.category,
        impactUnit: event.impactUnit,
        difficulty: event.difficulty,
        expectedDurationHours: event.expectedDurationHours,
        baseKarmaPerHour: event.baseKarmaPerHour,
        maxKarmaPerEvent: event.maxKarmaPerEvent,
        qrCodes: event.qrCodes,
        gpsRadius: event.gpsRadius,
        maxVolunteers: event.maxVolunteers,
        confirmedVolunteers: 0,
        status: event.status,
      },
    });
  } catch (err) {
    logger.error('[karmaRoutes] POST /admin/event error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to create event' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/karma/admin/event/:eventId/publish — NGO publishes a draft event
// ---------------------------------------------------------------------------

router.patch('/admin/event/:eventId/publish', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid eventId format' });
      return;
    }

    const { KarmaEvent } = await import('../models/index.js');
    const event = await KarmaEvent.findById(eventId).lean() as Record<string, unknown> | null;

    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    if (event.status === 'published' || event.status === 'ongoing') {
      res.status(409).json({ success: false, message: 'Event is already published' });
      return;
    }

    if (event.status !== 'draft') {
      res.status(409).json({ success: false, message: `Cannot publish event with status: ${event.status}` });
      return;
    }

    // Validate required fields are present before publishing
    const missingFields: string[] = [];
    if (!event.category) missingFields.push('category');
    if (!event.difficulty) missingFields.push('difficulty');
    if (!event.expectedDurationHours) missingFields.push('expectedDurationHours');
    if (!event.baseKarmaPerHour) missingFields.push('baseKarmaPerHour');
    if (!event.maxKarmaPerEvent) missingFields.push('maxKarmaPerEvent');

    if (missingFields.length > 0) {
      res.status(400).json({
        success: false,
        message: `Cannot publish: missing required fields: ${missingFields.join(', ')}`,
      });
      return;
    }

    const updated = await KarmaEvent.findByIdAndUpdate(
      eventId,
      { $set: { status: 'published' } },
      { new: true },
    ).lean() as Record<string, unknown> | null;

    logger.info('[karmaRoutes] KarmaEvent published', { eventId, category: event.category });

    res.json({
      success: true,
      message: 'Event published successfully',
      event: {
        _id: (updated?._id as mongoose.Types.ObjectId)?.toString(),
        merchantEventId: (updated?.merchantEventId as mongoose.Types.ObjectId)?.toString(),
        category: updated?.category,
        difficulty: updated?.difficulty,
        status: updated?.status,
        maxVolunteers: updated?.maxVolunteers,
        confirmedVolunteers: updated?.confirmedVolunteers,
      },
    });
  } catch (err) {
    logger.error('[karmaRoutes] PATCH /admin/event/:eventId/publish error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to publish event' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/karma/booking/:bookingId/approve — NGO approves a booking
// ---------------------------------------------------------------------------

router.patch('/booking/:bookingId/approve', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { bookingId } = req.params;
    const { approved } = req.body as { approved?: boolean };

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      res.status(400).json({ success: false, message: 'Invalid bookingId' });
      return;
    }

    const { EventBookingModel } = await import('../engines/verificationEngine.js');
    const booking = await EventBookingModel.findById(bookingId).lean() as Record<string, unknown> | null;
    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    await EventBookingModel.findByIdAndUpdate(bookingId, {
      $set: {
        ngoApproved: approved !== false,
        ngoApprovedAt: approved !== false ? new Date() : undefined,
      },
    });

    logger.info('[karmaRoutes] Booking approval updated', { bookingId, approved: approved !== false });

    res.json({ success: true, message: approved !== false ? 'Booking approved' : 'Approval revoked' });
  } catch (err) {
    logger.error('[karmaRoutes] PATCH /booking/approve error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to update booking approval' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/leaderboard — Get leaderboard entries
// ---------------------------------------------------------------------------

router.get('/leaderboard', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';

    // Parse and validate query parameters
    const scope = (req.query.scope as LeaderboardScope) ?? 'global';
    const period = (req.query.period as LeaderboardPeriod) ?? 'all-time';

    // Validate scope
    const validScopes: LeaderboardScope[] = ['global', 'city', 'cause'];
    if (!validScopes.includes(scope)) {
      res.status(400).json({
        success: false,
        message: `Invalid scope. Must be one of: ${validScopes.join(', ')}`,
      });
      return;
    }

    // Validate period
    const validPeriods: LeaderboardPeriod[] = ['all-time', 'monthly', 'weekly'];
    if (!validPeriods.includes(period)) {
      res.status(400).json({
        success: false,
        message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`,
      });
      return;
    }

    // Parse limit with bounds
    const rawLimit = parseInt(String(req.query.limit ?? '50'), 10);
    const limit = isNaN(rawLimit) ? 50 : Math.min(Math.max(1, rawLimit), 100);

    // Parse offset
    const rawOffset = parseInt(String(req.query.offset ?? '0'), 10);
    const offset = isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);

    const result = await getLeaderboard(scope, period, limit, offset, userId);
    res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    logger.error('[karmaRoutes] GET /leaderboard error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch leaderboard' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/leaderboard/me — Get current user's rank
// ---------------------------------------------------------------------------

router.get('/leaderboard/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';

    // Parse and validate query parameters
    const scope = (req.query.scope as LeaderboardScope) ?? 'global';
    const period = (req.query.period as LeaderboardPeriod) ?? 'all-time';

    // Validate scope
    const validScopes: LeaderboardScope[] = ['global', 'city', 'cause'];
    if (!validScopes.includes(scope)) {
      res.status(400).json({
        success: false,
        message: `Invalid scope. Must be one of: ${validScopes.join(', ')}`,
      });
      return;
    }

    // Validate period
    const validPeriods: LeaderboardPeriod[] = ['all-time', 'monthly', 'weekly'];
    if (!validPeriods.includes(period)) {
      res.status(400).json({
        success: false,
        message: `Invalid period. Must be one of: ${validPeriods.join(', ')}`,
      });
      return;
    }

    const [rank, totalParticipants] = await Promise.all([
      getUserRank(userId, scope, period),
      getTotalParticipants(scope, period),
    ]);

    res.json({
      success: true,
      rank,
      totalParticipants,
      scope,
      period,
    });
  } catch (err) {
    logger.error('[karmaRoutes] GET /leaderboard/me error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch user rank' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/communities — List all communities
// ---------------------------------------------------------------------------

router.get('/communities', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const communities = await getAllCommunities(userId);
    res.json({ communities });
  } catch (err) {
    logger.error('[karmaRoutes] GET /communities error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch communities' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/communities/:slug — Get community detail + recent posts
// ---------------------------------------------------------------------------

router.get('/communities/:slug', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.userId ?? '';
    const community = await getCommunity(slug, userId);
    if (!community) {
      res.status(404).json({ success: false, message: 'Community not found' });
      return;
    }
    res.json(community);
  } catch (err) {
    logger.error('[karmaRoutes] GET /communities/:slug error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch community' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/communities/:slug/follow — Follow a community
// ---------------------------------------------------------------------------

router.post('/communities/:slug/follow', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.userId ?? '';
    await followCommunity(userId, slug);
    res.json({ success: true });
  } catch (err) {
    logger.error('[karmaRoutes] POST /communities/:slug/follow error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage === 'Community not found') {
      res.status(404).json({ success: false, message: 'Community not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/karma/communities/:slug/follow — Unfollow a community
// ---------------------------------------------------------------------------

router.delete('/communities/:slug/follow', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const userId = req.userId ?? '';
    await unfollowCommunity(userId, slug);
    res.json({ success: true });
  } catch (err) {
    logger.error('[karmaRoutes] DELETE /communities/:slug/follow error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage === 'Community not found') {
      res.status(404).json({ success: false, message: 'Community not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/communities/:slug/feed — Get community feed (paginated posts)
// ---------------------------------------------------------------------------

router.get('/communities/:slug/feed', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const page = parseInt(String(req.query.page ?? '1'), 10);
    const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 50);
    const feed = await getCommunityFeed(slug, page, limit);
    res.json({ posts: feed, page, limit });
  } catch (err) {
    logger.error('[karmaRoutes] GET /communities/:slug/feed error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch community feed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/communities/:slug/posts — Create a post in a community
// ---------------------------------------------------------------------------

router.post('/communities/:slug/posts', requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { content, mediaUrls } = req.body as { content?: string; mediaUrls?: string[] };
    if (!content || content.trim().length === 0) {
      res.status(400).json({ success: false, message: 'content is required' });
      return;
    }
    const userId = req.userId ?? '';
    const post = await createPost(slug, userId, 'volunteer', content, mediaUrls);
    res.status(201).json(post);
  } catch (err) {
    logger.error('[karmaRoutes] POST /communities/:slug/posts error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage === 'Community not found') {
      res.status(404).json({ success: false, message: 'Community not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/communities/recommended — Get recommended communities for user
// ---------------------------------------------------------------------------

router.get('/communities/recommended', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const communities = await getRecommendedCommunities(userId);
    res.json({ communities });
  } catch (err) {
    logger.error('[karmaRoutes] GET /communities/recommended error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch recommended communities' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/communities/my — Get communities the user follows
// ---------------------------------------------------------------------------

router.get('/communities/my', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const communities = await getUserCommunities(userId);
    res.json({ communities });
  } catch (err) {
    logger.error('[karmaRoutes] GET /communities/my error', { error: err });
    res.status(500).json({ error: 'Failed to fetch user communities' });
  }
});

// ============================================================================
// CSR Cloud Routes — Corporate Social Responsibility Dashboard
// ============================================================================

// ---------------------------------------------------------------------------
// GET /api/karma/csr/dashboard — get corporate partner dashboard (admin only)
// ---------------------------------------------------------------------------

router.get('/csr/dashboard', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { partnerId } = req.query;
    if (!partnerId || typeof partnerId !== 'string') {
      res.status(400).json({ success: false, message: 'partnerId required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ success: false, message: 'Invalid partnerId format' });
      return;
    }

    const dashboard = await getCorporateDashboard(partnerId);
    res.json(dashboard);
  } catch (err) {
    logger.error('[karmaRoutes] GET /csr/dashboard error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('not found')) {
      res.status(404).json({ success: false, message: 'Dashboard not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/csr/allocate — allocate karma credits to employee
// ---------------------------------------------------------------------------

router.post('/csr/allocate', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { partnerId, recipientUserId, amount, eventId } = req.body as {
      partnerId?: string;
      recipientUserId?: string;
      amount?: number;
      eventId?: string;
    };

    if (!partnerId || !recipientUserId || amount === undefined) {
      res.status(400).json({ success: false, message: 'Missing required fields: partnerId, recipientUserId, amount' });
      return;
    }

    if (typeof amount !== 'number' || amount <= 0) {
      res.status(400).json({ success: false, message: 'amount must be a positive number' });
      return;
    }

    await allocateKarmaCredits(partnerId, recipientUserId, amount, eventId);
    res.json({ success: true });
  } catch (err) {
    logger.error('[karmaRoutes] POST /csr/allocate error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('not found') || errorMessage.includes('Invalid')) {
      res.status(400).json({ success: false, message: 'Invalid request parameters' });
      return;
    }
    if (errorMessage.includes('Insufficient')) {
      res.status(400).json({ success: false, message: 'Insufficient karma credits' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/csr/partner — create a corporate partner (admin)
// ---------------------------------------------------------------------------

router.post('/csr/partner', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { companyName, logoUrl, contactEmail, tier, creditsBudget } = req.body as {
      companyName?: string;
      logoUrl?: string;
      contactEmail?: string;
      tier?: string;
      creditsBudget?: number;
    };

    if (!companyName || !tier || creditsBudget === undefined) {
      res.status(400).json({ success: false, message: 'Missing required fields: companyName, tier, creditsBudget' });
      return;
    }

    const validTiers = ['bronze', 'silver', 'gold', 'platinum'];
    if (!validTiers.includes(tier)) {
      res.status(400).json({ success: false, message: `Invalid tier. Must be one of: ${validTiers.join(', ')}` });
      return;
    }

    if (typeof creditsBudget !== 'number' || creditsBudget < 0) {
      res.status(400).json({ success: false, message: 'creditsBudget must be a non-negative number' });
      return;
    }

    const slug = companyName
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');

    const partner = await CorporatePartner.create({
      companyName,
      companySlug: slug,
      logoUrl: logoUrl || '',
      contactEmail: contactEmail || '',
      tier,
      creditsBudget,
      creditsUsed: 0,
    });

    logger.info('[karmaRoutes] CorporatePartner created', { partnerId: partner._id, companyName });

    res.status(201).json({ success: true, partner });
  } catch (err) {
    logger.error('[karmaRoutes] POST /csr/partner error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('duplicate') || errorMessage.includes('E11000')) {
      res.status(409).json({ success: false, message: 'A partner with this company name already exists' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/csr/partners — list all corporate partners
// ---------------------------------------------------------------------------

router.get('/csr/partners', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const partners = await CorporatePartner.find()
      .sort({ createdAt: -1 })
      .lean();
    res.json({ partners });
  } catch (err) {
    logger.error('[karmaRoutes] GET /csr/partners error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch partners' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/csr/report/:partnerId?year=2026&quarter=1 — generate CSR report
// ---------------------------------------------------------------------------

router.get('/csr/report/:partnerId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { partnerId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId)) {
      res.status(400).json({ success: false, message: 'Invalid partnerId format' });
      return;
    }

    const year = parseInt(String(req.query.year ?? new Date().getFullYear()), 10);
    const quarter = parseInt(String(req.query.quarter ?? String(Math.ceil((new Date().getMonth() + 1) / 3))), 10);

    if (isNaN(year) || year < 2000 || year > 2100) {
      res.status(400).json({ success: false, message: 'Invalid year' });
      return;
    }

    if (isNaN(quarter) || quarter < 1 || quarter > 4) {
      res.status(400).json({ success: false, message: 'Invalid quarter. Must be 1-4' });
      return;
    }

    const report = await generateCsrReport(partnerId, year, quarter);
    res.json(report);
  } catch (err) {
    logger.error('[karmaRoutes] GET /csr/report error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('not found')) {
      res.status(404).json({ success: false, message: 'Report not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/csr/partner/:partnerId/employee — add employee to program
// ---------------------------------------------------------------------------

router.post('/csr/partner/:partnerId/employee', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { partnerId } = req.params;
    const { employeeUserId } = req.body as { employeeUserId?: string };

    if (!partnerId || !employeeUserId) {
      res.status(400).json({ success: false, message: 'Missing required fields: partnerId, employeeUserId' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(partnerId) || !mongoose.Types.ObjectId.isValid(employeeUserId)) {
      res.status(400).json({ success: false, message: 'Invalid ID format' });
      return;
    }

    await addEmployeeToProgram(partnerId, employeeUserId);
    res.json({ success: true });
  } catch (err) {
    logger.error('[karmaRoutes] POST /csr/partner/employee error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('not found')) {
      res.status(404).json({ success: false, message: 'Employee or partner not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/csr/partner/:partnerId/employee/:employeeUserId — get employee stats
// ---------------------------------------------------------------------------

router.get('/csr/partner/:partnerId/employee/:employeeUserId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { partnerId, employeeUserId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(partnerId) || !mongoose.Types.ObjectId.isValid(employeeUserId)) {
      res.status(400).json({ success: false, message: 'Invalid ID format' });
      return;
    }

    const stats = await getEmployeeStats(partnerId, employeeUserId);
    res.json(stats);
  } catch (err) {
    logger.error('[karmaRoutes] GET /csr/partner/employee/stats error', {
      path: req.path,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    const errorMessage = err instanceof Error ? err.message : '';
    if (errorMessage.includes('not found')) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }
    res.status(500).json({ success: false, message: 'An internal error occurred' });
  }
});

// ---------------------------------------------------------------------------
// Micro-Actions Routes — Daily engagement tasks
// ---------------------------------------------------------------------------

import {
  getUserActionStatus,
  completeAction,
  getTodayEarnings,
  MICRO_ACTIONS_REGISTRY,
} from '../services/microActionService.js';

/**
 * GET /api/karma/micro-actions
 * Returns all micro-actions with their completion status for today.
 */
router.get('/micro-actions', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    // Get all actions with completion status
    const actionStatus = await getUserActionStatus(userId);
    const completed = actionStatus.filter((s) => s.completed);
    const available = actionStatus.filter((s) => !s.completed);

    // Calculate total karma earned today
    const earnedToday = completed.reduce((sum, a) => sum + (a.earnedKarma ?? 0), 0);

    res.json({
      success: true,
      available: available.map((s) => ({
        actionKey: s.action.actionKey,
        name: s.action.name,
        description: s.action.description,
        karmaBonus: s.action.karmaBonus,
        icon: s.action.icon,
      })),
      completed: completed.map((s) => ({
        actionKey: s.action.actionKey,
        name: s.action.name,
        completedAt: s.completedAt,
        karmaEarned: s.earnedKarma,
      })),
      earnedToday,
      totalActions: MICRO_ACTIONS_REGISTRY.length,
      dailyComplete: available.length === 0,
    });
  } catch (err) {
    logger.error('[karmaRoutes] GET /micro-actions error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/karma/micro-actions/:actionKey/claim
 * Claim a micro-action and receive karma bonus.
 */
router.post('/micro-actions/:actionKey/claim', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const { actionKey } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    // Validate actionKey exists
    const validKeys = MICRO_ACTIONS_REGISTRY.map((a) => a.actionKey);
    if (!validKeys.includes(actionKey)) {
      res.status(400).json({ success: false, message: `Invalid actionKey. Valid keys: ${validKeys.join(', ')}` });
      return;
    }

    const result = await completeAction(userId, actionKey);

    if (!result.earned) {
      res.status(409).json({ success: false, message: 'Already claimed today' });
      return;
    }

    // Get updated total earned today
    const totalEarnedToday = await getTodayEarnings(userId);

    res.json({
      success: true,
      actionKey,
      karmaEarned: result.karma,
      totalEarnedToday,
    });
  } catch (err) {
    logger.error('[karmaRoutes] POST /micro-actions/claim error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/karma/micro-actions/:actionKey/trigger
 * Trigger a micro-action completion (called by other services/events).
 * Internal endpoint - can be called by other services.
 */
router.post('/micro-actions/:actionKey/trigger', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.userId ?? '';
    const { actionKey } = req.params;
    const { trigger } = req.body as { trigger?: string };

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId' });
      return;
    }

    const { evaluateMicroActions } = await import('../engines/microActionEngine.js');
    const validTriggers = ['app_open', 'profile_update', 'referral_credited', 'event_completed', 'share_click'];

    if (trigger && !validTriggers.includes(trigger)) {
      res.status(400).json({ success: false, message: `Invalid trigger. Valid triggers: ${validTriggers.join(', ')}` });
      return;
    }

    const result = await evaluateMicroActions(userId, (trigger ?? 'app_open') as import('../engines/microActionEngine.js').MicroActionTrigger);

    res.json({
      success: true,
      triggered: result.newActions.length > 0,
      newActions: result.newActions,
      bonusKarma: result.bonusKarma,
    });
  } catch (err) {
    logger.error('[karmaRoutes] POST /micro-actions/trigger error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
