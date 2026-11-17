import pg from 'pg';
import { Appointment, AppointmentStatus } from '../types/appointment.js';
import {
  IAppointmentRepository,
  CreateAppointmentRecord,
  UpdateAppointmentRecord
} from './appointmentRepository.js';

interface AppointmentDbRow {
  id: number;
  customer: string;
  date: string | Date;
  time: string;
  status: string;
  created_at: string | Date;
}

function mapRowToAppointment(row: AppointmentDbRow): Appointment {
  const dateStr =
    typeof row.date === 'string'
      ? row.date
      : row.date.toISOString().split('T')[0];

  const createdAtStr =
    row.created_at instanceof Date
      ? row.created_at.toISOString()
      : new Date(row.created_at).toISOString();

  return {
    id: row.id,
    customer: row.customer,
    date: dateStr,
    time: row.time,
    status: row.status as AppointmentStatus,
    createdAt: createdAtStr
  };
}

export class PostgresAppointmentRepository implements IAppointmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  public async findAll(): Promise<Appointment[]> {
    const res = await this.pool.query<AppointmentDbRow>(
      'SELECT id, customer, date, time, status, created_at FROM appointments ORDER BY date ASC, time ASC, id ASC'
    );
    return res.rows.map(mapRowToAppointment);
  }

  public async findById(id: number): Promise<Appointment | undefined> {
    const res = await this.pool.query<AppointmentDbRow>(
      'SELECT id, customer, date, time, status, created_at FROM appointments WHERE id = $1',
      [id]
    );
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async findConfirmedBySlot(
    date: string,
    time: string,
    excludeId?: number
  ): Promise<Appointment | undefined> {
    let query =
      "SELECT id, customer, date, time, status, created_at FROM appointments WHERE date = $1 AND time = $2 AND status = 'CONFIRMED'";
    const params: unknown[] = [date, time];

    if (excludeId !== undefined) {
      query += ' AND id != $3';
      params.push(excludeId);
    }

    query += ' LIMIT 1';

    const res = await this.pool.query<AppointmentDbRow>(query, params);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async create(record: CreateAppointmentRecord): Promise<Appointment> {
    const res = await this.pool.query<AppointmentDbRow>(
      `INSERT INTO appointments (customer, date, time, status)
       VALUES ($1, $2, $3, $4)
       RETURNING id, customer, date, time, status, created_at`,
      [record.customer, record.date, record.time, record.status]
    );
    return mapRowToAppointment(res.rows[0]);
  }

  public async update(id: number, record: UpdateAppointmentRecord): Promise<Appointment | undefined> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (record.customer !== undefined) {
      fields.push(`customer = $${idx++}`);
      values.push(record.customer);
    }
    if (record.date !== undefined) {
      fields.push(`date = $${idx++}`);
      values.push(record.date);
    }
    if (record.time !== undefined) {
      fields.push(`time = $${idx++}`);
      values.push(record.time);
    }
    if (record.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(record.status);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const query = `
      UPDATE appointments
      SET ${fields.join(', ')}
      WHERE id = $${idx}
      RETURNING id, customer, date, time, status, created_at
    `;

    const res = await this.pool.query<AppointmentDbRow>(query, values);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async delete(id: number): Promise<Appointment | undefined> {
    const res = await this.pool.query<AppointmentDbRow>(
      'DELETE FROM appointments WHERE id = $1 RETURNING id, customer, date, time, status, created_at',
      [id]
    );
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }
}
