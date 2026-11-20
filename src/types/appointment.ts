export type AppointmentStatus = 'CONFIRMED' | 'CANCELLED';

export type AppointmentServiceType =
  | 'CONSULTATION'
  | 'CHECKUP'
  | 'TREATMENT'
  | 'FOLLOW_UP';

export interface Appointment {
  id: number;
  customer: string;
  email?: string | undefined;
  phone?: string | undefined;
  serviceType: AppointmentServiceType;
  notes?: string | undefined;
  date: string; // ISO date format: YYYY-MM-DD
  time: string; // 24-hour format: HH:mm
  status: AppointmentStatus;
  createdAt: string;
}

export interface CreateAppointmentDTO {
  customer: string;
  email?: string | undefined;
  phone?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  notes?: string | undefined;
  date: string;
  time: string;
}

export interface UpdateAppointmentDTO {
  customer?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  notes?: string | undefined;
  date?: string | undefined;
  time?: string | undefined;
  status?: AppointmentStatus | undefined;
}

export type ServiceErrorType = 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND' | 'UNAUTHORIZED';

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  errorType?: ServiceErrorType;
}

export interface AppointmentQueryFilter {
  date?: string | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  status?: AppointmentStatus | undefined;
  customer?: string | undefined;
  email?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  page?: number | undefined;
  limit?: number | undefined;
}

export interface PaginatedAppointmentsResult {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  data: Appointment[];
}

export interface SlotInfo {
  time: string;
  available: boolean;
}

export interface AvailableSlotsResult {
  date: string;
  businessHours: {
    start: string;
    end: string;
    slotDurationMinutes: number;
  };
  totalSlots: number;
  availableCount: number;
  bookedCount: number;
  availableSlots: string[];
  slots: SlotInfo[];
}
