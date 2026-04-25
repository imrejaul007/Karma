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
import { nextLevelThreshold, karmaToNextLevel, getConversionRate } from '../engines/karmaEngine.js';
import type { Level } from '../types/index.js';
import { KarmaProfile } from '../models/index.js';
import { logger } from '../config/logger.js';

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
      let { userId } = req.params;
      if (userId === 'me') userId = req.userId ?? '';
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
      let { userId } = req.params;
      if (userId === 'me') userId = req.userId ?? '';
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
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'Invalid userId' });
      return;
    }
    const profile = await KarmaProfile.findOne({ userId: new mongoose.Types.ObjectId(userId) }).lean();
    res.json({ success: true, badges: profile?.badges ?? [] });
  } catch (err) {
    logger.error('GET /badges error', { error: err });
    res.status(500).json({ error: 'Internal server error' });
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
      res.status(400).json({ error: 'Invalid userId' });
      return;
    }

    const userName = String(req.query.name ?? req.query.userName ?? 'ReZ Volunteer');
    const sanitizedName = userName.replace(/[^\w\s'-]/g, '').trim();
    if (!sanitizedName) {
      res.status(400).json({ error: 'userName is required' });
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
    res.status(500).json({ error: 'Failed to generate report' });
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
      const msg = err instanceof Error ? err.message : 'Unknown error';
      logger.error('[karmaRoutes] Failed to generate QR codes', { error: msg });
      res.status(500).json({ success: false, message: 'Failed to generate QR codes: ' + msg });
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

export default router;
