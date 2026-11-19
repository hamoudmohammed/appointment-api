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

export interface UpdateAppointmentDTO {
  customer?: string;
  date?: string;
  time?: string;
  status?: AppointmentStatus;
}

export type ServiceErrorType = 'VALIDATION_ERROR' | 'CONFLICT' | 'NOT_FOUND';

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
