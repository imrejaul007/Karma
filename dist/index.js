"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
process.env.SERVICE_NAME = 'rez-karma-service';
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const mongoose_1 = __importDefault(require("mongoose"));
const express_mongo_sanitize_1 = __importDefault(require("express-mongo-sanitize"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const rate_limit_redis_1 = __importDefault(require("rate-limit-redis"));
const logger_1 = require("./config/logger");
const mongodb_1 = require("./config/mongodb");
const redis_1 = require("./config/redis");
const config_1 = require("./config");
const routes_1 = __importDefault(require("./routes"));
const karmaRoutes_1 = __importDefault(require("./routes/karmaRoutes"));
const verifyRoutes_1 = __importDefault(require("./routes/verifyRoutes"));
const batchRoutes_1 = __importDefault(require("./routes/batchRoutes"));
const app = (0, express_1.default)();
// W3C traceparent propagation
app.use((req, _res, next) => {
    const traceparent = req.headers['traceparent'];
    if (traceparent) {
        req.traceparent = traceparent;
    }
    next();
});
// Core middleware
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: config_1.corsOrigin, credentials: true }));
app.use(express_1.default.json({ limit: '100kb' }));
app.use((0, express_mongo_sanitize_1.default)());
// Rate limiting — global per-IP limit using Redis store
if (redis_1.redis.status === 'ready' || redis_1.redis.status === 'connect') {
    app.use((0, express_rate_limit_1.default)({
        windowMs: config_1.rateLimitWindowMs,
        max: config_1.rateLimitMax,
        standardHeaders: true,
        legacyHeaders: false,
        store: new rate_limit_redis_1.default({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            sendCommand: async (...args) => {
                return redis_1.redis.call(...args);
            },
        }),
        message: { success: false, message: 'Too many requests, please try again later' },
    }));
}
// ── Health Endpoints ───────────────────────────────────────────────────────────
// Liveness
app.get('/health/live', (_req, res) => {
    res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});
// Readiness
app.get('/health/ready', async (_req, res) => {
    const checks = {};
    let ready = true;
    try {
        if (mongoose_1.default.connection.readyState !== 1)
            throw new Error('not connected');
        await mongoose_1.default.connection.db?.admin().ping();
        checks.mongodb = 'ok';
    }
    catch (err) {
        checks.mongodb = `error: ${err instanceof Error ? err.message : String(err)}`;
        ready = false;
    }
    try {
        await redis_1.redis.ping();
        checks.redis = 'ok';
    }
    catch (err) {
        checks.redis = `degraded: ${err instanceof Error ? err.message : String(err)}`;
    }
    res.status(ready ? 200 : 503).json({
        status: ready ? 'ready' : 'degraded',
        checks,
        timestamp: new Date().toISOString(),
    });
});
// Main health endpoint
app.get('/health', async (_req, res) => {
    const errors = [];
    if (mongoose_1.default.connection.readyState !== 1) {
        errors.push('MongoDB not connected');
    }
    const status = errors.length > 0 ? 'degraded' : 'ok';
    res.status(errors.length > 0 ? 503 : 200).json({
        status,
        service: 'rez-karma-service',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
    });
});
app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', routes_1.default);
app.use('/api/karma', karmaRoutes_1.default);
app.use('/api/karma/verify', verifyRoutes_1.default);
app.use('/api/karma/batch', batchRoutes_1.default);
// ── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    logger_1.logger.error('Unhandled error', { error: message, stack: err instanceof Error ? err.stack : undefined });
    res.status(500).json({ success: false, message });
});
// ── Startup ──────────────────────────────────────────────────────────────────
let isShuttingDown = false;
async function start() {
    // Validate required env vars
    const required = ['MONGODB_URI', 'REDIS_URL'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        logger_1.logger.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
    await (0, mongodb_1.connectMongoDB)();
    const server = app.listen(config_1.port, '0.0.0.0', () => {
        logger_1.logger.info(`[rez-karma-service] HTTP API listening on port ${config_1.port}`);
    });
    const shutdown = async (signal) => {
        if (isShuttingDown)
            return;
        isShuttingDown = true;
        logger_1.logger.info(`[SHUTDOWN] ${signal} received — graceful shutdown starting`);
        server.close(() => {
            logger_1.logger.info('[SHUTDOWN] HTTP server closed');
        });
        try {
            await mongoose_1.default.disconnect();
            logger_1.logger.info('[SHUTDOWN] MongoDB disconnected');
            const { bullmqRedis, markRedisShutdownInitiated } = await Promise.resolve().then(() => __importStar(require('./config/redis')));
            markRedisShutdownInitiated();
            await redis_1.redis.quit().catch(() => { });
            await bullmqRedis.quit().catch(() => { });
            logger_1.logger.info('[SHUTDOWN] Redis connections closed');
            logger_1.logger.info('[SHUTDOWN] Graceful shutdown complete');
            process.exit(0);
        }
        catch (err) {
            logger_1.logger.error('[SHUTDOWN] Error during shutdown', err);
            process.exit(1);
        }
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('unhandledRejection', (reason) => {
        logger_1.logger.error('Unhandled promise rejection', {
            reason: reason instanceof Error ? reason.message : String(reason),
        });
    });
}
start().catch((err) => {
    logger_1.logger.error('[FATAL] Failed to start:', err);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=index.js.map