import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IdempotencyStore } from '../src/utils/idempotency.js';

describe('IdempotencyStore', () => {
  test('stores and retrieves records within TTL', () => {
    const store = new IdempotencyStore({ ttlMs: 5000 });
    const hash = IdempotencyStore.computeRequestHash({ customer: 'Alice', date: '2026-12-01' });

    store.set('key-1', hash, 201, { data: { id: 1 } }, 1000);

    const record = store.get('key-1', 2000);
    assert.ok(record);
    assert.strictEqual(record.statusCode, 201);
    assert.strictEqual(record.requestHash, hash);
  });

  test('expires records after TTL elapses', () => {
    const store = new IdempotencyStore({ ttlMs: 1000 });
    const hash = IdempotencyStore.computeRequestHash({ customer: 'Bob' });

    store.set('key-exp', hash, 201, { ok: true }, 1000);

    assert.ok(store.get('key-exp', 1500));
    assert.strictEqual(store.get('key-exp', 2000), undefined);
    assert.strictEqual(store.size(2000), 0);
  });

  test('computeRequestHash is order-independent for object keys', () => {
    const hashA = IdempotencyStore.computeRequestHash({ customer: 'Max', date: '2026-12-01', time: '10:00' });
    const hashB = IdempotencyStore.computeRequestHash({ time: '10:00', customer: 'Max', date: '2026-12-01' });
    const hashC = IdempotencyStore.computeRequestHash({ customer: 'Other', date: '2026-12-01', time: '10:00' });

    assert.strictEqual(hashA, hashB);
    assert.notStrictEqual(hashA, hashC);
  });

  test('evicts oldest entry when maxEntries is exceeded', () => {
    const store = new IdempotencyStore({ ttlMs: 60000, maxEntries: 2 });

    store.set('k1', 'h1', 201, { id: 1 }, 1000);
    store.set('k2', 'h2', 201, { id: 2 }, 1001);
    store.set('k3', 'h3', 201, { id: 3 }, 1002);

    assert.strictEqual(store.size(1002), 2);
    assert.strictEqual(store.get('k1', 1002), undefined);
    assert.ok(store.get('k2', 1002));
    assert.ok(store.get('k3', 1002));
  });
});
