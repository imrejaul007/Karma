"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAudit = logAudit;
exports.getAuditLogs = getAuditLogs;
/**
 * Audit Service — logs all admin actions to a dedicated MongoDB collection.
 *
 * Uses direct MongoDB collection access (no Mongoose model) for write performance.
 * Collection: karma_audit_logs
 */
const mongoose_1 = __importDefault(require("mongoose"));
const logger_js_1 = require("../config/logger.js");
const log = (0, logger_js_1.createServiceLogger)('auditService');
const COLLECTION_NAME = 'karma_audit_logs';
/**
 * Insert a single audit log entry into the dedicated collection.
 * Uses unordered insert for fire-and-forget semantics — failures are logged but not thrown.
 */
async function logAudit(entry) {
    try {
        const db = mongoose_1.default.connection.db;
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
    }
    catch (err) {
        // Duplicate key on idempotency — suppress silently
        const mongoErr = err;
        if (mongoErr.code === 11000) {
            log.debug('Audit duplicate suppressed', { action: entry.action });
            return;
        }
        log.error('Failed to write audit log', { entry, error: err.message });
    }
}
/**
 * Query audit logs with optional filters and pagination.
 *
 * @param options - Filter options (all optional)
 * @returns Paginated results with total count
 */
async function getAuditLogs(options = {}) {
    const { action, adminId, batchId, startDate, endDate, limit = 50, page = 1 } = options;
    const filter = {};
    if (action)
        filter.action = action;
    if (adminId)
        filter.adminId = adminId;
    if (batchId)
        filter.batchId = batchId;
    if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate)
            filter.timestamp.$gte = startDate;
        if (endDate)
            filter.timestamp.$lte = endDate;
    }
    const db = mongoose_1.default.connection.db;
    if (!db) {
        log.warn('getAuditLogs: no DB connection');
        return { logs: [], total: 0, page, hasMore: false };
    }
    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
        db
            .collection(COLLECTION_NAME)
            .find(filter)
            .sort({ timestamp: -1 })
            .skip(skip)
            .limit(limit)
            .toArray(),
        db.collection(COLLECTION_NAME).countDocuments(filter),
    ]);
    return {
        logs,
        total,
        page,
        hasMore: skip + logs.length < total,
    };
}
//# sourceMappingURL=auditService.js.map