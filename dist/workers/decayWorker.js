"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startDecayWorker = startDecayWorker;
exports.stopDecayWorker = stopDecayWorker;
exports.runDecayJob = runDecayJob;
exports.getNextRunTime = getNextRunTime;
/**
 * Decay Worker — daily cron job for karma decay
 *
 * Runs at midnight UTC every day (0 0 * * *).
 * Applies decay to all active karma profiles that have been inactive
 * for 30+ days, and logs level drops.
 */
const cron_1 = require("cron");
const index_js_1 = require("../config/index.js");
const karmaService_js_1 = require("../services/karmaService.js");
const logger_js_1 = require("../utils/logger.js");
let job = null;
/**
 * Start the decay cron job.
 * Should be called once after the MongoDB connection is established.
 */
function startDecayWorker() {
    if (job) {
        logger_js_1.logger.warn('Decay worker already started');
        return;
    }
    job = new cron_1.CronJob({
        cronTime: index_js_1.batchCronSchedule,
        onTick: async () => {
            await runDecayJob();
        },
        onComplete: () => {
            logger_js_1.logger.info('Decay cron job completed');
        },
        timeZone: 'UTC',
        start: false,
    });
    job.start();
    logger_js_1.logger.info('Decay worker started — scheduled for midnight UTC daily');
}
/**
 * Stop the decay cron job (useful for graceful shutdown).
 */
function stopDecayWorker() {
    if (job) {
        job.stop();
        job = null;
        logger_js_1.logger.info('Decay worker stopped');
    }
}
/**
 * Execute the decay job. Exported for testing and manual triggering.
 */
async function runDecayJob() {
    logger_js_1.logger.info('Starting daily karma decay job');
    try {
        const result = await (0, karmaService_js_1.applyDecayToAll)();
        logger_js_1.logger.info(`Decay job finished: processed=${result.processed}, ` +
            `decayed=${result.decayed}, levelDrops=${result.levelDrops}`);
        return result;
    }
    catch (err) {
        logger_js_1.logger.error('Decay job failed with error', { error: err });
        throw err;
    }
}
/**
 * Returns the next scheduled run time, or null if not running.
 */
function getNextRunTime() {
    if (!job)
        return null;
    try {
        return job.nextDate().toJSDate();
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=decayWorker.js.map