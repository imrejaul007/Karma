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
 *       - Creates EarnRecord with partial signals (partial credit)
 *       - Sends notification to user
 *
 * This ensures users who forget to check out still receive partial credit
 * and are notified that an NGO will verify their attendance.
 */
import { CronJob } from 'cron';
import moment from 'moment';
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { getConversionRate } from '../engines/karmaEngine.js';
import { EarnRecord } from '../models/EarnRecord.js';
import { KarmaProfile } from '../models/KarmaProfile.js';

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
      const typedBooking = booking as unknown as { _id: mongoose.Types.ObjectId };
      const raw = booking as Record<string, unknown>;
      try {
        const eventId = raw.eventId as string;

        // Look up event to determine end time
        const event = await KarmaEvent.findById(eventId).lean() as KarmaEventDocument | null;

        if (!event) {
          result.skipped++;
          logger.warn('[AutoCheckoutWorker] Event not found for booking', {
            bookingId: typedBooking._id,
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
        await EventBookingModel.findByIdAndUpdate(typedBooking._id, {
          qrCheckedOut: true,
          qrCheckedOutAt: eventEndTime, // retroactive timestamp
          verificationStatus: 'partial',
          notes: 'Auto-checkout: user forgot to check out',
        });

        // G-KS-B4 FIX: Create EarnRecord for the partial auto-checkout.
        // The user gets partial karma credit (50% rate) since they forgot to scan out.
        try {
          const profile = await KarmaProfile.findOne({ userId: raw.userId as string }).lean();
          const level = (profile?.level as string) ?? 'L1';
          const conversionRate = getConversionRate(level);
          const karmaEarned = Math.floor((event.expectedDurationHours * 5) * 0.5); // partial karma: 50% of estimated

          const idempotencyKey = `autocheckout_${typedBooking._id.toString()}`;

          // Check for existing record (idempotent)
          const existing = await EarnRecord.findOne({ idempotencyKey }).lean();
          if (!existing) {
            const record = new EarnRecord({
              userId: new mongoose.Types.ObjectId(raw.userId as string),
              eventId: new mongoose.Types.ObjectId(eventId),
              bookingId: typedBooking._id,
              karmaEarned,
              activeLevelAtApproval: level as 'L1' | 'L2' | 'L3' | 'L4',
              conversionRateSnapshot: conversionRate,
              csrPoolId: new mongoose.Types.ObjectId(raw.csrPoolId as string || '000000000000000000000000'),
              verificationSignals: {
                qr_in: true,           // User did check in
                qr_out: false,         // No QR checkout
                gps_match: 0,           // No GPS at checkout
                ngo_approved: false,   // Pending NGO verification
                photo_proof: false,
              },
              confidenceScore: 0.35,    // Below partial threshold, but auto-checkout grants partial karma
              status: 'APPROVED_PENDING_CONVERSION',
              approvedAt: new Date(),
              createdAt: new Date(),
              rezCoinsEarned: Math.floor(karmaEarned * conversionRate),
              idempotencyKey,
            });
            await record.save();
            logger.info('[AutoCheckoutWorker] EarnRecord created', {
              recordId: record._id,
              userId: raw.userId,
              eventId,
              karmaEarned,
            });
          }
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          result.errors.push(`EarnRecord creation for ${typedBooking._id}: ${errorMsg}`);
          logger.error('[AutoCheckoutWorker] Failed to create EarnRecord', {
            bookingId: typedBooking._id,
            userId: raw.userId,
            error: err,
          });
        }

        result.checkedOut++;
        logger.info('[AutoCheckoutWorker] Auto-checkout performed', {
          bookingId: typedBooking._id,
          userId: raw.userId,
          eventId,
          retroactiveTime: eventEndTime,
        });

        // Send notification to user
        await sendAutoCheckoutNotification(raw.userId as string, typedBooking._id.toString());
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        result.errors.push(`Booking ${typedBooking._id}: ${errorMsg}`);
        logger.error('[AutoCheckoutWorker] Error processing booking', {
          bookingId: typedBooking._id,
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

    // G-KS-H9 FIX: Validate that INTERNAL_SERVICE_TOKEN is set and non-empty.
    const internalToken = process.env.INTERNAL_SERVICE_TOKEN;
    if (!internalToken) {
      logger.debug('[AutoCheckoutWorker] INTERNAL_SERVICE_TOKEN not configured, skipping notification', { userId });
      return;
    }

    const response = await fetch(`${notificationServiceUrl}/api/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': internalToken,
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
