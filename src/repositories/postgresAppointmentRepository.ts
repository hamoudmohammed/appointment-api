import pg from 'pg';
import {
  Appointment,
  AppointmentStatus,
  AppointmentServiceType,
  AppointmentQueryFilter
} from '../types/appointment.js';
import {
  IAppointmentRepository,
  CreateAppointmentRecord,
  UpdateAppointmentRecord,
  RepositoryFindAllResult
} from './appointmentRepository.js';

interface AppointmentDbRow {
  id: number;
  customer: string;
  email?: string | null;
  phone?: string | null;
  service_type?: string | null;
  notes?: string | null;
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
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    serviceType: (row.service_type as AppointmentServiceType) || 'CONSULTATION',
    notes: row.notes ?? undefined,
    date: dateStr,
    time: row.time,
    status: row.status as AppointmentStatus,
    createdAt: createdAtStr
  };
}

export class PostgresAppointmentRepository implements IAppointmentRepository {
  constructor(private readonly pool: pg.Pool) {}

  public async findAll(filter?: AppointmentQueryFilter): Promise<RepositoryFindAllResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filter?.date) {
      conditions.push(`date = $${idx++}`);
      values.push(filter.date);
    }
    if (filter?.startDate) {
      conditions.push(`date >= $${idx++}`);
      values.push(filter.startDate);
    }
    if (filter?.endDate) {
      conditions.push(`date <= $${idx++}`);
      values.push(filter.endDate);
    }
    if (filter?.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filter.status);
    }
    if (filter?.customer) {
      conditions.push(`customer ILIKE $${idx++}`);
      values.push(`%${filter.customer.trim()}%`);
    }
    if (filter?.email) {
      conditions.push(`email ILIKE $${idx++}`);
      values.push(`%${filter.email.trim()}%`);
    }
    if (filter?.serviceType) {
      conditions.push(`service_type = $${idx++}`);
      values.push(filter.serviceType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS count FROM appointments ${whereClause}`;
    const countRes = await this.pool.query<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count ?? 0;

    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.max(1, filter?.limit ?? 20);
    const offset = (page - 1) * limit;

    const queryValues = [...values, limit, offset];
    const dataSql = `
      SELECT id, customer, email, phone, service_type, notes, date, time, status, created_at
      FROM appointments
      ${whereClause}
      ORDER BY date ASC, time ASC, id ASC
      LIMIT $${idx++} OFFSET $${idx++}
    `;

    const res = await this.pool.query<AppointmentDbRow>(dataSql, queryValues);
    return {
      items: res.rows.map(mapRowToAppointment),
      total
    };
  }

  public async findById(id: number): Promise<Appointment | undefined> {
    const res = await this.pool.query<AppointmentDbRow>(
      'SELECT id, customer, email, phone, service_type, notes, date, time, status, created_at FROM appointments WHERE id = $1',
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
      "SELECT id, customer, email, phone, service_type, notes, date, time, status, created_at FROM appointments WHERE date = $1 AND time = $2 AND status = 'CONFIRMED'";
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
      `INSERT INTO appointments (customer, email, phone, service_type, notes, date, time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, customer, email, phone, service_type, notes, date, time, status, created_at`,
      [
        record.customer,
        record.email ?? null,
        record.phone ?? null,
        record.serviceType,
        record.notes ?? null,
        record.date,
        record.time,
        record.status
      ]
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
    if (record.email !== undefined) {
      fields.push(`email = $${idx++}`);
      values.push(record.email);
    }
    if (record.phone !== undefined) {
      fields.push(`phone = $${idx++}`);
      values.push(record.phone);
    }
    if (record.serviceType !== undefined) {
      fields.push(`service_type = $${idx++}`);
      values.push(record.serviceType);
    }
    if (record.notes !== undefined) {
      fields.push(`notes = $${idx++}`);
      values.push(record.notes);
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
      RETURNING id, customer, email, phone, service_type, notes, date, time, status, created_at
    `;

    const res = await this.pool.query<AppointmentDbRow>(query, values);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async delete(id: number): Promise<Appointment | undefined> {
    const res = await this.pool.query<AppointmentDbRow>(
      'DELETE FROM appointments WHERE id = $1 RETURNING id, customer, email, phone, service_type, notes, date, time, status, created_at',
      [id]
    );
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }
}
