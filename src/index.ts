import 'dotenv/config';

process.env.SERVICE_NAME = 'rez-karma-service';

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import mongoSanitize from 'express-mongo-sanitize';
import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { logger } from './config/logger';
import { connectMongoDB } from './config/mongodb';
import { redis } from './config/redis';
import { port, corsOrigin, rateLimitWindowMs, rateLimitMax } from './config';
import routes from './routes';
import karmaRoutes from './routes/karmaRoutes';
import karmaScoreRoutes from './routes/karmaScoreRoutes';
import verifyRoutes from './routes/verifyRoutes';
import batchRoutes from './routes/batchRoutes';
import eventRoutes from './routes/eventRoutes';
import walletRoutes from './routes/walletRoutes';
import bookingRoutes from './routes/bookingRoutes';
import { startCoinEventSubscriber, stopCoinEventSubscriber } from './workers/coinEventSubscriber';
import { initScoreRankWorker } from './workers/scoreRankWorker';
import { startDecayWorker } from './workers/decayWorker';
import { seedCommunities } from './config/communitySeed.js';

const app = express();
// Behind Render LB + CF — trust N hops so per-IP rate limiters key on real client IP.
// See MASTER-PLAN-2026-04-19 P1 (trust proxy fleet-wide).
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

// W3C traceparent propagation
app.use((req, _res, next) => {
  const traceparent = req.headers['traceparent'] as string | undefined;
  if (traceparent) {
    (req as any).traceparent = traceparent;
  }
  next();
});

// Core middleware
app.use(helmet());
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(mongoSanitize());

// Rate limiting — global per-IP limit using Redis store.
// RATE-LIMIT-BYPASS FIX (2026-04-17): Always mount rate limiter.
// When Redis is unavailable, express-rate-limit falls back to its built-in
// in-memory store automatically instead of silently bypassing rate limiting.
app.use(
  rateLimit({
    windowMs: rateLimitWindowMs,
    max: rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    store: new RedisStore({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: async (...args: string[]): Promise<any> => {
        return redis.call(...(args as [string, ...string[]]));
      },
    }),
    message: { success: false, message: 'Too many requests, please try again later' },
  }),
);

// ── Health Endpoints ───────────────────────────────────────────────────────────

// Liveness
app.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Readiness
app.get('/health/ready', async (_req, res) => {
  const checks: Record<string, string> = {};
  let ready = true;

  try {
    if (mongoose.connection.readyState !== 1) throw new Error('not connected');
    await mongoose.connection.db?.admin().ping();
    checks.mongodb = 'ok';
  } catch (err: unknown) {
    checks.mongodb = `error: ${err instanceof Error ? err.message : String(err)}`;
    ready = false;
  }

  try {
    await redis.ping();
    checks.redis = 'ok';
  } catch (err: unknown) {
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
  const errors: string[] = [];

  if (mongoose.connection.readyState !== 1) {
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
app.use('/', routes);
app.use('/api/karma', karmaRoutes);
app.use('/api/karma/score', karmaScoreRoutes);
app.use('/api/karma/verify', verifyRoutes);
app.use('/api/karma/batch', batchRoutes);
app.use('/api/karma', eventRoutes);
app.use('/api/karma', walletRoutes);
app.use('/api/karma', bookingRoutes);

// ── Global Error Handler ─────────────────────────────────────────────────────

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error('Unhandled error', { error: message, stack: err instanceof Error ? err.stack : undefined });
  res.status(500).json({ success: false, message });
});

// ── Startup ──────────────────────────────────────────────────────────────────

let isShuttingDown = false;

async function start() {
  // Validate required env vars
  const required = ['MONGODB_URI', 'REDIS_URL'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    logger.error(`[FATAL] Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  // HIGH-7 FIX: Fail fast if internal service token is missing — all wallet operations
  // would silently fail at runtime without this, so validate at startup.
  const internalToken = process.env.INTERNAL_SERVICE_KEY || process.env.INTERNAL_SERVICE_TOKEN;
  if (!internalToken) {
    logger.error('[FATAL] INTERNAL_SERVICE_KEY / INTERNAL_SERVICE_TOKEN is not configured');
    process.exit(1);
  }

  await connectMongoDB();

  // Seed default Cause Communities (idempotent — safe on every startup)
  await seedCommunities();

  // XS-CRIT-007 FIX: Start the coin event subscriber so the karma service can
  // react to coin credit events from the wallet service and other services.
  await startCoinEventSubscriber();

  // Start background cron workers
  startDecayWorker();
  initScoreRankWorker();

  const server = app.listen(port, '0.0.0.0', () => {
    logger.info(`[rez-karma-service] HTTP API listening on port ${port}`);
  });

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info(`[SHUTDOWN] ${signal} received — graceful shutdown starting`);

    server.close(() => {
      logger.info('[SHUTDOWN] HTTP server closed');
    });

    try {
      await mongoose.disconnect();
      logger.info('[SHUTDOWN] MongoDB disconnected');

      const { bullmqRedis, markRedisShutdownInitiated } = await import('./config/redis');
      markRedisShutdownInitiated();

      // XS-CRIT-007 FIX: Stop coin event subscriber before closing Redis connections
      await stopCoinEventSubscriber().catch(() => {});

      await redis.quit().catch(() => {});
      await bullmqRedis.quit().catch(() => {});
      logger.info('[SHUTDOWN] Redis connections closed');

      logger.info('[SHUTDOWN] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('[SHUTDOWN] Error during shutdown', err);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (reason: unknown) => {
    logger.error('Unhandled promise rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });
}

start().catch((err) => {
  logger.error('[FATAL] Failed to start:', err);
  process.exit(1);
});

export default app;
