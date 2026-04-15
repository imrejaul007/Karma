"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.corsOrigin = exports.rateLimitMax = exports.rateLimitWindowMs = exports.batchCronSchedule = exports.jwtSecret = exports.merchantServiceUrl = exports.walletServiceUrl = exports.authServiceUrl = exports.redisUrl = exports.mongoUri = exports.nodeEnv = exports.port = void 0;
require("dotenv/config");
// ── Service ─────────────────────────────────────────────────────────────────
exports.port = parseInt(process.env.PORT || '3009', 10);
exports.nodeEnv = process.env.NODE_ENV || 'development';
// ── MongoDB ─────────────────────────────────────────────────────────────────
exports.mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/rez_karma';
// ── Redis ────────────────────────────────────────────────────────────────────
exports.redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// ── ReZ Service URLs ────────────────────────────────────────────────────────
exports.authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://rez-auth-service:3001';
exports.walletServiceUrl = process.env.WALLET_SERVICE_URL || 'http://rez-wallet-service:4004';
exports.merchantServiceUrl = process.env.MERCHANT_SERVICE_URL || 'http://rez-merchant-service:3003';
// ── JWT ─────────────────────────────────────────────────────────────────────
exports.jwtSecret = process.env.JWT_SECRET;
// ── Batch Conversion ────────────────────────────────────────────────────────
exports.batchCronSchedule = process.env.BATCH_CRON_SCHEDULE || '59 23 * * 0';
// ── Rate Limiting ───────────────────────────────────────────────────────────
exports.rateLimitWindowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
exports.rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX || '100', 10);
// ── CORS ───────────────────────────────────────────────────────────────────
exports.corsOrigin = (process.env.CORS_ORIGIN || 'https://rez.money')
    .split(',')
    .map((s) => s.trim());
//# sourceMappingURL=index.js.map