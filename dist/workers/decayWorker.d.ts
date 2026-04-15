/**
 * Start the decay cron job.
 * Should be called once after the MongoDB connection is established.
 */
export declare function startDecayWorker(): void;
/**
 * Stop the decay cron job (useful for graceful shutdown).
 */
export declare function stopDecayWorker(): void;
/**
 * Execute the decay job. Exported for testing and manual triggering.
 */
export declare function runDecayJob(): Promise<{
    processed: number;
    decayed: number;
    levelDrops: number;
}>;
/**
 * Returns the next scheduled run time, or null if not running.
 */
export declare function getNextRunTime(): Date | null;
//# sourceMappingURL=decayWorker.d.ts.map