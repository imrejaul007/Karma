export interface AuditLogEntry {
    action: string;
    adminId?: string;
    batchId?: string;
    recordId?: string;
    reason?: string;
    timestamp: Date;
    metadata?: Record<string, unknown>;
}
export interface AuditLogQuery {
    action?: string;
    adminId?: string;
    batchId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    page?: number;
}
export interface PaginatedAuditLogs {
    logs: AuditLogEntry[];
    total: number;
    page: number;
    hasMore: boolean;
}
/**
 * Insert a single audit log entry into the dedicated collection.
 * Uses unordered insert for fire-and-forget semantics — failures are logged but not thrown.
 */
export declare function logAudit(entry: AuditLogEntry): Promise<void>;
/**
 * Query audit logs with optional filters and pagination.
 *
 * @param options - Filter options (all optional)
 * @returns Paginated results with total count
 */
export declare function getAuditLogs(options?: AuditLogQuery): Promise<PaginatedAuditLogs>;
//# sourceMappingURL=auditService.d.ts.map