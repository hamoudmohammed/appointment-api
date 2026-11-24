export const DEFAULT_PROVIDER = 'General';
export const ALLOWED_SLOT_DURATIONS = [15, 30, 45, 60] as const;
export type SlotDurationMinutes = (typeof ALLOWED_SLOT_DURATIONS)[number];

export const ALLOWED_SORT_FIELDS = [
  'date',
  'time',
  'customer',
  'provider',
  'status',
  'createdAt'
] as const;
export type AppointmentSortField = (typeof ALLOWED_SORT_FIELDS)[number];

export const ALLOWED_SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof ALLOWED_SORT_ORDERS)[number];

export interface BusinessHoursConfig {
  start: string; // HH:mm
  end: string; // HH:mm
  slotDurationMinutes: number;
}

export interface AppointmentServiceOptions {
  businessHours?: Partial<BusinessHoursConfig> | undefined;
  enforceBusinessHours?: boolean | undefined;
  allowPastDates?: boolean | undefined;
  now?: (() => Date) | undefined;
}

export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW';

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
  provider: string;
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
  provider?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  notes?: string | undefined;
  date: string;
  time: string;
}

export interface UpdateAppointmentDTO {
  customer?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  provider?: string | undefined;
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
  provider?: string | undefined;
  serviceType?: AppointmentServiceType | undefined;
  q?: string | undefined;
  sortBy?: AppointmentSortField | undefined;
  sortOrder?: SortOrder | undefined;
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
  provider: string;
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

export interface AppointmentStatsFilter {
  startDate?: string | undefined;
  endDate?: string | undefined;
  provider?: string | undefined;
}

export interface AppointmentStatsResult {
  range: {
    startDate: string | null;
    endDate: string | null;
  };
  totalAppointments: number;
  byStatus: Record<AppointmentStatus, number>;
  byServiceType: Record<AppointmentServiceType, number>;
  byProvider: Record<string, number>;
  cancellationRatePercent: number;
  completionRatePercent: number;
  busiestTimeSlots: Array<{ time: string; count: number }>;
  busiestDates: Array<{ date: string; count: number }>;
}

export type AppointmentHistoryAction =
  | 'CREATED'
  | 'UPDATED'
  | 'RESCHEDULED'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'NO_SHOW';

export interface AppointmentHistoryEntry {
  id: number;
  appointmentId: number;
  action: AppointmentHistoryAction;
  previousValues?: Record<string, unknown> | undefined;
  newValues?: Record<string, unknown> | undefined;
  timestamp: string;
}
