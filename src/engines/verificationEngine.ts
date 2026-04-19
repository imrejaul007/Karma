/**
 * Verification Engine — Phase 3: Karma by ReZ
 *
 * Implements multi-layer confidence scoring, QR validation, GPS proximity
 * checking, fraud anomaly detection, and the check-in/check-out flows.
 */
import crypto from 'crypto';
import moment from 'moment';
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import type { VerificationSignals } from '../types/index.js';

// ---------------------------------------------------------------------------
// Cross-service EventBooking model (read/write, owned by merchant service).
// strict:false is intentional — this is a cross-service proxy.
// ---------------------------------------------------------------------------
const EventBookingSchema = new mongoose.Schema({}, {
  strict: false,
  strictQuery: true,
  timestamps: true,
  collection: 'eventbookings',
});
EventBookingSchema.index({ eventId: 1, status: 1 });
EventBookingSchema.index({ userId: 1, eventId: 1 });

export const EventBookingModel = mongoose.models.EventBooking ||
  mongoose.model('EventBooking', EventBookingSchema);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// G-KS-C6 FIX: crypto.timingSafeEqual throws TypeError if buffers differ in
// length. Wrap it so callers get a safe boolean false instead.
function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export const SIGNAL_WEIGHTS: Readonly<Record<keyof VerificationSignals, number>> = {
  qr_in: 0.30,
  qr_out: 0.30,
  gps_match: 0.15,
  ngo_approved: 0.40,
  photo_proof: 0.10,
} as const;

export const APPROVAL_THRESHOLD = 0.60;
export const PARTIAL_THRESHOLD = 0.40;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'verified' | 'partial' | 'rejected';

export interface QRPayload {
  eventId: string;
  type: 'check_in' | 'check_out';
  ts: number;
  sig: string;
}

export interface FraudAlert {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
}

export interface CheckInResult {
  success: boolean;
  booking?: Record<string, unknown>;
  confidenceScore?: number;
  status?: ApprovalStatus;
  error?: string;
  signals?: VerificationSignals;
}

export interface CheckOutResult {
  success: boolean;
  booking?: Record<string, unknown>;
  confidenceScore?: number;
  status?: ApprovalStatus;
  earnRecord?: Record<string, unknown>;
  error?: string;
}

export interface GPSCoords {
  lat: number;
  lng: number;
}

// ---------------------------------------------------------------------------
// Signal & Scoring
// ---------------------------------------------------------------------------

/**
 * Calculate the confidence score from verification signals.
 * Each signal contributes its weight when present/true; gps_match is
 * multiplied by its weight (0-1 range).
 *
 * Formula:
 *   score = (qr_in * 0.30) + (qr_out * 0.30) + (gps_match * 0.15)
 *           + (ngo_approved * 0.40) + (photo_proof * 0.10)
 */
export function calculateConfidenceScore(signals: VerificationSignals): number {
  let score = 0;
  if (signals.qr_in) score += SIGNAL_WEIGHTS.qr_in;
  if (signals.qr_out) score += SIGNAL_WEIGHTS.qr_out;
  score += signals.gps_match * SIGNAL_WEIGHTS.gps_match;
  if (signals.ngo_approved) score += SIGNAL_WEIGHTS.ngo_approved;
  if (signals.photo_proof) score += SIGNAL_WEIGHTS.photo_proof;
  return Math.round(score * 100) / 100;
}

/**
 * Determine approval status from a confidence score.
 *
 * >= 0.60 → verified  : auto-approve, create EarnRecord
 * 0.40–0.59 → partial : flag for NGO review
 * < 0.40 → rejected   : notify user, no karma
 */
export function getApprovalStatus(score: number): ApprovalStatus {
  if (score >= APPROVAL_THRESHOLD) return 'verified';
  if (score >= PARTIAL_THRESHOLD) return 'partial';
  return 'rejected';
}

// ---------------------------------------------------------------------------
// QR Code Validation
// ---------------------------------------------------------------------------

/**
 * Decode a base64-encoded QR payload and verify its HMAC-SHA256 signature.
 *
 * The QR payload is generated as:
 *   base64(JSON.stringify({ eventId, type, ts, sig }))
 * where sig = hmac-sha256(`${eventId}:${type}:${ts}`, QR_SECRET)[:16]
 *
 * Validation checks:
 *   1. Valid JSON and required fields present
 *   2. Type matches expected ('check_in' or 'check_out')
 *   3. Event ID matches expected
 *   4. Timestamp not older than 5 minutes (replay protection)
 *   5. HMAC signature matches
 */
export async function validateQRCode(
  qrPayload: string,
  type: 'check_in' | 'check_out',
  eventId: string,
): Promise<{ valid: boolean; error?: string }> {
  try {
    // 1. Decode base64
    let decoded: QRPayload;
    try {
      const jsonStr = Buffer.from(qrPayload, 'base64').toString('utf-8');
      decoded = JSON.parse(jsonStr) as QRPayload;
    } catch {
      return { valid: false, error: 'Invalid QR code format' };
    }

    // 2. Required fields
    if (!decoded.eventId || !decoded.type || !decoded.ts || !decoded.sig) {
      return { valid: false, error: 'QR code missing required fields' };
    }

    // 3. Type match
    if (decoded.type !== type) {
      return { valid: false, error: `QR code type mismatch: expected ${type}, got ${decoded.type}` };
    }

    // 4. Event ID match
    if (decoded.eventId !== eventId) {
      return { valid: false, error: 'QR code does not belong to this event' };
    }

    // 5. Replay protection (5-minute window)
    const fiveMinutesMs = 5 * 60 * 1000;
    if (Math.abs(Date.now() - decoded.ts) > fiveMinutesMs) {
      return { valid: false, error: 'QR code has expired' };
    }

    // 6. HMAC signature verification
    // KARMA-P1 FIX: Fail closed — never use a default fallback secret.
    // If QR_SECRET is not configured, throw instead of using a guessable default.
    const secret = process.env.QR_SECRET;
    if (!secret) {
      logger.error('[VerificationEngine] QR_SECRET not configured — refusing to verify');
      return { valid: false, error: 'QR verification unavailable: server misconfigured' };
    }
    const expectedSig = crypto
      .createHmac('sha256', secret)
      .update(`${decoded.eventId}:${decoded.type}:${decoded.ts}`)
      .digest('hex')
      .slice(0, 16);

    if (!safeCompare(decoded.sig, expectedSig)) {
      return { valid: false, error: 'QR code signature verification failed' };
    }

    return { valid: true };
  } catch (err) {
    logger.error('[VerificationEngine] QR validation error', { error: err });
    return { valid: false, error: 'QR code validation failed' };
  }
}

// ---------------------------------------------------------------------------
// GPS Proximity (Haversine Formula)
// ---------------------------------------------------------------------------

/**
 * Calculate proximity score (0-1) between user and event locations.
 * Uses the Haversine formula to compute great-circle distance in meters.
 *
 * @param eventLat  Event latitude
 * @param eventLng  Event longitude
 * @param userLat   User latitude
 * @param userLng   User longitude
 * @param radiusMeters  Acceptance radius (defaults to 100m)
 * @returns Score from 0 (outside radius) to 1 (at event center)
 *
 * Haversine formula:
 *   a = sin²(dlat/2) + cos(lat1) * cos(lat2) * sin²(dlon/2)
 *   c = 2 * atan2(√a, √(1−a))
 *   d = R * c   (R = 6371km)
 */
export function checkGPSProximity(
  eventLat: number,
  eventLng: number,
  userLat: number,
  userLng: number,
  radiusMeters: number = 100,
): number {
  const EARTH_RADIUS_M = 6_371_000;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(userLat - eventLat);
  const dLng = toRad(userLng - eventLng);

  const lat1 = toRad(eventLat);
  const lat2 = toRad(userLat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distanceMeters = EARTH_RADIUS_M * c;

  if (distanceMeters <= radiusMeters) {
    // Linear falloff from 1.0 at center to ~0.9 at edge
    return Math.max(0.5, 1 - distanceMeters / radiusMeters);
  }

  // Outside radius: score drops rapidly
  const excess = distanceMeters - radiusMeters;
  const score = Math.max(0, 1 - excess / radiusMeters);
  return Math.round(score * 100) / 100;
}

// ---------------------------------------------------------------------------
// Check-In Flow
// ---------------------------------------------------------------------------

/**
 * Process a user check-in for an event.
 *
 * Modes:
 *   'qr' — Full QR + GPS validation
 *   'gps' — GPS-only validation (fallback when QR unavailable)
 *
 * For 'qr' mode: validates QR code and GPS proximity.
 * For 'gps' mode: only validates GPS proximity (partial score).
 *
 * Updates EventBooking with check-in fields and returns the result.
 */
export async function processCheckIn(
  userId: string,
  eventId: string,
  mode: 'qr' | 'gps',
  qrCode?: string,
  gpsCoords?: GPSCoords,
): Promise<CheckInResult> {
  try {
    // Find the user's booking for this event
    const booking = await EventBookingModel.findOne({ userId, eventId }).lean() as (Record<string, unknown> & { _id: mongoose.Types.ObjectId }) | null;
    if (!booking) {
      return { success: false, error: 'No booking found for this user and event' };
    }

    const bookingDoc = booking as Record<string, unknown>;
    if (bookingDoc.qrCheckedIn) {
      return { success: false, error: 'Already checked in' };
    }

    // Initialize signals from existing booking data
    const signals: VerificationSignals = {
      qr_in: false,
      qr_out: false,
      gps_match: 0,
      ngo_approved: Boolean(bookingDoc.ngoApproved),
      photo_proof: Boolean(bookingDoc.photoProofUrl),
    };

    if (mode === 'qr' && qrCode) {
      // Validate QR code
      const qrValidation = await validateQRCode(qrCode, 'check_in', eventId);
      if (!qrValidation.valid) {
        return { success: false, error: qrValidation.error };
      }
      signals.qr_in = true;
    }

    if (gpsCoords) {
      // BAK-KARMA-005 FIX: Fail closed — reject check-in if event GPS is missing.
      // Null coalescing to (0,0) silently bypasses proximity check since virtually
      // any land location is far from the Gulf of Guinea, producing gps_match=false
      // while still applying QR-in bonus (0.30 weight) without GPS verification.
      const eventLat = bookingDoc.eventLatitude as number | null;
      const eventLng = bookingDoc.eventLongitude as number | null;
      if (eventLat === null || eventLng === null) {
        return {
          success: false,
          error: 'Event GPS coordinates not configured — GPS verification required',
          signals,
        };
      }
      const gpsMatch = checkGPSProximity(
        eventLat,
        eventLng,
        gpsCoords.lat,
        gpsCoords.lng,
        bookingDoc.gpsRadius as number ?? 100,
      );
      signals.gps_match = gpsMatch;
    }

    const confidenceScore = calculateConfidenceScore(signals);
    const status = getApprovalStatus(confidenceScore);

    // Update the booking
    const updateFields: Record<string, unknown> = {
      qrCheckedIn: mode === 'qr',
      qrCheckedInAt: new Date(),
      gpsCheckIn: gpsCoords ? { lat: gpsCoords.lat, lng: gpsCoords.lng } : undefined,
      verificationStatus: status,
      confidenceScore,
    };

    const bookingId = booking._id as mongoose.Types.ObjectId;
    await EventBookingModel.findByIdAndUpdate(bookingId, updateFields);

    const updatedBooking = (await EventBookingModel.findById(bookingId).lean()) as Record<string, unknown> | null;

    logger.info('[VerificationEngine] Check-in processed', {
      userId,
      eventId,
      bookingId: booking._id,
      mode,
      confidenceScore,
      status,
    });

    return {
      success: true,
      booking: updatedBooking as Record<string, unknown>,
      confidenceScore,
      status,
    };
  } catch (err) {
    logger.error('[VerificationEngine] Check-in error', { userId, eventId, error: err });
    return { success: false, error: 'Failed to process check-in' };
  }
}

// ---------------------------------------------------------------------------
// Check-Out Flow
// ---------------------------------------------------------------------------

/**
 * Process a user check-out for an event.
 *
 * Completes the verification signal set, calculates confidence score,
 * and creates an EarnRecord if score >= 0.60.
 *
 * Returns the updated booking, score, status, and (if approved) the earn record.
 */
export async function processCheckOut(
  userId: string,
  eventId: string,
  mode: 'qr' | 'gps',
  qrCode?: string,
  gpsCoords?: GPSCoords,
): Promise<CheckOutResult> {
  try {
    const booking = await EventBookingModel.findOne({ userId, eventId }).lean() as (Record<string, unknown> & { _id: mongoose.Types.ObjectId }) | null;
    if (!booking) {
      return { success: false, error: 'No booking found for this user and event' };
    }

    const checkoutBookingDoc = booking as Record<string, unknown>;
    if (checkoutBookingDoc.qrCheckedOut) {
      return { success: false, error: 'Already checked out' };
    }

    const raw = checkoutBookingDoc;

    // Build signals from accumulated data
    const signals: VerificationSignals = {
      qr_in: Boolean(raw.qrCheckedIn),
      qr_out: false,
      gps_match: raw.gpsCheckIn
        ? (typeof raw.gpsCheckIn === 'object' && raw.gpsCheckIn !== null
            ? checkGPSProximity(
                (raw.gpsCheckIn as { lat: number; lng: number }).lat,
                (raw.gpsCheckIn as { lat: number; lng: number }).lng,
                gpsCoords?.lat ?? (raw.gpsCheckIn as { lat: number; lng: number }).lat,
                gpsCoords?.lng ?? (raw.gpsCheckIn as { lat: number; lng: number }).lng,
                (raw.gpsRadius as number) ?? 100,
              )
            : 0)
        : 0,
      ngo_approved: Boolean(raw.ngoApproved),
      photo_proof: Boolean(raw.photoProofUrl),
    };

    if (mode === 'qr' && qrCode) {
      const qrValidation = await validateQRCode(qrCode, 'check_out', eventId);
      if (!qrValidation.valid) {
        return { success: false, error: qrValidation.error };
      }
      signals.qr_out = true;
    }

    if (gpsCoords) {
      signals.gps_match = Math.max(
        signals.gps_match,
        checkGPSProximity(
          (raw.eventLatitude as number) ?? 0,
          (raw.eventLongitude as number) ?? 0,
          gpsCoords.lat,
          gpsCoords.lng,
          (raw.gpsRadius as number) ?? 100,
        ),
      );
    }

    const confidenceScore = calculateConfidenceScore(signals);
    const status = getApprovalStatus(confidenceScore);

    // Update booking
    const updateFields: Record<string, unknown> = {
      qrCheckedOut: mode === 'qr',
      qrCheckedOutAt: new Date(),
      gpsCheckOut: gpsCoords ? { lat: gpsCoords.lat, lng: gpsCoords.lng } : undefined,
      verificationStatus: status,
      confidenceScore,
    };

    const checkoutBookingId = booking._id as mongoose.Types.ObjectId;
    await EventBookingModel.findByIdAndUpdate(checkoutBookingId, updateFields);

    let earnRecord: Record<string, unknown> | undefined;

    if (status === 'verified') {
      // Create earn record (lazy import to avoid circular dependency)
      const { createEarnRecord } = await import('../services/earnRecordService.js');
      const record = await createEarnRecord({
        userId,
        eventId,
        bookingId: booking._id.toString(),
        verificationSignals: signals,
        confidenceScore,
        karmaEarned: (raw.karmaEarned as number) ?? 0,
        csrPoolId: (raw.csrPoolId as string) ?? '',
      });
      earnRecord = record as unknown as Record<string, unknown>;
    }

    const updatedBooking = (await EventBookingModel.findById(checkoutBookingId).lean()) as Record<string, unknown> | null;

    logger.info('[VerificationEngine] Check-out processed', {
      userId,
      eventId,
      bookingId: booking._id,
      mode,
      confidenceScore,
      status,
      earnRecordId: earnRecord?._id,
    });

    return {
      success: true,
      booking: updatedBooking as Record<string, unknown>,
      confidenceScore,
      status,
      earnRecord,
    };
  } catch (err) {
    logger.error('[VerificationEngine] Check-out error', { userId, eventId, error: err });
    return { success: false, error: 'Failed to process check-out' };
  }
}

// ---------------------------------------------------------------------------
// Fraud Detection
// ---------------------------------------------------------------------------

/**
 * Detect fraud anomalies for a booking.
 *
 * Anomalies detected:
 *   1. suspicious_gps     — Same GPS location across 5+ recent check-ins
 *   2. impossible_duration — Check-in to check-out in < 5 minutes
 *   3. batch_fake_signals  — 5+ users checking in at the same timestamp
 */
export async function detectFraudAnomalies(bookingId: string): Promise<FraudAlert[]> {
  const alerts: FraudAlert[] = [];

  try {
    const booking = await EventBookingModel.findById(bookingId).lean();
    if (!booking) return alerts;

    const raw = booking as Record<string, unknown>;
    const userId = raw.userId as string;
    const eventId = raw.eventId as string;
    const qrCheckedInAt = raw.qrCheckedInAt as Date | undefined;
    const qrCheckedOutAt = raw.qrCheckedOutAt as Date | undefined;

    // Anomaly 1: Same GPS location for all check-ins (last 30 days)
    const thirtyDaysAgo = moment().subtract(30, 'days').toDate();
    const recentBookings = await EventBookingModel.find({
      userId,
      qrCheckedInAt: { $gte: thirtyDaysAgo },
    }).lean();

    if (recentBookings.length >= 5) {
      const gpsLocations = new Set(
        recentBookings
          .map((b) => {
            const g = (b as Record<string, unknown>).gpsCheckIn as { lat?: number; lng?: number } | null;
            return g ? `${g.lat?.toFixed(5)},${g.lng?.toFixed(5)}` : 'unknown';
          }),
      );

      if (gpsLocations.size <= 2) {
        alerts.push({
          type: 'suspicious_gps',
          severity: 'high',
          message: `User checked in from same location(s) across ${recentBookings.length} events`,
        });
      }
    }

    // Anomaly 2: Impossible duration (< 5 minutes between check-in and check-out)
    if (qrCheckedInAt && qrCheckedOutAt) {
      const minutesBetween = moment(qrCheckedOutAt).diff(moment(qrCheckedInAt), 'minutes');
      if (minutesBetween < 5) {
        alerts.push({
          type: 'impossible_duration',
          severity: 'high',
          message: `Check-in to check-out in ${minutesBetween} minute(s)`,
        });
      }
    }

    // Anomaly 3: Same timestamp from multiple users at same event
    if (qrCheckedInAt) {
      const windowStart = moment(qrCheckedInAt).subtract(1, 'minute').toDate();
      const windowEnd = moment(qrCheckedInAt).add(1, 'minute').toDate();
      const sameTimestampCount = await EventBookingModel.countDocuments({
        eventId,
        qrCheckedInAt: { $gte: windowStart, $lte: windowEnd },
      });

      if (sameTimestampCount > 5) {
        alerts.push({
          type: 'batch_fake_signals',
          severity: 'critical',
          message: `${sameTimestampCount} users checked in at identical timestamp`,
        });
      }
    }
  } catch (err) {
    logger.error('[VerificationEngine] Fraud detection error', { bookingId, error: err });
  }

  return alerts;
}

// ---------------------------------------------------------------------------
// QR Code Generation (used by karma admin routes)
// ---------------------------------------------------------------------------

/**
 * Generate signed QR codes for check-in and check-out.
 * Returns base64-encoded JSON payloads with HMAC signatures.
 */
export async function generateEventQRCodes(eventId: string): Promise<{
  checkIn: string;
  checkOut: string;
}> {
  // KARMA-P1 FIX: Fail closed — QR_SECRET must be set.
  if (!process.env.QR_SECRET) {
    throw new Error('QR_SECRET environment variable is required to generate event QR codes');
  }
  const secret = process.env.QR_SECRET;
  const ts = Date.now();

  const checkInPayload: QRPayload = {
    eventId,
    type: 'check_in',
    ts,
    sig: crypto
      .createHmac('sha256', secret)
      .update(`${eventId}:check_in:${ts}`)
      .digest('hex')
      .slice(0, 16),
  };

  const checkOutPayload: QRPayload = {
    eventId,
    type: 'check_out',
    ts,
    sig: crypto
      .createHmac('sha256', secret)
      .update(`${eventId}:check_out:${ts}`)
      .digest('hex')
      .slice(0, 16),
  };

  return {
    checkIn: Buffer.from(JSON.stringify(checkInPayload)).toString('base64'),
    checkOut: Buffer.from(JSON.stringify(checkOutPayload)).toString('base64'),
  };
}
