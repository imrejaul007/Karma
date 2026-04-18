/**
 * Karma → Gamification Bridge
 *
 * Emits karma award events to the gamification service via BullMQ queue.
 * The gamification service can then check for karma-based achievements,
 * badges, and other engagement rewards.
 *
 * Queue: 'gamification-events'
 * Event: 'karma.awarded'
 *
 * This is a fire-and-forget pattern — callers should catch and log errors
 * rather than letting them propagate. Karma operations must not fail
 * because the gamification bridge is unavailable.
 */
import { Queue } from 'bullmq';
import { createServiceLogger } from '../config/logger.js';
import { redisUrl } from '../config/index.js';

const log = createServiceLogger('gamificationBridge');

// ── Queue configuration ──────────────────────────────────────────────────────

const GAMIFICATION_QUEUE_NAME = 'gamification-events';

let gamificationQueue: Queue | null = null;

function getGamificationQueue(): Queue {
  if (!gamificationQueue) {
    gamificationQueue = new Queue(GAMIFICATION_QUEUE_NAME, {
      connection: {
        url: redisUrl,
        maxRetriesPerRequest: null,
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    });
    log.info('[GamificationBridge] Queue initialized', { queue: GAMIFICATION_QUEUE_NAME });
  }
  return gamificationQueue;
}

// ── Event payload ────────────────────────────────────────────────────────────

export interface KarmaAwardedEvent {
  userId: string;
  karmaAmount: number;
  eventType: 'karma.awarded';
  eventId: string;
  newActiveKarma?: number;
  newLevel?: string;
}

// ── Emit function ────────────────────────────────────────────────────────────

/**
 * Emit a karma.awarded event to the gamification-events queue.
 *
 * Fire-and-forget: callers should wrap this in .catch() to prevent
 * gamification failures from blocking karma operations.
 */
export async function emitKarmaAwardedEvent(event: KarmaAwardedEvent): Promise<void> {
  try {
    const queue = getGamificationQueue();
    await queue.add('karma.awarded', event, {
      jobId: event.eventId,  // deduplication via eventId
    });
    log.info('[GamificationBridge] Emitted karma.awarded event', {
      userId: event.userId,
      karmaAmount: event.karmaAmount,
      eventId: event.eventId,
    });
  } catch (err) {
    log.error('[GamificationBridge] Failed to emit karma.awarded event', {
      userId: event.userId,
      eventId: event.eventId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Gracefully close the gamification queue connection.
 * Call during service shutdown.
 */
export async function closeGamificationBridge(): Promise<void> {
  if (gamificationQueue) {
    await gamificationQueue.close();
    gamificationQueue = null;
    log.info('[GamificationBridge] Queue closed');
  }
}
