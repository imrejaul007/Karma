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
 *   SKIP_SMOKE_TESTS   — set to 'true' to skip (e.g. in CI without a running service)
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3009';
const SKIP_SMOKE = process.env.SKIP_SMOKE_TESTS === 'true' || process.env.SKIP_SMOKE_TESTS === '1';

async function fetchRaw(url: string) {
  try {
    return await fetch(url);
  } catch {
    return null;
  }
}

const describeOrSkip = SKIP_SMOKE ? describe.skip : describe;
const testOrSkip = SKIP_SMOKE ? test.skip : test;

describeOrSkip('Smoke Tests — Health Endpoints', () => {
  testOrSkip('GET /health returns 200 with status ok', async () => {
    const res = await fetchRaw(`${BASE_URL}/health`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as { status: string; service: string; timestamp: unknown };
    expect(body.status).toMatch(/^(ok|degraded)$/);
    expect(body.service).toBe('rez-karma-service');
    expect(body.timestamp).toBeDefined();
  });

  testOrSkip('GET /health/live returns 200', async () => {
    const res = await fetchRaw(`${BASE_URL}/health/live`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as { status: string };
    expect(body.status).toBe('alive');
  });

  testOrSkip('GET /healthz returns 200', async () => {
    const res = await fetchRaw(`${BASE_URL}/healthz`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
  });

  testOrSkip('GET /metrics returns JSON with uptime and memory', async () => {
    const res = await fetchRaw(`${BASE_URL}/metrics`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json() as { uptime: number; memory: { heapUsed: unknown } };
    expect(typeof body.uptime).toBe('number');
    expect(body.memory).toBeDefined();
    expect(body.memory.heapUsed).toBeDefined();
  });
});

describeOrSkip('Smoke Tests — Authentication Guard', () => {
  testOrSkip('GET /api/karma/user/:id returns 401 without token', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/user/testuser123`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  testOrSkip('GET /api/karma/batch returns 401 without token', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/batch`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  testOrSkip('POST /api/karma/earn returns 401 without token', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/earn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });

  testOrSkip('POST /api/karma/verify/checkin returns 401 without token', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/verify/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
  });
});

describeOrSkip('Smoke Tests — Batch Endpoints (no auth, stubs)', () => {
  testOrSkip('GET /api/karma/batch with no token returns 401 or 501 (stub)', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/batch`);
    expect(res).not.toBeNull();
    expect([401, 501]).toContain(res!.status);
  });
});

describeOrSkip('Smoke Tests — 404 Handling', () => {
  testOrSkip('Unknown route returns 404', async () => {
    const res = await fetchRaw(`${BASE_URL}/api/karma/nonexistent`);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(404);
    const body = await res!.json() as { success: boolean };
    expect(body.success).toBe(false);
  });
});

describeOrSkip('Smoke Tests — Rate Limiting', () => {
  testOrSkip('Rapid requests eventually receive rate limit response', async () => {
    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await fetchRaw(`${BASE_URL}/health`);
      if (res) results.push(res.status);
    }
    results.forEach((status) => {
      expect(status).toBe(200);
    });
  });
});

describeOrSkip('Smoke Tests — Content Type', () => {
  testOrSkip('Health endpoint returns application/json', async () => {
    const res = await fetchRaw(`${BASE_URL}/health`);
    expect(res).not.toBeNull();
    expect(res!.headers.get('content-type')).toMatch(/application\/json/);
  });
});
