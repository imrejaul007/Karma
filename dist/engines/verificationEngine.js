"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PARTIAL_THRESHOLD = exports.APPROVAL_THRESHOLD = exports.SIGNAL_WEIGHTS = exports.EventBookingModel = void 0;
exports.calculateConfidenceScore = calculateConfidenceScore;
exports.getApprovalStatus = getApprovalStatus;
exports.validateQRCode = validateQRCode;
exports.checkGPSProximity = checkGPSProximity;
exports.processCheckIn = processCheckIn;
exports.processCheckOut = processCheckOut;
exports.detectFraudAnomalies = detectFraudAnomalies;
exports.generateEventQRCodes = generateEventQRCodes;
/**
 * Verification Engine — Phase 3: Karma by ReZ
 *
 * Implements multi-layer confidence scoring, QR validation, GPS proximity
 * checking, fraud anomaly detection, and the check-in/check-out flows.
 */
const crypto_1 = __importDefault(require("crypto"));
const moment_1 = __importDefault(require("moment"));
const mongoose_1 = __importDefault(require("mongoose"));
const logger_js_1 = require("../config/logger.js");
// ---------------------------------------------------------------------------
// Cross-service EventBooking model (read/write, owned by merchant service).
// strict:false is intentional — this is a cross-service proxy.
// ---------------------------------------------------------------------------
const EventBookingSchema = new mongoose_1.default.Schema({}, {
    strict: false,
    strictQuery: true,
    timestamps: true,
    collection: 'eventbookings',
});
EventBookingSchema.index({ eventId: 1, status: 1 });
EventBookingSchema.index({ userId: 1, eventId: 1 });
exports.EventBookingModel = mongoose_1.default.models.EventBooking ||
    mongoose_1.default.model('EventBooking', EventBookingSchema);
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
exports.SIGNAL_WEIGHTS = {
    qr_in: 0.30,
    qr_out: 0.30,
    gps_match: 0.15,
    ngo_approved: 0.40,
    photo_proof: 0.10,
};
exports.APPROVAL_THRESHOLD = 0.60;
exports.PARTIAL_THRESHOLD = 0.40;
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
function calculateConfidenceScore(signals) {
    let score = 0;
    if (signals.qr_in)
        score += exports.SIGNAL_WEIGHTS.qr_in;
    if (signals.qr_out)
        score += exports.SIGNAL_WEIGHTS.qr_out;
    score += signals.gps_match * exports.SIGNAL_WEIGHTS.gps_match;
    if (signals.ngo_approved)
        score += exports.SIGNAL_WEIGHTS.ngo_approved;
    if (signals.photo_proof)
        score += exports.SIGNAL_WEIGHTS.photo_proof;
    return Math.round(score * 100) / 100;
}
/**
 * Determine approval status from a confidence score.
 *
 * >= 0.60 → verified  : auto-approve, create EarnRecord
 * 0.40–0.59 → partial : flag for NGO review
 * < 0.40 → rejected   : notify user, no karma
 */
function getApprovalStatus(score) {
    if (score >= exports.APPROVAL_THRESHOLD)
        return 'verified';
    if (score >= exports.PARTIAL_THRESHOLD)
        return 'partial';
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
async function validateQRCode(qrPayload, type, eventId) {
    try {
        // 1. Decode base64
        let decoded;
        try {
            const jsonStr = Buffer.from(qrPayload, 'base64').toString('utf-8');
            decoded = JSON.parse(jsonStr);
        }
        catch {
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
        const secret = process.env.QR_SECRET || 'default-karma-qr-secret';
        const expectedSig = crypto_1.default
            .createHmac('sha256', secret)
            .update(`${decoded.eventId}:${decoded.type}:${decoded.ts}`)
            .digest('hex')
            .slice(0, 16);
        if (!crypto_1.default.timingSafeEqual(Buffer.from(decoded.sig), Buffer.from(expectedSig))) {
            return { valid: false, error: 'QR code signature verification failed' };
        }
        return { valid: true };
    }
    catch (err) {
        logger_js_1.logger.error('[VerificationEngine] QR validation error', { error: err });
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
function checkGPSProximity(eventLat, eventLng, userLat, userLng, radiusMeters = 100) {
    const EARTH_RADIUS_M = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(userLat - eventLat);
    const dLng = toRad(userLng - eventLng);
    const lat1 = toRad(eventLat);
    const lat2 = toRad(userLat);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
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
async function processCheckIn(userId, eventId, mode, qrCode, gpsCoords) {
    try {
        // Find the user's booking for this event
        const booking = await exports.EventBookingModel.findOne({ userId, eventId }).lean();
        if (!booking) {
            return { success: false, error: 'No booking found for this user and event' };
        }
        if (booking.qrCheckedIn) {
            return { success: false, error: 'Already checked in' };
        }
        // Initialize signals from existing booking data
        const signals = {
            qr_in: false,
            qr_out: false,
            gps_match: 0,
            ngo_approved: Boolean(booking.ngoApproved),
            photo_proof: Boolean(booking.photoProofUrl),
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
            // Look up event GPS radius (default 100m)
            const gpsMatch = checkGPSProximity(booking.eventLatitude ?? 0, booking.eventLongitude ?? 0, gpsCoords.lat, gpsCoords.lng, booking.gpsRadius ?? 100);
            signals.gps_match = gpsMatch;
        }
        const confidenceScore = calculateConfidenceScore(signals);
        const status = getApprovalStatus(confidenceScore);
        // Update the booking
        const updateFields = {
            qrCheckedIn: mode === 'qr',
            qrCheckedInAt: new Date(),
            gpsCheckIn: gpsCoords ? { lat: gpsCoords.lat, lng: gpsCoords.lng } : undefined,
            verificationStatus: status,
            confidenceScore,
        };
        await exports.EventBookingModel.findByIdAndUpdate(booking._id, updateFields);
        const updatedBooking = await exports.EventBookingModel.findById(booking._id).lean();
        logger_js_1.logger.info('[VerificationEngine] Check-in processed', {
            userId,
            eventId,
            bookingId: booking._id,
            mode,
            confidenceScore,
            status,
        });
        return {
            success: true,
            booking: updatedBooking,
            confidenceScore,
            status,
        };
    }
    catch (err) {
        logger_js_1.logger.error('[VerificationEngine] Check-in error', { userId, eventId, error: err });
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
async function processCheckOut(userId, eventId, mode, qrCode, gpsCoords) {
    try {
        const booking = await exports.EventBookingModel.findOne({ userId, eventId }).lean();
        if (!booking) {
            return { success: false, error: 'No booking found for this user and event' };
        }
        if (booking.qrCheckedOut) {
            return { success: false, error: 'Already checked out' };
        }
        const raw = booking;
        // Build signals from accumulated data
        const signals = {
            qr_in: Boolean(raw.qrCheckedIn),
            qr_out: false,
            gps_match: raw.gpsCheckIn
                ? (typeof raw.gpsCheckIn === 'object' && raw.gpsCheckIn !== null
                    ? checkGPSProximity(raw.gpsCheckIn.lat, raw.gpsCheckIn.lng, gpsCoords?.lat ?? raw.gpsCheckIn.lat, gpsCoords?.lng ?? raw.gpsCheckIn.lng, raw.gpsRadius ?? 100)
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
            signals.gps_match = Math.max(signals.gps_match, checkGPSProximity(raw.eventLatitude ?? 0, raw.eventLongitude ?? 0, gpsCoords.lat, gpsCoords.lng, raw.gpsRadius ?? 100));
        }
        const confidenceScore = calculateConfidenceScore(signals);
        const status = getApprovalStatus(confidenceScore);
        // Update booking
        const updateFields = {
            qrCheckedOut: mode === 'qr',
            qrCheckedOutAt: new Date(),
            gpsCheckOut: gpsCoords ? { lat: gpsCoords.lat, lng: gpsCoords.lng } : undefined,
            verificationStatus: status,
            confidenceScore,
        };
        await exports.EventBookingModel.findByIdAndUpdate(booking._id, updateFields);
        let earnRecord;
        if (status === 'verified') {
            // Create earn record (lazy import to avoid circular dependency)
            const { createEarnRecord } = await Promise.resolve().then(() => __importStar(require('../services/earnRecordService.js')));
            const record = await createEarnRecord({
                userId,
                eventId,
                bookingId: booking._id.toString(),
                verificationSignals: signals,
                confidenceScore,
                karmaEarned: raw.karmaEarned ?? 0,
                csrPoolId: raw.csrPoolId ?? '',
            });
            earnRecord = record;
        }
        const updatedBooking = await exports.EventBookingModel.findById(booking._id).lean();
        logger_js_1.logger.info('[VerificationEngine] Check-out processed', {
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
            booking: updatedBooking,
            confidenceScore,
            status,
            earnRecord,
        };
    }
    catch (err) {
        logger_js_1.logger.error('[VerificationEngine] Check-out error', { userId, eventId, error: err });
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
async function detectFraudAnomalies(bookingId) {
    const alerts = [];
    try {
        const booking = await exports.EventBookingModel.findById(bookingId).lean();
        if (!booking)
            return alerts;
        const raw = booking;
        const userId = raw.userId;
        const eventId = raw.eventId;
        const qrCheckedInAt = raw.qrCheckedInAt;
        const qrCheckedOutAt = raw.qrCheckedOutAt;
        // Anomaly 1: Same GPS location for all check-ins (last 30 days)
        const thirtyDaysAgo = (0, moment_1.default)().subtract(30, 'days').toDate();
        const recentBookings = await exports.EventBookingModel.find({
            userId,
            qrCheckedInAt: { $gte: thirtyDaysAgo },
        }).lean();
        if (recentBookings.length >= 5) {
            const gpsLocations = new Set(recentBookings
                .map((b) => {
                const g = b.gpsCheckIn;
                return g ? `${g.lat?.toFixed(5)},${g.lng?.toFixed(5)}` : 'unknown';
            }));
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
            const minutesBetween = (0, moment_1.default)(qrCheckedOutAt).diff((0, moment_1.default)(qrCheckedInAt), 'minutes');
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
            const windowStart = (0, moment_1.default)(qrCheckedInAt).subtract(1, 'minute').toDate();
            const windowEnd = (0, moment_1.default)(qrCheckedInAt).add(1, 'minute').toDate();
            const sameTimestampCount = await exports.EventBookingModel.countDocuments({
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
    }
    catch (err) {
        logger_js_1.logger.error('[VerificationEngine] Fraud detection error', { bookingId, error: err });
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
async function generateEventQRCodes(eventId) {
    const secret = process.env.QR_SECRET || 'default-karma-qr-secret';
    const ts = Date.now();
    const checkInPayload = {
        eventId,
        type: 'check_in',
        ts,
        sig: crypto_1.default
            .createHmac('sha256', secret)
            .update(`${eventId}:check_in:${ts}`)
            .digest('hex')
            .slice(0, 16),
    };
    const checkOutPayload = {
        eventId,
        type: 'check_out',
        ts,
        sig: crypto_1.default
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
//# sourceMappingURL=verificationEngine.js.map