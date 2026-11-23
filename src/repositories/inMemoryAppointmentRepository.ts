import {
  Appointment,
  AppointmentQueryFilter,
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

export class InMemoryAppointmentRepository implements IAppointmentRepository {
  private appointments: Appointment[] = [];
  private history: AppointmentHistoryEntry[] = [];
  private nextId = 1;
  private nextHistoryId = 1;

  constructor(initialData?: Appointment[]) {
    if (initialData) {
      this.appointments = [...initialData];
      this.nextId = Math.max(...initialData.map((a) => a.id), 0) + 1;
    } else {
      this.appointments = [
        {
          id: 1,
          customer: 'Max Mustermann',
          email: 'max@example.com',
          phone: '+49 151 12345678',
          provider: DEFAULT_PROVIDER,
          serviceType: 'CONSULTATION',
          notes: 'Initial consultation session',
          date: '2026-11-20',
          time: '10:00',
          status: 'CONFIRMED',
          createdAt: '2026-11-14T10:00:00.000Z'
        }
      ];
      this.nextId = 2;
    }

    for (const appt of this.appointments) {
      this.history.push({
        id: this.nextHistoryId++,
        appointmentId: appt.id,
        action: 'CREATED',
        newValues: {
          customer: appt.customer,
          provider: appt.provider,
          serviceType: appt.serviceType,
          date: appt.date,
          time: appt.time,
          status: appt.status
        },
        timestamp: appt.createdAt
      });
    }
  }

  public async findAll(filter?: AppointmentQueryFilter): Promise<RepositoryFindAllResult> {
    let result = [...this.appointments];

    if (filter) {
      if (filter.date) {
        result = result.filter((item) => item.date === filter.date);
      }
      if (filter.startDate) {
        result = result.filter((item) => item.date >= filter.startDate!);
      }
      if (filter.endDate) {
        result = result.filter((item) => item.date <= filter.endDate!);
      }
      if (filter.status) {
        result = result.filter((item) => item.status === filter.status);
      }
      if (filter.customer) {
        const query = filter.customer.trim().toLowerCase();
        result = result.filter((item) => item.customer.toLowerCase().includes(query));
      }
      if (filter.email) {
        const query = filter.email.trim().toLowerCase();
        result = result.filter((item) => item.email?.toLowerCase().includes(query));
      }
      if (filter.provider) {
        const query = filter.provider.trim().toLowerCase();
        result = result.filter((item) => item.provider.toLowerCase().includes(query));
      }
      if (filter.serviceType) {
        result = result.filter((item) => item.serviceType === filter.serviceType);
      }
    }

    // Sort consistently: date ASC, time ASC, id ASC
    result.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.time !== b.time) return a.time.localeCompare(b.time);
      return a.id - b.id;
    });

    const total = result.length;

    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.max(1, filter?.limit ?? 20);
    const offset = (page - 1) * limit;

    const items = result.slice(offset, offset + limit);

    return { items, total };
  }

  public async findById(id: number): Promise<Appointment | undefined> {
    return this.appointments.find((item) => item.id === id);
  }

  public async findConfirmedBySlot(
    date: string,
    time: string,
    excludeId?: number,
    provider?: string
  ): Promise<Appointment | undefined> {
    const targetProvider = (provider?.trim() || DEFAULT_PROVIDER).toLowerCase();
    return this.appointments.find(
      (item) =>
        item.date === date &&
        item.time === time &&
        item.provider.toLowerCase() === targetProvider &&
        item.status === 'CONFIRMED' &&
        (excludeId === undefined || item.id !== excludeId)
    );
  }

  public async create(record: CreateAppointmentRecord): Promise<Appointment> {
    const newAppointment: Appointment = {
      id: this.nextId++,
      customer: record.customer,
      email: record.email,
      phone: record.phone,
      provider: record.provider?.trim() || DEFAULT_PROVIDER,
      serviceType: record.serviceType ?? 'CONSULTATION',
      notes: record.notes,
      date: record.date,
      time: record.time,
      status: record.status,
      createdAt: new Date().toISOString()
    };

    this.appointments.push(newAppointment);
    return newAppointment;
  }

  public async update(id: number, record: UpdateAppointmentRecord): Promise<Appointment | undefined> {
    const index = this.appointments.findIndex((item) => item.id === id);
    if (index === -1) {
      return undefined;
    }

    const current = this.appointments[index];
    const updated: Appointment = {
      ...current,
      customer: record.customer !== undefined ? record.customer : current.customer,
      email: record.email !== undefined ? record.email : current.email,
      phone: record.phone !== undefined ? record.phone : current.phone,
      provider: record.provider !== undefined ? record.provider : current.provider,
      serviceType: record.serviceType !== undefined ? record.serviceType : current.serviceType,
      notes: record.notes !== undefined ? record.notes : current.notes,
      date: record.date !== undefined ? record.date : current.date,
      time: record.time !== undefined ? record.time : current.time,
      status: record.status !== undefined ? record.status : current.status
    };

    this.appointments[index] = updated;
    return updated;
  }

  public async delete(id: number): Promise<Appointment | undefined> {
    const index = this.appointments.findIndex((item) => item.id === id);
    if (index === -1) {
      return undefined;
    }

    const [deleted] = this.appointments.splice(index, 1);
    this.history = this.history.filter((entry) => entry.appointmentId !== id);
    return deleted;
  }

  public async addHistory(record: CreateHistoryRecord): Promise<AppointmentHistoryEntry> {
    const entry: AppointmentHistoryEntry = {
      id: this.nextHistoryId++,
      appointmentId: record.appointmentId,
      action: record.action,
      previousValues: record.previousValues,
      newValues: record.newValues,
      timestamp: new Date().toISOString()
    };
    this.history.push(entry);
    return entry;
  }

  public async findHistoryByAppointmentId(appointmentId: number): Promise<AppointmentHistoryEntry[]> {
    return this.history
      .filter((entry) => entry.appointmentId === appointmentId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id - b.id);
  }
}
