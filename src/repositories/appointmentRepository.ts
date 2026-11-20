import {
  Appointment,
  AppointmentStatus,
  AppointmentServiceType,
  AppointmentQueryFilter
} from '../types/appointment.js';

export interface CreateAppointmentRecord {
  customer: string;
  email?: string | undefined;
  phone?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  notes?: string | undefined;
  date: string;
  time: string;
  status: AppointmentStatus;
}

export interface UpdateAppointmentRecord {
  customer?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  notes?: string | undefined;
  date?: string | undefined;
  time?: string | undefined;
  status?: AppointmentStatus | undefined;
}

export interface RepositoryFindAllResult {
  items: Appointment[];
  total: number;
}

export interface IAppointmentRepository {
  findAll(filter?: AppointmentQueryFilter): Promise<RepositoryFindAllResult>;
  findById(id: number): Promise<Appointment | undefined>;
  findConfirmedBySlot(date: string, time: string, excludeId?: number | undefined): Promise<Appointment | undefined>;
  create(record: CreateAppointmentRecord): Promise<Appointment>;
  update(id: number, record: UpdateAppointmentRecord): Promise<Appointment | undefined>;
  delete(id: number): Promise<Appointment | undefined>;
}
