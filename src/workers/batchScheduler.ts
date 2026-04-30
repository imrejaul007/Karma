// @ts-nocheck
/**
 * Batch Scheduler — cron worker that triggers weekly batch creation every Sunday at 23:59
 *
 * Schedule: 59 23 * * 0  (Sunday 23:59)
 *
 * On trigger:
 * 1. Log start
 * 2. Call createWeeklyBatch()
 * 3. Log completion: N batches, total karma, total estimated coins
 * 4. Error handling with graceful logging
 */
import { CronJob } from 'cron';
import { createWeeklyBatch } from '../services/batchService.js';
import { createServiceLogger } from '../config/logger.js';
import { batchCronSchedule } from '../config/index.js';
import { redis } from '../config/redis.js';

const log = createServiceLogger('batchScheduler');

let job: CronJob | null = null;

// cron@3.x CronJob has nextDate() returning CronDate; @types/cron@2.x may not expose it
type CronDateLike = { toISO: () => string };
type CronJobWithNextDate = CronJob & { nextDate: () => CronDateLike };

/**
 * Run the weekly batch creation. Called by the cron job.
 */
async function runWeeklyBatchCreation(): Promise<void> {
  log.info('[BatchScheduler] Starting weekly batch creation...');

  // FIX 7: Distributed lock to prevent duplicate execution across instances.
  const LOCK_KEY = 'rez-karma:batch-scheduler-lock';
  const LOCK_TTL = 300; // 5 minutes
  const lockAcquired = await redis.set(LOCK_KEY, 'locked', 'EX', LOCK_TTL, 'NX');
  if (!lockAcquired) {
    log.info('[BatchScheduler] Skipped — another instance holds the lock');
    return;
  }

  try {
    const batches = await createWeeklyBatch();

    if (batches.length === 0) {
      log.info('[BatchScheduler] No batches created — no pending records found.');
      return;
    }

    const totalKarma = batches.reduce((sum, b) => sum + (b.totalKarma ?? 0), 0);
    const totalCoins = batches.reduce((sum, b) => sum + (b.totalRezCoinsEstimated ?? 0), 0);

    log.info('[BatchScheduler] Weekly batch creation complete', {
      batchCount: batches.length,
      totalKarma,
      totalEstimatedCoins: totalCoins,
      batchIds: batches.map((b) => b._id.toString()),
    });
  } catch (err) {
    log.error('[BatchScheduler] Weekly batch creation failed', {
      error: (err as Error).message,
      stack: (err as Error).stack,
    });
    // CRON-002 FIX: Don't rethrow — keep the cron job alive for the next scheduled run.
    // Rethrowing kills the worker after the first failure, causing weekly batch processing
    // to silently stop until a restart.
  } finally {
    await redis.del(LOCK_KEY).catch(() => {});
  }
}

/**
 * Start the batch scheduler cron job.
 * Safe to call multiple times (idempotent — won't start duplicate jobs).
 */
export function startBatchScheduler(): void {
  if (job) {
    log.warn('[BatchScheduler] Scheduler already running, skipping start.');
    return;
  }

  const schedule = batchCronSchedule;
  log.info('[BatchScheduler] Initializing cron job', { schedule });

  // CRON-001 FIX: Distributed lock — prevents N× execution in multi-instance deploy
  job = new CronJob(schedule, async () => {
    const LOCK_KEY = 'rez-karma:batch-scheduler-lock';
    const LOCK_TTL = 600; // 10 minutes
    const lockAcquired = await redis.set(LOCK_KEY, '1', 'EX', LOCK_TTL, 'NX');
    if (!lockAcquired) {
      log.info('[BatchScheduler] Skipped — another instance holds the lock');
      return;
    }
    try {
      await runWeeklyBatchCreation();
    } finally {
      try {
        await redis.del(LOCK_KEY);
      } catch (delErr) {
        log.error('[BatchScheduler] Failed to release lock', { LOCK_KEY, error: delErr });
      }
    }
  });

  // Run on next tick to verify no immediate errors
  setImmediate(() => {
    if (job) {
      job.start();
      const nextRun = (job as CronJobWithNextDate).nextDate?.()?.toISO() ?? 'unknown';
      log.info('[BatchScheduler] Scheduler started', { schedule, nextRun });
    }
  });
}

/**
 * Stop the batch scheduler cron job.
 */
export function stopBatchScheduler(): void {
  if (job) {
    job.stop();
    job = null;
    log.info('[BatchScheduler] Scheduler stopped');
  }
}

/**
 * Manually trigger a batch run (useful for testing or admin override).
 */
export async function triggerBatchCreation(): Promise<number> {
  const batches = await createWeeklyBatch();
  return batches.length;
}
