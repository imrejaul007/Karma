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
import { CronJob } from 'cron';
import moment from 'moment';
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';

// ---------------------------------------------------------------------------
// EventBooking cross-service model (same pattern as verificationEngine.ts)
// ---------------------------------------------------------------------------
const EventBookingSchema = new mongoose.Schema({}, {
  strict: false,
  strictQuery: true,
  timestamps: true,
  collection: 'eventbookings',
});
EventBookingSchema.index({ eventId: 1, status: 1 });
EventBookingSchema.index({ qrCheckedIn: 1, qrCheckedOut: 1 });

const EventBookingModel = mongoose.models.EventBooking ||
  mongoose.model('EventBooking', EventBookingSchema);

// ---------------------------------------------------------------------------
// KarmaEvent model
// ---------------------------------------------------------------------------
import { KarmaEvent, KarmaEventDocument } from '../models/KarmaEvent.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Grace period after event end time before auto-checkout fires (1 hour). */
export const AUTO_CHECKOUT_GRACE_MS = 60 * 60 * 1000;

/** Notification title for auto-checkout. */
export const AUTO_CHECKOUT_NOTIFICATION_TITLE = 'Auto check-out recorded';
export const AUTO_CHECKOUT_NOTIFICATION_BODY =
  'We recorded your check-out automatically. An NGO will verify your attendance.';

// ---------------------------------------------------------------------------
// Process Results
// ---------------------------------------------------------------------------

export interface AutoCheckoutResult {
  processed: number;
  checkedOut: number;
  skipped: number;
  errors: string[];
}

/**
 * Scan all active bookings with no check-out and process those whose
 * event has ended beyond the grace period.
 */
export async function processForgottenCheckouts(): Promise<AutoCheckoutResult> {
  const result: AutoCheckoutResult = { processed: 0, checkedOut: 0, skipped: 0, errors: [] };

  try {
    // Find all bookings that are checked in but not checked out
    const bookings = await EventBookingModel.find({
      qrCheckedIn: true,
      qrCheckedOut: false,
    }).lean();

    result.processed = bookings.length;
    logger.info(`[AutoCheckoutWorker] Scanning ${bookings.length} pending bookings`);

    for (const booking of bookings) {
      try {
        const raw = booking as Record<string, unknown>;
        const eventId = raw.eventId as string;

        // Look up event to determine end time
        const event = await (KarmaEvent.findById(eventId).lean().exec() as unknown) as (KarmaEventDocument | null);

        if (!event) {
          result.skipped++;
          logger.warn('[AutoCheckoutWorker] Event not found for booking', {
            bookingId: booking._id,
            eventId,
          });
          continue;
        }

        // Calculate event end time
        // eventDate is stored on the booking (from merchant service)
        const eventDate = raw.eventDate as Date | undefined;
        if (!eventDate) {
          result.skipped++;
          continue;
        }

        const eventEndTime = moment(eventDate)
          .add(event.expectedDurationHours, 'hours')
          .toDate();

        const cutoffTime = new Date(eventEndTime.getTime() + AUTO_CHECKOUT_GRACE_MS);

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
        logger.info('[AutoCheckoutWorker] Auto-checkout performed', {
          bookingId: booking._id,
          userId: raw.userId,
          eventId,
          retroactiveTime: eventEndTime,
        });

        // Send notification to user
        await sendAutoCheckoutNotification(raw.userId as string, booking._id.toString());
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Booking ${booking._id}: ${errorMsg}`);
        logger.error('[AutoCheckoutWorker] Error processing booking', {
          bookingId: booking._id,
          error: err,
        });
      }
    }

    logger.info('[AutoCheckoutWorker] Scan complete', result);
    return result;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Scan failed: ${errorMsg}`);
    logger.error('[AutoCheckoutWorker] Scan failed', { error: err });
    return result;
  }
}

/**
 * Send a push/in-app notification to the user about their auto-checkout.
 * Uses the ReZ notification service via internal API call.
 */
async function sendAutoCheckoutNotification(userId: string, bookingId: string): Promise<void> {
  try {
    // Attempt to call notification service if configured
    const notificationServiceUrl = process.env.NOTIFICATION_SERVICE_URL;
    if (!notificationServiceUrl) {
      logger.debug('[AutoCheckoutWorker] Notification service not configured, skipping push', { userId });
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
        title: AUTO_CHECKOUT_NOTIFICATION_TITLE,
        body: AUTO_CHECKOUT_NOTIFICATION_BODY,
        data: { type: 'auto_checkout', bookingId },
        channel: 'karma',
      }),
    });

    if (!response.ok) {
      logger.warn('[AutoCheckoutWorker] Failed to send notification', {
        userId,
        bookingId,
        status: response.status,
      });
    }
  } catch (err) {
    // Non-fatal: log and continue
    logger.warn('[AutoCheckoutWorker] Notification send error', { userId, bookingId, error: err });
  }
}

// ---------------------------------------------------------------------------
// Cron Job Factory
// ---------------------------------------------------------------------------

let cronJob: CronJob | null = null;

/**
 * Start the auto-checkout cron job.
 * Runs every hour at minute 0.
 *
 * @param onComplete  Optional callback fired after each run with the result.
 */
export function startAutoCheckoutWorker(onComplete?: (result: AutoCheckoutResult) => void): void {
  if (cronJob) {
    logger.warn('[AutoCheckoutWorker] Already running');
    return;
  }

  cronJob = new CronJob('0 * * * *', async () => {
    logger.info('[AutoCheckoutWorker] Starting hourly scan...');
    const result = await processForgottenCheckouts();
    if (onComplete) {
      onComplete(result);
    }
  });

  cronJob.start();
  logger.info('[AutoCheckoutWorker] Started — runs every hour at :00');
}

/**
 * Stop the auto-checkout cron job gracefully.
 */
export function stopAutoCheckoutWorker(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    logger.info('[AutoCheckoutWorker] Stopped');
  }
}
