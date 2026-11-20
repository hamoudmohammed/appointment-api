import { Appointment } from '../types/appointment.js';

function escapeCsvField(val: unknown): string {
  if (val === undefined || val === null) {
    return '';
  }
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportToCsv(appointments: Appointment[]): string {
  const headers = [
    'ID',
    'Customer',
    'Email',
    'Phone',
    'ServiceType',
    'Date',
    'Time',
    'Status',
    'Notes',
    'CreatedAt'
  ];

  const rows = appointments.map((a) => [
    escapeCsvField(a.id),
    escapeCsvField(a.customer),
    escapeCsvField(a.email),
    escapeCsvField(a.phone),
    escapeCsvField(a.serviceType),
    escapeCsvField(a.date),
    escapeCsvField(a.time),
    escapeCsvField(a.status),
    escapeCsvField(a.notes),
    escapeCsvField(a.createdAt)
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
}

function formatIcsDateTime(dateStr: string, timeStr: string, addMinutes = 0): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes));
  if (addMinutes > 0) {
    date.setUTCMinutes(date.getUTCMinutes() + addMinutes);
  }

  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  const s = '00';

  return `${y}${m}${d}T${h}${min}${s}Z`;
}

function escapeIcsText(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function exportToIcs(appointments: Appointment[]): string {
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

  const events = appointments.map((a) => {
    const startStr = formatIcsDateTime(a.date, a.time, 0);
    const endStr = formatIcsDateTime(a.date, a.time, 30);
    const summary = escapeIcsText(`Appointment: ${a.serviceType} with ${a.customer}`);
    const description = escapeIcsText(
      `Service: ${a.serviceType}\nCustomer: ${a.customer}${a.phone ? `\nPhone: ${a.phone}` : ''}${a.notes ? `\nNotes: ${a.notes}` : ''}`
    );

    return [
      'BEGIN:VEVENT',
      `UID:appointment-${a.id}@appointment-api`,
      `DTSTAMP:${now}`,
      `DTSTART:${startStr}`,
      `DTEND:${endStr}`,
      `SUMMARY:${summary}`,
      `DESCRIPTION:${description}`,
      `STATUS:${a.status === 'CONFIRMED' ? 'CONFIRMED' : 'CANCELLED'}`,
      'END:VEVENT'
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Appointment REST API//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR'
  ].join('\r\n');
}
