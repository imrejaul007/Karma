import { Batch } from '../models/Batch.js';
export interface AnomalyFlag {
    type: 'too_many_from_one_ngo' | 'suspicious_timestamps' | 'pool_shortage';
    count: number;
    resolved: boolean;
}
export interface BatchPreview {
    batch: {
        _id: string;
        weekStart: Date;
        weekEnd: Date;
        csrPoolId: string;
        status: string;
        totalEarnRecords: number;
        totalKarma: number;
        totalRezCoinsEstimated: number;
        anomalyFlags: AnomalyFlag[];
    };
    pool: {
        _id: string;
        name: string;
        coinPoolRemaining: number;
        status: string;
    };
    records: Array<{
        _id: string;
        userId: string;
        karmaEarned: number;
        conversionRateSnapshot: number;
        estimatedCoins: number;
        cappedCoins: number;
        status: string;
    }>;
    summary: {
        totalRecords: number;
        totalKarma: number;
        totalEstimated: number;
        totalCapped: number;
        poolRemaining: number;
        exceedsPool: boolean;
    };
    anomalies: AnomalyFlag[];
    recordsSample: Array<{
        _id: string;
        userId: string;
        karmaEarned: number;
        estimatedCoins: number;
        cappedCoins: number;
    }>;
}
export interface ExecutionResult {
    success: boolean;
    batchId: string;
    processed: number;
    succeeded: number;
    failed: number;
    totalCoinsIssued: number;
    errors: string[];
}
export interface EarnRecordData {
    _id: string;
    userId: string;
    karmaEarned: number;
    conversionRateSnapshot: number;
    status: string;
    estimatedCoins: number;
    cappedCoins: number;
}
/**
 * Create weekly batches for all CSR pools with pending earn records.
 * Groups records by csrPoolId and creates one batch per pool.
 *
 * @returns Array of created Batch documents
 */
export declare function createWeeklyBatch(): Promise<InstanceType<typeof Batch>[]>;
/**
 * Create a single batch for a specific CSR pool.
 * Checks pool availability and creates a READY batch if sufficient coins remain.
 *
 * @param csrPoolId - CSR Pool ID
 * @param weekStart - Week start date
 * @param weekEnd - Week end date
 * @param group - Pre-computed aggregate group data (optional)
 */
export declare function createBatchForPool(csrPoolId: string, weekStart: Date, weekEnd: Date, group?: {
    _id: string;
    records: {
        _id: string;
    }[];
    totalKarma: number;
    totalCoinsEstimated: number;
    count: number;
}): Promise<InstanceType<typeof Batch> | null>;
/**
 * Get a full preview of a batch including pool info, capped records, summary, and anomalies.
 */
export declare function getBatchPreview(batchId: string): Promise<BatchPreview | null>;
/**
 * Execute a batch: credit all pending earn records and update statuses.
 * Each record is processed atomically — individual failures do not block other records.
 * Uses idempotency keys to prevent double-crediting.
 */
export declare function executeBatch(batchId: string, adminId: string): Promise<ExecutionResult>;
/**
 * Apply the per-user weekly coin cap (300 coins) to a karma conversion.
 *
 * @param record - Earn record with karmaEarned and conversionRateSnapshot
 * @param weeklyUsed - Coins already used this week by the same user
 * @returns Coins to issue after cap enforcement
 */
export declare function applyCapsToRecord(record: {
    karmaEarned: number;
    conversionRateSnapshot: number;
}, weeklyUsed: number): number;
/**
 * Detect anomalies in a batch: high NGO concentration, suspicious timestamps, pool shortage.
 */
export declare function checkBatchAnomalies(batchId: string, csrPoolId: string, weekStart: Date, weekEnd: Date): Promise<AnomalyFlag[]>;
/**
 * Pause all READY/DRAFT batches. Used as a kill switch during emergencies.
 *
 * @param reason - Reason for pausing (logged in audit trail)
 * @returns Number of batches paused
 */
export declare function pauseAllPendingBatches(reason: string): Promise<number>;
/**
 * Notify users of successful coin conversion.
 * In Phase 1 this logs the notification. In Phase 2 this would send push + in-app notifications.
 */
export declare function notifyUsersOfConversion(records: EarnRecordData[]): Promise<void>;
//# sourceMappingURL=batchService.d.ts.map