import { Appointment } from '../types/appointment.js';
import {
  IAppointmentRepository,
  CreateAppointmentRecord,
  UpdateAppointmentRecord
} from './appointmentRepository.js';

export class InMemoryAppointmentRepository implements IAppointmentRepository {
  private appointments: Appointment[] = [];
  private nextId = 1;

  constructor(initialData?: Appointment[]) {
    if (initialData) {
      this.appointments = [...initialData];
      this.nextId = Math.max(...initialData.map((a) => a.id), 0) + 1;
    } else {
      this.appointments = [
        {
          id: 1,
          customer: 'Max Mustermann',
          date: '2026-11-20',
          time: '10:00',
          status: 'CONFIRMED',
          createdAt: '2026-11-14T10:00:00.000Z'
        }
      ];
      this.nextId = 2;
    }
  }

  public async findAll(): Promise<Appointment[]> {
    return [...this.appointments];
  }

  public async findById(id: number): Promise<Appointment | undefined> {
    return this.appointments.find((item) => item.id === id);
  }

  public async findConfirmedBySlot(
    date: string,
    time: string,
    excludeId?: number
  ): Promise<Appointment | undefined> {
    return this.appointments.find(
      (item) =>
        item.date === date &&
        item.time === time &&
        item.status === 'CONFIRMED' &&
        (excludeId === undefined || item.id !== excludeId)
    );
  }

  public async create(record: CreateAppointmentRecord): Promise<Appointment> {
    const newAppointment: Appointment = {
      id: this.nextId++,
      customer: record.customer,
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
    return deleted;
  }
}
