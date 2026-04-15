import 'dotenv/config';

// ── Service ─────────────────────────────────────────────────────────────────
export const port = parseInt(process.env.PORT || '3009', 10);
export const nodeEnv = process.env.NODE_ENV || 'development';

// ── MongoDB ─────────────────────────────────────────────────────────────────
export const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/rez_karma';

// ── Redis ────────────────────────────────────────────────────────────────────
export const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// ── ReZ Service URLs ────────────────────────────────────────────────────────
export const authServiceUrl =
  process.env.AUTH_SERVICE_URL || 'http://rez-auth-service:3001';
export const walletServiceUrl =
  process.env.WALLET_SERVICE_URL || 'http://rez-wallet-service:4004';
export const merchantServiceUrl =
  process.env.MERCHANT_SERVICE_URL || 'http://rez-merchant-service:3003';

// ── JWT ─────────────────────────────────────────────────────────────────────
export const jwtSecret = process.env.JWT_SECRET as string;

// ── Batch Conversion ────────────────────────────────────────────────────────
export const batchCronSchedule = process.env.BATCH_CRON_SCHEDULE || '59 23 * * 0';

// ── Rate Limiting ───────────────────────────────────────────────────────────
export const rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
export const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);

// ── CORS ───────────────────────────────────────────────────────────────────
export const corsOrigin = (process.env.CORS_ORIGIN || 'https://rez.money')
  .split(',')
  .map((s) => s.trim());
