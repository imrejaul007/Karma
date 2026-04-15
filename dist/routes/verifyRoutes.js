"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Verify Routes — Phase 3: Karma by ReZ
 *
 * Express router for verification endpoints:
 *   POST /api/karma/verify/checkin
 *   POST /api/karma/verify/checkout
 *   GET  /api/karma/verify/status/:bookingId
 */
const express_1 = require("express");
const mongoose_1 = __importDefault(require("mongoose"));
const verificationEngine_1 = require("../engines/verificationEngine");
const earnRecordService_1 = require("../services/earnRecordService");
const auth_1 = require("../middleware/auth");
const logger_1 = require("../config/logger");
const router = (0, express_1.Router)();
function isValidCheckIn(body) {
    if (!body || typeof body !== 'object')
        return { valid: false, message: 'Request body is required' };
    const b = body;
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
        const gps = b.gpsCoords;
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
            userId: b.userId,
            eventId: b.eventId,
            mode: b.mode,
            qrCode: b.qrCode,
            gpsCoords: b.gpsCoords,
        },
    };
}
function isValidCheckOut(body) {
    return isValidCheckIn(body);
}
// ---------------------------------------------------------------------------
// POST /api/karma/verify/checkin
// ---------------------------------------------------------------------------
router.post('/checkin', auth_1.requireAuth, async (req, res) => {
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
        if (!mongoose_1.default.Types.ObjectId.isValid(userId)) {
            res.status(400).json({ success: false, message: 'Invalid userId format' });
            return;
        }
        if (!mongoose_1.default.Types.ObjectId.isValid(eventId)) {
            res.status(400).json({ success: false, message: 'Invalid eventId format' });
            return;
        }
        const result = await (0, verificationEngine_1.processCheckIn)(userId, eventId, mode, qrCode, gpsCoords);
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
    }
    catch (err) {
        logger_1.logger.error('[VerifyRoutes] Check-in error', { error: err });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
// ---------------------------------------------------------------------------
// POST /api/karma/verify/checkout
// ---------------------------------------------------------------------------
router.post('/checkout', auth_1.requireAuth, async (req, res) => {
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
        if (!mongoose_1.default.Types.ObjectId.isValid(userId)) {
            res.status(400).json({ success: false, message: 'Invalid userId format' });
            return;
        }
        if (!mongoose_1.default.Types.ObjectId.isValid(eventId)) {
            res.status(400).json({ success: false, message: 'Invalid eventId format' });
            return;
        }
        const result = await (0, verificationEngine_1.processCheckOut)(userId, eventId, mode, qrCode, gpsCoords);
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
    }
    catch (err) {
        logger_1.logger.error('[VerifyRoutes] Check-out error', { error: err });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
// ---------------------------------------------------------------------------
// GET /api/karma/verify/status/:bookingId
// ---------------------------------------------------------------------------
router.get('/status/:bookingId', auth_1.requireAuth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        if (!mongoose_1.default.Types.ObjectId.isValid(bookingId)) {
            res.status(400).json({ success: false, message: 'Invalid bookingId format' });
            return;
        }
        const booking = await verificationEngine_1.EventBookingModel.findById(bookingId).lean();
        if (!booking) {
            res.status(404).json({ success: false, message: 'Booking not found' });
            return;
        }
        const raw = booking;
        if (req.userId &&
            req.userId !== raw.userId &&
            req.userRole !== 'admin' &&
            req.userRole !== 'superadmin') {
            res.status(403).json({ success: false, message: 'Access denied' });
            return;
        }
        const anomalies = await (0, verificationEngine_1.detectFraudAnomalies)(bookingId);
        let earnRecord = null;
        if (raw._id) {
            earnRecord = await (0, earnRecordService_1.getEarnRecord)(raw._id.toString());
        }
        res.json({
            success: true,
            booking: {
                id: booking._id.toString(),
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
    }
    catch (err) {
        logger_1.logger.error('[VerifyRoutes] Status error', { error: err });
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});
exports.default = router;
//# sourceMappingURL=verifyRoutes.js.map