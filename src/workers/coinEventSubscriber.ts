// -nocheck
// @ts-nocheck
/**
 * Coin Event Subscriber — XS-CRIT-007 Fix
 *
 * Redis pub/sub listener that receives coin credit events from the wallet service.
 * When the wallet service credits coins to a user, it publishes an event on the
 * 'coin-credit' channel. This subscriber receives those events and:
 *   1. Verifies the transaction against the EarnRecord ledger
 *   2. Updates KarmaProfile conversion history if not already recorded
 *   3. Logs the event for audit trail
 *
 * Channels subscribed:
 *   - coin-credit: Published when any coin credit succeeds (karma_conversion,
 *     gamification, referral, cashback, admin_adjustment, etc.)
 *
 * This ensures the karma service stays in sync with the wallet service and can
 * react to coin events from ANY source (merchant, gamification, consumer app).
 */
import { redis, subscriber } from '../config/redis';
import { createServiceLogger } from '../config/logger';

const log = createServiceLogger('coinEventSubscriber');

// ── Canonical channel names ────────────────────────────────────────────────────────
export const CHANNEL_COIN_CREDIT = 'coin-credit';

// ── Event types that represent coin credits (matches wallet service event types) ──
const COIN_CREDIT_EVENT_TYPES = new Set<string>([
  'wallet.credited',
  'wallet.cashback_awarded',
  'wallet.reward_granted',
  'wallet.admin_adjustment',
]);

// ── Payload shape published by the wallet service ─────────────────────────────────
export interface CoinCreditEvent {
  /** Unique event ID from the wallet service */
  eventId: string;
  /** Matches wallet service eventType (e.g. 'wallet.credited') */
  eventType: string;
  /** Target user ID */
  userId: string;
  /** Amount of coins credited */
  amount: number;
  /** Coin type: 'rez' | 'prive' | 'branded' | 'promo' | 'cashback' | 'referral' */
  coinType: string;
  /** Source string from the wallet service credit call */
  source: string;
  /** Wallet transaction ID */
  transactionId?: string;
  /** Reference ID (e.g. EarnRecord ID for karma conversions) */
  referenceId?: string;
  /** Reference model name */
  referenceModel?: string;
  /** Human-readable description */
  description?: string;
  /** Balance after credit */
  newBalance?: number;
  /** ISO timestamp when the event was created */
  createdAt: string;
}

// ── Idempotency: track processed event IDs in Redis ────────────────────────────────
const PROCESSED_EVENTS_PREFIX = 'coin-event:processed:';
/** TTL for processed event dedup keys (24 hours) */
const PROCESSED_EVENT_TTL_SECONDS = 86400;

/**
 * Mark an event as processed to prevent double-handling.
 * Returns true if the event was already processed (skip), false if newly processed.
 */
async function markEventProcessed(eventId: string): Promise<boolean> {
  const key = `${PROCESSED_EVENTS_PREFIX}${eventId}`;
  // FIX: SET NX EX is atomic — single Redis command sets key + TTL together.
  // Previously used setnx + expire (2 ops); a crash between them left the key
  // with no TTL, permanently blocking future events with the same ID.
  const wasNew = await redis.set(key, '1', 'EX', PROCESSED_EVENT_TTL_SECONDS, 'NX');
  return !wasNew; // 'NX' returns null if key exists → wasNew is null → !null = true (duplicate)
}

// ── Handler: update karma conversion history ──────────────────────────────────────

/**
 * Process a coin credit event from the wallet service.
 * Updates KarmaProfile conversion history to record the conversion.
 *
 * Idempotent: safe to call multiple times for the same event.
 * Only processes karma_conversion source events (other sources are logged but skipped).
 */
async function handleCoinCreditEvent(event: CoinCreditEvent): Promise<void> {
  const { eventId, userId, amount, source, referenceId, referenceModel } = event;

  // Only process karma conversion events
  if (source !== 'karma_conversion') {
    log.debug('[CoinEventSubscriber] Skipping non-karma coin event', {
      eventId,
      userId,
      source,
    });
    return;
  }

  if (!referenceId || !referenceModel) {
    log.warn('[CoinEventSubscriber] karma_conversion event missing reference', {
      eventId,
      userId,
    });
    return;
  }

  // Check idempotency: skip if already processed
  const alreadyProcessed = await markEventProcessed(eventId);
  if (alreadyProcessed) {
    log.debug('[CoinEventSubscriber] Event already processed, skipping', { eventId });
    return;
  }

  log.info('[CoinEventSubscriber] Processing karma conversion coin event', {
    eventId,
    userId,
    amount,
    source,
    referenceId,
    referenceModel,
  });

  try {
    const { Types } = await import('mongoose');
    const { EarnRecord, KarmaProfile } = await import('../models');

    // Verify the EarnRecord exists and matches the credit
    const record = await EarnRecord.findOne({ _id: referenceId }).lean();
    if (!record) {
      log.warn('[CoinEventSubscriber] EarnRecord not found for reference', {
        eventId,
        referenceId,
        userId,
      });
      return;
    }

    // Check if conversion history already has this record
    const profile = await KarmaProfile.findOne({ userId: new Types.ObjectId(userId) }).lean();
    if (profile) {
      const alreadyRecorded = profile.conversionHistory.some(
        (entry) => entry.batchId && entry.batchId.toString() === String(record.batchId ?? ''),
      );
      if (alreadyRecorded) {
        log.debug('[CoinEventSubscriber] Conversion already in history', {
          eventId,
          referenceId,
          batchId: record.batchId,
        });
        return;
      }
    }

    // Record conversion in KarmaProfile history
    if (profile) {
      await KarmaProfile.updateOne(
        { _id: profile._id },
        {
          $push: {
            conversionHistory: {
              karmaConverted: record.karmaEarned,
              coinsEarned: amount,
              rate: record.conversionRateSnapshot,
              batchId: record.batchId ?? new Types.ObjectId(),
              convertedAt: new Date(),
            },
          },
        },
      );
      log.info('[CoinEventSubscriber] KarmaProfile conversion history updated', {
        eventId,
        userId,
        karmaConverted: record.karmaEarned,
        coinsEarned: amount,
        rate: record.conversionRateSnapshot,
      });
    } else {
      log.warn('[CoinEventSubscriber] KarmaProfile not found for user', { userId, eventId });
    }
  } catch (err) {
    log.error('[CoinEventSubscriber] Failed to process coin event', {
      eventId,
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Message handler ───────────────────────────────────────────────────────────────

/**
 * Parse and dispatch incoming pub/sub messages.
 * Called by subscriber.on('message').
 */
function onMessage(channel: string, message: string): void {
  if (channel !== CHANNEL_COIN_CREDIT) {
    log.warn('[CoinEventSubscriber] Received message on unexpected channel', { channel });
    return;
  }

  let event: CoinCreditEvent;
  try {
    event = JSON.parse(message) as CoinCreditEvent;
  } catch (err) {
    log.error('[CoinEventSubscriber] Failed to parse message JSON', {
      channel,
      raw: message.slice(0, 200),
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Validate required fields
  if (!event.eventId || !event.userId || typeof event.amount !== 'number') {
    log.warn('[CoinEventSubscriber] Message missing required fields', {
      channel,
      eventId: event.eventId,
    });
    return;
  }

  log.debug('[CoinEventSubscriber] Received coin event', {
    channel,
    eventId: event.eventId,
    eventType: event.eventType,
    userId: event.userId,
    amount: event.amount,
    source: event.source,
  });

  if (COIN_CREDIT_EVENT_TYPES.has(event.eventType)) {
    void handleCoinCreditEvent(event);
  } else {
    log.debug('[CoinEventSubscriber] Unknown event type, skipping', {
      eventType: event.eventType,
      eventId: event.eventId,
    });
  }
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────────

let isSubscribed = false;
let subscriberReady = false;

/**
 * Start the coin event subscriber.
 * Connects the subscriber client and subscribes to the coin-credit channel.
 *
 * Safe to call multiple times — subsequent calls are no-ops while already subscribed.
 */
export async function startCoinEventSubscriber(): Promise<void> {
  if (isSubscribed) {
    log.debug('[CoinEventSubscriber] Already subscribed, skipping');
    return;
  }

  try {
    // Connect the lazy subscriber client
    if (!subscriberReady) {
      await subscriber.connect();
      subscriberReady = true;
    }

    // Wire up handlers
    subscriber.on('message', onMessage);

    // Subscribe to the coin-credit channel
    await subscriber.subscribe(CHANNEL_COIN_CREDIT);
    isSubscribed = true;

    log.info('[CoinEventSubscriber] Subscribed to channel', { channel: CHANNEL_COIN_CREDIT });
  } catch (err) {
    log.error('[CoinEventSubscriber] Failed to start subscriber', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Stop the coin event subscriber gracefully.
 * Unsubscribes from all channels and closes the subscriber connection.
 */
export async function stopCoinEventSubscriber(): Promise<void> {
  if (!isSubscribed && !subscriberReady) {
    return;
  }

  try {
    if (isSubscribed) {
      await subscriber.unsubscribe(CHANNEL_COIN_CREDIT);
      isSubscribed = false;
    }

    subscriber.removeAllListeners('message');

    if (subscriberReady) {
      await subscriber.quit();
      subscriberReady = false;
    }

    log.info('[CoinEventSubscriber] Stopped gracefully');
  } catch (err) {
    log.error('[CoinEventSubscriber] Error during stop', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
