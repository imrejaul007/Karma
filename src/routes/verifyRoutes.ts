/**
 * Verify Routes — Phase 3: Karma by ReZ
 *
 * Express router for verification endpoints:
 *   POST /api/karma/verify/checkin
 *   POST /api/karma/verify/checkout
 *   GET  /api/karma/verify/status/:bookingId
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  processCheckIn,
  processCheckOut,
  detectFraudAnomalies,
  EventBookingModel,
} from '../engines/verificationEngine';
import { getEarnRecord } from '../services/earnRecordService';
import { requireAuth } from '../middleware/auth';
import { logger } from '../config/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Request Validation
// ---------------------------------------------------------------------------

interface CheckInInput {
  userId: string;
  eventId: string;
  mode: 'qr' | 'gps';
  qrCode?: string;
  gpsCoords?: { lat: number; lng: number };
}

interface CheckOutInput {
  userId: string;
  eventId: string;
  mode: 'qr' | 'gps';
  qrCode?: string;
  gpsCoords?: { lat: number; lng: number };
}

function isValidCheckIn(body: unknown): { valid: true; data: CheckInInput } | { valid: false; message: string } {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required' };
  const b = body as Record<string, unknown>;

  if (typeof b.userId !== 'string' || b.userId.length === 0) {
    return { valid: false, message: 'userId is required' };
  }
  if (typeof b.eventId !== 'string' || b.eventId.length === 0) {
    return { valid: false, message: 'eventId is required' };
  }
  if (b.mode !== 'qr' && b.mode !== 'gps') {
    return { valid: false, message: 'mode must be "qr" or "gps"' };
  }
  if (b.mode === 'qr' && (typeof b.qrCode !== 'string' || b.qrCode.length === 0)) {
    return { valid: false, message: 'qrCode is required when mode is qr' };
  }
  if (b.gpsCoords !== undefined) {
    if (typeof b.gpsCoords !== 'object' || b.gpsCoords === null) {
      return { valid: false, message: 'gpsCoords must be an object with lat and lng' };
    }
    const gps = b.gpsCoords as Record<string, unknown>;
    if (typeof gps.lat !== 'number' || typeof gps.lng !== 'number') {
      return { valid: false, message: 'gpsCoords.lat and gpsCoords.lng must be numbers' };
    }
    if (gps.lat < -90 || gps.lat > 90) {
      return { valid: false, message: 'gpsCoords.lat must be between -90 and 90' };
    }
    if (gps.lng < -180 || gps.lng > 180) {
      return { valid: false, message: 'gpsCoords.lng must be between -180 and 180' };
    }
  }

  return {
    valid: true,
    data: {
      userId: b.userId as string,
      eventId: b.eventId as string,
      mode: b.mode as 'qr' | 'gps',
      qrCode: b.qrCode as string | undefined,
      gpsCoords: b.gpsCoords as { lat: number; lng: number } | undefined,
    },
  };
}

function isValidCheckOut(body: unknown): { valid: true; data: CheckOutInput } | { valid: false; message: string } {
  return isValidCheckIn(body) as { valid: true; data: CheckOutInput } | { valid: false; message: string };
}

// ---------------------------------------------------------------------------
// POST /api/karma/verify/checkin
// ---------------------------------------------------------------------------

router.post('/checkin', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = isValidCheckIn(req.body);
    if (!parseResult.valid) {
      res.status(400).json({ success: false, message: parseResult.message });
      return;
    }

    const { userId, eventId, mode, qrCode, gpsCoords } = parseResult.data;

    if (req.userId && req.userId !== userId && req.userRole !== 'admin' && req.userRole !== 'superadmin') {
      res.status(403).json({ success: false, message: 'Cannot check in on behalf of another user' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId format' });
      return;
    }
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid eventId format' });
      return;
    }

    const result = await processCheckIn(userId, eventId, mode, qrCode, gpsCoords);

    if (!result.success) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }

    res.json({
      success: true,
      booking: result.booking,
      confidenceScore: result.confidenceScore,
      status: result.status,
    });
  } catch (err) {
    logger.error('[VerifyRoutes] Check-in error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/verify/checkout
// ---------------------------------------------------------------------------

router.post('/checkout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = isValidCheckOut(req.body);
    if (!parseResult.valid) {
      res.status(400).json({ success: false, message: parseResult.message });
      return;
    }

    const { userId, eventId, mode, qrCode, gpsCoords } = parseResult.data;

    if (req.userId && req.userId !== userId && req.userRole !== 'admin' && req.userRole !== 'superadmin') {
      res.status(403).json({ success: false, message: 'Cannot check out on behalf of another user' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      res.status(400).json({ success: false, message: 'Invalid userId format' });
      return;
    }
    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid eventId format' });
      return;
    }

    const result = await processCheckOut(userId, eventId, mode, qrCode, gpsCoords);

    if (!result.success) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }

    res.json({
      success: true,
      booking: result.booking,
      confidenceScore: result.confidenceScore,
      status: result.status,
      earnRecord: result.earnRecord,
    });
  } catch (err) {
    logger.error('[VerifyRoutes] Check-out error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/verify/status/:bookingId
// ---------------------------------------------------------------------------

router.get('/status/:bookingId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { bookingId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      res.status(400).json({ success: false, message: 'Invalid bookingId format' });
      return;
    }

    const booking = await EventBookingModel.findById(bookingId).lean();

    if (!booking) {
      res.status(404).json({ success: false, message: 'Booking not found' });
      return;
    }

    const raw = booking as Record<string, unknown>;
    // G-KS-C8 FIX: raw.userId is an ObjectId from MongoDB — convert to string before comparison.
    const bookingUserIdStr = String(raw.userId ?? '');
    if (
      req.userId &&
      req.userId !== bookingUserIdStr &&
      req.userRole !== 'admin' &&
      req.userRole !== 'superadmin'
    ) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const anomalies = await detectFraudAnomalies(bookingId);

    let earnRecord = null;
    if (raw._id) {
      earnRecord = await getEarnRecord((raw._id as mongoose.Types.ObjectId).toString());
    }

    res.json({
      success: true,
      booking: {
        id: (booking._id as mongoose.Types.ObjectId).toString(),
        userId: raw.userId,
        eventId: raw.eventId,
        qrCheckedIn: raw.qrCheckedIn,
        qrCheckedInAt: raw.qrCheckedInAt,
        qrCheckedOut: raw.qrCheckedOut,
        qrCheckedOutAt: raw.qrCheckedOutAt,
        gpsCheckIn: raw.gpsCheckIn,
        gpsCheckOut: raw.gpsCheckOut,
        ngoApproved: raw.ngoApproved,
        ngoApprovedAt: raw.ngoApprovedAt,
        photoProofUrl: raw.photoProofUrl,
        confidenceScore: raw.confidenceScore,
        verificationStatus: raw.verificationStatus,
        karmaEarned: raw.karmaEarned,
        earnedAt: raw.earnedAt,
      },
      anomalies,
      earnRecord,
    });
  } catch (err) {
    logger.error('[VerifyRoutes] Status error', { error: err });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

export default router;
