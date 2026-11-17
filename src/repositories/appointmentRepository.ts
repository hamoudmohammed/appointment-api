import { Appointment, AppointmentStatus } from '../types/appointment.js';

export interface CreateAppointmentRecord {
  customer: string;
  date: string;
  time: string;
  status: AppointmentStatus;
}

export interface UpdateAppointmentRecord {
  customer?: string | undefined;
  date?: string | undefined;
  time?: string | undefined;
  status?: AppointmentStatus | undefined;
}

export interface IAppointmentRepository {
  findAll(): Promise<Appointment[]>;
  findById(id: number): Promise<Appointment | undefined>;
  findConfirmedBySlot(date: string, time: string, excludeId?: number | undefined): Promise<Appointment | undefined>;
  create(record: CreateAppointmentRecord): Promise<Appointment>;
  update(id: number, record: UpdateAppointmentRecord): Promise<Appointment | undefined>;
  delete(id: number): Promise<Appointment | undefined>;
}
