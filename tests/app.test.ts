import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  requestHandler,
  setAppointmentService,
  setRateLimiter,
  setDatabaseHealthChecker
} from '../src/app.js';
import { AppointmentService } from '../src/services/appointmentService.js';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';
import { MemoryRateLimiter } from '../src/utils/security.js';

describe('HTTP API Endpoints', () => {
  let server: http.Server;
  let baseUrl: string;

  before(async () => {
    server = http.createServer(requestHandler);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  beforeEach(() => {
    setAppointmentService(new AppointmentService(new InMemoryAppointmentRepository()));
    setRateLimiter(new MemoryRateLimiter({ windowMs: 60000, maxRequests: 100 }));
    setDatabaseHealthChecker(async () => ({
      status: 'healthy',
      storage: 'in-memory',
      latencyMs: 0
    }));
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /health and /health/live return 200 with uptime and memory', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'healthy');
    assert.strictEqual(typeof data.uptimeSeconds, 'number');
    assert.strictEqual(typeof data.memory.rssMb, 'number');
  });

  test('GET /health/ready returns 200 when database is healthy', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'healthy');
    assert.strictEqual(data.database.storage, 'in-memory');
  });

  test('GET /health/ready returns 503 when database is unhealthy', async () => {
    setDatabaseHealthChecker(async () => ({
      status: 'unhealthy',
      storage: 'postgresql',
      latencyMs: 50.5,
      error: 'Connection refused'
    }));

    const res = await fetch(`${baseUrl}/health/ready`);
    const data = await res.json();
    assert.strictEqual(res.status, 503);
    assert.strictEqual(data.status, 'unhealthy');
    assert.strictEqual(data.database.error, 'Connection refused');
  });

  test('GET /openapi.json returns 200 and valid OpenAPI 3.0 schema', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.openapi, '3.0.3');
    assert.strictEqual(data.info.title, 'Appointment REST API');
    assert.ok(data.paths['/appointments']);
    assert.ok(data.paths['/appointments/{id}']);
  });

  test('GET /docs returns 200 and HTML with Swagger UI', async () => {
    const res = await fetch(`${baseUrl}/docs`);
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /swagger-ui/i);
    assert.match(html, /\/openapi\.json/);
  });

  test('GET /appointments returns list with pagination metadata', async () => {
    const res = await fetch(`${baseUrl}/appointments`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(data.data));
    assert.strictEqual(typeof data.total, 'number');
    assert.strictEqual(data.page, 1);
    assert.strictEqual(data.limit, 20);
    assert.strictEqual(typeof data.totalPages, 'number');
  });

  test('GET /appointments supports filtering and pagination query params', async () => {
    // Create an appointment for 2026-12-10
    await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Query Filter User',
        date: '2026-12-10',
        time: '15:00'
      })
    });

    // Filter by date
    const dateRes = await fetch(`${baseUrl}/appointments?date=2026-12-10`);
    const dateData = await dateRes.json();
    assert.strictEqual(dateRes.status, 200);
    assert.strictEqual(dateData.total, 1);
    assert.strictEqual(dateData.data[0].customer, 'Query Filter User');

    // Filter by invalid date returns 400
    const errRes = await fetch(`${baseUrl}/appointments?date=not-a-date`);
    const errData = await errRes.json();
    assert.strictEqual(errRes.status, 400);
    assert.strictEqual(errData.errorType, 'VALIDATION_ERROR');
  });

  test('POST /appointments creates an appointment with 201', async () => {
    const res = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Integration Test User',
        date: '2026-12-15',
        time: '14:00'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(data.data.customer, 'Integration Test User');
    assert.strictEqual(data.data.status, 'CONFIRMED');
  });

  test('PATCH /appointments/:id updates appointment details with 200', async () => {
    const res = await fetch(`${baseUrl}/appointments/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'Max Updated via HTTP' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.customer, 'Max Updated via HTTP');
  });

  test('PATCH /appointments/:id returns 404 for non-existent appointment', async () => {
    const res = await fetch(`${baseUrl}/appointments/9999`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'Non Existent' })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 404);
    assert.strictEqual(data.errorType, 'NOT_FOUND');
  });

  test('DELETE /appointments/:id deletes an appointment with 200', async () => {
    // Create an item to delete
    const postRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'To Be Deleted',
        date: '2026-12-20',
        time: '09:00'
      })
    });
    const created = await postRes.json();
    const idToDelete = created.data.id;

    // Delete it
    const delRes = await fetch(`${baseUrl}/appointments/${idToDelete}`, {
      method: 'DELETE'
    });
    const delData = await delRes.json();
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delData.data.id, idToDelete);

    // Verify it's gone
    const getRes = await fetch(`${baseUrl}/appointments/${idToDelete}`);
    assert.strictEqual(getRes.status, 404);
  });

  test('DELETE /appointments/:id returns 404 for unknown id', async () => {
    const res = await fetch(`${baseUrl}/appointments/8888`, {
      method: 'DELETE'
    });
    assert.strictEqual(res.status, 404);
  });

  test('Security & CORS headers are present on responses', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('OPTIONS preflight returns 204 No Content with CORS headers', async () => {
    const res = await fetch(`${baseUrl}/appointments`, {
      method: 'OPTIONS'
    });
    assert.strictEqual(res.status, 204);
    assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
    assert.ok(res.headers.get('access-control-allow-methods')?.includes('POST'));
  });

  test('Rate limiting blocks excessive requests with 429 Too Many Requests', async () => {
    // Configure rate limiter with max 2 requests
    setRateLimiter(new MemoryRateLimiter({ windowMs: 60000, maxRequests: 2 }));

    const res1 = await fetch(`${baseUrl}/appointments`);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.headers.get('x-ratelimit-remaining'), '1');

    const res2 = await fetch(`${baseUrl}/appointments`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.headers.get('x-ratelimit-remaining'), '0');

    // 3rd request should exceed limit
    const res3 = await fetch(`${baseUrl}/appointments`);
    assert.strictEqual(res3.status, 429);
    assert.ok(res3.headers.get('retry-after'));
    const body = await res3.json();
    assert.strictEqual(body.errorType, 'RATE_LIMIT_EXCEEDED');
  });

  test('Response includes generated X-Request-Id header for distributed tracing', async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.status, 200);
    const requestId = res.headers.get('x-request-id');
    assert.ok(requestId);
    // UUID v4 format verification
    assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  test('Server preserves client-supplied X-Request-Id header', async () => {
    const customId = 'gateway-trace-12345';
    const res = await fetch(`${baseUrl}/health`, {
      headers: { 'X-Request-Id': customId }
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers.get('x-request-id'), customId);
  });
});
