/**
 * Audit Service — logs all admin actions to a dedicated MongoDB collection.
 *
 * Uses direct MongoDB collection access (no Mongoose model) for write performance.
 * Collection: karma_audit_logs
 */
import mongoose from 'mongoose';
import { createServiceLogger } from '../config/logger.js';

const log = createServiceLogger('auditService');

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

const COLLECTION_NAME = 'karma_audit_logs';

/**
 * Insert a single audit log entry into the dedicated collection.
 * Uses unordered insert for fire-and-forget semantics — failures are logged but not thrown.
 */
export async function logAudit(entry: AuditLogEntry): Promise<void> {
  try {
    const db = mongoose.connection.db;
    if (!db) {
      log.warn('logAudit: no DB connection, skipping audit write');
      return;
    }

    const doc = {
      ...entry,
      timestamp: entry.timestamp ?? new Date(),
    };

    await db.collection(COLLECTION_NAME).insertOne(doc);
    log.debug('Audit logged', { action: entry.action, adminId: entry.adminId, batchId: entry.batchId });
  } catch (err) {
    // Duplicate key on idempotency — suppress silently
    const mongoErr = err as { code?: number };
    if (mongoErr.code === 11000) {
      log.debug('Audit duplicate suppressed', { action: entry.action });
      return;
    }
    log.error('Failed to write audit log', { entry, error: (err as Error).message });
  }
}

/**
 * Query audit logs with optional filters and pagination.
 *
 * @param options - Filter options (all optional)
 * @returns Paginated results with total count
 */
export async function getAuditLogs(options: AuditLogQuery = {}): Promise<PaginatedAuditLogs> {
  const { action, adminId, batchId, startDate, endDate, limit = 50, page = 1 } = options;

  const filter: Record<string, unknown> = {};

  if (action) filter.action = action;
  if (adminId) filter.adminId = adminId;
  if (batchId) filter.batchId = batchId;

  if (startDate || endDate) {
    filter.timestamp = {};
    if (startDate) (filter.timestamp as Record<string, Date>).$gte = startDate;
    if (endDate) (filter.timestamp as Record<string, Date>).$lte = endDate;
  }

  const db = mongoose.connection.db;
  if (!db) {
    log.warn('getAuditLogs: no DB connection');
    return { logs: [], total: 0, page, hasMore: false };
  }

  const skip = (page - 1) * limit;

  const [logs, total] = await Promise.all([
    db
      .collection<AuditLogEntry>(COLLECTION_NAME)
      .find(filter)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit)
      .toArray(),
    db.collection<AuditLogEntry>(COLLECTION_NAME).countDocuments(filter),
  ]);

  return {
    logs,
    total,
    page,
    hasMore: skip + logs.length < total,
  };
}
