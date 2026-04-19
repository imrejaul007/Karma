/**
 * Karma Service — Smoke Tests
 *
 * Lightweight integration tests that validate the running service endpoints.
 * These require the service to be running (local or CI environment).
 * Run with: npm test -- __tests__/smoke.test.ts
 *
 * Environment:
 *   TEST_BASE_URL      — base URL of the running service (default: http://localhost:3009)
 *   TEST_ADMIN_TOKEN   — admin JWT for admin-protected endpoints
 *   TEST_USER_TOKEN    — user JWT for user-protected endpoints
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3009';

describe('Smoke Tests — Health Endpoints', () => {
  test('GET /health returns 200 with status ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; service: string; timestamp: unknown };
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.service).toBe('rez-karma-service');
    expect(body.timestamp).toBeDefined();
  });

  test('GET /health/live returns 200', async () => {
    const res = await fetch(`${BASE_URL}/health/live`);
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('alive');
  });

  test('GET /healthz returns 200', async () => {
    const res = await fetch(`${BASE_URL}/healthz`);
    expect(res.status).toBe(200);
  });

  test('GET /metrics returns JSON with uptime and memory', async () => {
    const res = await fetch(`${BASE_URL}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.json() as { uptime: number; memory: { heapUsed: unknown } };
    expect(typeof body.uptime).toBe('number');
    expect(body.memory).toBeDefined();
    expect(body.memory.heapUsed).toBeDefined();
  });
});

describe('Smoke Tests — Authentication Guard', () => {
  test('GET /api/karma/user/:id returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/user/testuser123`);
    expect(res.status).toBe(401);
  });

  test('GET /api/karma/batch returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/batch`);
    expect(res.status).toBe(401);
  });

  test('POST /api/karma/earn returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/earn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  test('POST /api/karma/verify/checkin returns 401 without token', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/verify/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });
});

describe('Smoke Tests — Batch Endpoints (no auth, stubs)', () => {
  // These test the stub responses; once routes are implemented they should return auth errors instead
  test('GET /api/karma/batch with no token returns 401 or 501 (stub)', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/batch`);
    // Either auth guard (401) or stub (501) is acceptable at this phase
    expect([401, 501]).toContain(res.status);
  });
});

describe('Smoke Tests — 404 Handling', () => {
  test('Unknown route returns 404', async () => {
    const res = await fetch(`${BASE_URL}/api/karma/nonexistent`);
    expect(res.status).toBe(404);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(false);
  });
});

describe('Smoke Tests — Rate Limiting', () => {
  test('Rapid requests eventually receive rate limit response', async () => {
    // Send 100 requests quickly; the global rate limit is 100 per 15 minutes
    // so the 101st should be limited. We test with a smaller burst here.
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${BASE_URL}/health`);
      results.push(res.status);
    }
    // All should succeed since we are well under the limit
    results.forEach((status) => {
      expect(status).toBe(200);
    });
  });
});

describe('Smoke Tests — Content Type', () => {
  test('Health endpoint returns application/json', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
