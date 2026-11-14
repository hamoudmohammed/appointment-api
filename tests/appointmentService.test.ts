import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentService } from '../src/services/appointmentService.js';

describe('AppointmentService', () => {
  let service: AppointmentService;

  beforeEach(() => {
    service = new AppointmentService();
  });

  test('getAll() returns initial seed appointments', () => {
    const appointments = service.getAll();
    assert.strictEqual(Array.isArray(appointments), true);
    assert.strictEqual(appointments.length, 1);
    assert.strictEqual(appointments[0].customer, 'Max Mustermann');
  });

  test('getById() returns item when exists and undefined when absent', () => {
    const existing = service.getById(1);
    assert.ok(existing);
    assert.strictEqual(existing?.id, 1);

    const nonExistent = service.getById(999);
    assert.strictEqual(nonExistent, undefined);
  });

  test('create() successfully adds a valid appointment', () => {
    const payload = {
      customer: 'Sarah Connor',
      date: '2026-12-01',
      time: '14:30'
    };

    const result = service.create(payload);

    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data?.customer, 'Sarah Connor');
    assert.strictEqual(result.data?.id, 2);
    assert.strictEqual(result.data?.status, 'CONFIRMED');

    // Verify it is returned in getAll()
    const all = service.getAll();
    assert.strictEqual(all.length, 2);
  });

  test('create() rejects appointment with empty customer name', () => {
    const result = service.create({
      customer: '   ',
      date: '2026-12-01',
      time: '14:30'
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /required/i);
  });

  test('create() rejects appointment with invalid date format', () => {
    const result = service.create({
      customer: 'John Doe',
      date: '01-12-2026', // Wrong format (should be YYYY-MM-DD)
      time: '14:30'
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /YYYY-MM-DD/);
  });

  test('create() rejects appointment with invalid time format', () => {
    const result = service.create({
      customer: 'John Doe',
      date: '2026-12-01',
      time: '25:99' // Invalid 24h time
    });

    assert.strictEqual(result.success, false);
    assert.match(result.error || '', /HH:mm/);
  });
});
