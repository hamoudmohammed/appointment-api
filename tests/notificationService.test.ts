import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  NotificationService,
  DomainEventBus
} from '../src/services/notificationService.js';
import { AppointmentService } from '../src/services/appointmentService.js';
import { InMemoryAppointmentRepository } from '../src/repositories/inMemoryAppointmentRepository.js';

describe('NotificationService & Domain Events', () => {
  let eventBus: DomainEventBus;
  let notificationService: NotificationService;
  let appointmentService: AppointmentService;

  beforeEach(() => {
    eventBus = new DomainEventBus();
    notificationService = new NotificationService(eventBus);
    appointmentService = new AppointmentService(new InMemoryAppointmentRepository(), eventBus);
  });

  test('generates confirmation notification when appointment is created', async () => {
    const res = await appointmentService.create({
      customer: 'Elena Rostova',
      email: 'elena@example.com',
      serviceType: 'CONSULTATION',
      date: '2026-12-05',
      time: '11:00'
    });

    assert.strictEqual(res.success, true);

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:created');
    assert.strictEqual(sent[0].recipient, 'elena@example.com');
    assert.match(sent[0].subject, /Booking Confirmation/);
    assert.match(sent[0].body, /Elena Rostova/);
  });

  test('generates cancellation notification when appointment is cancelled', async () => {
    await appointmentService.cancelAppointment(1);

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:cancelled');
    assert.match(sent[0].subject, /Cancellation Notice/);
  });

  test('generates rescheduled notification when date or time is modified', async () => {
    await appointmentService.update(1, {
      date: '2026-11-21',
      time: '14:00'
    });

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:rescheduled');
    assert.match(sent[0].subject, /Rescheduled/);
    assert.match(sent[0].body, /2026-11-21 at 14:00/);
  });

  test('generates completion notification when appointment is marked completed', async () => {
    await appointmentService.completeAppointment(1);

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:completed');
    assert.match(sent[0].subject, /Thank You/);
  });

  test('generates no-show notification when appointment is marked as no-show', async () => {
    await appointmentService.markNoShow(1);

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:no_show');
    assert.match(sent[0].subject, /Missed Appointment/);
  });

  test('generates confirmation notification when pending appointment is confirmed', async () => {
    const repo = new InMemoryAppointmentRepository([
      {
        id: 10,
        customer: 'Pending User',
        email: 'pending@example.com',
        provider: 'Dr. Weber',
        serviceType: 'CHECKUP',
        date: '2026-12-10',
        time: '11:00',
        status: 'PENDING',
        createdAt: '2026-11-14T10:00:00.000Z'
      }
    ]);
    const svc = new AppointmentService(repo, eventBus);

    const res = await svc.confirmAppointment(10);
    assert.strictEqual(res.success, true);

    const sent = notificationService.getSentNotifications();
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].eventType, 'appointment:confirmed');
    assert.strictEqual(sent[0].recipient, 'pending@example.com');
    assert.match(sent[0].subject, /Appointment Confirmed/);
  });
});
