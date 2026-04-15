# Karma by ReZ

Impact Economy Platform backend. Converts verified volunteer hours into ReZ Coins via a weekly admin-triggered batch conversion process.

## Brand Identity

> **"Good actions should be visible, valued, and rewarding."**

Karma is: **Positive · Human · Impact-driven · Rewarding**
Feel: **Warm + Trustworthy + Modern** — not NGO-like, not corporate-heavy

### Colors

| Role | Color | Hex |
|------|-------|-----|
| Primary (Impact / Growth) | Fresh Green | `#22C55E` |
| Secondary (Reward / Value) | Warm Gold | `#FACC15` |
| Trust | Sky Blue | `#3B82F6` |
| Neutrals | Near Black / Dark Grey | `#111827` / `#374151` |

### Typography
Inter or Poppins — clean, modern, fintech-app feel. Bold headings, minimal clutter.

### Voice
Simple · Positive · Action-oriented

| Instead of | Say |
|------------|-----|
| "Participate in CSR activities" | "Do something good today" |
| "Earn rewards" | "Get rewarded for doing good" |
| "Convert karma to coins" | "Turn your impact into value" |
| "Volunteering opportunities" | "Good deeds near you" |

### Tagline
**"Do Good. Get Rewarded."**

### Key Differentiation
This is **NOT:** NGO app, donation platform, charity tracker
This **IS:** Modern, reward-driven, lifestyle-integrated, fintech-clean

> **Think: Headspace meets Robinhood.** Purpose meets reward.

Full brand brief: [`docs/BRAND_IDENTITY.md`](docs/BRAND_IDENTITY.md)

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (App)                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │ JWT Auth
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                 rez-karma-service :3009                         │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ Karma      │  │ Verification │  │ Batch Conversion       │ │
│  │ Engine     │  │ Engine       │  │ Engine (BullMQ Cron)   │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────────────┐ │
│  │ KarmaProfile│  │ EarnRecord   │  │ Batch / CSRPool        │ │
│  └─────────────┘  └──────────────┘  └────────────────────────┘ │
└───────────┬──────────────┬──────────────────┬───────────────────┘
            │              │                  │
            ▼              ▼                  ▼
┌────────────────┐  ┌──────────────┐  ┌──────────────────────────┐
│ReZ Auth        │  │ReZ Wallet   │  │ReZ Merchant (BizOS)     │
│Service         │  │Service      │  │(NGO approvals)          │
│:3001           │  │:4004        │  │:3004                    │
└────────────────┘  └──────────────┘  └──────────────────────────┘

External: MongoDB (schema: rez_karma) + Redis (BullMQ queues)
```

## Data Models

| Model | Purpose |
|-------|---------|
| `KarmaProfile` | User karma level, trust score, conversion history |
| `EarnRecord` | Per-event karma earn record with verification signals |
| `Batch` | Weekly batch of earn records awaiting conversion |
| `CSRPool` | Corporate CSR coin pool linked to campaigns |
| `KarmaEvent` | Event configuration (karma/hour, difficulty, verification mode) |

## Conversion Flow

```
Event Complete → NGO Approves → EarnRecord (APPROVED_PENDING_CONVERSION)
                                            │
                                      Weekly Batch Cron
                                      (Sunday 23:59)
                                            │
                                      Admin Preview
                                            │
                                      Admin Execute → ReZ Wallet credited
```

## API Endpoints

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness + readiness |
| GET | `/health/live` | No | Liveness probe |
| GET | `/healthz` | No | K8s-compatible probe |
| GET | `/metrics` | No | Memory + uptime metrics |

### Karma (Phase 1)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/karma/user/:userId` | User | Get karma profile |
| POST | `/api/karma/earn` | User | Record karma earned |

### Verification
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/karma/verify/checkin` | User | QR/GPS check-in |
| POST | `/api/karma/verify/checkout` | User | QR/GPS check-out |

### Batch (Admin)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/karma/batch` | Admin | List all batches |
| POST | `/api/karma/batch/:id/preview` | Admin | Preview conversion |
| POST | `/api/karma/batch/:id/execute` | Admin | Execute conversion |
| POST | `/api/karma/batch/kill-switch` | Admin | Pause all pending batches |

### Phase 2 (Not Yet Implemented)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/karma/leaderboard` | Top karma earners |
| GET | `/api/karma/feed` | Activity feed |

## Setup

### Prerequisites
- Node.js 20.x
- MongoDB 7.x
- Redis 7.x

### Local Development

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start MongoDB and Redis (example)
docker run -d -p 27017:27017 mongo:7
docker run -d -p 6379:6379 redis:7-alpine

# 4. Start the service in dev mode
npm run dev
```

### Production (Docker)

```bash
# Build and run
docker build -t rez-karma-service .
docker run -d -p 3009:3009 --env-file .env rez-karma-service

# Or use docker-compose
docker-compose -f docker-compose.yml up -d
```

### Run Tests

```bash
npm test
npm run test:coverage
```

### Type Check

```bash
npm run lint
```

## Environment Variables

See [`.env.example`](.env.example) for all variables. Key ones:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3009` | Service port |
| `MONGODB_URI` | — | MongoDB connection string |
| `REDIS_URL` | — | Redis connection URL |
| `AUTH_SERVICE_URL` | `http://rez-auth-service:3001` | ReZ Auth service URL |
| `WALLET_SERVICE_URL` | `http://rez-wallet-service:4004` | ReZ Wallet service URL |
| `BATCH_CRON_SCHEDULE` | `59 23 * * 0` | Weekly batch cron (Sunday 23:59) |

## Level System

| Level | Active Karma | Conversion Rate |
|-------|-------------|-----------------|
| L1 | 0–999 | 25% |
| L2 | 1000–2999 | 50% |
| L3 | 3000–5999 | 75% |
| L4 | 6000+ | 100% |

## Batch Guardrails

- **Per-user weekly cap:** 300 ReZ Coins per user per week
- **Pool availability check:** Batch execution blocked if CSR pool insufficient
- **Anomaly detection:** Flags for suspicious timestamp clusters and >50 records from one NGO
- **Idempotency:** `batch_execute_{batchId}_{recordId}` key prevents double-crediting
- **Kill switch:** `POST /api/karma/batch/kill-switch` pauses all READY batches

## Deployment

### Docker Compose (local / shadow mode)

```bash
docker-compose -f docker-compose.microservices.yml up -d rez-karma-service
```

### Render.com

Connect the `rez-karma-service` repo to Render. Set the following environment variables in the Render dashboard:

- `MONGODB_URI` — shared MongoDB cluster URI
- `REDIS_URL` — shared Redis cluster URL
- `AUTH_SERVICE_URL` — `https://rez-auth-service.onrender.com`
- `WALLET_SERVICE_URL` — `https://rez-wallet-service.onrender.com`
- `MERCHANT_SERVICE_URL` — `https://rez-merchant-service.onrender.com`
- `BATCH_CRON_SCHEDULE` — `59 23 * * 0`
- `JWT_SECRET` — shared JWT secret (same as auth service)
- `INTERNAL_SERVICE_TOKEN` — service-to-service auth token
