# Karma Service API Reference

**Base URL:** `https://api.rez.money/api/karma`
**Version:** 1.0.0
**Service:** `rez-karma-service`

## Authentication

All endpoints require a valid JWT in the `Authorization` header.

### Bearer Token (User Auth)

```
Authorization: Bearer <user_jwt>
```

The JWT is validated by `requireAuth` middleware. The `userId` is extracted from `req.userId`.

### Admin Bearer Token (Admin Auth)

```
Authorization: Bearer <admin_jwt>
```

Admin-only endpoints are protected by `requireAdminAuth` middleware. Only admins with `admin` or `superadmin` roles can access these endpoints.

---

## Response Format

All responses follow this envelope format:

```json
{
  "success": true,
  "data": { ... }
}
```

On error:

```json
{
  "success": false,
  "message": "Human-readable error message"
}
```

### HTTP Status Codes

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created |
| `400` | Bad Request — invalid input |
| `401` | Unauthorized — missing/invalid token |
| `403` | Forbidden — insufficient permissions |
| `404` | Not Found |
| `409` | Conflict — duplicate or invalid state |
| `500` | Internal Server Error |

---

## Endpoints

### Karma Profile

#### GET /api/karma/user/:userId

Get the full karma profile for a user. Users can only view their own profile.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| userId | string | User ID. Use `me` for the authenticated user. |

**Response `200`:**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "lifetimeKarma": 2450,
  "activeKarma": 1800,
  "level": "L3",
  "conversionRate": 0.75,
  "eventsCompleted": 23,
  "totalHours": 147.5,
  "trustScore": 0.92,
  "badges": [
    { "id": "badge_001", "name": "Early Adopter", "earnedAt": "2025-01-15T10:00:00Z" }
  ],
  "nextLevelAt": 2500,
  "karmaToNextLevel": 700,
  "decayWarning": null,
  "levelHistory": [
    { "level": "L1", "earnedAt": "2025-01-10T00:00:00Z" },
    { "level": "L2", "earnedAt": "2025-02-20T00:00:00Z" },
    { "level": "L3", "earnedAt": "2025-04-01T00:00:00Z" }
  ]
}
```

**Errors:** `401` Unauthorized, `403` Access denied (viewing another user's profile), `404` Profile not found, `500` Server error

---

#### GET /api/karma/user/:userId/history

Get the conversion history for a user, most recent first.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| userId | string | User ID. Use `me` for the authenticated user. |

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | `20` | Max records to return (1-100) |

**Response `200`:**
```json
{
  "history": [
    {
      "karmaConverted": 500,
      "coinsEarned": 250,
      "rate": 0.5,
      "batchId": "507f1f77bcf86cd799439099",
      "convertedAt": "2026-03-31T00:00:00Z"
    }
  ]
}
```

**Errors:** `401` Unauthorized, `403` Access denied, `500` Server error

---

#### GET /api/karma/user/:userId/level

Get level, conversion rate, and next-level threshold for a user.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| userId | string | User ID. Use `me` for the authenticated user. |

**Response `200`:**
```json
{
  "level": "L3",
  "conversionRate": 0.75,
  "nextLevelAt": 2500,
  "activeKarma": 1800
}
```

**Level System:**

| Level | Conversion Rate | Karma Threshold |
|-------|-----------------|----------------|
| L1 | 0.25 | 0 |
| L2 | 0.50 | 500 |
| L3 | 0.75 | 1500 |
| L4 | 1.00 | 3500 |

**Errors:** `401` Unauthorized, `403` Access denied, `500` Server error

---

### Events

#### GET /api/karma/events

List all published karma events with optional filtering.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| category | string | — | `environment` \| `food` \| `health` \| `education` \| `community` |
| status | string | `published,ongoing` | Comma-separated status values |

**Response `200`:**
```json
{
  "success": true,
  "events": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "merchantEventId": "507f1f77bcf86cd799439012",
      "name": "Beach Cleanup Drive",
      "description": "Join us for a morning beach cleanup...",
      "category": "environment",
      "status": "published",
      "difficulty": "easy",
      "expectedDurationHours": 3,
      "baseKarmaPerHour": 10,
      "maxKarmaPerEvent": 50,
      "impactUnit": "volunteer_hours",
      "impactMultiplier": 1.5,
      "gpsRadius": 100,
      "maxVolunteers": 50,
      "confirmedVolunteers": 12,
      "verificationMode": "qr",
      "isJoined": false,
      "date": "2026-05-01",
      "time": "08:00",
      "location": { "name": "Marina Beach", "lat": 13.0827, "lng": 80.2707 },
      "organizer": { "name": "Green Chennai Foundation" }
    }
  ],
  "total": 1
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/event/:eventId

Get details for a single karma event.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| eventId | string | Karma event ID or merchant event ID |

**Response `200`:**
```json
{
  "success": true,
  "event": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Beach Cleanup Drive",
    "description": "Join us for a morning beach cleanup...",
    "category": "environment",
    "status": "published",
    "difficulty": "easy",
    "expectedDurationHours": 3,
    "baseKarmaPerHour": 10,
    "maxKarmaPerEvent": 50,
    "gpsRadius": 100,
    "maxVolunteers": 50,
    "confirmedVolunteers": 12,
    "verificationMode": "qr",
    "isJoined": true,
    "qrCodes": {
      "checkIn": "BKCI-...",
      "checkOut": "BKCO-..."
    },
    "capacity": { "goal": 50, "enrolled": 12 }
  }
}
```

**Errors:** `401` Unauthorized, `400` Invalid event ID, `404` Event not found, `500` Server error

---

#### POST /api/karma/event/join

Join a karma event. Creates a booking and increments confirmed volunteers.

**Auth:** `Bearer <user_jwt>`

**Request body:**
```json
{
  "eventId": "507f1f77bcf86cd799439011"
}
```

**Response `201`:**
```json
{
  "success": true,
  "booking": {
    "_id": "507f1f77bcf86cd799439099",
    "eventId": "507f1f77bcf86cd799439011",
    "bookingReference": "BK-a1b2c3d4-e5f6-...",
    "status": "confirmed",
    "qrCheckedIn": false,
    "qrCheckedOut": false,
    "qrCodes": {
      "checkIn": "BKCI-...",
      "checkOut": "BKCO-..."
    },
    "ngoApproved": false,
    "confidenceScore": 0,
    "verificationStatus": "pending",
    "karmaEarned": 0,
    "createdAt": "2026-04-25T10:30:00Z"
  }
}
```

**Errors:** `400` Missing/invalid eventId, `401` Unauthorized, `404` Event not found or not joinable, `409` Already joined or event at full capacity, `500` Server error

---

#### DELETE /api/karma/event/:eventId/leave

Cancel a booking and leave an event.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| eventId | string | Karma event ID or merchant event ID |

**Response `200`:**
```json
{
  "success": true,
  "message": "Booking cancelled successfully"
}
```

**Errors:** `400` Invalid eventId, `401` Unauthorized, `404` No active booking found, `500` Server error

---

#### GET /api/karma/my-bookings

Get all bookings for the authenticated user.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| status | string | — | `upcoming` \| `ongoing` \| `past` |

**Response `200`:**
```json
{
  "success": true,
  "bookings": [
    {
      "_id": "507f1f77bcf86cd799439099",
      "eventId": "507f1f77bcf86cd799439011",
      "bookingReference": "BK-a1b2c3d4-e5f6-...",
      "status": "checked_in",
      "qrCheckedIn": true,
      "qrCheckedInAt": "2026-05-01T08:05:00Z",
      "qrCheckedOut": false,
      "ngoApproved": false,
      "confidenceScore": 0.95,
      "verificationStatus": "pending",
      "karmaEarned": 0,
      "event": {
        "name": "Beach Cleanup Drive",
        "category": "environment",
        "difficulty": "easy",
        "expectedDurationHours": 3,
        "baseKarmaPerHour": 10,
        "maxKarmaPerEvent": 50
      }
    }
  ],
  "total": 1
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

### Verification

#### POST /api/karma/verify/checkin

Check in to an event using QR code or GPS coordinates.

**Auth:** `Bearer <user_jwt>`

**Request body (QR mode):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "eventId": "507f1f77bcf86cd799439099",
  "mode": "qr",
  "qrCode": "BKCI-a1b2c3d4..."
}
```

**Request body (GPS mode):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "eventId": "507f1f77bcf86cd799439099",
  "mode": "gps",
  "gpsCoords": { "lat": 13.0827, "lng": 80.2707 }
}
```

**Response `200`:**
```json
{
  "success": true,
  "booking": {
    "_id": "507f1f77bcf86cd799439099",
    "qrCheckedIn": true,
    "qrCheckedInAt": "2026-05-01T08:05:00Z",
    "status": "checked_in"
  },
  "confidenceScore": 0.95,
  "status": "checked_in"
}
```

**Errors:** `400` Invalid input (missing fields, invalid coordinates), `401` Unauthorized, `403` Cannot check in on behalf of another user, `500` Server error

---

#### POST /api/karma/verify/checkout

Check out of an event using QR code or GPS coordinates. Triggers karma calculation.

**Auth:** `Bearer <user_jwt>`

**Request body (QR mode):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "eventId": "507f1f77bcf86cd799439099",
  "mode": "qr",
  "qrCode": "BKCO-a1b2c3d4..."
}
```

**Request body (GPS mode):**
```json
{
  "userId": "507f1f77bcf86cd799439011",
  "eventId": "507f1f77bcf86cd799439099",
  "mode": "gps",
  "gpsCoords": { "lat": 13.0827, "lng": 80.2707 }
}
```

**Response `200`:**
```json
{
  "success": true,
  "booking": {
    "_id": "507f1f77bcf86cd799439099",
    "qrCheckedOut": true,
    "qrCheckedOutAt": "2026-05-01T11:30:00Z",
    "status": "completed"
  },
  "confidenceScore": 0.95,
  "status": "completed",
  "earnRecord": {
    "_id": "507f1f77bcf86cd799439100",
    "karmaEarned": 30,
    "conversionRateSnapshot": 0.75,
    "verificationSignals": {
      "qr_in": true,
      "qr_out": true,
      "gps_match": 0.92,
      "ngo_approved": false,
      "photo_proof": false
    },
    "confidenceScore": 0.95
  }
}
```

**Errors:** `400` Invalid input, `401` Unauthorized, `403` Cannot check out on behalf of another user, `500` Server error

---

#### GET /api/karma/verify/status/:bookingId

Get the verification status of a booking including fraud anomaly detection.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| bookingId | string | MongoDB ObjectId of the booking |

**Response `200`:**
```json
{
  "success": true,
  "booking": {
    "id": "507f1f77bcf86cd799439099",
    "userId": "507f1f77bcf86cd799439011",
    "eventId": "507f1f77bcf86cd799439099",
    "qrCheckedIn": true,
    "qrCheckedInAt": "2026-05-01T08:05:00Z",
    "qrCheckedOut": true,
    "qrCheckedOutAt": "2026-05-01T11:30:00Z",
    "ngoApproved": true,
    "ngoApprovedAt": "2026-05-02T10:00:00Z",
    "confidenceScore": 0.95,
    "verificationStatus": "verified",
    "karmaEarned": 30,
    "earnedAt": "2026-05-02T10:00:00Z"
  },
  "anomalies": [],
  "earnRecord": { ... }
}
```

**Errors:** `400` Invalid bookingId, `401` Unauthorized, `403` Access denied, `404` Booking not found, `500` Server error

---

### Karma Score

#### GET /api/karma/score

Get the current user's KarmaScore (300-900 scale with stability buffer).

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "userId": "507f1f77bcf86cd799439011",
    "total": 723,
    "display": 721,
    "raw": 723,
    "components": {
      "base": 300,
      "impact": 180,
      "relativeRank": 120,
      "trust": 78,
      "momentum": 45
    },
    "band": "leader",
    "bandMeta": {
      "label": "Leader",
      "color": "#6366f1",
      "bgColor": "#eef2ff",
      "minScore": 600,
      "maxScore": 749,
      "perks": ["Early access to events", "Priority booking", "Badge: Leader"]
    },
    "percentile": 85.4,
    "trustGrade": "A",
    "momentumLabel": "hot",
    "stability": {
      "raw": 723,
      "display": 721,
      "lastRawAt": 1745600000000
    }
  }
}
```

**Score Bands:**

| Band | Score Range | Color | Perks |
|------|-------------|-------|-------|
| starter | 300-349 | Gray | Basic access |
| active | 350-449 | Green | Verified badge |
| performer | 450-599 | Blue | Early event access |
| leader | 600-749 | Indigo | Priority booking |
| elite | 750-819 | Purple | Exclusive events |
| pinnacle | 820-900 | Gold | Mythical tier |

**Errors:** `401` Unauthorized, `404` Karma profile not found, `500` Server error

---

#### GET /api/karma/score/history

Get the user's score history for the last 90 days.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| days | number | `30` | Number of days to retrieve (1-90) |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "days": 30,
    "entries": [
      {
        "date": "2026-04-01T00:00:00Z",
        "rawScore": 720,
        "displayScore": 718,
        "band": "leader",
        "percentile": 84.2,
        "components": { "base": 300, "impact": 180, "relativeRank": 115, "trust": 78, "momentum": 47 },
        "activeKarma": 1750,
        "lifetimeKarma": 2400
      }
    ]
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/score/leaderboard

Get the karma score leaderboard (public endpoint, no auth required).

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| limit | number | `20` | Max entries to return (1-100) |
| offset | number | `0` | Pagination offset |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "entries": [
      { "rank": 1, "userId": "507f1f77bcf86cd799439011", "activeKarma": 2450 },
      { "rank": 2, "userId": "507f1f77bcf86cd799439012", "activeKarma": 2300 }
    ],
    "total": 1500,
    "limit": 20,
    "offset": 0,
    "hasMore": true
  }
}
```

**Errors:** `500` Server error

---

#### GET /api/karma/score/leaderboard/my-rank

Get the authenticated user's rank on the leaderboard.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "rank": 42,
    "total": 1500,
    "score": 1800,
    "percentile": 97.27
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/score/band/:band

Get metadata for a specific score band.

**Auth:** None (public endpoint)

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| band | string | Band name: `starter` \| `active` \| `performer` \| `leader` \| `elite` \| `pinnacle` |

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "label": "Leader",
    "color": "#6366f1",
    "bgColor": "#eef2ff",
    "minScore": 600,
    "maxScore": 749,
    "perks": ["Early access to events", "Priority booking", "Badge: Leader"]
  }
}
```

**Errors:** `400` Invalid band, `500` Server error

---

### Leaderboards

#### GET /api/karma/leaderboard

Get ranked karma leaderboard with scope and period filtering.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| scope | string | `global` | `global` \| `city` \| `cause` |
| period | string | `all-time` | `all-time` \| `monthly` \| `weekly` |
| limit | number | `50` | Max entries (1-100) |
| offset | number | `0` | Pagination offset |

**Response `200`:**
```json
{
  "success": true,
  "scope": "global",
  "period": "all-time",
  "entries": [
    {
      "rank": 1,
      "userId": "507f1f77bcf86cd799439011",
      "userName": "Alice",
      "avatar": "https://...",
      "activeKarma": 2450,
      "level": "L4",
      "city": "Chennai"
    }
  ],
  "userRank": 42,
  "totalParticipants": 1500,
  "updatedAt": "2026-04-25T10:30:00Z"
}
```

**Errors:** `400` Invalid scope or period, `401` Unauthorized, `500` Server error

---

#### GET /api/karma/leaderboard/me

Get the authenticated user's own rank.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| scope | string | `global` | `global` \| `city` \| `cause` |
| period | string | `all-time` | `all-time` \| `monthly` \| `weekly` |

**Response `200`:**
```json
{
  "success": true,
  "rank": 42,
  "totalParticipants": 1500,
  "scope": "global",
  "period": "all-time"
}
```

**Errors:** `400` Invalid scope or period, `401` Unauthorized, `500` Server error

---

### Micro-Actions

#### GET /api/karma/micro-actions

Get all available and completed micro-actions for today.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "available": [
    {
      "actionKey": "profile_update",
      "name": "Update Profile",
      "description": "Keep your profile fresh",
      "karmaBonus": 5,
      "icon": "user-edit"
    }
  ],
  "completed": [
    {
      "actionKey": "app_open",
      "name": "Open App",
      "completedAt": "2026-04-25T09:00:00Z",
      "karmaEarned": 2
    }
  ],
  "earnedToday": 7,
  "totalActions": 8,
  "dailyComplete": false
}
```

**Available Actions:**

| Action Key | Name | Karma Bonus |
|------------|------|-------------|
| `app_open` | Open App | 2 |
| `profile_update` | Update Profile | 5 |
| `referral_credited` | Referral Credited | 10 |
| `event_completed` | Complete Event | 15 |
| `share_click` | Share Activity | 3 |

**Errors:** `400` Invalid userId, `401` Unauthorized, `500` Server error

---

#### POST /api/karma/micro-actions/:actionKey/claim

Claim a micro-action and receive the karma bonus.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| actionKey | string | The micro-action key to claim |

**Response `200`:**
```json
{
  "success": true,
  "actionKey": "profile_update",
  "karmaEarned": 5,
  "totalEarnedToday": 12
}
```

**Errors:** `400` Invalid actionKey, `401` Unauthorized, `409` Already claimed today, `500` Server error

---

#### POST /api/karma/micro-actions/:actionKey/trigger

Trigger micro-action evaluation (called by other services or on app events).

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| actionKey | string | The micro-action key |

**Request body:**
```json
{
  "trigger": "app_open"
}
```

**Valid triggers:** `app_open` \| `profile_update` \| `referral_credited` \| `event_completed` \| `share_click`

**Response `200`:**
```json
{
  "success": true,
  "triggered": true,
  "newActions": ["profile_update"],
  "bonusKarma": 5
}
```

**Errors:** `400` Invalid trigger, `401` Unauthorized, `500` Server error

---

### Impact Reports

#### GET /api/karma/report

Generate and download the user's Impact Report as a branded PDF.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| name | string | `ReZ Volunteer` | User's display name for the report |
| userName | string | `ReZ Volunteer` | Alias for name |

**Response `200`:**
```json
Content-Type: application/pdf
Content-Disposition: attachment; filename="ImpactReport_Alice_1745600000000.pdf"
```

**PDF includes:**
- User's name and profile
- Total karma earned
- Events completed
- Hours contributed
- Badges earned
- Impact metrics by cause category
- Top events participated

**Errors:** `400` Missing/invalid userName, `401` Unauthorized, `500` Server error

---

#### GET /api/karma/resume

Get the user's Impact Resume as structured JSON.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "profile": {
    "userId": "507f1f77bcf86cd799439011",
    "name": "Alice",
    "karmaScore": 723,
    "band": "leader",
    "level": "L3",
    "activeKarma": 1800,
    "lifetimeKarma": 2450
  },
  "summary": {
    "eventsCompleted": 23,
    "totalHours": 147.5,
    "impactScore": 85
  },
  "badges": [...],
  "timeline": [...],
  "skills": ["Event Coordination", "Team Leadership", "Community Outreach"],
  "certifications": [...],
  "generatedAt": "2026-04-25T10:30:00Z"
}
```

**Errors:** `400` Invalid userId, `401` Unauthorized, `500` Server error

---

#### GET /api/karma/resume/pdf

Get the user's Impact Resume as a branded PDF (two-column layout).

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| name | string | `Volunteer` | User's display name for the PDF |
| userName | string | `Volunteer` | Alias for name |

**Response `200`:**
```json
Content-Type: application/pdf
Content-Disposition: attachment; filename="ImpactResume_Alice_1745600000000.pdf"
```

**Errors:** `400` Missing/invalid userName, `401` Unauthorized, `500` Server error

---

### Cause Communities

#### GET /api/karma/communities

List all available cause communities.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "communities": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "slug": "green-chennai",
      "name": "Green Chennai",
      "description": "Environmental initiatives in Chennai",
      "category": "environment",
      "memberCount": 1250,
      "isFollowing": true,
      "image": "https://..."
    }
  ]
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/communities/:slug

Get detailed information about a community including recent posts.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| slug | string | Community slug (e.g., `green-chennai`) |

**Response `200`:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "slug": "green-chennai",
  "name": "Green Chennai",
  "description": "Environmental initiatives in Chennai",
  "category": "environment",
  "memberCount": 1250,
  "isFollowing": true,
  "recentPosts": [
    {
      "_id": "507f1f77bcf86cd799439099",
      "content": "Join our beach cleanup this weekend!",
      "author": { "userId": "...", "name": "Alice" },
      "likes": 24,
      "createdAt": "2026-04-24T10:00:00Z"
    }
  ]
}
```

**Errors:** `401` Unauthorized, `404` Community not found, `500` Server error

---

#### POST /api/karma/communities/:slug/follow

Follow a cause community.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| slug | string | Community slug |

**Response `200`:**
```json
{
  "success": true
}
```

**Errors:** `401` Unauthorized, `404` Community not found, `500` Server error

---

#### DELETE /api/karma/communities/:slug/follow

Unfollow a cause community.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| slug | string | Community slug |

**Response `200`:**
```json
{
  "success": true
}
```

**Errors:** `401` Unauthorized, `404` Community not found, `500` Server error

---

#### GET /api/karma/communities/:slug/feed

Get paginated feed of posts from a community.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| slug | string | Community slug |

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | `1` | Page number |
| limit | number | `20` | Posts per page (max 50) |

**Response `200`:**
```json
{
  "posts": [
    {
      "_id": "507f1f77bcf86cd799439099",
      "content": "Join our beach cleanup this weekend!",
      "author": { "userId": "...", "name": "Alice", "avatar": "..." },
      "likes": 24,
      "comments": 5,
      "createdAt": "2026-04-24T10:00:00Z"
    }
  ],
  "page": 1,
  "limit": 20
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### POST /api/karma/communities/:slug/posts

Create a new post in a community.

**Auth:** `Bearer <user_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| slug | string | Community slug |

**Request body:**
```json
{
  "content": "Great event today! Thanks everyone for participating.",
  "mediaUrls": ["https://example.com/photo1.jpg"]
}
```

**Response `201`:**
```json
{
  "_id": "507f1f77bcf86cd799439099",
  "content": "Great event today! Thanks everyone for participating.",
  "mediaUrls": ["https://example.com/photo1.jpg"],
  "author": { "userId": "...", "name": "Alice" },
  "communitySlug": "green-chennai",
  "likes": 0,
  "comments": 0,
  "createdAt": "2026-04-25T10:30:00Z"
}
```

**Errors:** `400` Content required, `401` Unauthorized, `404` Community not found, `500` Server error

---

#### GET /api/karma/communities/recommended

Get recommended communities for the user based on their interests and activity.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "communities": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "slug": "food-for-all",
      "name": "Food for All",
      "description": "Fighting hunger in our city",
      "category": "food",
      "memberCount": 890,
      "isFollowing": false,
      "matchScore": 0.85
    }
  ]
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/communities/my

Get communities the authenticated user follows.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "communities": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "slug": "green-chennai",
      "name": "Green Chennai",
      "category": "environment",
      "memberCount": 1250
    }
  ]
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

### Badges & Missions

#### GET /api/karma/badges

Get all earned badges for the authenticated user.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "badges": [
    {
      "id": "early_adopter",
      "name": "Early Adopter",
      "description": "Joined during the beta launch",
      "earnedAt": "2025-01-15T10:00:00Z",
      "icon": "star"
    },
    {
      "id": "event_starter",
      "name": "Event Starter",
      "description": "Completed your first event",
      "earnedAt": "2025-02-01T10:00:00Z",
      "icon": "trophy"
    }
  ]
}
```

**Errors:** `400` Invalid userId, `401` Unauthorized, `500` Server error

---

#### GET /api/karma/missions

Get active missions with progress for the authenticated user.

**Auth:** `Bearer <user_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "missions": [
    {
      "id": "mission_monthly_5",
      "name": "Monthly Marathoner",
      "description": "Complete 5 events this month",
      "target": 5,
      "progress": 3,
      "reward": { "karma": 100, "badge": "monthly_marathoner" },
      "deadline": "2026-04-30T23:59:59Z",
      "completed": false
    }
  ]
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

### CSR Cloud (Admin Only)

#### GET /api/karma/csr/partners

List all corporate partners.

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "partners": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "companyName": "TechCorp India",
      "companySlug": "techcorp-india",
      "logoUrl": "https://...",
      "contactEmail": "csr@techcorp.com",
      "tier": "gold",
      "creditsBudget": 100000,
      "creditsUsed": 25000,
      "createdAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### POST /api/karma/csr/partner

Create a new corporate partner.

**Auth:** `Bearer <admin_jwt>`

**Request body:**
```json
{
  "companyName": "TechCorp India",
  "logoUrl": "https://example.com/logo.png",
  "contactEmail": "csr@techcorp.com",
  "tier": "gold",
  "creditsBudget": 100000
}
```

**Required fields:** `companyName`, `tier`, `creditsBudget`

**Valid tiers:** `bronze` | `silver` | `gold` | `platinum`

**Response `201`:**
```json
{
  "success": true,
  "partner": {
    "_id": "507f1f77bcf86cd799439011",
    "companyName": "TechCorp India",
    "companySlug": "techcorp-india",
    "tier": "gold",
    "creditsBudget": 100000,
    "creditsUsed": 0
  }
}
```

**Errors:** `400` Missing required fields or invalid tier, `401` Unauthorized, `409` Partner already exists, `500` Server error

---

#### GET /api/karma/csr/dashboard

Get the corporate partner dashboard with aggregated metrics.

**Auth:** `Bearer <admin_jwt>`

**Query params:**

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| partnerId | string | Yes | Corporate partner ID |

**Response `200`:**
```json
{
  "partnerId": "507f1f77bcf86cd799439011",
  "companyName": "TechCorp India",
  "tier": "gold",
  "budget": {
    "total": 100000,
    "used": 25000,
    "remaining": 75000,
    "utilizationPercent": 25
  },
  "employees": {
    "total": 150,
    "active": 120
  },
  "impact": {
    "totalKarmaAllocated": 25000,
    "totalVolunteerHours": 1250,
    "eventsSupported": 18,
    "employeesActive": 120
  },
  "period": {
    "startDate": "2026-01-01",
    "endDate": "2026-03-31"
  }
}
```

**Errors:** `400` Missing/invalid partnerId, `401` Unauthorized, `404` Partner not found, `500` Server error

---

#### POST /api/karma/csr/allocate

Allocate karma credits to an employee.

**Auth:** `Bearer <admin_jwt>`

**Request body:**
```json
{
  "partnerId": "507f1f77bcf86cd799439011",
  "recipientUserId": "507f1f77bcf86cd799439099",
  "amount": 500,
  "eventId": "507f1f77bcf86cd799439100"
}
```

**Required fields:** `partnerId`, `recipientUserId`, `amount`

**Response `200`:**
```json
{
  "success": true
}
```

**Errors:** `400` Missing fields, insufficient credits, or invalid IDs, `401` Unauthorized, `500` Server error

---

#### GET /api/karma/csr/report/:partnerId

Generate a CSR report for a corporate partner.

**Auth:** `Bearer <admin_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| partnerId | string | Corporate partner ID |

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| year | number | Current year | Report year |
| quarter | number | Current quarter | Report quarter (1-4) |

**Response `200`:**
```json
{
  "partnerId": "507f1f77bcf86cd799439011",
  "companyName": "TechCorp India",
  "period": {
    "year": 2026,
    "quarter": 1,
    "startDate": "2026-01-01",
    "endDate": "2026-03-31"
  },
  "summary": {
    "totalKarmaAllocated": 15000,
    "totalCoinsIssued": 7500,
    "employeesEnrolled": 150,
    "employeesActive": 120,
    "eventsSupported": 12,
    "volunteerHours": 720
  },
  "byEmployee": [...],
  "byCause": [
    { "cause": "environment", "karma": 6000 },
    { "cause": "education", "karma": 5000 },
    { "cause": "health", "karma": 4000 }
  ],
  "generatedAt": "2026-04-25T10:30:00Z"
}
```

**Errors:** `400` Invalid partnerId, year, or quarter, `401` Unauthorized, `404` Partner not found, `500` Server error

---

#### POST /api/karma/csr/partner/:partnerId/employee

Add an employee to a corporate partner's CSR program.

**Auth:** `Bearer <admin_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| partnerId | string | Corporate partner ID |

**Request body:**
```json
{
  "employeeUserId": "507f1f77bcf86cd799439099"
}
```

**Response `200`:**
```json
{
  "success": true
}
```

**Errors:** `400` Missing fields or invalid IDs, `401` Unauthorized, `404` Partner or employee not found, `500` Server error

---

#### GET /api/karma/csr/partner/:partnerId/employee/:employeeUserId

Get stats for a specific employee in a CSR program.

**Auth:** `Bearer <admin_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| partnerId | string | Corporate partner ID |
| employeeUserId | string | Employee user ID |

**Response `200`:**
```json
{
  "employeeUserId": "507f1f77bcf86cd799439099",
  "partnerId": "507f1f77bcf86cd799439011",
  "enrolledAt": "2026-01-15T00:00:00Z",
  "karmaAllocated": 2500,
  "coinsEarned": 1250,
  "eventsAttended": 8,
  "volunteerHours": 40,
  "activeKarma": 1800,
  "level": "L3",
  "badges": ["csr_champion", "volunteer_streak"]
}
```

**Errors:** `400` Invalid IDs, `401` Unauthorized, `404` Employee not found, `500` Server error

---

### Batch Conversion (Admin Only)

#### GET /api/karma/batch

List all batch conversion records with pagination.

**Auth:** `Bearer <admin_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | `1` | Page number |
| limit | number | `20` | Items per page (max 100) |
| status | string | — | Filter by status: `DRAFT` \| `READY` \| `EXECUTED` \| `PARTIAL` \| `PAUSED` |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "weekStart": "2026-04-01T00:00:00Z",
      "weekEnd": "2026-04-07T23:59:59Z",
      "csrPoolId": "507f1f77bcf86cd799439012",
      "status": "EXECUTED",
      "totalEarnRecords": 150,
      "totalKarma": 7500,
      "totalRezCoinsEstimated": 3750,
      "totalRezCoinsExecuted": 3750,
      "anomalyFlags": [],
      "executedAt": "2026-04-08T00:00:00Z",
      "createdAt": "2026-04-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 12,
    "pages": 1
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/batch/:id

Get a single batch by ID.

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "weekStart": "2026-04-01T00:00:00Z",
    "weekEnd": "2026-04-07T23:59:59Z",
    "status": "EXECUTED",
    "totalEarnRecords": 150,
    "totalKarma": 7500,
    "totalRezCoinsEstimated": 3750,
    "totalRezCoinsExecuted": 3750,
    "pool": {
      "_id": "507f1f77bcf86cd799439012",
      "name": "TechCorp Q2 Pool",
      "coinPoolRemaining": 96250,
      "status": "active"
    }
  }
}
```

**Errors:** `400` Invalid batch ID, `401` Unauthorized, `404` Batch not found, `500` Server error

---

#### GET /api/karma/batch/:id/preview

Get full preview of a batch including capped records, summary, and anomalies.

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "batchId": "507f1f77bcf86cd799439011",
    "status": "READY",
    "pool": { "name": "TechCorp Q2 Pool", "coinPoolRemaining": 96250 },
    "summary": {
      "totalRecords": 150,
      "totalKarma": 7500,
      "cappedRecords": 5,
      "coinsToIssue": 3750
    },
    "anomalies": [
      { "type": "too_many_from_one_ngo", "ngoId": "...", "count": 45, "resolved": false }
    ],
    "records": [...]
  }
}
```

**Errors:** `401` Unauthorized, `404` Batch not found, `500` Server error

---

#### POST /api/karma/batch/:id/execute

Execute a batch conversion. Credits wallets, marks records as converted.

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "message": "Batch executed successfully",
  "data": {
    "batchId": "507f1f77bcf86cd799439011",
    "recordsProcessed": 150,
    "recordsFailed": 0,
    "coinsIssued": 3750,
    "executedAt": "2026-04-08T10:30:00Z"
  }
}
```

**Response `207` (partial success):**
```json
{
  "success": false,
  "message": "Batch executed with errors",
  "data": {
    "batchId": "507f1f77bcf86cd799439011",
    "recordsProcessed": 145,
    "recordsFailed": 5,
    "coinsIssued": 3625
  }
}
```

**Errors:** `400` Batch already executed or not ready, `401` Unauthorized, `404` Batch not found, `500` Server error

---

#### POST /api/karma/batch/pause-all

Kill switch: pause all pending batches.

**Auth:** `Bearer <admin_jwt>`

**Request body:**
```json
{
  "reason": "Pool shortage detected"
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Kill switch activated. 3 batch(es) paused.",
  "data": {
    "pausedCount": 3,
    "reason": "Pool shortage detected"
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/batch/stats

Get overall batch statistics.

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "totalBatches": 52,
    "executedBatches": 48,
    "pendingBatches": 2,
    "partialBatches": 1,
    "totalRecordsConverted": 7500,
    "totalCoinsIssued": 375000,
    "totalKarmaConverted": 750000
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

#### GET /api/karma/batch/audit/logs

Query audit logs for batch operations.

**Auth:** `Bearer <admin_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| action | string | — | Filter by action type |
| adminId | string | — | Filter by admin ID |
| batchId | string | — | Filter by batch ID |
| page | number | `1` | Page number |
| limit | number | `50` | Items per page (max 200) |
| startDate | string | — | ISO date string |
| endDate | string | — | ISO date string |

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "action": "BATCH_EXECUTE",
      "adminId": "507f1f77bcf86cd799439001",
      "batchId": "507f1f77bcf86cd799439011",
      "timestamp": "2026-04-08T10:30:00Z",
      "metadata": { "recordsProcessed": 150, "coinsIssued": 3750 }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 250,
    "hasMore": true
  }
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

### Wallet

#### GET /api/karma/wallet/balance

Get the user's karma points and REZ coins balance.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| coinType | string | `all` | `all` \| `rez_coins` |

**Response `200`:**
```json
{
  "success": true,
  "balance": {
    "karmaPoints": 1800,
    "rezCoins": 450,
    "brandedCoins": {
      "techcorp_rewards": 100
    }
  }
}
```

**Errors:** `401` Unauthorized, `503` Wallet service not configured, `500` Server error

---

#### GET /api/karma/wallet/transactions

Get the user's transaction history.

**Auth:** `Bearer <user_jwt>`

**Query params:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| coinType | string | `all` | Filter by coin type |
| page | number | `1` | Page number |

**Response `200`:**
```json
{
  "success": true,
  "transactions": [
    {
      "_id": "507f1f77bcf86cd799439099",
      "type": "earned",
      "coinType": "karma_points",
      "amount": 30,
      "description": "Beach Cleanup Drive",
      "eventId": "507f1f77bcf86cd799439011",
      "batchId": "507f1f77bcf86cd799439012",
      "createdAt": "2026-05-02T10:00:00Z"
    }
  ],
  "total": 45,
  "page": 1,
  "pages": 3
}
```

**Errors:** `401` Unauthorized, `503` Wallet service not configured, `500` Server error

---

### Admin Operations

#### POST /api/karma/admin/event

Create a new karma event (NGO/Admin only).

**Auth:** `Bearer <admin_jwt>`

**Request body:**
```json
{
  "merchantEventId": "507f1f77bcf86cd799439099",
  "ngoId": "507f1f77bcf86cd799439098",
  "category": "environment",
  "impactUnit": "volunteer_hours",
  "impactMultiplier": 1.5,
  "difficulty": "easy",
  "expectedDurationHours": 3,
  "baseKarmaPerHour": 10,
  "maxKarmaPerEvent": 50,
  "gpsRadius": 100,
  "maxVolunteers": 50
}
```

**Required fields:** `category`, `difficulty`, `expectedDurationHours`, `baseKarmaPerHour`, `maxKarmaPerEvent`

**Valid categories:** `environment` | `food` | `health` | `education` | `community`
**Valid difficulties:** `easy` | `medium` | `hard`

**Response `201`:**
```json
{
  "success": true,
  "event": {
    "_id": "507f1f77bcf86cd799439011",
    "merchantEventId": "507f1f77bcf86cd799439099",
    "category": "environment",
    "status": "draft",
    "difficulty": "easy",
    "expectedDurationHours": 3,
    "baseKarmaPerHour": 10,
    "maxKarmaPerEvent": 50,
    "qrCodes": {
      "checkIn": "BKCI-...",
      "checkOut": "BKCO-..."
    },
    "gpsRadius": 100,
    "maxVolunteers": 50,
    "confirmedVolunteers": 0
  }
}
```

**Errors:** `400` Missing/invalid required fields, `401` Unauthorized, `500` Server error

---

#### PATCH /api/karma/admin/event/:eventId/publish

Publish a draft karma event.

**Auth:** `Bearer <admin_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| eventId | string | Karma event ID |

**Response `200`:**
```json
{
  "success": true,
  "message": "Event published successfully",
  "event": {
    "_id": "507f1f77bcf86cd799439011",
    "status": "published",
    "category": "environment",
    "difficulty": "easy",
    "maxVolunteers": 50,
    "confirmedVolunteers": 0
  }
}
```

**Errors:** `400` Missing required fields, `401` Unauthorized, `404` Event not found, `409` Already published, `500` Server error

---

#### PATCH /api/karma/booking/:bookingId/approve

Approve or reject a booking (NGO/Admin only).

**Auth:** `Bearer <admin_jwt>`

**Path params:**

| Param | Type | Description |
|-------|------|-------------|
| bookingId | string | MongoDB ObjectId of the booking |

**Request body:**
```json
{
  "approved": true
}
```

**Response `200`:**
```json
{
  "success": true,
  "message": "Booking approved"
}
```

**Errors:** `400` Invalid bookingId, `401` Unauthorized, `404` Booking not found, `500` Server error

---

#### POST /api/karma/decay-all

Trigger karma decay across all profiles (Admin only).

**Auth:** `Bearer <admin_jwt>`

**Response `200`:**
```json
{
  "success": true,
  "processed": 500,
  "decayed": 125,
  "levelDrops": 2
}
```

**Errors:** `401` Unauthorized, `500` Server error

---

## Data Models

### KarmaProfile

```typescript
interface KarmaProfile {
  _id: string;
  userId: string;
  lifetimeKarma: number;      // Total karma ever earned
  activeKarma: number;        // Current usable karma
  level: 'L1' | 'L2' | 'L3' | 'L4';
  eventsCompleted: number;
  eventsJoined: number;
  totalHours: number;
  trustScore: number;          // 0.0 - 1.0
  badges: Badge[];
  lastActivityAt: Date;
  levelHistory: LevelHistoryEntry[];
  conversionHistory: ConversionHistoryEntry[];
  thisWeekKarmaEarned: number;
  avgEventDifficulty: number;
  avgConfidenceScore: number;
  checkIns: number;
  approvedCheckIns: number;
  createdAt: Date;
  updatedAt: Date;
}
```

### KarmaEvent

```typescript
interface KarmaEvent {
  _id: string;
  merchantEventId: string;
  ngoId: string;
  category: 'environment' | 'food' | 'health' | 'education' | 'community';
  impactUnit: string;
  impactMultiplier: number;
  difficulty: 'easy' | 'medium' | 'hard';
  expectedDurationHours: number;
  baseKarmaPerHour: number;
  maxKarmaPerEvent: number;
  qrCodes: { checkIn: string; checkOut: string; };
  gpsRadius: number;
  maxVolunteers: number;
  confirmedVolunteers: number;
  status: 'draft' | 'published' | 'ongoing' | 'completed' | 'cancelled';
}
```

### EarnRecord

```typescript
interface EarnRecord {
  _id: string;
  userId: string;
  eventId: string;
  bookingId: string;
  karmaEarned: number;
  activeLevelAtApproval: 'L1' | 'L2' | 'L3' | 'L4';
  conversionRateSnapshot: number;
  csrPoolId: string;
  verificationSignals: {
    qr_in: boolean;
    qr_out: boolean;
    gps_match: number;
    ngo_approved: boolean;
    photo_proof: boolean;
  };
  confidenceScore: number;
  status: 'APPROVED_PENDING_CONVERSION' | 'CONVERTED' | 'REJECTED' | 'ROLLED_BACK' | 'CONVERSION_FAILED';
  createdAt: Date;
  approvedAt?: Date;
  convertedAt?: Date;
  convertedBy?: string;
  batchId?: string;
  rezCoinsEarned?: number;
}
```

### Batch

```typescript
interface Batch {
  _id: string;
  weekStart: Date;
  weekEnd: Date;
  csrPoolId: string;
  totalEarnRecords: number;
  totalKarma: number;
  totalRezCoinsEstimated: number;
  totalRezCoinsExecuted: number;
  status: 'DRAFT' | 'READY' | 'EXECUTED' | 'PARTIAL' | 'PAUSED';
  anomalyFlags: Array<{
    type: 'too_many_from_one_ngo' | 'suspicious_timestamps' | 'pool_shortage';
    count: number;
    resolved: boolean;
  }>;
  executedAt?: Date;
  executedBy?: string;
  createdAt: Date;
}
```

---

## Rate Limits

| Endpoint Group | Limit |
|---------------|-------|
| Standard endpoints | 100 req/min |
| Leaderboard | 60 req/min |
| Report/Resume PDF generation | 10 req/min |
| CSR operations | 30 req/min |

---

## Error Codes

| Code | Message | Description |
|------|---------|-------------|
| `KARMA_PROFILE_NOT_FOUND` | Karma profile not found | User has no karma profile |
| `EVENT_NOT_FOUND` | Event not found or not joinable | Event does not exist or is not active |
| `ALREADY_JOINED` | Already joined this event | User has an active booking |
| `EVENT_FULL` | Event is at full capacity | No more volunteers allowed |
| `INVALID_VERIFICATION` | Verification failed | QR/GPS check failed |
| `BATCH_ALREADY_EXECUTED` | Batch already executed | Cannot execute twice |
| `INSUFFICIENT_CREDITS` | Insufficient CSR credits | Partner budget exhausted |
| `DECAY_WARNING` | No activity for X days | Karma decay imminent |

---

## Webhooks

The karma service emits events for downstream consumers:

### Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `karma.earned` | Karma earned after event completion | `{ userId, karmaEarned, eventId, conversionRate }` |
| `karma.level_up` | User leveled up | `{ userId, oldLevel, newLevel }` |
| `karma.badge_earned` | New badge earned | `{ userId, badge }` |
| `karma.converted` | Karma converted to coins | `{ userId, karma, coins, batchId }` |

---

## Changelog

### v1.0.0 (2026-04-25)
- Initial API release
- Karma profile and level system
- Event discovery and booking
- QR/GPS verification
- Karma score (300-900 scale)
- Leaderboards
- Micro-actions
- Impact reports and resume
- Cause communities
- CSR cloud for corporate partners
- Batch conversion
- Wallet integration
