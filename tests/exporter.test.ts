import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { exportToCsv, exportToIcs } from '../src/utils/exporter.js';
import { Appointment } from '../src/types/appointment.js';

describe('Exporter Utility', () => {
  const sampleAppointments: Appointment[] = [
    {
      id: 1,
      customer: 'Max Mustermann',
      email: 'max@example.com',
      phone: '+49 151 12345678',
      provider: 'General',
      serviceType: 'CONSULTATION',
      notes: 'Initial consultation, needs info',
      date: '2026-11-20',
      time: '10:00',
      status: 'CONFIRMED',
      createdAt: '2026-11-14T10:00:00.000Z'
    },
    {
      id: 2,
      customer: 'Sarah Connor',
      email: 'sarah@skynet.com',
      phone: '+1 555 1234',
      provider: 'Dr. Weber',
      serviceType: 'TREATMENT',
      date: '2026-11-25',
      time: '14:30',
      status: 'CANCELLED',
      createdAt: '2026-11-15T12:00:00.000Z'
    }
  ];

  test('exportToCsv() generates RFC 4180 compliant CSV', () => {
    const csv = exportToCsv(sampleAppointments);
    const lines = csv.split('\r\n');

    assert.strictEqual(lines.length, 3); // Header + 2 rows
    assert.strictEqual(
      lines[0],
      'ID,Customer,Email,Phone,ServiceType,Date,Time,Status,Notes,CreatedAt'
    );
    assert.match(lines[1], /^1,Max Mustermann,max@example\.com/);
    assert.match(lines[1], /"Initial consultation, needs info"/); // Comma correctly escaped
    assert.match(lines[2], /^2,Sarah Connor,sarah@skynet\.com/);
  });

  test('exportToIcs() generates valid iCalendar format', () => {
    const ics = exportToIcs(sampleAppointments);

    assert.match(ics, /^BEGIN:VCALENDAR/);
    assert.match(ics, /VERSION:2\.0/);
    assert.match(ics, /PRODID:-\/\/Appointment REST API\/\/EN/);
    assert.match(ics, /BEGIN:VEVENT/);
    assert.match(ics, /UID:appointment-1@appointment-api/);
    assert.match(ics, /DTSTART:20261120T100000Z/);
    assert.match(ics, /DTEND:20261120T103000Z/);
    assert.match(ics, /SUMMARY:Appointment: CONSULTATION with Max Mustermann/);
    assert.match(ics, /STATUS:CONFIRMED/);
    assert.match(ics, /STATUS:CANCELLED/);
    assert.match(ics, /END:VCALENDAR$/);
  });
});
