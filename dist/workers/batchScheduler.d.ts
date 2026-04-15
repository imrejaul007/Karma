/**
 * Start the batch scheduler cron job.
 * Safe to call multiple times (idempotent — won't start duplicate jobs).
 */
export declare function startBatchScheduler(): void;
/**
 * Stop the batch scheduler cron job.
 */
export declare function stopBatchScheduler(): void;
/**
 * Manually trigger a batch run (useful for testing or admin override).
 */
export declare function triggerBatchCreation(): Promise<number>;
//# sourceMappingURL=batchScheduler.d.ts.map