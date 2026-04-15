import type { VerificationSignals, EarnRecordStatus, Level } from '../types/index.js';
export interface CreateEarnRecordParams {
    userId: string;
    eventId: string;
    bookingId: string;
    karmaEarned: number;
    verificationSignals: VerificationSignals;
    confidenceScore: number;
    csrPoolId?: string;
}
export interface EarnRecordResponse {
    id: string;
    userId: string;
    eventId: string;
    bookingId: string;
    karmaEarned: number;
    activeLevelAtApproval: Level;
    conversionRate: number;
    csrPoolId: string;
    verificationSignals: VerificationSignals;
    confidenceScore: number;
    status: EarnRecordStatus;
    createdAt: Date;
    approvedAt: Date;
    convertedAt?: Date;
    convertedBy?: string;
    batchId?: string;
    rezCoinsEarned: number;
    idempotencyKey: string;
}
export interface PaginatedEarnRecords {
    records: EarnRecordResponse[];
    total: number;
    page: number;
    hasMore: boolean;
}
/**
 * Create a new EarnRecord after verified event completion.
 *
 * Snapshots the user's current level and conversion rate at approval time
 * (rate does not change even if level decays before conversion).
 *
 * Idempotency is guaranteed by the unique idempotencyKey constraint.
 * If a record with the same idempotency key already exists, returns it.
 */
export declare function createEarnRecord(params: CreateEarnRecordParams): Promise<EarnRecordResponse>;
/**
 * Retrieve a single EarnRecord by its _id.
 * Returns null if not found.
 */
export declare function getEarnRecord(recordId: string): Promise<EarnRecordResponse | null>;
/**
 * Retrieve all EarnRecords for a user with optional pagination and status filter.
 *
 * @param userId   MongoDB _id of the user
 * @param options.page     Page number (1-indexed, default 1)
 * @param options.limit    Items per page (default 20, max 100)
 * @param options.status   Filter by EarnRecordStatus
 */
export declare function getUserEarnRecords(userId: string, options?: {
    page?: number;
    limit?: number;
    status?: EarnRecordStatus;
}): Promise<PaginatedEarnRecords>;
/**
 * Retrieve all EarnRecords for a given batch.
 */
export declare function getRecordsByBatch(batchId: string): Promise<EarnRecordResponse[]>;
/**
 * Update the status of an EarnRecord.
 * Returns the updated record or null if not found.
 *
 * Allowed transitions:
 *   APPROVED_PENDING_CONVERSION → CONVERTED | REJECTED | ROLLED_BACK
 *   REJECTED → ROLLED_BACK (admin reversal)
 */
export declare function updateEarnRecordStatus(recordId: string, status: EarnRecordStatus): Promise<EarnRecordResponse | null>;
/**
 * Get all EarnRecords with status APPROVED_PENDING_CONVERSION
 * that are ready for batch conversion.
 */
export declare function getPendingConversionRecords(): Promise<EarnRecordResponse[]>;
//# sourceMappingURL=earnRecordService.d.ts.map