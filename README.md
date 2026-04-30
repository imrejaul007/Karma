# Karma by ReZ

Social impact and karma tracking microservice for charitable giving and social good initiatives.

## Brand Identity

> **"Good actions should be visible, valued, and rewarding."**

Karma is: **Positive - Human - Impact-driven - Rewarding**
Feel: **Warm + Trustworthy + Modern** - not NGO-like, not corporate-heavy

### Colors
| Role | Color | Hex |
|------|-------|-----|
| Primary (Impact / Growth) | Fresh Green | `#22C55E` |
| Secondary (Reward / Value) | Warm Gold | `#FACC15` |
| Trust | Sky Blue | `#3B82F6` |
| Neutrals | Near Black / Dark Grey | `#111827` / `#374151` |

### Tagline
**"Do Good. Get Rewarded."**

## Purpose

The Karma Service manages:
- Karma points tracking
- Social impact initiatives
- Charitable giving campaigns
- Impact analytics
- Partner integrations for donations
- Batch conversion processing

## Environment Variables

```env
# Service
PORT=3009
NODE_ENV=development

# Database
MONGODB_URI=mongodb://localhost:27017/rez_karma

# Redis
REDIS_URL=redis://localhost:6379

# Service-to-Service URLs
AUTH_SERVICE_URL=https://rez-auth-service.onrender.com
WALLET_SERVICE_URL=https://rez-wallet-service-36vo.onrender.com
MERCHANT_SERVICE_URL=https://rez-merchant-service-n3q2.onrender.com

# Security
JWT_SECRET=your-32-char-minimum-jwt-secret-here
INTERNAL_SERVICE_TOKEN=your-internal-service-token-here

# Firebase Cloud Messaging
FCM_SERVER_KEY=your-fcm-server-key-here

# ReZ Mind Intent Capture
INTENT_CAPTURE_URL=https://rez-intent-graph.onrender.com

# Batch Conversion
BATCH_CRON_SCHEDULE=59 23 * * 0

# CORS
CORS_ORIGIN=https://rez.money,https://app.rez.money

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX=100
```

## Local Development

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start MongoDB and Redis (example)
docker run -d -p 27017:27017 mongo:7
docker run -d -p 6379:6379 redis:7-alpine

# Start development server
npm run dev

# Production build
npm run build

# Start production server
npm start

# Run tests
npm test
```

## API Endpoints

### Karma Points

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/karma/user/:userId | User | Get user's karma balance |
| POST | /api/karma/earn | User | Earn karma points |

### Verification

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/karma/verify/checkin | User | QR/GPS check-in |
| POST | /api/karma/verify/checkout | User | QR/GPS check-out |

### Batch (Admin)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/karma/batch | Admin | List all batches |
| POST | /api/karma/batch/:id/preview | Admin | Preview conversion |
| POST | /api/karma/batch/:id/execute | Admin | Execute conversion |
| POST | /api/karma/batch/kill-switch | Admin | Pause all pending batches |

### Impact Initiatives

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/initiatives | List active initiatives |
| GET | /api/initiatives/:initiativeId | Get initiative details |
| POST | /api/initiatives | Create initiative |
| POST | /api/initiatives/:initiativeId/donate | Donate to initiative |

### Impact Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/impact/user/:userId | User's impact summary |
| GET | /api/impact/global | Global impact metrics |

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check |
| GET | /health/live | Liveness probe |
| GET | /healthz | K8s-compatible probe |
| GET | /metrics | Memory + uptime metrics |

## Level System

| Level | Active Karma | Conversion Rate |
|-------|-------------|-----------------|
| L1 | 0-999 | 25% |
| L2 | 1000-2999 | 50% |
| L3 | 3000-5999 | 75% |
| L4 | 6000+ | 100% |

## Batch Guardrails

- **Per-user weekly cap:** 300 ReZ Coins per user per week
- **Pool availability check:** Batch execution blocked if CSR pool insufficient
- **Anomaly detection:** Flags for suspicious timestamp clusters
- **Idempotency:** `batch_execute_{batchId}_{recordId}` key prevents double-crediting
- **Kill switch:** `POST /api/karma/batch/kill-switch` pauses all READY batches

## Conversion Flow

```
Event Complete -> NGO Approves -> EarnRecord (APPROVED_PENDING_CONVERSION)
                                              |
                                        Weekly Batch Cron
                                        (Sunday 23:59)
                                              |
                                        Admin Preview
                                              |
                                        Admin Execute -> ReZ Wallet credited
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (App)                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ JWT Auth
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                 rez-karma-service :3009                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Karma      │  │ Verification │  │ Batch Conversion       │ │
│  │ Engine     │  │ Engine       │  │ Engine (BullMQ Cron)  │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ KarmaProfile│  │ EarnRecord   │  │ Batch / CSRPool       │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└───────────┬──────────────┬──────────────────┬───────────────────┘
            │              │                  │
            ▼              ▼                  ▼
┌────────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│ReZ Auth        │  │ReZ Wallet   │  │ReZ Merchant (BizOS)     │
│Service         │  │Service      │  │(NGO approvals)          │
└────────────────┘  └──────────────┘  └──────────────────────────┘
```

## Data Models

| Model | Purpose |
|-------|---------|
| `KarmaProfile` | User karma level, trust score, conversion history |
| `EarnRecord` | Per-event karma earn record with verification signals |
| `Batch` | Weekly batch of earn records awaiting conversion |
| `CSRPool` | Corporate CSR coin pool linked to campaigns |
| `KarmaEvent` | Event configuration (karma/hour, difficulty, verification mode) |

## Deployment

### Docker Compose
```bash
docker-compose -f docker-compose.yml up -d
```

### Docker
```bash
docker build -t rez-karma-service .
docker run -d -p 3009:3009 --env-file .env rez-karma-service
```

### Render.com

Connect the `rez-karma-service` repo to Render. Set environment variables:
- `MONGODB_URI` - shared MongoDB cluster URI
- `REDIS_URL` - shared Redis cluster URL
- `AUTH_SERVICE_URL` - `https://rez-auth-service.onrender.com`
- `WALLET_SERVICE_URL` - `https://rez-wallet-service.onrender.com`
- `BATCH_CRON_SCHEDULE` - `59 23 * * 0`
- `JWT_SECRET` - shared JWT secret
- `INTERNAL_SERVICE_TOKEN` - service-to-service auth token

## Related Services

- **rez-wallet-service** - Karma balance management
- **rez-merchant-service** - Order-based karma
- **rez-intent-graph** - ReZ Mind intent capture

## License

MIT
