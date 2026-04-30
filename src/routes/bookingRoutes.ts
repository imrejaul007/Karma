// -nocheck
// @ts-ignore
/**
 * Booking Routes — User's event bookings
 *
 * GET /api/karma/booking/:eventId — user's booking for a specific event (enriched with event data)
 *
 * NOTE: /my-events was removed (duplicate of /my-bookings in eventRoutes.ts)
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { KarmaEvent } from '../models/index.js';
import { EventBookingModel } from '../engines/verificationEngine.js';
import { merchantServiceUrl } from '../config/index.js';
import { logger } from '../config/logger.js';

const router = Router();

// Plain object types for lean() results
type PlainBooking = {
  _id: mongoose.Types.ObjectId;
  eventId: string | mongoose.Types.ObjectId;
  status: string;
  bookingReference?: string;
  qrCheckedIn: boolean;
  qrCheckedInAt?: Date;
  qrCheckedOut: boolean;
  qrCheckedOutAt?: Date;
  gpsCheckIn?: Record<string, unknown>;
  gpsCheckOut?: Record<string, unknown>;
  ngoApproved: boolean;
  confidenceScore: number;
  verificationStatus: string;
  karmaEarned: number;
  earnedAt?: Date;
  createdAt: Date;
};

type PlainKarmaEvent = {
  _id: mongoose.Types.ObjectId;
  merchantEventId: mongoose.Types.ObjectId;
  category: string;
  status: string;
  difficulty: string;
  baseKarmaPerHour: number;
  maxKarmaPerEvent: number;
  maxVolunteers: number;
  confirmedVolunteers: number;
  expectedDurationHours: number;
  qrCodes?: { checkIn: string; checkOut: string };
};

// ---------------------------------------------------------------------------
// GET /api/karma/booking/:eventId
// ---------------------------------------------------------------------------

router.get('/booking/:eventId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { eventId } = req.params;

    const booking = await EventBookingModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      eventId,
      status: { $in: ['pending', 'confirmed', 'checked_in', 'completed'] },
    }).lean() as unknown as (PlainBooking & Record<string, unknown>) | null;

    if (!booking) {
      res.json({ success: true, booking: null, message: 'No booking found for this event' });
      return;
    }

    const karmaEvent = await KarmaEvent.findOne({
      $or: [{ _id: eventId }, { merchantEventId: eventId }],
    }).lean() as unknown as (PlainKarmaEvent & Record<string, unknown>) | null;

    let merchantEventData: Record<string, unknown> = {};
    if (merchantServiceUrl) {
      try {
        const { default: axios } = await import('axios');
        const response = await axios.get<Record<string, unknown>>(
          `${merchantServiceUrl}/api/events/${eventId}`,
          { timeout: 3000 },
        );
        merchantEventData = response.data ?? {};
      } catch {
        // Merchant service unavailable
      }
    }

    res.json({
      success: true,
      booking: {
        _id: booking._id.toString(),
        eventId: booking.eventId.toString(),
        bookingReference: booking.bookingReference,
        status: booking.status,
        qrCheckedIn: booking.qrCheckedIn,
        qrCheckedInAt: booking.qrCheckedInAt,
        qrCheckedOut: booking.qrCheckedOut,
        qrCheckedOutAt: booking.qrCheckedOutAt,
        gpsCheckIn: booking.gpsCheckIn,
        gpsCheckOut: booking.gpsCheckOut,
        ngoApproved: booking.ngoApproved,
        confidenceScore: booking.confidenceScore,
        verificationStatus: booking.verificationStatus,
        karmaEarned: booking.karmaEarned,
        earnedAt: booking.earnedAt,
        createdAt: booking.createdAt,
        eventName: merchantEventData.name ?? karmaEvent?.category ?? 'Event',
        difficulty: karmaEvent?.difficulty,
        baseKarmaPerHour: karmaEvent?.baseKarmaPerHour,
        maxKarmaPerEvent: karmaEvent?.maxKarmaPerEvent,
        qrCodes: karmaEvent?.qrCodes,
      },
    });
  } catch (err) {
    logger.error('[bookingRoutes] GET /booking/:eventId error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch booking' });
  }
});

export default router;
