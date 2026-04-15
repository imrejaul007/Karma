"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startBatchScheduler = startBatchScheduler;
exports.stopBatchScheduler = stopBatchScheduler;
exports.triggerBatchCreation = triggerBatchCreation;
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
const cron_1 = require("cron");
const batchService_js_1 = require("../services/batchService.js");
const logger_js_1 = require("../config/logger.js");
const index_js_1 = require("../config/index.js");
const log = (0, logger_js_1.createServiceLogger)('batchScheduler');
let job = null;
/**
 * Run the weekly batch creation. Called by the cron job.
 */
async function runWeeklyBatchCreation() {
    log.info('[BatchScheduler] Starting weekly batch creation...');
    try {
        const batches = await (0, batchService_js_1.createWeeklyBatch)();
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
    }
    catch (err) {
        log.error('[BatchScheduler] Weekly batch creation failed', {
            error: err.message,
            stack: err.stack,
        });
        // Don't rethrow — keep the cron job alive for the next scheduled run
    }
}
/**
 * Start the batch scheduler cron job.
 * Safe to call multiple times (idempotent — won't start duplicate jobs).
 */
function startBatchScheduler() {
    if (job) {
        log.warn('[BatchScheduler] Scheduler already running, skipping start.');
        return;
    }
    const schedule = index_js_1.batchCronSchedule;
    log.info('[BatchScheduler] Initializing cron job', { schedule });
    job = new cron_1.CronJob(schedule, runWeeklyBatchCreation);
    // Run on next tick to verify no immediate errors
    setImmediate(() => {
        if (job) {
            job.start();
            const nextRun = job.nextDate?.()?.toISO() ?? 'unknown';
            log.info('[BatchScheduler] Scheduler started', { schedule, nextRun });
        }
    });
}
/**
 * Stop the batch scheduler cron job.
 */
function stopBatchScheduler() {
    if (job) {
        job.stop();
        job = null;
        log.info('[BatchScheduler] Scheduler stopped');
    }
}
/**
 * Manually trigger a batch run (useful for testing or admin override).
 */
async function triggerBatchCreation() {
    const batches = await (0, batchService_js_1.createWeeklyBatch)();
    return batches.length;
}
//# sourceMappingURL=batchScheduler.js.map