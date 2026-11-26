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

  test('create() allows booking the same date/time for different providers and prevents conflict per provider', async () => {
    // Seed appointment is on 2026-11-20 at 10:00 for provider "General"
    const drWeber = await service.create({
      customer: 'Patient A',
      provider: 'Dr. Weber',
      date: '2026-11-20',
      time: '10:00'
    });
    assert.strictEqual(drWeber.success, true);
    assert.strictEqual(drWeber.data?.provider, 'Dr. Weber');

    // Same slot for same provider (case-insensitive) must conflict
    const conflict = await service.create({
      customer: 'Patient B',
      provider: 'dr. weber',
      date: '2026-11-20',
      time: '10:00'
    });
    assert.strictEqual(conflict.success, false);
    assert.strictEqual(conflict.errorType, 'CONFLICT');

    // Empty provider is rejected
    const badProvider = await service.create({
      customer: 'Patient C',
      provider: '   ',
      date: '2026-11-20',
      time: '11:00'
    });
    assert.strictEqual(badProvider.success, false);
    assert.strictEqual(badProvider.errorType, 'VALIDATION_ERROR');
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

    test('calculates slot availability independently per provider', async () => {
      // Seed occupies 10:00 for "General", so "Dr. Weber" still has 10:00 free
      const beforeBooking = await service.getAvailableSlots('2026-11-20', 'Dr. Weber');
      assert.strictEqual(beforeBooking.success, true);
      assert.strictEqual(beforeBooking.data?.provider, 'Dr. Weber');
      assert.strictEqual(beforeBooking.data?.bookedCount, 0);
      assert.strictEqual(beforeBooking.data?.availableSlots.includes('10:00'), true);

      await service.create({
        customer: 'Weber Patient',
        provider: 'Dr. Weber',
        date: '2026-11-20',
        time: '14:00'
      });

      const afterBooking = await service.getAvailableSlots('2026-11-20', 'Dr. Weber');
      assert.strictEqual(afterBooking.success, true);
      assert.strictEqual(afterBooking.data?.bookedCount, 1);
      assert.strictEqual(afterBooking.data?.availableSlots.includes('14:00'), false);
      assert.strictEqual(afterBooking.data?.availableSlots.includes('10:00'), true);
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

    test('includes byProvider breakdown and supports provider filter', async () => {
      await service.create({
        customer: 'Patient 1',
        provider: 'Dr. Weber',
        date: '2026-11-20',
        time: '11:00'
      });
      await service.create({
        customer: 'Patient 2',
        provider: 'Dr. Weber',
        date: '2026-11-20',
        time: '12:00'
      });

      const allStats = await service.getStats();
      assert.strictEqual(allStats.success, true);
      assert.strictEqual(allStats.data?.byProvider['General'], 1);
      assert.strictEqual(allStats.data?.byProvider['Dr. Weber'], 2);

      const weberStats = await service.getStats({ provider: 'Dr. Weber' });
      assert.strictEqual(weberStats.success, true);
      assert.strictEqual(weberStats.data?.totalAppointments, 2);
      assert.strictEqual(weberStats.data?.byProvider['Dr. Weber'], 2);
    });
  });

  describe('getHistory()', () => {
    test('tracks CREATED, UPDATED, RESCHEDULED, and CANCELLED audit entries chronologically', async () => {
      const created = await service.create({
        customer: 'Audit Client',
        provider: 'Dr. Weber',
        date: '2026-12-10',
        time: '09:00'
      });
      assert.strictEqual(created.success, true);
      const id = created.data!.id;

      await service.update(id, { notes: 'Bring previous lab results' });
      await service.update(id, { date: '2026-12-12', time: '11:30' });
      await service.cancelAppointment(id);

      const historyRes = await service.getHistory(id);
      assert.strictEqual(historyRes.success, true);
      const entries = historyRes.data!;
      assert.strictEqual(entries.length, 4);
      assert.strictEqual(entries[0].action, 'CREATED');
      assert.strictEqual(entries[0].newValues?.customer, 'Audit Client');
      assert.strictEqual(entries[1].action, 'UPDATED');
      assert.strictEqual(entries[1].newValues?.notes, 'Bring previous lab results');
      assert.strictEqual(entries[2].action, 'RESCHEDULED');
      assert.strictEqual(entries[2].previousValues?.date, '2026-12-10');
      assert.strictEqual(entries[2].newValues?.date, '2026-12-12');
      assert.strictEqual(entries[2].previousValues?.time, '09:00');
      assert.strictEqual(entries[2].newValues?.time, '11:30');
      assert.strictEqual(entries[3].action, 'CANCELLED');
      assert.strictEqual(entries[3].previousValues?.status, 'CONFIRMED');
      assert.strictEqual(entries[3].newValues?.status, 'CANCELLED');
    });

    test('returns NOT_FOUND for unknown appointment ID', async () => {
      const res = await service.getHistory(9999);
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.errorType, 'NOT_FOUND');
    });
  });

  describe('Business hours & configurable slot durations', () => {
    test('rejects booking and rescheduling outside business hours (08:00 - 17:00)', async () => {
      for (const badTime of ['07:30', '17:00', '22:15']) {
        const res = await service.create({
          customer: 'After Hours Client',
          date: '2026-12-10',
          time: badTime
        });
        assert.strictEqual(res.success, false, `Expected ${badTime} to be rejected`);
        assert.strictEqual(res.errorType, 'VALIDATION_ERROR');
        assert.match(res.error || '', /business hours/i);
      }

      const updateRes = await service.update(1, { time: '18:00' });
      assert.strictEqual(updateRes.success, false);
      assert.strictEqual(updateRes.errorType, 'VALIDATION_ERROR');
      assert.match(updateRes.error || '', /business hours/i);
    });

    test('rejects past dates when allowPastDates is false', async () => {
      const strictService = new AppointmentService(new InMemoryAppointmentRepository(), undefined, {
        allowPastDates: false,
        now: () => new Date('2026-11-23T10:00:00.000Z')
      });

      const pastRes = await strictService.create({
        customer: 'Time Traveler',
        date: '2026-11-22',
        time: '10:00'
      });
      assert.strictEqual(pastRes.success, false);
      assert.strictEqual(pastRes.errorType, 'VALIDATION_ERROR');
      assert.match(pastRes.error || '', /past/i);

      const todayRes = await strictService.create({
        customer: 'Same Day Client',
        date: '2026-11-23',
        time: '14:00'
      });
      assert.strictEqual(todayRes.success, true);
    });

    test('getAvailableSlots() supports custom slotDuration (15, 30, 45, 60) and rejects invalid values', async () => {
      const hourly = await service.getAvailableSlots('2026-11-20', 'General', 60);
      assert.strictEqual(hourly.success, true);
      assert.strictEqual(hourly.data?.businessHours.slotDurationMinutes, 60);
      assert.strictEqual(hourly.data?.totalSlots, 9);
      assert.strictEqual(hourly.data?.bookedCount, 1);
      assert.strictEqual(hourly.data?.availableSlots.includes('10:00'), false);

      const quarterHour = await service.getAvailableSlots('2026-11-20', 'General', 15);
      assert.strictEqual(quarterHour.success, true);
      assert.strictEqual(quarterHour.data?.totalSlots, 36);

      const invalidDuration = await service.getAvailableSlots('2026-11-20', 'General', 25);
      assert.strictEqual(invalidDuration.success, false);
      assert.strictEqual(invalidDuration.errorType, 'VALIDATION_ERROR');
      assert.match(invalidDuration.error || '', /slotDuration/i);
    });
  });

  describe('markNoShow() & confirmAppointment()', () => {
    test('markNoShow() transitions CONFIRMED to NO_SHOW, records history, and is idempotent', async () => {
      const res = await service.markNoShow(1);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.status, 'NO_SHOW');

      // Idempotent second call
      const second = await service.markNoShow(1);
      assert.strictEqual(second.success, true);
      assert.strictEqual(second.data?.status, 'NO_SHOW');

      const history = await service.getHistory(1);
      assert.strictEqual(history.success, true);
      assert.strictEqual(history.data?.filter((e) => e.action === 'NO_SHOW').length, 1);
    });

    test('markNoShow() rejects CANCELLED, COMPLETED, and unknown IDs', async () => {
      const missing = await service.markNoShow(9999);
      assert.strictEqual(missing.success, false);
      assert.strictEqual(missing.errorType, 'NOT_FOUND');

      await service.cancelAppointment(1);
      const cancelledRes = await service.markNoShow(1);
      assert.strictEqual(cancelledRes.success, false);
      assert.strictEqual(cancelledRes.errorType, 'VALIDATION_ERROR');

      const created = await service.create({
        customer: 'Completed Customer',
        date: '2026-12-15',
        time: '09:00'
      });
      await service.completeAppointment(created.data!.id);
      const completedRes = await service.markNoShow(created.data!.id);
      assert.strictEqual(completedRes.success, false);
      assert.strictEqual(completedRes.errorType, 'VALIDATION_ERROR');
    });

    test('confirmAppointment() confirms PENDING appointment, detects conflicts, and rejects terminal states', async () => {
      const repo = new InMemoryAppointmentRepository([
        {
          id: 1,
          customer: 'Pending Client',
          provider: 'Dr. Weber',
          serviceType: 'CONSULTATION',
          date: '2026-12-20',
          time: '10:00',
          status: 'PENDING',
          createdAt: '2026-11-14T10:00:00.000Z'
        },
        {
          id: 2,
          customer: 'Conflicting Pending Client',
          provider: 'Dr. Weber',
          serviceType: 'CONSULTATION',
          date: '2026-12-20',
          time: '10:00',
          status: 'PENDING',
          createdAt: '2026-11-14T10:05:00.000Z'
        }
      ]);
      const localService = new AppointmentService(repo);

      const confirmed = await localService.confirmAppointment(1);
      assert.strictEqual(confirmed.success, true);
      assert.strictEqual(confirmed.data?.status, 'CONFIRMED');

      // Idempotent call on already confirmed appointment
      const repeat = await localService.confirmAppointment(1);
      assert.strictEqual(repeat.success, true);

      // History recorded CONFIRMED
      const history = await localService.getHistory(1);
      assert.strictEqual(history.data?.some((e) => e.action === 'CONFIRMED'), true);

      // Second pending appointment for same slot/provider hits CONFLICT
      const conflict = await localService.confirmAppointment(2);
      assert.strictEqual(conflict.success, false);
      assert.strictEqual(conflict.errorType, 'CONFLICT');

      // Terminal states cannot be confirmed
      await localService.cancelAppointment(1);
      const cancelledConfirm = await localService.confirmAppointment(1);
      assert.strictEqual(cancelledConfirm.success, false);
      assert.strictEqual(cancelledConfirm.errorType, 'VALIDATION_ERROR');

      // Missing ID
      const missing = await localService.confirmAppointment(9999);
      assert.strictEqual(missing.success, false);
      assert.strictEqual(missing.errorType, 'NOT_FOUND');
    });
  });

  describe('getAll() sorting & search validation', () => {
    test('rejects invalid sortBy, invalid sortOrder, and overly long q', async () => {
      const badSortBy = await service.getAll({ sortBy: 'password' as never });
      assert.strictEqual(badSortBy.success, false);
      assert.strictEqual(badSortBy.errorType, 'VALIDATION_ERROR');
      assert.match(badSortBy.error || '', /sortBy/i);

      const badSortOrder = await service.getAll({ sortOrder: 'random' as never });
      assert.strictEqual(badSortOrder.success, false);
      assert.strictEqual(badSortOrder.errorType, 'VALIDATION_ERROR');
      assert.match(badSortOrder.error || '', /sortOrder/i);

      const tooLongQ = await service.getAll({ q: 'a'.repeat(201) });
      assert.strictEqual(tooLongQ.success, false);
      assert.strictEqual(tooLongQ.errorType, 'VALIDATION_ERROR');
      assert.match(tooLongQ.error || '', /"q"/i);
    });
  });

  describe('AppointmentService.getOptionsFromEnv()', () => {
    test('parses valid business hours, slot duration, and past-booking flag from env', async () => {
      const options = AppointmentService.getOptionsFromEnv({
        BUSINESS_HOURS_START: '09:00',
        BUSINESS_HOURS_END: '18:00',
        SLOT_DURATION_MINUTES: '60',
        PREVENT_PAST_BOOKING: 'true'
      });

      assert.deepStrictEqual(options.businessHours, {
        start: '09:00',
        end: '18:00',
        slotDurationMinutes: 60
      });
      assert.strictEqual(options.allowPastDates, false);

      const configuredService = new AppointmentService(
        new InMemoryAppointmentRepository([]),
        undefined,
        {
          ...options,
          now: () => new Date('2026-11-26T10:00:00.000Z')
        }
      );

      const tooEarly = await configuredService.create({
        customer: 'Early Bird',
        date: '2026-11-27',
        time: '08:30'
      });
      assert.strictEqual(tooEarly.success, false);
      assert.match(tooEarly.error || '', /09:00 - 18:00/);

      const slots = await configuredService.getAvailableSlots('2026-11-27');
      assert.strictEqual(slots.success, true);
      assert.strictEqual(slots.data?.totalSlots, 9);
      assert.strictEqual(slots.data?.availableSlots[0], '09:00');
    });

    test('falls back to safe defaults on invalid or reversed env values', () => {
      const options = AppointmentService.getOptionsFromEnv({
        BUSINESS_HOURS_START: '19:00',
        BUSINESS_HOURS_END: '08:00',
        SLOT_DURATION_MINUTES: '25',
        PREVENT_PAST_BOOKING: 'false'
      });

      assert.deepStrictEqual(options.businessHours, {
        start: '08:00',
        end: '17:00',
        slotDurationMinutes: 30
      });
      assert.strictEqual(options.allowPastDates, true);
    });
  });

  describe('getNextAvailableSlot()', () => {
    test('skips booked slots and rolls over to the next day when a day is full', async () => {
      const repo = new InMemoryAppointmentRepository([]);
      const localService = new AppointmentService(repo, undefined, {
        businessHours: { start: '09:00', end: '11:00', slotDurationMinutes: 60 },
        now: () => new Date('2026-11-26T08:00:00.000Z')
      });

      // Book both slots on 2026-11-26 for Dr. Weber (09:00 and 10:00)
      await localService.create({
        customer: 'Patient 1',
        provider: 'Dr. Weber',
        date: '2026-11-26',
        time: '09:00'
      });
      await localService.create({
        customer: 'Patient 2',
        provider: 'Dr. Weber',
        date: '2026-11-26',
        time: '10:00'
      });

      // Next available for Dr. Weber rolls over to 2026-11-27 09:00
      const res = await localService.getNextAvailableSlot({
        fromDate: '2026-11-26',
        provider: 'Dr. Weber',
        slotDuration: 60,
        daysAhead: 5
      });
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.data?.found, true);
      assert.strictEqual(res.data?.daysSearched, 2);
      assert.deepStrictEqual(res.data?.nextAvailable, { date: '2026-11-27', time: '09:00' });

      // When daysAhead=1 and day 1 is full -> found: false
      const noneFound = await localService.getNextAvailableSlot({
        fromDate: '2026-11-26',
        provider: 'Dr. Weber',
        slotDuration: 60,
        daysAhead: 1
      });
      assert.strictEqual(noneFound.success, true);
      assert.strictEqual(noneFound.data?.found, false);
      assert.strictEqual(noneFound.data?.nextAvailable, null);
    });

    test('skips elapsed times on current day and validates query parameters', async () => {
      const localService = new AppointmentService(
        new InMemoryAppointmentRepository([]),
        undefined,
        { now: () => new Date('2026-11-26T10:15:00.000Z') }
      );

      const res = await localService.getNextAvailableSlot();
      assert.strictEqual(res.success, true);
      assert.deepStrictEqual(res.data?.nextAvailable, { date: '2026-11-26', time: '10:30' });

      const badDays = await localService.getNextAvailableSlot({ daysAhead: 50 });
      assert.strictEqual(badDays.success, false);
      assert.strictEqual(badDays.errorType, 'VALIDATION_ERROR');

      const badTime = await localService.getNextAvailableSlot({ fromTime: '25:99' });
      assert.strictEqual(badTime.success, false);
      assert.strictEqual(badTime.errorType, 'VALIDATION_ERROR');
    });
  });

  describe('getUpcoming()', () => {
    test('returns only active CONFIRMED/PENDING appointments within days or hours window', async () => {
      const repo = new InMemoryAppointmentRepository([
        {
          id: 1,
          customer: 'Past Client',
          provider: 'Dr. Weber',
          serviceType: 'CONSULTATION',
          date: '2026-11-26',
          time: '08:00',
          status: 'CONFIRMED',
          createdAt: '2026-11-20T10:00:00.000Z'
        },
        {
          id: 2,
          customer: 'Soon Confirmed',
          provider: 'Dr. Weber',
          serviceType: 'CONSULTATION',
          date: '2026-11-26',
          time: '12:00',
          status: 'CONFIRMED',
          createdAt: '2026-11-20T10:00:00.000Z'
        },
        {
          id: 3,
          customer: 'Cancelled Soon',
          provider: 'Dr. Weber',
          serviceType: 'CHECKUP',
          date: '2026-11-26',
          time: '13:00',
          status: 'CANCELLED',
          createdAt: '2026-11-20T10:00:00.000Z'
        },
        {
          id: 4,
          customer: 'Pending Next Week',
          provider: 'Dr. Weber',
          serviceType: 'FOLLOW_UP',
          date: '2026-11-30',
          time: '10:00',
          status: 'PENDING',
          createdAt: '2026-11-20T10:00:00.000Z'
        },
        {
          id: 5,
          customer: 'Far Future',
          provider: 'Dr. Weber',
          serviceType: 'TREATMENT',
          date: '2026-12-25',
          time: '10:00',
          status: 'CONFIRMED',
          createdAt: '2026-11-20T10:00:00.000Z'
        }
      ]);
      const localService = new AppointmentService(repo, undefined, {
        now: () => new Date('2026-11-26T10:00:00.000Z')
      });

      // Default 7-day window -> id 2 and id 4
      const weekRes = await localService.getUpcoming({ provider: 'Dr. Weber' });
      assert.strictEqual(weekRes.success, true);
      assert.strictEqual(weekRes.data?.total, 2);
      assert.deepStrictEqual(
        weekRes.data?.data.map((a) => a.id),
        [2, 4]
      );

      // 4-hour window -> only id 2 (12:00)
      const hoursRes = await localService.getUpcoming({ hours: 4 });
      assert.strictEqual(hoursRes.success, true);
      assert.strictEqual(hoursRes.data?.total, 1);
      assert.strictEqual(hoursRes.data?.data[0].id, 2);
    });

    test('validates mutually exclusive days/hours and bounds', async () => {
      const both = await service.getUpcoming({ days: 7, hours: 24 });
      assert.strictEqual(both.success, false);
      assert.strictEqual(both.errorType, 'VALIDATION_ERROR');

      const badDays = await service.getUpcoming({ days: 120 });
      assert.strictEqual(badDays.success, false);
      assert.strictEqual(badDays.errorType, 'VALIDATION_ERROR');

      const badHours = await service.getUpcoming({ hours: 0 });
      assert.strictEqual(badHours.success, false);
      assert.strictEqual(badHours.errorType, 'VALIDATION_ERROR');

      const badLimit = await service.getUpcoming({ limit: 500 });
      assert.strictEqual(badLimit.success, false);
      assert.strictEqual(badLimit.errorType, 'VALIDATION_ERROR');
    });
  });
});
