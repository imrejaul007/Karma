// Connection modes:
//   Single node: REDIS_URL=redis://host:6379
//   Sentinel:    REDIS_SENTINEL_HOSTS=s1:26379,s2:26379,s3:26379
//                REDIS_SENTINEL_NAME=mymaster
//                REDIS_PASSWORD=...

import IORedis from 'ioredis';
import { logger } from './logger';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
let redisShutdownInitiated = false;

export function markRedisShutdownInitiated(): void {
  redisShutdownInitiated = true;
}

function parsedUrl() {
  try {
    return new URL(redisUrl);
  } catch {
    return { hostname: 'localhost', port: '6379', password: '' };
  }
}

const reconnectOnError = (err: Error) =>
  err.message.includes('ECONNRESET') ||
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
export const redis: IORedis = sentinels
  ? new IORedis({
      sentinels,
      name: sentinelName,
      password: redisPassword,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      keepAlive: 10000,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        const base = Math.min(Math.pow(2, times) * 200, 15000);
        // NOTE: Math.random() is intentional here for non-cryptographic retry jitter
        return Math.floor(base + Math.random() * 500);
      },
      reconnectOnError,
    })
  : new IORedis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      keepAlive: 10000,
      lazyConnect: false,
      password: redisPassword,
      tls: redisUrl.startsWith('rediss://') ? {} : undefined,
      retryStrategy: (times: number) => {
        const base = Math.min(Math.pow(2, times) * 200, 15000);
        // NOTE: Math.random() is intentional here for non-cryptographic retry jitter
        return Math.floor(base + Math.random() * 500);
      },
      reconnectOnError,
    });

redis.on('connect', () => logger.info('[Redis:cache] Connected'));
redis.on('ready', () => logger.info('[Redis:cache] Ready'));
redis.on('error', (err: Error) => {
  if (redisShutdownInitiated) {
    logger.info('[Redis:cache] Connection closing during shutdown');
    return;
  }
  logger.error('[Redis:cache] Error: ' + err.message);
});
redis.on('reconnecting', () => logger.warn('[Redis:cache] Reconnecting...'));
redis.on('end', () => {
  if (redisShutdownInitiated) {
    logger.info('[Redis:cache] Connection closed (shutdown)');
    return;
  }
  logger.error('[Redis:cache] Connection permanently closed');
});

// BullMQ Redis client (needs maxRetriesPerRequest: null).
export const bullmqRedis: IORedis = sentinels
  ? new IORedis({
      sentinels,
      name: sentinelName,
      password: redisPassword,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      keepAlive: 10000,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        const base = Math.min(Math.pow(2, times) * 200, 15000);
        // NOTE: Math.random() is intentional here for non-cryptographic retry jitter
        return Math.floor(base + Math.random() * 1000);
      },
      reconnectOnError,
    })
  : (() => {
      const u = parsedUrl();
      return new IORedis({
        host: u.hostname || 'localhost',
        port: parseInt(u.port || '6379', 10),
        password: redisPassword || u.password || undefined,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        keepAlive: 10000,
        lazyConnect: false,
        tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
        retryStrategy: (times: number) => {
          const base = Math.min(Math.pow(2, times) * 200, 15000);
          // NOTE: Math.random() is intentional here for non-cryptographic retry jitter
          return Math.floor(base + Math.random() * 1000);
        },
        reconnectOnError,
      });
    })();

bullmqRedis.on('connect', () => logger.info('[Redis:bullmq] Connected'));
bullmqRedis.on('ready', () => logger.info('[Redis:bullmq] Ready'));
bullmqRedis.on('reconnecting', () => logger.warn('[Redis:bullmq] Reconnecting...'));
bullmqRedis.on('error', (err: Error) => {
  if (redisShutdownInitiated) {
    logger.info('[Redis:bullmq] Connection closing during shutdown');
    return;
  }
  logger.error('[Redis:bullmq] Error: ' + err.message);
});
bullmqRedis.on('end', () => {
  if (redisShutdownInitiated) {
    logger.info('[Redis:bullmq] Connection closed (shutdown)');
    return;
  }
  logger.error('[Redis:bullmq] Connection closed');
});
