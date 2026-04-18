/**
 * Booking Routes — User's event bookings
 *
 * GET /api/karma/my-events   — user's joined events
 * GET /api/karma/booking/:eventId — user's active booking for a specific event
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { KarmaEvent } from '../models/index.js';
import { EventBookingModel } from '../engines/verificationEngine.js';
import { merchantServiceUrl } from '../config/index.js';
import { logger } from '../utils/logger.js';

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
// GET /api/karma/my-events
// ---------------------------------------------------------------------------

router.get('/my-events', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { status } = req.query;

    const statusIn: string[] =
      status === 'past' || status === 'completed'
        ? ['completed', 'cancelled']
        : status === 'upcoming'
          ? ['pending', 'confirmed']
          : status === 'ongoing'
            ? ['checked_in']
            : ['pending', 'confirmed', 'checked_in'];

    const bookings = await EventBookingModel.find({
      userId: new mongoose.Types.ObjectId(userId),
      status: { $in: statusIn },
    }).lean() as unknown as PlainBooking[];

    if (bookings.length === 0) {
      res.json({ success: true, events: [], total: 0 });
      return;
    }

    const eventIds = bookings.map((b) => b.eventId.toString());

    const validEventIds = eventIds.filter((id) => mongoose.Types.ObjectId.isValid(id));

    const karmaEvents = await KarmaEvent.find({
      $or: [
        { _id: { $in: validEventIds } },
        { merchantEventId: { $in: eventIds } },
      ],
    }).lean() as unknown as PlainKarmaEvent[];

    const karmaEventMap = new Map<string, PlainKarmaEvent>();
    for (const ke of karmaEvents) {
      karmaEventMap.set(ke._id.toString(), ke);
      karmaEventMap.set(ke.merchantEventId.toString(), ke);
    }

    let merchantEventsMap = new Map<string, Record<string, unknown>>();
    if (merchantServiceUrl) {
      try {
        const { default: axios } = await import('axios');
        const response = await axios.get<{ events: Record<string, unknown>[] }>(
          `${merchantServiceUrl}/api/events/batch`,
          { params: { ids: eventIds.join(',') }, timeout: 3000 },
        );
        for (const ev of response.data.events ?? []) {
          const id = (ev._id as string) || (ev.id as string);
          if (id) merchantEventsMap.set(id, ev);
        }
      } catch {
        // Merchant service unavailable — continue with minimal data
      }
    }

    const events = bookings.map((booking) => {
      const eventId = booking.eventId.toString();
      const karmaEv = karmaEventMap.get(eventId);
      const merchantEv = merchantEventsMap.get(eventId) as Record<string, unknown> | undefined;

      return {
        _id: eventId,
        bookingId: booking._id.toString(),
        status: booking.status,
        bookingReference: booking.bookingReference,
        qrCheckedIn: booking.qrCheckedIn,
        qrCheckedInAt: booking.qrCheckedInAt,
        qrCheckedOut: booking.qrCheckedOut,
        qrCheckedOutAt: booking.qrCheckedOutAt,
        ngoApproved: booking.ngoApproved,
        confidenceScore: booking.confidenceScore,
        verificationStatus: booking.verificationStatus,
        karmaEarned: booking.karmaEarned,
        earnedAt: booking.earnedAt,
        createdAt: booking.createdAt,
        name: merchantEv?.name ?? karmaEv?.category ?? 'Event',
        description: (merchantEv?.description as string) ?? '',
        category: karmaEv?.category ?? 'community',
        difficulty: karmaEv?.difficulty ?? 'medium',
        baseKarmaPerHour: karmaEv?.baseKarmaPerHour ?? 10,
        maxKarmaPerEvent: karmaEv?.maxKarmaPerEvent ?? 50,
        maxVolunteers: karmaEv?.maxVolunteers ?? 50,
        confirmedVolunteers: karmaEv?.confirmedVolunteers ?? 0,
        expectedDurationHours: karmaEv?.expectedDurationHours ?? 2,
        verificationMode: karmaEv?.qrCodes?.checkIn ? 'qr' : 'gps',
        image: merchantEv?.image as string | undefined,
        date: merchantEv?.date ?? merchantEv?.startDate,
        location: merchantEv?.location as Record<string, unknown> | undefined,
        organizer: merchantEv?.organizer as Record<string, unknown> | undefined,
      };
    });

    res.json({ success: true, events, total: events.length });
  } catch (err) {
    logger.error('[bookingRoutes] GET /my-events error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch your events' });
  }
});

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
