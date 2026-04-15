"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTO_CHECKOUT_NOTIFICATION_BODY = exports.AUTO_CHECKOUT_NOTIFICATION_TITLE = exports.AUTO_CHECKOUT_GRACE_MS = void 0;
exports.processForgottenCheckouts = processForgottenCheckouts;
exports.startAutoCheckoutWorker = startAutoCheckoutWorker;
exports.stopAutoCheckoutWorker = stopAutoCheckoutWorker;
/**
 * Auto-Checkout Worker — Phase 3: Karma by ReZ
 *
 * Hourly cron job that handles forgotten check-outs.
 *
 * For each event that has ended:
 *   - Finds bookings with qrCheckedIn=true but no qrCheckedOut
 *   - If event end time + 1 hour grace period has passed:
 *       - Sets qrCheckedOut = true (retroactive timestamp)
 *       - Sets verificationStatus = 'partial'
 *       - Sends notification to user
 *
 * This ensures users who forget to check out still receive partial credit
 * and are notified that an NGO will verify their attendance.
 */
const cron_1 = require("cron");
const moment_1 = __importDefault(require("moment"));
const mongoose_1 = __importDefault(require("mongoose"));
const logger_js_1 = require("../config/logger.js");
// ---------------------------------------------------------------------------
// EventBooking cross-service model (same pattern as verificationEngine.ts)
// ---------------------------------------------------------------------------
const EventBookingSchema = new mongoose_1.default.Schema({}, {
    strict: false,
    strictQuery: true,
    timestamps: true,
    collection: 'eventbookings',
});
EventBookingSchema.index({ eventId: 1, status: 1 });
EventBookingSchema.index({ qrCheckedIn: 1, qrCheckedOut: 1 });
const EventBookingModel = mongoose_1.default.models.EventBooking ||
    mongoose_1.default.model('EventBooking', EventBookingSchema);
// ---------------------------------------------------------------------------
// KarmaEvent model
// ---------------------------------------------------------------------------
const KarmaEvent_js_1 = require("../models/KarmaEvent.js");
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
/** Grace period after event end time before auto-checkout fires (1 hour). */
exports.AUTO_CHECKOUT_GRACE_MS = 60 * 60 * 1000;
/** Notification title for auto-checkout. */
exports.AUTO_CHECKOUT_NOTIFICATION_TITLE = 'Auto check-out recorded';
exports.AUTO_CHECKOUT_NOTIFICATION_BODY = 'We recorded your check-out automatically. An NGO will verify your attendance.';
/**
 * Scan all active bookings with no check-out and process those whose
 * event has ended beyond the grace period.
 */
async function processForgottenCheckouts() {
    const result = { processed: 0, checkedOut: 0, skipped: 0, errors: [] };
    try {
        // Find all bookings that are checked in but not checked out
        const bookings = await EventBookingModel.find({
            qrCheckedIn: true,
            qrCheckedOut: false,
        }).lean();
        result.processed = bookings.length;
        logger_js_1.logger.info(`[AutoCheckoutWorker] Scanning ${bookings.length} pending bookings`);
        for (const booking of bookings) {
            try {
                const raw = booking;
                const eventId = raw.eventId;
                // Look up event to determine end time
                const event = await KarmaEvent_js_1.KarmaEvent.findById(eventId).lean();
                if (!event) {
                    result.skipped++;
                    logger_js_1.logger.warn('[AutoCheckoutWorker] Event not found for booking', {
                        bookingId: booking._id,
                        eventId,
                    });
                    continue;
                }
                // Calculate event end time
                // eventDate is stored on the booking (from merchant service)
                const eventDate = raw.eventDate;
                if (!eventDate) {
                    result.skipped++;
                    continue;
                }
                const eventEndTime = (0, moment_1.default)(eventDate)
                    .add(event.expectedDurationHours, 'hours')
                    .toDate();
                const cutoffTime = new Date(eventEndTime.getTime() + exports.AUTO_CHECKOUT_GRACE_MS);
                // Skip if grace period hasn't elapsed yet
                if (new Date() < cutoffTime) {
                    result.skipped++;
                    continue;
                }
                // Perform auto-checkout
                await EventBookingModel.findByIdAndUpdate(booking._id, {
                    qrCheckedOut: true,
                    qrCheckedOutAt: eventEndTime, // retroactive timestamp
                    verificationStatus: 'partial',
                    notes: 'Auto-checkout: user forgot to check out',
                });
                result.checkedOut++;
                logger_js_1.logger.info('[AutoCheckoutWorker] Auto-checkout performed', {
                    bookingId: booking._id,
                    userId: raw.userId,
                    eventId,
                    retroactiveTime: eventEndTime,
                });
                // Send notification to user
                await sendAutoCheckoutNotification(raw.userId, booking._id.toString());
            }
            catch (err) {
                const errorMsg = err instanceof Error ? err.message : String(err);
                result.errors.push(`Booking ${booking._id}: ${errorMsg}`);
                logger_js_1.logger.error('[AutoCheckoutWorker] Error processing booking', {
                    bookingId: booking._id,
                    error: err,
                });
            }
        }
        logger_js_1.logger.info('[AutoCheckoutWorker] Scan complete', result);
        return result;
    }
    catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Scan failed: ${errorMsg}`);
        logger_js_1.logger.error('[AutoCheckoutWorker] Scan failed', { error: err });
        return result;
    }
}
/**
 * Send a push/in-app notification to the user about their auto-checkout.
 * Uses the ReZ notification service via internal API call.
 */
async function sendAutoCheckoutNotification(userId, bookingId) {
    try {
        // Attempt to call notification service if configured
        const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
        if (!notificationServiceUrl) {
            logger_js_1.logger.debug('[AutoCheckoutWorker] Notification service not configured, skipping push', { userId });
            return;
        }
        const response = await fetch(`${notificationServiceUrl}/api/notifications`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN || '',
            },
            body: JSON.stringify({
                userId,
                title: exports.AUTO_CHECKOUT_NOTIFICATION_TITLE,
                body: exports.AUTO_CHECKOUT_NOTIFICATION_BODY,
                data: { type: 'auto_checkout', bookingId },
                channel: 'karma',
            }),
        });
        if (!response.ok) {
            logger_js_1.logger.warn('[AutoCheckoutWorker] Failed to send notification', {
                userId,
                bookingId,
                status: response.status,
            });
        }
    }
    catch (err) {
        // Non-fatal: log and continue
        logger_js_1.logger.warn('[AutoCheckoutWorker] Notification send error', { userId, bookingId, error: err });
    }
}
// ---------------------------------------------------------------------------
// Cron Job Factory
// ---------------------------------------------------------------------------
let cronJob = null;
/**
 * Start the auto-checkout cron job.
 * Runs every hour at minute 0.
 *
 * @param onComplete  Optional callback fired after each run with the result.
 */
function startAutoCheckoutWorker(onComplete) {
    if (cronJob) {
        logger_js_1.logger.warn('[AutoCheckoutWorker] Already running');
        return;
    }
    cronJob = new cron_1.CronJob('0 * * * *', async () => {
        logger_js_1.logger.info('[AutoCheckoutWorker] Starting hourly scan...');
        const result = await processForgottenCheckouts();
        if (onComplete) {
            onComplete(result);
        }
    });
    cronJob.start();
    logger_js_1.logger.info('[AutoCheckoutWorker] Started — runs every hour at :00');
}
/**
 * Stop the auto-checkout cron job gracefully.
 */
function stopAutoCheckoutWorker() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
        logger_js_1.logger.info('[AutoCheckoutWorker] Stopped');
    }
}
//# sourceMappingURL=autoCheckoutWorker.js.map