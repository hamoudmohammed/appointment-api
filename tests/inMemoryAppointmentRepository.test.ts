import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';

describe('InMemoryAppointmentRepository', () => {
  let repo: InMemoryAppointmentRepository;

  beforeEach(() => {
    repo = new InMemoryAppointmentRepository();
  });

  test('findAll() returns all appointments', async () => {
    const all = await repo.findAll();
    assert.strictEqual(all.length, 1);
    assert.strictEqual(all[0].customer, 'Max Mustermann');
  });

  test('findById() finds item by id or returns undefined', async () => {
    const item = await repo.findById(1);
    assert.ok(item);
    assert.strictEqual(item?.id, 1);

    const missing = await repo.findById(9999);
    assert.strictEqual(missing, undefined);
  });

  test('findConfirmedBySlot() matches confirmed slot and ignores cancelled', async () => {
    const found = await repo.findConfirmedBySlot('2026-11-20', '10:00');
    assert.ok(found);
    assert.strictEqual(found?.id, 1);

    // With excludeId
    const excluded = await repo.findConfirmedBySlot('2026-11-20', '10:00', 1);
    assert.strictEqual(excluded, undefined);

    // Cancelled slot
    await repo.update(1, { status: 'CANCELLED' });
    const afterCancel = await repo.findConfirmedBySlot('2026-11-20', '10:00');
    assert.strictEqual(afterCancel, undefined);
  });

  test('create() adds record with auto-increment id', async () => {
    const created = await repo.create({
      customer: 'Alice',
      date: '2026-12-10',
      time: '11:00',
      status: 'CONFIRMED'
    });

    assert.strictEqual(created.id, 2);
    assert.strictEqual(created.customer, 'Alice');

    const all = await repo.findAll();
    assert.strictEqual(all.length, 2);
  });

  test('update() modifies specified fields only', async () => {
    const updated = await repo.update(1, { customer: 'Max Updated' });
    assert.ok(updated);
    assert.strictEqual(updated?.customer, 'Max Updated');
    assert.strictEqual(updated?.date, '2026-11-20');

    const missing = await repo.update(999, { customer: 'Ghost' });
    assert.strictEqual(missing, undefined);
  });

  test('delete() removes appointment', async () => {
    const deleted = await repo.delete(1);
    assert.ok(deleted);
    assert.strictEqual(deleted?.id, 1);

    const after = await repo.findById(1);
    assert.strictEqual(after, undefined);

    const missing = await repo.delete(999);
    assert.strictEqual(missing, undefined);
  });
});
