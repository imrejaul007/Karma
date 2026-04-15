"use strict";
// Connection modes:
//   Single node: REDIS_URL=redis://host:6379
//   Sentinel:    REDIS_SENTINEL_HOSTS=s1:26379,s2:26379,s3:26379
//                REDIS_SENTINEL_NAME=mymaster
//                REDIS_PASSWORD=...
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bullmqRedis = exports.redis = void 0;
exports.markRedisShutdownInitiated = markRedisShutdownInitiated;
const ioredis_1 = __importDefault(require("ioredis"));
const logger_1 = require("./logger");
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redisShutdownInitiated = false;
function markRedisShutdownInitiated() {
    redisShutdownInitiated = true;
}
function parsedUrl() {
    try {
        return new URL(redisUrl);
    }
    catch {
        return { hostname: 'localhost', port: '6379', password: '' };
    }
}
const reconnectOnError = (err) => err.message.includes('ECONNRESET') ||
    err.message.includes('EPIPE') ||
    err.message.includes('READONLY');
const sentinelRaw = process.env.REDIS_SENTINEL_HOSTS;
const sentinels = sentinelRaw
    ? sentinelRaw.split(',').map((h) => {
        const [host, port] = h.trim().split(':');
        return { host: host || 'localhost', port: parseInt(port || '26379', 10) };
    })
    : undefined;
const sentinelName = process.env.REDIS_SENTINEL_NAME || 'mymaster';
const redisPassword = process.env.REDIS_PASSWORD;
// General-purpose Redis client for caching.
exports.redis = sentinels
    ? new ioredis_1.default({
        sentinels,
        name: sentinelName,
        password: redisPassword,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        keepAlive: 10000,
        lazyConnect: false,
        retryStrategy: (times) => {
            const base = Math.min(Math.pow(2, times) * 200, 15000);
            return Math.floor(base + Math.random() * 500);
        },
        reconnectOnError,
    })
    : new ioredis_1.default(redisUrl, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        keepAlive: 10000,
        lazyConnect: false,
        password: redisPassword,
        tls: redisUrl.startsWith('rediss://') ? {} : undefined,
        retryStrategy: (times) => {
            const base = Math.min(Math.pow(2, times) * 200, 15000);
            return Math.floor(base + Math.random() * 500);
        },
        reconnectOnError,
    });
exports.redis.on('connect', () => logger_1.logger.info('[Redis:cache] Connected'));
exports.redis.on('ready', () => logger_1.logger.info('[Redis:cache] Ready'));
exports.redis.on('error', (err) => {
    if (redisShutdownInitiated) {
        logger_1.logger.info('[Redis:cache] Connection closing during shutdown');
        return;
    }
    logger_1.logger.error('[Redis:cache] Error: ' + err.message);
});
exports.redis.on('reconnecting', () => logger_1.logger.warn('[Redis:cache] Reconnecting...'));
exports.redis.on('end', () => {
    if (redisShutdownInitiated) {
        logger_1.logger.info('[Redis:cache] Connection closed (shutdown)');
        return;
    }
    logger_1.logger.error('[Redis:cache] Connection permanently closed');
});
// BullMQ Redis client (needs maxRetriesPerRequest: null).
exports.bullmqRedis = sentinels
    ? new ioredis_1.default({
        sentinels,
        name: sentinelName,
        password: redisPassword,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        keepAlive: 10000,
        lazyConnect: false,
        retryStrategy: (times) => {
            const base = Math.min(Math.pow(2, times) * 200, 15000);
            return Math.floor(base + Math.random() * 1000);
        },
        reconnectOnError,
    })
    : (() => {
        const u = parsedUrl();
        return new ioredis_1.default({
            host: u.hostname || 'localhost',
            port: parseInt(u.port || '6379', 10),
            password: redisPassword || u.password || undefined,
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            keepAlive: 10000,
            lazyConnect: false,
            tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
            retryStrategy: (times) => {
                const base = Math.min(Math.pow(2, times) * 200, 15000);
                return Math.floor(base + Math.random() * 1000);
            },
            reconnectOnError,
        });
    })();
exports.bullmqRedis.on('connect', () => logger_1.logger.info('[Redis:bullmq] Connected'));
exports.bullmqRedis.on('ready', () => logger_1.logger.info('[Redis:bullmq] Ready'));
exports.bullmqRedis.on('reconnecting', () => logger_1.logger.warn('[Redis:bullmq] Reconnecting...'));
exports.bullmqRedis.on('error', (err) => {
    if (redisShutdownInitiated) {
        logger_1.logger.info('[Redis:bullmq] Connection closing during shutdown');
        return;
    }
    logger_1.logger.error('[Redis:bullmq] Error: ' + err.message);
});
exports.bullmqRedis.on('end', () => {
    if (redisShutdownInitiated) {
        logger_1.logger.info('[Redis:bullmq] Connection closed (shutdown)');
        return;
    }
    logger_1.logger.error('[Redis:bullmq] Connection closed');
});
//# sourceMappingURL=redis.js.map