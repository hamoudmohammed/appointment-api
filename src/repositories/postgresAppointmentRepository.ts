import pg from 'pg';
import {
  Appointment,
  AppointmentStatus,
  AppointmentServiceType,
  AppointmentQueryFilter,
  AppointmentSortField,
  AppointmentHistoryAction,
  AppointmentHistoryEntry,
  DEFAULT_PROVIDER
} from '../types/appointment.js';
import {
  IAppointmentRepository,
  CreateAppointmentRecord,
  UpdateAppointmentRecord,
  CreateHistoryRecord,
  RepositoryFindAllResult
} from './appointmentRepository.js';

interface AppointmentHistoryDbRow {
  id: number;
  appointment_id: number;
  action: string;
  previous_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  timestamp: string | Date;
}

function mapRowToHistoryEntry(row: AppointmentHistoryDbRow): AppointmentHistoryEntry {
  const timestampStr =
    row.timestamp instanceof Date
      ? row.timestamp.toISOString()
      : new Date(row.timestamp).toISOString();

  return {
    id: row.id,
    appointmentId: row.appointment_id,
    action: row.action as AppointmentHistoryAction,
    previousValues: row.previous_values ?? undefined,
    newValues: row.new_values ?? undefined,
    timestamp: timestampStr
  };
}

interface AppointmentDbRow {
  id: number;
  customer: string;
  email?: string | null;
  phone?: string | null;
  provider?: string | null;
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
    provider: row.provider || DEFAULT_PROVIDER,
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
    if (filter?.provider) {
      conditions.push(`provider ILIKE $${idx++}`);
      values.push(`%${filter.provider.trim()}%`);
    }
    if (filter?.serviceType) {
      conditions.push(`service_type = $${idx++}`);
      values.push(filter.serviceType);
    }
    if (filter?.q && filter.q.trim().length > 0) {
      conditions.push(
        `(customer ILIKE $${idx} OR COALESCE(email, '') ILIKE $${idx} OR provider ILIKE $${idx} OR COALESCE(notes, '') ILIKE $${idx} OR COALESCE(phone, '') ILIKE $${idx} OR service_type ILIKE $${idx})`
      );
      values.push(`%${filter.q.trim()}%`);
      idx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS count FROM appointments ${whereClause}`;
    const countRes = await this.pool.query<{ count: number }>(countSql, values);
    const total = countRes.rows[0]?.count ?? 0;

    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.max(1, filter?.limit ?? 20);
    const offset = (page - 1) * limit;

    const sortColumnMap: Record<AppointmentSortField, string> = {
      date: 'date',
      time: 'time',
      customer: 'LOWER(customer)',
      provider: 'LOWER(provider)',
      status: 'status',
      createdAt: 'created_at'
    };
    const sortBy: AppointmentSortField =
      filter?.sortBy && filter.sortBy in sortColumnMap ? filter.sortBy : 'date';
    const sortDir = filter?.sortOrder === 'desc' ? 'DESC' : 'ASC';
    const orderByClause =
      sortBy === 'date'
        ? `date ${sortDir}, time ${sortDir}, id ${sortDir}`
        : sortBy === 'time'
          ? `time ${sortDir}, date ${sortDir}, id ${sortDir}`
          : `${sortColumnMap[sortBy]} ${sortDir}, id ASC`;

    const queryValues = [...values, limit, offset];
    const dataSql = `
      SELECT id, customer, email, phone, provider, service_type, notes, date, time, status, created_at
      FROM appointments
      ${whereClause}
      ORDER BY ${orderByClause}
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
      'SELECT id, customer, email, phone, provider, service_type, notes, date, time, status, created_at FROM appointments WHERE id = $1',
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
    excludeId?: number,
    provider?: string
  ): Promise<Appointment | undefined> {
    const targetProvider = provider?.trim() || DEFAULT_PROVIDER;
    let query =
      "SELECT id, customer, email, phone, provider, service_type, notes, date, time, status, created_at FROM appointments WHERE date = $1 AND time = $2 AND LOWER(provider) = LOWER($3) AND status = 'CONFIRMED'";
    const params: unknown[] = [date, time, targetProvider];

    if (excludeId !== undefined) {
      query += ' AND id != $4';
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
      `INSERT INTO appointments (customer, email, phone, provider, service_type, notes, date, time, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, customer, email, phone, provider, service_type, notes, date, time, status, created_at`,
      [
        record.customer,
        record.email ?? null,
        record.phone ?? null,
        record.provider?.trim() || DEFAULT_PROVIDER,
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
    if (record.provider !== undefined) {
      fields.push(`provider = $${idx++}`);
      values.push(record.provider);
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
      RETURNING id, customer, email, phone, provider, service_type, notes, date, time, status, created_at
    `;

    const res = await this.pool.query<AppointmentDbRow>(query, values);
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async delete(id: number): Promise<Appointment | undefined> {
    const res = await this.pool.query<AppointmentDbRow>(
      'DELETE FROM appointments WHERE id = $1 RETURNING id, customer, email, phone, provider, service_type, notes, date, time, status, created_at',
      [id]
    );
    if (res.rows.length === 0) {
      return undefined;
    }
    return mapRowToAppointment(res.rows[0]);
  }

  public async addHistory(record: CreateHistoryRecord): Promise<AppointmentHistoryEntry> {
    const res = await this.pool.query<AppointmentHistoryDbRow>(
      `INSERT INTO appointment_history (appointment_id, action, previous_values, new_values)
       VALUES ($1, $2, $3, $4)
       RETURNING id, appointment_id, action, previous_values, new_values, timestamp`,
      [
        record.appointmentId,
        record.action,
        record.previousValues ? JSON.stringify(record.previousValues) : null,
        record.newValues ? JSON.stringify(record.newValues) : null
      ]
    );
    return mapRowToHistoryEntry(res.rows[0]);
  }

  public async findHistoryByAppointmentId(appointmentId: number): Promise<AppointmentHistoryEntry[]> {
    const res = await this.pool.query<AppointmentHistoryDbRow>(
      `SELECT id, appointment_id, action, previous_values, new_values, timestamp
       FROM appointment_history
       WHERE appointment_id = $1
       ORDER BY timestamp ASC, id ASC`,
      [appointmentId]
    );
    return res.rows.map(mapRowToHistoryEntry);
  }
}
