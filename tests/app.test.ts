import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  requestHandler,
  setAppointmentService,
  setRateLimiter,
  setIdempotencyStore,
  setDatabaseHealthChecker,
  setAdminApiKey
} from '../src/app.js';
import { AppointmentService } from '../src/services/appointmentService.js';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';
import { MemoryRateLimiter } from '../src/utils/security.js';
import { IdempotencyStore } from '../src/utils/idempotency.js';

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
    setIdempotencyStore(new IdempotencyStore());
    setAdminApiKey('test-admin-secret-key');
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

  test('GET /metrics returns 200 with Prometheus formatted metrics', async () => {
    // Perform a request first to produce metrics
    await fetch(`${baseUrl}/health/live`);

    const res = await fetch(`${baseUrl}/metrics`);
    const text = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/plain/);
    assert.match(text, /# HELP http_requests_total/);
    assert.match(text, /# TYPE http_requests_total counter/);
    assert.match(text, /nodejs_process_uptime_seconds/);
    assert.match(text, /nodejs_process_heap_bytes/);
  });

  test('GET /openapi.json returns 200 and valid OpenAPI 3.0 schema', async () => {
    const res = await fetch(`${baseUrl}/openapi.json`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.openapi, '3.0.3');
    assert.strictEqual(data.info.title, 'Appointment REST API');
    assert.ok(data.paths['/appointments']);
    assert.ok(data.paths['/appointments/slots']);
    assert.ok(data.paths['/appointments/stats']);
    assert.ok(data.paths['/appointments/{id}']);
    assert.ok(data.paths['/metrics']);
    assert.ok(data.components.securitySchemes.ApiKeyAuth);
  });

  test('GET /docs returns 200 and HTML with Swagger UI', async () => {
    const res = await fetch(`${baseUrl}/docs`);
    const html = await res.text();
    assert.strictEqual(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /swagger-ui/i);
    assert.match(html, /\/openapi\.json/);
  });

  test('POST /auth/verify validates API key', async () => {
    // Valid key
    const validRes = await fetch(`${baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'X-API-Key': 'test-admin-secret-key' }
    });
    const validData = await validRes.json();
    assert.strictEqual(validRes.status, 200);
    assert.strictEqual(validData.valid, true);

    // Invalid key
    const invalidRes = await fetch(`${baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'X-API-Key': 'wrong-password' }
    });
    const invalidData = await invalidRes.json();
    assert.strictEqual(invalidRes.status, 401);
    assert.strictEqual(invalidData.valid, false);
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

  test('GET /appointments/export returns CSV and iCalendar files', async () => {
    // Test CSV export
    const csvRes = await fetch(`${baseUrl}/appointments/export?format=csv`);
    assert.strictEqual(csvRes.status, 200);
    assert.match(csvRes.headers.get('content-type') || '', /text\/csv/);
    const csvText = await csvRes.text();
    assert.match(csvText, /ID,Customer,Email,Phone/);
    assert.match(csvText, /Max Mustermann/);

    // Test ICS export
    const icsRes = await fetch(`${baseUrl}/appointments/export?format=ics`);
    assert.strictEqual(icsRes.status, 200);
    assert.match(icsRes.headers.get('content-type') || '', /text\/calendar/);
    const icsText = await icsRes.text();
    assert.match(icsText, /BEGIN:VCALENDAR/);
    assert.match(icsText, /BEGIN:VEVENT/);

    // Test single appointment export
    const singleIcsRes = await fetch(`${baseUrl}/appointments/1/export?format=ics`);
    assert.strictEqual(singleIcsRes.status, 200);
    const singleIcsText = await singleIcsRes.text();
    assert.match(singleIcsText, /UID:appointment-1@appointment-api/);

    // Test invalid format returns 400
    const badFormatRes = await fetch(`${baseUrl}/appointments/export?format=xml`);
    assert.strictEqual(badFormatRes.status, 400);
  });

  test('GET /appointments/slots returns available slot breakdown', async () => {
    // Missing date query param
    const badRes = await fetch(`${baseUrl}/appointments/slots`);
    assert.strictEqual(badRes.status, 400);

    // Valid date query param
    const res = await fetch(`${baseUrl}/appointments/slots?date=2026-11-20`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.date, '2026-11-20');
    assert.strictEqual(data.totalSlots, 18);
    assert.strictEqual(data.availableCount, 17);
    assert.strictEqual(data.bookedCount, 1);
    assert.strictEqual(data.availableSlots.includes('10:00'), false);
    assert.strictEqual(data.availableSlots.includes('14:00'), true);
  });

  test('GET /appointments/stats returns aggregated appointment analytics', async () => {
    await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Stats User',
        serviceType: 'CHECKUP',
        date: '2026-11-25',
        time: '10:00'
      })
    });

    const res = await fetch(`${baseUrl}/appointments/stats`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.totalAppointments, 2);
    assert.strictEqual(data.byStatus.CONFIRMED, 2);
    assert.strictEqual(data.byServiceType.CHECKUP, 1);
    assert.deepStrictEqual(data.busiestTimeSlots[0], { time: '10:00', count: 2 });

    const filteredRes = await fetch(`${baseUrl}/appointments/stats?startDate=2026-11-25&endDate=2026-11-30`);
    const filteredData = await filteredRes.json();
    assert.strictEqual(filteredRes.status, 200);
    assert.strictEqual(filteredData.totalAppointments, 1);

    const invalidRes = await fetch(`${baseUrl}/appointments/stats?startDate=2026-12-10&endDate=2026-12-01`);
    assert.strictEqual(invalidRes.status, 400);
  });

  test('GET /appointments/slots and /appointments/stats support provider query param', async () => {
    await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Weber Client',
        provider: 'Dr. Weber',
        date: '2026-11-20',
        time: '15:00'
      })
    });

    const slotsRes = await fetch(`${baseUrl}/appointments/slots?date=2026-11-20&provider=Dr.%20Weber`);
    const slotsData = await slotsRes.json();
    assert.strictEqual(slotsRes.status, 200);
    assert.strictEqual(slotsData.provider, 'Dr. Weber');
    assert.strictEqual(slotsData.bookedCount, 1);
    assert.strictEqual(slotsData.availableSlots.includes('10:00'), true);
    assert.strictEqual(slotsData.availableSlots.includes('15:00'), false);

    const statsRes = await fetch(`${baseUrl}/appointments/stats?provider=Dr.%20Weber`);
    const statsData = await statsRes.json();
    assert.strictEqual(statsRes.status, 200);
    assert.strictEqual(statsData.totalAppointments, 1);
    assert.strictEqual(statsData.byProvider['Dr. Weber'], 1);
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

  test('POST & GET /appointments support multi-provider booking and filtering', async () => {
    // Same slot as seed (2026-11-20 10:00) but different provider succeeds
    const res1 = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Multi Provider Client',
        provider: 'Dr. Schmidt',
        date: '2026-11-20',
        time: '10:00'
      })
    });
    const data1 = await res1.json();
    assert.strictEqual(res1.status, 201);
    assert.strictEqual(data1.data.provider, 'Dr. Schmidt');

    // Same slot + same provider -> 409 Conflict
    const res2 = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Conflicting Client',
        provider: 'Dr. Schmidt',
        date: '2026-11-20',
        time: '10:00'
      })
    });
    assert.strictEqual(res2.status, 409);

    // Filter by provider
    const listRes = await fetch(`${baseUrl}/appointments?provider=schmidt`);
    const listData = await listRes.json();
    assert.strictEqual(listRes.status, 200);
    assert.strictEqual(listData.total, 1);
    assert.strictEqual(listData.data[0].provider, 'Dr. Schmidt');
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

  test('POST and PATCH return 400 Bad Request on malformed JSON payloads', async () => {
    const postRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json'
    });
    const postData = await postRes.json();
    assert.strictEqual(postRes.status, 400);
    assert.strictEqual(postData.errorType, 'VALIDATION_ERROR');
    assert.match(postData.error, /Invalid JSON/i);

    const patchRes = await fetch(`${baseUrl}/appointments/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: '{"customer": '
    });
    const patchData = await patchRes.json();
    assert.strictEqual(patchRes.status, 400);
    assert.strictEqual(patchData.errorType, 'VALIDATION_ERROR');
  });

  test('POST /appointments returns 400 for non-existent calendar dates like 2026-02-31', async () => {
    const res = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Invalid Calendar User',
        date: '2026-02-31',
        time: '10:00'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.errorType, 'VALIDATION_ERROR');
  });

  test('POST /appointments replays identical response for repeated Idempotency-Key and rejects payload mismatch', async () => {
    const payload = {
      customer: 'Idempotent User',
      date: '2026-12-18',
      time: '13:00'
    };

    const firstRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'req-unique-123'
      },
      body: JSON.stringify(payload)
    });
    const firstData = await firstRes.json();
    assert.strictEqual(firstRes.status, 201);
    assert.strictEqual(firstRes.headers.get('idempotency-replayed'), 'false');
    assert.strictEqual(firstRes.headers.get('idempotency-key'), 'req-unique-123');

    // Retry with identical key and payload
    const replayRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'req-unique-123'
      },
      body: JSON.stringify(payload)
    });
    const replayData = await replayRes.json();
    assert.strictEqual(replayRes.status, 201);
    assert.strictEqual(replayRes.headers.get('idempotency-replayed'), 'true');
    assert.strictEqual(replayData.data.id, firstData.data.id);

    // Reuse same key with different payload -> 409 IDEMPOTENCY_CONFLICT
    const conflictRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'req-unique-123'
      },
      body: JSON.stringify({
        customer: 'Different User',
        date: '2026-12-18',
        time: '14:00'
      })
    });
    const conflictData = await conflictRes.json();
    assert.strictEqual(conflictRes.status, 409);
    assert.strictEqual(conflictData.errorType, 'IDEMPOTENCY_CONFLICT');

    // Overly long key -> 400 VALIDATION_ERROR
    const invalidKeyRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'x'.repeat(129)
      },
      body: JSON.stringify(payload)
    });
    assert.strictEqual(invalidKeyRes.status, 400);
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

  test('POST /appointments/:id/cancel cancels an appointment with 200', async () => {
    const res = await fetch(`${baseUrl}/appointments/1/cancel`, {
      method: 'POST'
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.status, 'CANCELLED');
    assert.match(data.message, /cancelled successfully/i);
  });

  test('POST /appointments/:id/complete marks appointment completed with 200', async () => {
    const res = await fetch(`${baseUrl}/appointments/1/complete`, {
      method: 'POST'
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.data.status, 'COMPLETED');
    assert.match(data.message, /completed successfully/i);
  });

  test('GET /appointments/:id/history returns chronological audit trail and 404 for unknown ID', async () => {
    await fetch(`${baseUrl}/appointments/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-11-28', time: '14:00' })
    });
    await fetch(`${baseUrl}/appointments/1/complete`, { method: 'POST' });

    const historyRes = await fetch(`${baseUrl}/appointments/1/history`);
    const historyData = await historyRes.json();
    assert.strictEqual(historyRes.status, 200);
    assert.strictEqual(historyData.appointmentId, 1);
    assert.strictEqual(historyData.total, 3);
    assert.deepStrictEqual(
      historyData.data.map((e: { action: string }) => e.action),
      ['CREATED', 'RESCHEDULED', 'COMPLETED']
    );

    const notFoundRes = await fetch(`${baseUrl}/appointments/9999/history`);
    assert.strictEqual(notFoundRes.status, 404);
  });

  test('POST/PATCH enforce business hours and GET /appointments/slots supports slotDuration', async () => {
    const afterHoursRes = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Late Night Client',
        date: '2026-12-10',
        time: '21:00'
      })
    });
    const afterHoursData = await afterHoursRes.json();
    assert.strictEqual(afterHoursRes.status, 400);
    assert.strictEqual(afterHoursData.errorType, 'VALIDATION_ERROR');
    assert.match(afterHoursData.error, /business hours/i);

    const hourlySlotsRes = await fetch(`${baseUrl}/appointments/slots?date=2026-11-20&slotDuration=60`);
    const hourlySlotsData = await hourlySlotsRes.json();
    assert.strictEqual(hourlySlotsRes.status, 200);
    assert.strictEqual(hourlySlotsData.totalSlots, 9);
    assert.strictEqual(hourlySlotsData.businessHours.slotDurationMinutes, 60);

    const badDurationRes = await fetch(`${baseUrl}/appointments/slots?date=2026-11-20&slotDuration=25`);
    assert.strictEqual(badDurationRes.status, 400);
  });

  test('DELETE /appointments/:id requires valid API key (401 Unauthorized)', async () => {
    // Attempt deletion without auth header
    const noAuthRes = await fetch(`${baseUrl}/appointments/1`, {
      method: 'DELETE'
    });
    const noAuthData = await noAuthRes.json();
    assert.strictEqual(noAuthRes.status, 401);
    assert.strictEqual(noAuthData.errorType, 'UNAUTHORIZED');

    // Attempt deletion with invalid key
    const badAuthRes = await fetch(`${baseUrl}/appointments/1`, {
      method: 'DELETE',
      headers: { 'X-API-Key': 'wrong-key' }
    });
    const badAuthData = await badAuthRes.json();
    assert.strictEqual(badAuthRes.status, 401);
    assert.strictEqual(badAuthData.errorType, 'UNAUTHORIZED');
  });

  test('DELETE /appointments/:id deletes an appointment with 200 when valid API key is supplied', async () => {
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

    // Delete it with valid X-API-Key
    const delRes = await fetch(`${baseUrl}/appointments/${idToDelete}`, {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-admin-secret-key' }
    });
    const delData = await delRes.json();
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delData.data.id, idToDelete);

    // Verify it's gone
    const getRes = await fetch(`${baseUrl}/appointments/${idToDelete}`);
    assert.strictEqual(getRes.status, 404);
  });

  test('DELETE /appointments/:id returns 404 for unknown id when authenticated', async () => {
    const res = await fetch(`${baseUrl}/appointments/8888`, {
      method: 'DELETE',
      headers: { 'X-API-Key': 'test-admin-secret-key' }
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

  test('POST /appointments/:id/no-show marks appointment as NO_SHOW and rejects terminal states', async () => {
    const res = await fetch(`${baseUrl}/appointments/1/no-show`, { method: 'POST' });
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.data.status, 'NO_SHOW');

    // Unknown ID -> 404
    const missing = await fetch(`${baseUrl}/appointments/9999/no-show`, { method: 'POST' });
    assert.strictEqual(missing.status, 404);

    // Completed appointment -> 400
    const created = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'Done Client', date: '2026-12-18', time: '11:00' })
    });
    const createdId = (await created.json()).data.id;
    await fetch(`${baseUrl}/appointments/${createdId}/complete`, { method: 'POST' });

    const invalid = await fetch(`${baseUrl}/appointments/${createdId}/no-show`, { method: 'POST' });
    assert.strictEqual(invalid.status, 400);
    assert.strictEqual((await invalid.json()).errorType, 'VALIDATION_ERROR');
  });

  test('POST /appointments/:id/confirm confirms PENDING appointments and returns 409 on slot conflict', async () => {
    // Move appointment #1 to PENDING via PATCH
    const patchRes = await fetch(`${baseUrl}/appointments/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PENDING' })
    });
    assert.strictEqual(patchRes.status, 200);

    // Confirm it via POST /appointments/1/confirm
    const confirmRes = await fetch(`${baseUrl}/appointments/1/confirm`, { method: 'POST' });
    assert.strictEqual(confirmRes.status, 200);
    const confirmBody = await confirmRes.json();
    assert.strictEqual(confirmBody.data.status, 'CONFIRMED');

    // Move appointment #1 back to PENDING, book the same slot with another appointment, then try confirming #1 -> 409
    await fetch(`${baseUrl}/appointments/1`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'PENDING' })
    });
    const competing = await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer: 'Slot Taker', date: '2026-11-20', time: '10:00' })
    });
    assert.strictEqual(competing.status, 201);

    const conflictRes = await fetch(`${baseUrl}/appointments/1/confirm`, { method: 'POST' });
    assert.strictEqual(conflictRes.status, 409);
    assert.strictEqual((await conflictRes.json()).errorType, 'CONFLICT');

    // Unknown ID -> 404
    const missing = await fetch(`${baseUrl}/appointments/9999/confirm`, { method: 'POST' });
    assert.strictEqual(missing.status, 404);
  });

  test('GET /appointments supports q search, sortBy, sortOrder, and rejects invalid sort parameters', async () => {
    await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Alice Smith',
        provider: 'Dr. Weber',
        notes: 'Dental cleaning',
        date: '2026-12-05',
        time: '09:00'
      })
    });
    await fetch(`${baseUrl}/appointments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Zoe Baker',
        provider: 'Dr. Klein',
        notes: 'Routine visit',
        date: '2026-11-15',
        time: '14:00'
      })
    });

    // Search via q across notes
    const searchRes = await fetch(`${baseUrl}/appointments?q=dental`);
    assert.strictEqual(searchRes.status, 200);
    const searchBody = await searchRes.json();
    assert.strictEqual(searchBody.total, 1);
    assert.strictEqual(searchBody.data[0].customer, 'Alice Smith');

    // Sort by customer desc
    const sortedRes = await fetch(`${baseUrl}/appointments?sortBy=customer&sortOrder=desc`);
    assert.strictEqual(sortedRes.status, 200);
    const sortedBody = await sortedRes.json();
    assert.deepStrictEqual(
      sortedBody.data.map((a: { customer: string }) => a.customer),
      ['Zoe Baker', 'Max Mustermann', 'Alice Smith']
    );

    // Invalid sortBy -> 400
    const badSort = await fetch(`${baseUrl}/appointments?sortBy=invalidField`);
    assert.strictEqual(badSort.status, 400);
    assert.strictEqual((await badSort.json()).errorType, 'VALIDATION_ERROR');

    // Invalid sortOrder -> 400
    const badOrder = await fetch(`${baseUrl}/appointments?sortOrder=sideways`);
    assert.strictEqual(badOrder.status, 400);
    assert.strictEqual((await badOrder.json()).errorType, 'VALIDATION_ERROR');
  });

  test('GET /appointments/next-available returns earliest open slot and validates params', async () => {
    // 2026-11-20 10:00 is booked for General; starting at 10:00 should return 10:30
    const res = await fetch(
      `${baseUrl}/appointments/next-available?fromDate=2026-11-20&fromTime=10:00&provider=General&slotDuration=30`
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.found, true);
    assert.deepStrictEqual(body.nextAvailable, { date: '2026-11-20', time: '10:30' });

    // Invalid daysAhead -> 400
    const bad = await fetch(`${baseUrl}/appointments/next-available?daysAhead=99`);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual((await bad.json()).errorType, 'VALIDATION_ERROR');
  });
});
