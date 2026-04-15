import mongoose from 'mongoose';
import type { VerificationSignals } from '../types/index.js';
export declare const EventBookingModel: mongoose.Model<any, {}, {}, {}, any, any>;
export declare const SIGNAL_WEIGHTS: Readonly<Record<keyof VerificationSignals, number>>;
export declare const APPROVAL_THRESHOLD = 0.6;
export declare const PARTIAL_THRESHOLD = 0.4;
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
/**
 * Calculate the confidence score from verification signals.
 * Each signal contributes its weight when present/true; gps_match is
 * multiplied by its weight (0-1 range).
 *
 * Formula:
 *   score = (qr_in * 0.30) + (qr_out * 0.30) + (gps_match * 0.15)
 *           + (ngo_approved * 0.40) + (photo_proof * 0.10)
 */
export declare function calculateConfidenceScore(signals: VerificationSignals): number;
/**
 * Determine approval status from a confidence score.
 *
 * >= 0.60 → verified  : auto-approve, create EarnRecord
 * 0.40–0.59 → partial : flag for NGO review
 * < 0.40 → rejected   : notify user, no karma
 */
export declare function getApprovalStatus(score: number): ApprovalStatus;
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
export declare function validateQRCode(qrPayload: string, type: 'check_in' | 'check_out', eventId: string): Promise<{
    valid: boolean;
    error?: string;
}>;
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
export declare function checkGPSProximity(eventLat: number, eventLng: number, userLat: number, userLng: number, radiusMeters?: number): number;
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
export declare function processCheckIn(userId: string, eventId: string, mode: 'qr' | 'gps', qrCode?: string, gpsCoords?: GPSCoords): Promise<CheckInResult>;
/**
 * Process a user check-out for an event.
 *
 * Completes the verification signal set, calculates confidence score,
 * and creates an EarnRecord if score >= 0.60.
 *
 * Returns the updated booking, score, status, and (if approved) the earn record.
 */
export declare function processCheckOut(userId: string, eventId: string, mode: 'qr' | 'gps', qrCode?: string, gpsCoords?: GPSCoords): Promise<CheckOutResult>;
/**
 * Detect fraud anomalies for a booking.
 *
 * Anomalies detected:
 *   1. suspicious_gps     — Same GPS location across 5+ recent check-ins
 *   2. impossible_duration — Check-in to check-out in < 5 minutes
 *   3. batch_fake_signals  — 5+ users checking in at the same timestamp
 */
export declare function detectFraudAnomalies(bookingId: string): Promise<FraudAlert[]>;
/**
 * Generate signed QR codes for check-in and check-out.
 * Returns base64-encoded JSON payloads with HMAC signatures.
 */
export declare function generateEventQRCodes(eventId: string): Promise<{
    checkIn: string;
    checkOut: string;
}>;
//# sourceMappingURL=verificationEngine.d.ts.map