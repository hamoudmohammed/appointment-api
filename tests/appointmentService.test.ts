import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppointmentService } from '../src/services/appointmentService.js';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';

describe('AppointmentService', () => {
  let service: AppointmentService;

  beforeEach(() => {
    service = new AppointmentService(new InMemoryAppointmentRepository());
  });

  test('getAll() returns initial seed appointments', async () => {
    const res = await service.getAll();
    assert.strictEqual(res.success, true);
    assert.ok(res.data);
    assert.strictEqual(res.data?.total, 1);
    assert.strictEqual(res.data?.page, 1);
    assert.strictEqual(res.data?.data[0].customer, 'Max Mustermann');
  });

  test('getAll() validates query parameters', async () => {
    const invalidDate = await service.getAll({ date: 'invalid-date' });
    assert.strictEqual(invalidDate.success, false);
    assert.strictEqual(invalidDate.errorType, 'VALIDATION_ERROR');

    const invalidRange = await service.getAll({ startDate: '2026-12-01', endDate: '2026-11-01' });
    assert.strictEqual(invalidRange.success, false);
    assert.strictEqual(invalidRange.errorType, 'VALIDATION_ERROR');

    const invalidPage = await service.getAll({ page: 0 });
    assert.strictEqual(invalidPage.success, false);
    assert.strictEqual(invalidPage.errorType, 'VALIDATION_ERROR');

    const invalidLimit = await service.getAll({ limit: 101 });
    assert.strictEqual(invalidLimit.success, false);
    assert.strictEqual(invalidLimit.errorType, 'VALIDATION_ERROR');
  });

  test('getById() returns item when exists and undefined when absent', async () => {
    const existing = await service.getById(1);
    assert.ok(existing);
    assert.strictEqual(existing?.id, 1);

    const nonExistent = await service.getById(999);
    assert.strictEqual(nonExistent, undefined);
  });

  test('create() successfully adds a valid appointment', async () => {
    const payload = {
      customer: 'Sarah Connor',
      date: '2026-12-01',
      time: '14:30'
    };

    const result = await service.create(payload);

    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data?.customer, 'Sarah Connor');
    assert.strictEqual(result.data?.id, 2);
    assert.strictEqual(result.data?.status, 'CONFIRMED');

    // Verify it is returned in getAll()
    const all = await service.getAll();
    assert.strictEqual(all.data?.total, 2);
  });

  test('create() prevents double-booking the same date and time slot (CONFLICT)', async () => {
    // Attempting to book the seed slot (2026-11-20 at 10:00)
    const duplicate = await service.create({
      customer: 'Another Customer',
      date: '2026-11-20',
      time: '10:00'
    });

    assert.strictEqual(duplicate.success, false);
    assert.strictEqual(duplicate.errorType, 'CONFLICT');
    assert.match(duplicate.error || '', /already booked/i);
  });

  test('create() rejects appointment with empty customer name', async () => {
    const result = await service.create({
      customer: '   ',
      date: '2026-12-01',
      time: '14:30'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    assert.match(result.error || '', /required/i);
  });

  test('create() rejects appointment with invalid date format', async () => {
    const result = await service.create({
      customer: 'John Doe',
      date: '01-12-2026', // Wrong format (should be YYYY-MM-DD)
      time: '14:30'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    assert.match(result.error || '', /YYYY-MM-DD/);
  });

  test('create() rejects non-existent calendar dates and accepts valid leap day', async () => {
    for (const badDate of ['2026-02-29', '2026-02-31', '2026-04-31', '2026-13-01', '2026-00-10']) {
      const res = await service.create({
        customer: 'Calendar Edge Case',
        date: badDate,
        time: '10:00'
      });
      assert.strictEqual(res.success, false, `Expected ${badDate} to be rejected`);
      assert.strictEqual(res.errorType, 'VALIDATION_ERROR');
    }

    const leapDay = await service.create({
      customer: 'Leap Day Booker',
      date: '2028-02-29',
      time: '11:30'
    });
    assert.strictEqual(leapDay.success, true);
    assert.strictEqual(leapDay.data?.date, '2028-02-29');
  });

  test('getAvailableSlots() and getAll() reject non-existent calendar dates', async () => {
    const slotsRes = await service.getAvailableSlots('2026-02-30');
    assert.strictEqual(slotsRes.success, false);
    assert.strictEqual(slotsRes.errorType, 'VALIDATION_ERROR');

    const listRes = await service.getAll({ startDate: '2026-04-31' });
    assert.strictEqual(listRes.success, false);
    assert.strictEqual(listRes.errorType, 'VALIDATION_ERROR');
  });

  test('create() rejects appointment with invalid time format', async () => {
    const result = await service.create({
      customer: 'John Doe',
      date: '2026-12-01',
      time: '25:99' // Invalid 24h time
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    assert.match(result.error || '', /HH:mm/);
  });

  test('create() accepts valid email, phone, and serviceType', async () => {
    const result = await service.create({
      customer: 'Alice Wonder',
      email: 'alice@example.com',
      phone: '+49 170 98765432',
      serviceType: 'TREATMENT',
      notes: 'Special care needed',
      date: '2026-12-02',
      time: '11:00'
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.data);
    assert.strictEqual(result.data?.email, 'alice@example.com');
    assert.strictEqual(result.data?.serviceType, 'TREATMENT');
    assert.strictEqual(result.data?.notes, 'Special care needed');
  });

  test('create() rejects invalid email format', async () => {
    const result = await service.create({
      customer: 'Invalid Email Person',
      email: 'invalid-email-string',
      date: '2026-12-02',
      time: '12:00'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    assert.match(result.error || '', /email/i);
  });

  test('create() rejects invalid serviceType', async () => {
    const result = await service.create({
      customer: 'Bob Person',
      // @ts-expect-error test invalid enum
      serviceType: 'SURGERY',
      date: '2026-12-02',
      time: '12:00'
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    assert.match(result.error || '', /serviceType/i);
  });

  describe('update()', () => {
    test('successfully updates customer name', async () => {
      const result = await service.update(1, { customer: 'Max Updated' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.customer, 'Max Updated');
      assert.strictEqual(result.data?.date, '2026-11-20');
      assert.strictEqual(result.data?.time, '10:00');
    });

    test('successfully reschedules date and time', async () => {
      const result = await service.update(1, { date: '2026-11-25', time: '15:00' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.date, '2026-11-25');
      assert.strictEqual(result.data?.time, '15:00');
    });

    test('allows updating own details without self-slot conflict', async () => {
      // Re-saving with same date and time should not trigger CONFLICT
      const result = await service.update(1, { customer: 'Max Same Slot', date: '2026-11-20', time: '10:00' });
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.customer, 'Max Same Slot');
    });

    test('prevents rescheduling to a slot taken by another confirmed appointment (CONFLICT)', async () => {
      // Create a second appointment
      await service.create({
        customer: 'Jane Doe',
        date: '2026-11-21',
        time: '11:00'
      });

      // Try to update appointment 1 to appointment 2's slot
      const conflictResult = await service.update(1, {
        date: '2026-11-21',
        time: '11:00'
      });

      assert.strictEqual(conflictResult.success, false);
      assert.strictEqual(conflictResult.errorType, 'CONFLICT');
      assert.match(conflictResult.error || '', /already booked/i);
    });

    test('returns NOT_FOUND for non-existent appointment ID', async () => {
      const result = await service.update(999, { customer: 'Ghost' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'NOT_FOUND');
    });

    test('rejects empty update object', async () => {
      const result = await service.update(1, {});
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    });

    test('rejects invalid date format', async () => {
      const result = await service.update(1, { date: '20-11-2026' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    });

    test('rejects invalid time format', async () => {
      const result = await service.update(1, { time: '99:00' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    });

    test('rejects invalid status value', async () => {
      // @ts-expect-error testing runtime validation with invalid status
      const result = await service.update(1, { status: 'UNKNOWN' });
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'VALIDATION_ERROR');
    });

    test('cancelling an appointment frees up the slot for new booking', async () => {
      const cancelResult = await service.update(1, { status: 'CANCELLED' });
      assert.strictEqual(cancelResult.success, true);
      assert.strictEqual(cancelResult.data?.status, 'CANCELLED');

      // Now another user can book the 2026-11-20 10:00 slot
      const newBooking = await service.create({
        customer: 'New Booker',
        date: '2026-11-20',
        time: '10:00'
      });

      assert.strictEqual(newBooking.success, true);
      assert.strictEqual(newBooking.data?.customer, 'New Booker');
    });

    test('prevents modifying an already cancelled appointment', async () => {
      await service.update(1, { status: 'CANCELLED' });
      const attempt = await service.update(1, { customer: 'New Name' });
      assert.strictEqual(attempt.success, false);
      assert.strictEqual(attempt.errorType, 'VALIDATION_ERROR');
      assert.match(attempt.error || '', /cancelled/i);
    });

    test('prevents modifying an already completed appointment', async () => {
      await service.update(1, { status: 'COMPLETED' });
      const attempt = await service.update(1, { time: '11:00' });
      assert.strictEqual(attempt.success, false);
      assert.strictEqual(attempt.errorType, 'VALIDATION_ERROR');
      assert.match(attempt.error || '', /completed/i);
    });
  });

  describe('cancelAppointment() & completeAppointment()', () => {
    test('cancelAppointment() cancels confirmed appointment', async () => {
      const res = await service.cancelAppointment(1);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'CANCELLED');
    });

    test('completeAppointment() marks confirmed appointment as completed', async () => {
      const res = await service.completeAppointment(1);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'COMPLETED');
    });

    test('cannot complete a cancelled appointment', async () => {
      await service.cancelAppointment(1);
      const res = await service.completeAppointment(1);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.errorType, 'VALIDATION_ERROR');
    });
  });

  describe('delete()', () => {
    test('successfully deletes an existing appointment', async () => {
      const result = await service.delete(1);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.data?.id, 1);

      // Verify it is no longer returned
      assert.strictEqual(await service.getById(1), undefined);
      const all = await service.getAll();
      assert.strictEqual(all.data?.total, 0);
    });

    test('returns NOT_FOUND when deleting non-existent ID', async () => {
      const result = await service.delete(999);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.errorType, 'NOT_FOUND');
    });

    test('deleting an appointment frees its slot', async () => {
      await service.delete(1);

      const rebook = await service.create({
        customer: 'Re-booker',
        date: '2026-11-20',
        time: '10:00'
      });

      assert.strictEqual(rebook.success, true);
    });
  });

  describe('getAvailableSlots()', () => {
    test('returns VALIDATION_ERROR when date is missing or invalid', async () => {
      const missing = await service.getAvailableSlots(undefined);
      assert.strictEqual(missing.success, false);
      assert.strictEqual(missing.errorType, 'VALIDATION_ERROR');

      const invalid = await service.getAvailableSlots('20-11-2026');
      assert.strictEqual(invalid.success, false);
      assert.strictEqual(invalid.errorType, 'VALIDATION_ERROR');
    });

    test('returns correct slot availability for a date with confirmed bookings', async () => {
      const res = await service.getAvailableSlots('2026-11-20');
      assert.strictEqual(res.success, true);
      assert.ok(res.data);
      assert.strictEqual(res.data?.date, '2026-11-20');
      assert.strictEqual(res.data?.totalSlots, 18);
      assert.strictEqual(res.data?.availableCount, 17);
      assert.strictEqual(res.data?.bookedCount, 1);
      assert.strictEqual(res.data?.availableSlots.includes('10:00'), false);
      assert.strictEqual(res.data?.availableSlots.includes('08:00'), true);

      const tenAmSlot = res.data?.slots.find((s) => s.time === '10:00');
      assert.strictEqual(tenAmSlot?.available, false);

      const eightAmSlot = res.data?.slots.find((s) => s.time === '08:00');
      assert.strictEqual(eightAmSlot?.available, true);
    });

    test('cancelled appointments do not consume slots', async () => {
      await service.update(1, { status: 'CANCELLED' });
      const res = await service.getAvailableSlots('2026-11-20');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.availableCount, 18);
      assert.strictEqual(res.data?.bookedCount, 0);
      assert.strictEqual(res.data?.availableSlots.includes('10:00'), true);
    });
  });

  describe('getStats()', () => {
    test('computes counts by status, serviceType, rates, and busiest slots/dates', async () => {
      const a2 = await service.create({
        customer: 'Alice',
        serviceType: 'TREATMENT',
        date: '2026-11-20',
        time: '11:00'
      });
      const a3 = await service.create({
        customer: 'Bob',
        serviceType: 'CHECKUP',
        date: '2026-11-21',
        time: '10:00'
      });
      const a4 = await service.create({
        customer: 'Clara',
        serviceType: 'TREATMENT',
        date: '2026-11-22',
        time: '10:00'
      });

      await service.cancelAppointment(a2.data!.id);
      await service.completeAppointment(a3.data!.id);
      assert.ok(a4.success);

      const res = await service.getStats();
      assert.strictEqual(res.success, true);
      assert.ok(res.data);
      assert.strictEqual(res.data?.totalAppointments, 4);
      assert.strictEqual(res.data?.byStatus.CONFIRMED, 2);
      assert.strictEqual(res.data?.byStatus.CANCELLED, 1);
      assert.strictEqual(res.data?.byStatus.COMPLETED, 1);
      assert.strictEqual(res.data?.byServiceType.TREATMENT, 2);
      assert.strictEqual(res.data?.byServiceType.CONSULTATION, 1);
      assert.strictEqual(res.data?.byServiceType.CHECKUP, 1);
      assert.strictEqual(res.data?.cancellationRatePercent, 25);
      assert.strictEqual(res.data?.completionRatePercent, 25);
      assert.deepStrictEqual(res.data?.busiestTimeSlots[0], { time: '10:00', count: 3 });
      assert.deepStrictEqual(res.data?.busiestDates[0], { date: '2026-11-20', count: 2 });
    });

    test('filters stats by startDate and endDate and validates date range', async () => {
      await service.create({
        customer: 'December User',
        serviceType: 'FOLLOW_UP',
        date: '2026-12-15',
        time: '09:00'
      });

      const decStats = await service.getStats({ startDate: '2026-12-01', endDate: '2026-12-31' });
      assert.strictEqual(decStats.success, true);
      assert.strictEqual(decStats.data?.totalAppointments, 1);
      assert.strictEqual(decStats.data?.byServiceType.FOLLOW_UP, 1);

      const badRange = await service.getStats({ startDate: '2026-12-31', endDate: '2026-12-01' });
      assert.strictEqual(badRange.success, false);
      assert.strictEqual(badRange.errorType, 'VALIDATION_ERROR');

      const badDate = await service.getStats({ startDate: '2026-02-31' });
      assert.strictEqual(badDate.success, false);
      assert.strictEqual(badDate.errorType, 'VALIDATION_ERROR');
    });
  });
});
