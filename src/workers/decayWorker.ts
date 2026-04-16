/**
 * Decay Worker — daily cron job for karma decay
 *
 * Runs at midnight UTC every day (0 0 * * *).
 * Applies decay to all active karma profiles that have been inactive
 * for 30+ days, and logs level drops.
 */
import { CronJob } from 'cron';
import { applyDecayToAll } from '../services/karmaService.js';
import { logger } from '../utils/logger.js';

// G-KS-B5 FIX: Decay runs DAILY (midnight UTC), not weekly.
// The weekly batchCronSchedule is used for batch conversion, not decay.
const DAILY_DECAY_SCHEDULE = '0 0 * * *';

let job: CronJob | null = null;

/**
 * Start the decay cron job.
 * Should be called once after the MongoDB connection is established.
 */
export function startDecayWorker(): void {
  if (job) {
    logger.warn('Decay worker already started');
    return;
  }

  job = new CronJob({
    cronTime: DAILY_DECAY_SCHEDULE,
    onTick: async () => {
      await runDecayJob();
    },
    onComplete: () => {
      logger.info('Decay cron job completed');
    },
    timeZone: 'UTC',
    start: false,
  });

  job.start();
  logger.info(`Decay worker started — scheduled daily at midnight UTC (${DAILY_DECAY_SCHEDULE})`);
}

/**
 * Stop the decay cron job (useful for graceful shutdown).
 */
export function stopDecayWorker(): void {
  if (job) {
    job.stop();
    job = null;
    logger.info('Decay worker stopped');
  }
}

/**
 * Execute the decay job. Exported for testing and manual triggering.
 */
export async function runDecayJob(): Promise<{
  processed: number;
  decayed: number;
  levelDrops: number;
}> {
  logger.info('Starting daily karma decay job');

  try {
    const result = await applyDecayToAll();
    logger.info(
      `Decay job finished: processed=${result.processed}, ` +
        `decayed=${result.decayed}, levelDrops=${result.levelDrops}`,
    );
    return result;
  } catch (err) {
    logger.error('Decay job failed with error', { error: err });
    throw err;
  }
}

/**
 * Returns the next scheduled run time, or null if not running.
 */
export function getNextRunTime(): Date | null {
  if (!job) return null;
  try {
    return job.nextDate().toJSDate();
  } catch {
    return null;
  }
}
