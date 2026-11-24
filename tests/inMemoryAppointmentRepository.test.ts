import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';

describe('InMemoryAppointmentRepository', () => {
  let repo: InMemoryAppointmentRepository;

  beforeEach(() => {
    repo = new InMemoryAppointmentRepository();
  });

  test('findAll() returns all appointments', async () => {
    const res = await repo.findAll();
    assert.strictEqual(res.total, 1);
    assert.strictEqual(res.items.length, 1);
    assert.strictEqual(res.items[0].customer, 'Max Mustermann');
  });

  test('findAll() filters by date, status, customer, and date range', async () => {
    await repo.create({
      customer: 'Alice Wonderland',
      date: '2026-11-25',
      time: '14:00',
      status: 'CONFIRMED'
    });
    await repo.create({
      customer: 'Bob Builder',
      date: '2026-11-28',
      time: '09:00',
      status: 'CANCELLED'
    });

    // Filter by exact date
    const byDate = await repo.findAll({ date: '2026-11-25' });
    assert.strictEqual(byDate.total, 1);
    assert.strictEqual(byDate.items[0].customer, 'Alice Wonderland');

    // Filter by status
    const byStatus = await repo.findAll({ status: 'CANCELLED' });
    assert.strictEqual(byStatus.total, 1);
    assert.strictEqual(byStatus.items[0].customer, 'Bob Builder');

    // Filter by customer (case-insensitive substring)
    const byCustomer = await repo.findAll({ customer: 'alice' });
    assert.strictEqual(byCustomer.total, 1);
    assert.strictEqual(byCustomer.items[0].customer, 'Alice Wonderland');

    // Filter by date range
    const byRange = await repo.findAll({ startDate: '2026-11-21', endDate: '2026-11-30' });
    assert.strictEqual(byRange.total, 2);

    // Pagination
    const page1 = await repo.findAll({ page: 1, limit: 2 });
    assert.strictEqual(page1.total, 3);
    assert.strictEqual(page1.items.length, 2);

    const page2 = await repo.findAll({ page: 2, limit: 2 });
    assert.strictEqual(page2.total, 3);
    assert.strictEqual(page2.items.length, 1);
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
    assert.strictEqual(all.total, 2);
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

  test('findAll() supports full-text search (q) and dynamic sorting (sortBy, sortOrder)', async () => {
    await repo.create({
      customer: 'Zara Zebra',
      email: 'zara@clinic.org',
      provider: 'Dr. Alpha',
      serviceType: 'TREATMENT',
      notes: 'Allergy follow-up required',
      date: '2026-12-01',
      time: '15:00',
      status: 'CONFIRMED'
    });
    await repo.create({
      customer: 'Anna Apfel',
      email: 'anna@example.com',
      provider: 'Dr. Weber',
      serviceType: 'CHECKUP',
      notes: 'Annual check',
      date: '2026-11-18',
      time: '08:30',
      status: 'PENDING'
    });

    // Search in notes
    const byNotes = await repo.findAll({ q: 'allergy' });
    assert.strictEqual(byNotes.total, 1);
    assert.strictEqual(byNotes.items[0].customer, 'Zara Zebra');

    // Search in provider
    const byProvider = await repo.findAll({ q: 'weber' });
    assert.strictEqual(byProvider.total, 1);
    assert.strictEqual(byProvider.items[0].customer, 'Anna Apfel');

    // Sort by customer ASC
    const customerAsc = await repo.findAll({ sortBy: 'customer', sortOrder: 'asc' });
    assert.deepStrictEqual(
      customerAsc.items.map((a) => a.customer),
      ['Anna Apfel', 'Max Mustermann', 'Zara Zebra']
    );

    // Sort by customer DESC
    const customerDesc = await repo.findAll({ sortBy: 'customer', sortOrder: 'desc' });
    assert.deepStrictEqual(
      customerDesc.items.map((a) => a.customer),
      ['Zara Zebra', 'Max Mustermann', 'Anna Apfel']
    );

    // Sort by date DESC
    const dateDesc = await repo.findAll({ sortBy: 'date', sortOrder: 'desc' });
    assert.deepStrictEqual(
      dateDesc.items.map((a) => a.date),
      ['2026-12-01', '2026-11-20', '2026-11-18']
    );
  });
});
