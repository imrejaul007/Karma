/**
 * Event Routes — Karma event discovery and booking
 *
 * GET  /api/karma/events              — list nearby karma events (with filters)
 * GET  /api/karma/event/:eventId     — single event detail
 * POST /api/karma/event/join         — join an event
 * DELETE /api/karma/event/:eventId/leave — cancel booking
 * GET  /api/karma/my-bookings        — user's joined events (upcoming/past)
 * GET  /api/karma/booking/:eventId   — DEPRECATED: use bookingRoutes version (enriched with event data)
 */
import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { requireAuth } from '../middleware/auth.js';
import { KarmaEvent } from '../models/index.js';
import { EventBookingModel } from '../engines/verificationEngine.js';
import { merchantServiceUrl } from '../config/index.js';
import { logger } from '../config/logger.js';

const router = Router();

// Plain object type for lean() results
type PlainKarmaEvent = {
  _id: mongoose.Types.ObjectId;
  merchantEventId: mongoose.Types.ObjectId;
  category: string;
  status: string;
  impactUnit: string;
  impactMultiplier: number;
  difficulty: string;
  expectedDurationHours: number;
  baseKarmaPerHour: number;
  maxKarmaPerEvent: number;
  qrCodes: { checkIn: string; checkOut: string };
  gpsRadius: number;
  maxVolunteers: number;
  confirmedVolunteers: number;
  createdAt: Date;
};

function toKarmaEventResponse(doc: PlainKarmaEvent, isJoined?: boolean) {
  return {
    _id: doc._id.toString(),
    merchantEventId: doc.merchantEventId.toString(),
    category: doc.category,
    status: doc.status,
    impactUnit: doc.impactUnit,
    impactMultiplier: doc.impactMultiplier,
    difficulty: doc.difficulty,
    expectedDurationHours: doc.expectedDurationHours,
    baseKarmaPerHour: doc.baseKarmaPerHour,
    maxKarmaPerEvent: doc.maxKarmaPerEvent,
    qrCodes: doc.qrCodes,
    gpsRadius: doc.gpsRadius,
    maxVolunteers: doc.maxVolunteers,
    confirmedVolunteers: doc.confirmedVolunteers,
    verificationMode: doc.qrCodes?.checkIn ? 'qr' : 'gps',
    isJoined: isJoined ?? false,
    createdAt: doc.createdAt,
  };
}

async function enrichWithMerchantEvent(
  events: PlainKarmaEvent[],
  userId: string,
): Promise<Record<string, unknown>[]> {
  const merchantEventIds = events.map((e) => e.merchantEventId.toString());

  const bookings = await EventBookingModel.find({
    userId: new mongoose.Types.ObjectId(userId),
    eventId: { $in: merchantEventIds },
    status: { $in: ['pending', 'confirmed', 'checked_in'] },
  }).lean();
  const joinedEventIds = new Set<string>();
  for (const b of bookings) {
    joinedEventIds.add(b.eventId.toString());
  }

  if (!merchantServiceUrl) {
    return events.map((e) => ({
      ...toKarmaEventResponse(e, joinedEventIds.has(e._id.toString())),
      name: 'Event',
      description: '',
      organizer: { name: 'ReZ Partner' },
    }));
  }

  try {
    const { default: axios } = await import('axios');
    const response = await axios.get<{ events: Record<string, unknown>[] }>(
      `${merchantServiceUrl}/api/events/batch`,
      {
        params: { ids: merchantEventIds.join(',') },
        timeout: 3000,
      },
    );

    const merchantEventsMap = new Map<string, Record<string, unknown>>();
    for (const ev of response.data.events ?? []) {
      const id = (ev._id as string) || (ev.id as string);
      if (id) merchantEventsMap.set(id, ev);
    }

    return events.map((ke) => {
      const merchantEv = merchantEventsMap.get(ke.merchantEventId.toString()) ?? {};
      return {
        ...toKarmaEventResponse(ke, joinedEventIds.has(ke._id.toString())),
        _id: ke._id.toString(),
        merchantEventId: ke.merchantEventId.toString(),
        name: merchantEv.name ?? 'Event',
        description: merchantEv.description ?? '',
        image: merchantEv.image,
        date: merchantEv.date ?? merchantEv.startDate,
        time: merchantEv.time ?? merchantEv.startTime,
        location: merchantEv.location,
        organizer: merchantEv.organizer,
        impactUnit: ke.impactUnit,
        impactMultiplier: ke.impactMultiplier,
      };
    });
  } catch (err) {
    logger.warn('Failed to enrich events with merchant data — returning partial data', { error: err });
    return events.map((e) => ({
      ...toKarmaEventResponse(e, joinedEventIds.has(e._id.toString())),
      name: 'Event',
      description: '',
      organizer: { name: 'ReZ Partner' },
    }));
  }
}

// ---------------------------------------------------------------------------
// GET /api/karma/events
// ---------------------------------------------------------------------------

router.get('/events', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { category, status } = req.query;

    const filter: Record<string, unknown> = {};
    filter.status = { $in: ['published', 'ongoing'] };

    if (category && typeof category === 'string') {
      filter.category = category;
    }
    if (status && typeof status === 'string') {
      filter.status = { $in: status.split(',').map((s) => s.trim()) };
    }

    const events = await KarmaEvent.find(filter).limit(100).lean() as unknown as PlainKarmaEvent[];
    const enriched = await enrichWithMerchantEvent(events, req.userId ?? '');

    res.json({ success: true, events: enriched, total: enriched.length });
  } catch (err) {
    logger.error('[eventRoutes] GET /events error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch events' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/event/:eventId
// ---------------------------------------------------------------------------

router.get('/event/:eventId', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { eventId } = req.params;
    const userId = req.userId ?? '';

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid event ID format' });
      return;
    }

    const karmaEvent = await KarmaEvent.findOne({
      $or: [
        { _id: eventId },
        { merchantEventId: eventId },
      ],
    }).lean() as unknown as (PlainKarmaEvent & Record<string, unknown>) | null;

    if (!karmaEvent) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }

    const booking = await EventBookingModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      eventId,
      status: { $in: ['pending', 'confirmed', 'checked_in'] },
    }).lean();

    const isJoined = !!booking;

    let enriched: Record<string, unknown> = {
      ...toKarmaEventResponse(karmaEvent as unknown as PlainKarmaEvent, isJoined),
      name: 'Event',
      description: '',
      organizer: { name: 'ReZ Partner' },
    };

    try {
      const { default: axios } = await import('axios');
      const response = await axios.get<Record<string, unknown>>(
        `${merchantServiceUrl}/api/events/${eventId}`,
        { timeout: 3000 },
      );
      enriched = {
        ...enriched,
        ...response.data,
        _id: karmaEvent._id.toString(),
        isJoined,
        qrCodes: karmaEvent.qrCodes,
        capacity: {
          goal: karmaEvent.maxVolunteers,
          enrolled: karmaEvent.confirmedVolunteers,
        },
      };
    } catch {
      // Merchant service unavailable — return minimal data
    }

    res.json({ success: true, event: enriched });
  } catch (err) {
    logger.error('[eventRoutes] GET /event/:eventId error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch event' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/karma/event/join
// ---------------------------------------------------------------------------

router.post('/event/join', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { eventId } = req.body as { eventId?: string };

    if (!eventId || typeof eventId !== 'string') {
      res.status(400).json({ success: false, message: 'eventId is required' });
      return;
    }

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid eventId format' });
      return;
    }

    const karmaEvent = await KarmaEvent.findOne({
      $or: [{ _id: eventId }, { merchantEventId: eventId }],
      status: { $in: ['published', 'ongoing'] },
    }).lean() as unknown as (PlainKarmaEvent & { _id: mongoose.Types.ObjectId }) | null;

    if (!karmaEvent) {
      res.status(404).json({ success: false, message: 'Event not found or not joinable' });
      return;
    }

    if (
      karmaEvent.maxVolunteers > 0 &&
      karmaEvent.confirmedVolunteers >= karmaEvent.maxVolunteers
    ) {
      res.status(409).json({ success: false, message: 'Event is at full capacity' });
      return;
    }

    const existing = await EventBookingModel.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      eventId,
      status: { $in: ['pending', 'confirmed', 'checked_in'] },
    }).lean() as unknown as ({ _id: mongoose.Types.ObjectId } & Record<string, unknown>) | null;

    if (existing) {
      res.status(409).json({
        success: false,
        message: 'Already joined this event',
        bookingId: existing._id.toString(),
      });
      return;
    }

    const booking = await EventBookingModel.create({
      userId: new mongoose.Types.ObjectId(userId),
      eventId,
      status: 'confirmed',
      // PAY-KAR-002 FIX: Use cryptographically random UUID instead of timestamp + userId slice.
      // Date.now() is predictable and enumerable — attackers can iterate timestamps and
      // partial userIds to guess valid booking references. randomUUID() uses crypto RNG
      // (UUID v4) making references unguessable and collision-resistant.
      bookingReference: `BK-${randomUUID()}`,

      qrCheckedIn: false,
      qrCheckedOut: false,
      ngoApproved: false,
      confidenceScore: 0,
      verificationStatus: 'pending',
      karmaEarned: 0,
      qrCodes: karmaEvent.qrCodes,
    });

    await KarmaEvent.updateOne(
      { _id: karmaEvent._id },
      { $inc: { confirmedVolunteers: 1 } },
    );

    res.status(201).json({
      success: true,
      booking: {
        _id: (booking._id as mongoose.Types.ObjectId).toString(),
        eventId: booking.eventId,
        bookingReference: booking.bookingReference,
        status: booking.status,
        qrCheckedIn: booking.qrCheckedIn,
        qrCheckedOut: booking.qrCheckedOut,
        qrCodes: booking.qrCodes,
        ngoApproved: booking.ngoApproved,
        confidenceScore: booking.confidenceScore,
        verificationStatus: booking.verificationStatus,
        karmaEarned: booking.karmaEarned,
        createdAt: (booking as unknown as { createdAt: Date }).createdAt,
      },
    });
  } catch (err) {
    logger.error('[eventRoutes] POST /event/join error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to join event' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/karma/event/:eventId/leave
// ---------------------------------------------------------------------------

router.delete('/event/:eventId/leave', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { eventId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(eventId)) {
      res.status(400).json({ success: false, message: 'Invalid eventId format' });
      return;
    }

    const booking = await EventBookingModel.findOneAndUpdate(
      {
        userId: new mongoose.Types.ObjectId(userId),
        eventId,
        status: { $in: ['pending', 'confirmed'] },
      },
      { $set: { status: 'cancelled' } },
      { new: true },
    ).lean();

    if (!booking) {
      res.status(404).json({ success: false, message: 'No active booking found for this event' });
      return;
    }

    const event = await KarmaEvent.findOne({ $or: [{ _id: eventId }, { merchantEventId: eventId }] });
    if (!event) {
      res.status(404).json({ success: false, message: 'Event not found' });
      return;
    }
    if (event.confirmedVolunteers <= 0) {
      res.status(400).json({ success: false, message: 'No confirmed volunteers to remove' });
      return;
    }
    await KarmaEvent.updateOne(
      { _id: event._id },
      { $inc: { confirmedVolunteers: -1 } },
    );

    res.json({ success: true, message: 'Booking cancelled successfully' });
  } catch (err) {
    logger.error('[eventRoutes] DELETE /event/:eventId/leave error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to cancel booking' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/karma/my-bookings
// ---------------------------------------------------------------------------

router.get('/my-bookings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.userId ?? '';
    const { status } = req.query;

    const bookingFilter: Record<string, unknown> = {
      userId: new mongoose.Types.ObjectId(userId),
      status: { $nin: ['cancelled'] },
    };

    if (status === 'past') {
      bookingFilter.qrCheckedOut = true;
    } else if (status === 'upcoming' || status === 'ongoing') {
      bookingFilter.qrCheckedOut = { $ne: true };
    }

    const bookings = await EventBookingModel.find(bookingFilter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean() as unknown as (Record<string, unknown> & { _id: mongoose.Types.ObjectId; eventId: mongoose.Types.ObjectId })[];

    if (bookings.length === 0) {
      res.json({ success: true, bookings: [], total: 0 });
      return;
    }

    const eventIds = bookings.map((b) => b.eventId.toString());

    // Fetch karma events for category and karma info
    const karmaEvents = await KarmaEvent.find({
      $or: eventIds.flatMap((id) => [
        { _id: new mongoose.Types.ObjectId(id) } as Record<string, unknown>,
        { merchantEventId: new mongoose.Types.ObjectId(id) } as Record<string, unknown>,
      ]),
    }).lean() as unknown as (Record<string, unknown> & { _id: mongoose.Types.ObjectId; merchantEventId: mongoose.Types.ObjectId })[];

    const eventMap = new Map<string, Record<string, unknown>>();
    for (const ev of karmaEvents) {
      eventMap.set(ev._id.toString(), ev);
      eventMap.set(ev.merchantEventId.toString(), ev);
    }

    // Enrich with merchant event data if available
    if (merchantServiceUrl) {
      try {
        const { default: axios } = await import('axios');
        const response = await axios.get<{ events: Record<string, unknown>[] }>(
          `${merchantServiceUrl}/api/events/batch`,
          { params: { ids: eventIds.join(',') }, timeout: 3000 },
        );
        for (const ev of response.data.events ?? []) {
          const id = (ev._id as string) || (ev.id as string);
          const existing = eventMap.get(id);
          if (existing) {
            Object.assign(existing, ev);
          }
        }
      } catch { /* non-fatal */ }
    }

    const enriched = bookings.map((booking) => {
      const eventId = booking.eventId.toString();
      const karmaEv = eventMap.get(eventId) ?? {};
      const qrCheckedIn = booking.qrCheckedIn as boolean;
      const qrCheckedOut = booking.qrCheckedOut as boolean;
      let bookingStatus = 'confirmed';
      if (qrCheckedOut) bookingStatus = 'completed';
      else if (qrCheckedIn) bookingStatus = 'checked_in';

      return {
        _id: (booking._id as mongoose.Types.ObjectId).toString(),
        eventId,
        bookingReference: booking.bookingReference as string,
        status: bookingStatus,
        qrCheckedIn,
        qrCheckedInAt: booking.qrCheckedInAt,
        qrCheckedOut,
        qrCheckedOutAt: booking.qrCheckedOutAt,
        ngoApproved: booking.ngoApproved as boolean,
        confidenceScore: booking.confidenceScore as number,
        verificationStatus: booking.verificationStatus as string,
        karmaEarned: booking.karmaEarned as number,
        earnedAt: booking.earnedAt,
        createdAt: (booking as unknown as { createdAt: Date }).createdAt,
        event: {
          _id: eventId,
          name: karmaEv.name ?? 'Event',
          description: karmaEv.description ?? '',
          image: karmaEv.image,
          date: karmaEv.date ?? karmaEv.startDate,
          time: karmaEv.time ?? karmaEv.startTime,
          location: karmaEv.location,
          organizer: karmaEv.organizer,
          category: karmaEv.category,
          difficulty: karmaEv.difficulty,
          expectedDurationHours: karmaEv.expectedDurationHours,
          baseKarmaPerHour: karmaEv.baseKarmaPerHour,
          maxKarmaPerEvent: karmaEv.maxKarmaPerEvent,
          impactUnit: karmaEv.impactUnit,
          impactMultiplier: karmaEv.impactMultiplier,
          maxVolunteers: karmaEv.maxVolunteers,
          confirmedVolunteers: karmaEv.confirmedVolunteers,
          status: karmaEv.status,
        },
      };
    });

    res.json({ success: true, bookings: enriched, total: enriched.length });
  } catch (err) {
    logger.error('[eventRoutes] GET /my-bookings error', { error: err });
    res.status(500).json({ success: false, message: 'Failed to fetch bookings' });
  }
});

export default router;
