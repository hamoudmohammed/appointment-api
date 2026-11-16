import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { requestHandler } from '../src/app.js';

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

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test('GET /health returns 200 and healthy status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.status, 'healthy');
  });

  test('GET /appointments returns list with count', async () => {
    const res = await fetch(`${baseUrl}/appointments`);
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(data.data));
    assert.strictEqual(typeof data.count, 'number');
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
});
