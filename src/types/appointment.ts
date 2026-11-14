export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED';

export interface Appointment {
  id: number;
  customer: string;
  date: string; // ISO date format: YYYY-MM-DD
  time: string; // 24-hour format: HH:mm
  status: AppointmentStatus;
  createdAt: string;
}

export interface CreateAppointmentDTO {
  customer: string;
  date: string;
  time: string;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
