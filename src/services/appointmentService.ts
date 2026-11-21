import {
  Appointment,
  AppointmentStatus,
  AppointmentServiceType,
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
  ServiceResult,
  AppointmentQueryFilter,
  PaginatedAppointmentsResult,
  AvailableSlotsResult,
  SlotInfo,
  AppointmentStatsFilter,
  AppointmentStatsResult
} from '../types/appointment.js';
import { IAppointmentRepository } from '../repositories/appointmentRepository.js';
import { InMemoryAppointmentRepository } from '../repositories/inMemoryAppointmentRepository.js';
import { domainEventBus, DomainEventBus } from './notificationService.js';

export class AppointmentService {
  constructor(
    private readonly repository: IAppointmentRepository = new InMemoryAppointmentRepository(),
    private readonly eventBus: DomainEventBus = domainEventBus
  ) {}

  public async getAll(filter?: AppointmentQueryFilter): Promise<ServiceResult<PaginatedAppointmentsResult>> {
    if (filter) {
      const validationError = this.validateFilter(filter);
      if (validationError) {
        return { success: false, error: validationError, errorType: 'VALIDATION_ERROR' };
      }
    }

    const page = Math.max(1, filter?.page ?? 1);
    const limit = Math.min(100, Math.max(1, filter?.limit ?? 20));

    const repoFilter: AppointmentQueryFilter = {
      ...filter,
      page,
      limit
    };

    const { items, total } = await this.repository.findAll(repoFilter);
    const totalPages = Math.ceil(total / limit) || (total === 0 ? 0 : 1);

    return {
      success: true,
      data: {
        total,
        page,
        limit,
        totalPages,
        data: items
      }
    };
  }

  public async getById(id: number): Promise<Appointment | undefined> {
    return this.repository.findById(id);
  }

  public static readonly BUSINESS_HOURS = {
    start: '08:00',
    end: '17:00',
    slotDurationMinutes: 30
  };

  private generateDailySlots(): string[] {
    const slots: string[] = [];
    const [startH, startM] = AppointmentService.BUSINESS_HOURS.start.split(':').map(Number);
    const [endH, endM] = AppointmentService.BUSINESS_HOURS.end.split(':').map(Number);

    let currentMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    while (currentMinutes < endMinutes) {
      const h = Math.floor(currentMinutes / 60).toString().padStart(2, '0');
      const m = (currentMinutes % 60).toString().padStart(2, '0');
      slots.push(`${h}:${m}`);
      currentMinutes += AppointmentService.BUSINESS_HOURS.slotDurationMinutes;
    }
    return slots;
  }

  public async getAvailableSlots(date?: string): Promise<ServiceResult<AvailableSlotsResult>> {
    if (!date) {
      return {
        success: false,
        error: 'Query parameter "date" is required (YYYY-MM-DD format).',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (!AppointmentService.isValidCalendarDate(date)) {
      return {
        success: false,
        error: 'Query parameter "date" must be a valid calendar date in YYYY-MM-DD format.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const { items } = await this.repository.findAll({
      date,
      status: 'CONFIRMED',
      limit: 100
    });

    const bookedSet = new Set(items.map((item) => item.time));
    const allSlots = this.generateDailySlots();

    const slots: SlotInfo[] = allSlots.map((time) => ({
      time,
      available: !bookedSet.has(time)
    }));

    const availableSlots = slots.filter((s) => s.available).map((s) => s.time);
    const totalSlots = slots.length;
    const availableCount = availableSlots.length;
    const bookedCount = totalSlots - availableCount;

    return {
      success: true,
      data: {
        date,
        businessHours: AppointmentService.BUSINESS_HOURS,
        totalSlots,
        availableCount,
        bookedCount,
        availableSlots,
        slots
      }
    };
  }

  public async getStats(filter?: AppointmentStatsFilter): Promise<ServiceResult<AppointmentStatsResult>> {
    if (filter?.startDate !== undefined && !AppointmentService.isValidCalendarDate(filter.startDate)) {
      return {
        success: false,
        error: 'Query parameter "startDate" must be a valid calendar date in YYYY-MM-DD format.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (filter?.endDate !== undefined && !AppointmentService.isValidCalendarDate(filter.endDate)) {
      return {
        success: false,
        error: 'Query parameter "endDate" must be a valid calendar date in YYYY-MM-DD format.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (filter?.startDate && filter?.endDate && filter.startDate > filter.endDate) {
      return {
        success: false,
        error: '"startDate" cannot be after "endDate".',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const { items } = await this.repository.findAll({
      startDate: filter?.startDate,
      endDate: filter?.endDate,
      page: 1,
      limit: 10000
    });

    const byStatus: Record<AppointmentStatus, number> = {
      PENDING: 0,
      CONFIRMED: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0
    };

    const byServiceType: Record<AppointmentServiceType, number> = {
      CONSULTATION: 0,
      CHECKUP: 0,
      TREATMENT: 0,
      FOLLOW_UP: 0
    };

    const timeSlotCounts = new Map<string, number>();
    const dateCounts = new Map<string, number>();

    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      byServiceType[item.serviceType] = (byServiceType[item.serviceType] ?? 0) + 1;
      timeSlotCounts.set(item.time, (timeSlotCounts.get(item.time) ?? 0) + 1);
      dateCounts.set(item.date, (dateCounts.get(item.date) ?? 0) + 1);
    }

    const totalAppointments = items.length;
    const cancellationRatePercent =
      totalAppointments === 0
        ? 0
        : Number(((byStatus.CANCELLED / totalAppointments) * 100).toFixed(2));
    const completionRatePercent =
      totalAppointments === 0
        ? 0
        : Number(((byStatus.COMPLETED / totalAppointments) * 100).toFixed(2));

    const busiestTimeSlots = Array.from(timeSlotCounts.entries())
      .map(([time, count]) => ({ time, count }))
      .sort((a, b) => b.count - a.count || a.time.localeCompare(b.time))
      .slice(0, 5);

    const busiestDates = Array.from(dateCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date))
      .slice(0, 5);

    return {
      success: true,
      data: {
        range: {
          startDate: filter?.startDate ?? null,
          endDate: filter?.endDate ?? null
        },
        totalAppointments,
        byStatus,
        byServiceType,
        cancellationRatePercent,
        completionRatePercent,
        busiestTimeSlots,
        busiestDates
      }
    };
  }

  public async create(dto: CreateAppointmentDTO): Promise<ServiceResult<Appointment>> {
    // 1. Syntax & Format Validation
    const validationError = this.validateDTO(dto);
    if (validationError) {
      return { success: false, error: validationError, errorType: 'VALIDATION_ERROR' };
    }

    // 2. Domain Rule: Prevent double booking for the same slot
    const slotTaken = await this.repository.findConfirmedBySlot(dto.date, dto.time);
    if (slotTaken) {
      return {
        success: false,
        error: `Time slot on ${dto.date} at ${dto.time} is already booked. Please choose another time.`,
        errorType: 'CONFLICT'
      };
    }

    // 3. Persist new appointment (with database-level unique constraint handling)
    try {
      const newAppointment = await this.repository.create({
        customer: dto.customer.trim(),
        email: dto.email ? dto.email.trim() : undefined,
        phone: dto.phone ? dto.phone.trim() : undefined,
        serviceType: dto.serviceType || 'CONSULTATION',
        notes: dto.notes ? dto.notes.trim() : undefined,
        date: dto.date,
        time: dto.time,
        status: 'CONFIRMED'
      });

      this.eventBus.dispatch('appointment:created', newAppointment);

      return { success: true, data: newAppointment };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        return {
          success: false,
          error: `Time slot on ${dto.date} at ${dto.time} is already booked. Please choose another time.`,
          errorType: 'CONFLICT'
        };
      }
      throw err;
    }
  }

  public async update(id: number, dto: UpdateAppointmentDTO): Promise<ServiceResult<Appointment>> {
    const current = await this.repository.findById(id);
    if (!current) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    // Lifecycle state machine guards
    if (current.status === 'CANCELLED') {
      return {
        success: false,
        error: 'Cannot modify a cancelled appointment. Please book a new appointment.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (current.status === 'COMPLETED') {
      return {
        success: false,
        error: 'Cannot modify an already completed appointment.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (current.status === 'NO_SHOW') {
      return {
        success: false,
        error: 'Cannot modify a no-show appointment.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    // Validation
    const validationError = this.validateUpdateDTO(dto);
    if (validationError) {
      return { success: false, error: validationError, errorType: 'VALIDATION_ERROR' };
    }

    const targetDate = dto.date ?? current.date;
    const targetTime = dto.time ?? current.time;
    const targetStatus = dto.status ?? current.status;

    // Check slot conflict if the status is CONFIRMED
    if (targetStatus === 'CONFIRMED') {
      const slotTaken = await this.repository.findConfirmedBySlot(targetDate, targetTime, id);
      if (slotTaken) {
        return {
          success: false,
          error: `Time slot on ${targetDate} at ${targetTime} is already booked. Please choose another time.`,
          errorType: 'CONFLICT'
        };
      }
    }

    // Apply updates
    try {
      const updatedAppointment = await this.repository.update(id, {
        customer: dto.customer !== undefined ? dto.customer.trim() : undefined,
        email: dto.email !== undefined ? dto.email.trim() : undefined,
        phone: dto.phone !== undefined ? dto.phone.trim() : undefined,
        serviceType: dto.serviceType,
        notes: dto.notes !== undefined ? dto.notes.trim() : undefined,
        date: dto.date,
        time: dto.time,
        status: dto.status
      });

      if (!updatedAppointment) {
        return {
          success: false,
          error: `Appointment with ID ${id} not found.`,
          errorType: 'NOT_FOUND'
        };
      }

      // Check if rescheduled
      if (
        (dto.date && dto.date !== current.date) ||
        (dto.time && dto.time !== current.time)
      ) {
        this.eventBus.dispatch('appointment:rescheduled', {
          appointment: updatedAppointment,
          oldDate: current.date,
          oldTime: current.time
        });
      } else if (dto.status === 'CANCELLED') {
        this.eventBus.dispatch('appointment:cancelled', updatedAppointment);
      } else if (dto.status === 'COMPLETED') {
        this.eventBus.dispatch('appointment:completed', updatedAppointment);
      }

      return { success: true, data: updatedAppointment };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        return {
          success: false,
          error: `Time slot on ${targetDate} at ${targetTime} is already booked. Please choose another time.`,
          errorType: 'CONFLICT'
        };
      }
      throw err;
    }
  }

  public async delete(id: number): Promise<ServiceResult<Appointment>> {
    const deleted = await this.repository.delete(id);
    if (!deleted) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    return { success: true, data: deleted };
  }

  public async cancelAppointment(id: number): Promise<ServiceResult<Appointment>> {
    const current = await this.repository.findById(id);
    if (!current) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    if (current.status === 'CANCELLED') {
      return { success: true, data: current };
    }

    if (current.status === 'COMPLETED') {
      return {
        success: false,
        error: 'Cannot cancel a completed appointment.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const updated = await this.repository.update(id, { status: 'CANCELLED' });
    if (updated) {
      this.eventBus.dispatch('appointment:cancelled', updated);
    }
    return { success: true, data: updated! };
  }

  public async completeAppointment(id: number): Promise<ServiceResult<Appointment>> {
    const current = await this.repository.findById(id);
    if (!current) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    if (current.status === 'CANCELLED') {
      return {
        success: false,
        error: 'Cannot mark a cancelled appointment as completed.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (current.status === 'COMPLETED') {
      return { success: true, data: current };
    }

    const updated = await this.repository.update(id, { status: 'COMPLETED' });
    if (updated) {
      this.eventBus.dispatch('appointment:completed', updated);
    }
    return { success: true, data: updated! };
  }

  private static readonly ALLOWED_STATUSES: AppointmentStatus[] = [
    'PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'NO_SHOW'
  ];

  private static readonly ALLOWED_SERVICE_TYPES = [
    'CONSULTATION',
    'CHECKUP',
    'TREATMENT',
    'FOLLOW_UP'
  ];

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  public static isValidCalendarDate(dateStr: string): boolean {
    if (typeof dateStr !== 'string' || !AppointmentService.DATE_REGEX.test(dateStr)) {
      return false;
    }

    const [year, month, day] = dateStr.split('-').map(Number);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return false;
    }

    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }

  private validateDTO(dto: CreateAppointmentDTO): string | null {
    if (!dto || typeof dto !== 'object') {
      return 'Request body must be a valid JSON object.';
    }

    if (!dto.customer || typeof dto.customer !== 'string' || dto.customer.trim().length === 0) {
      return 'Field "customer" is required and cannot be empty.';
    }

    if (dto.email !== undefined && dto.email !== null) {
      if (typeof dto.email !== 'string' || !AppointmentService.EMAIL_REGEX.test(dto.email.trim())) {
        return 'Field "email" must be a valid email address.';
      }
    }

    if (dto.phone !== undefined && dto.phone !== null) {
      if (typeof dto.phone !== 'string' || dto.phone.trim().length < 5) {
        return 'Field "phone" must be at least 5 characters long.';
      }
    }

    if (dto.serviceType !== undefined && dto.serviceType !== null) {
      if (!AppointmentService.ALLOWED_SERVICE_TYPES.includes(dto.serviceType)) {
        return `Field "serviceType" must be one of: ${AppointmentService.ALLOWED_SERVICE_TYPES.join(', ')}.`;
      }
    }

    // Validate calendar date in YYYY-MM-DD format
    if (!dto.date || !AppointmentService.isValidCalendarDate(dto.date)) {
      return 'Field "date" is required and must be a valid calendar date in YYYY-MM-DD format.';
    }

    // Validate time format HH:mm (24-hour)
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!dto.time || !timeRegex.test(dto.time)) {
      return 'Field "time" is required and must follow HH:mm (24h) format.';
    }

    return null;
  }

  private validateUpdateDTO(dto: UpdateAppointmentDTO): string | null {
    if (!dto || typeof dto !== 'object') {
      return 'Request body must be a valid JSON object.';
    }

    if (
      dto.customer === undefined &&
      dto.email === undefined &&
      dto.phone === undefined &&
      dto.serviceType === undefined &&
      dto.notes === undefined &&
      dto.date === undefined &&
      dto.time === undefined &&
      dto.status === undefined
    ) {
      return 'At least one field must be provided for update.';
    }

    if (dto.customer !== undefined) {
      if (typeof dto.customer !== 'string' || dto.customer.trim().length === 0) {
        return 'Field "customer" cannot be empty.';
      }
    }

    if (dto.email !== undefined && dto.email !== null) {
      if (typeof dto.email !== 'string' || !AppointmentService.EMAIL_REGEX.test(dto.email.trim())) {
        return 'Field "email" must be a valid email address.';
      }
    }

    if (dto.phone !== undefined && dto.phone !== null) {
      if (typeof dto.phone !== 'string' || dto.phone.trim().length < 5) {
        return 'Field "phone" must be at least 5 characters long.';
      }
    }

    if (dto.serviceType !== undefined && dto.serviceType !== null) {
      if (!AppointmentService.ALLOWED_SERVICE_TYPES.includes(dto.serviceType)) {
        return `Field "serviceType" must be one of: ${AppointmentService.ALLOWED_SERVICE_TYPES.join(', ')}.`;
      }
    }

    if (dto.date !== undefined && (!dto.date || !AppointmentService.isValidCalendarDate(dto.date))) {
      return 'Field "date" must be a valid calendar date in YYYY-MM-DD format.';
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dto.time !== undefined && (!dto.time || !timeRegex.test(dto.time))) {
      return 'Field "time" must follow HH:mm (24h) format.';
    }

    if (dto.status !== undefined && !AppointmentService.ALLOWED_STATUSES.includes(dto.status)) {
      return `Field "status" must be one of: ${AppointmentService.ALLOWED_STATUSES.join(', ')}.`;
    }

    return null;
  }

  private validateFilter(filter: AppointmentQueryFilter): string | null {
    if (filter.date !== undefined && (!filter.date || !AppointmentService.isValidCalendarDate(filter.date))) {
      return 'Query parameter "date" must be a valid calendar date in YYYY-MM-DD format.';
    }

    if (filter.startDate !== undefined && (!filter.startDate || !AppointmentService.isValidCalendarDate(filter.startDate))) {
      return 'Query parameter "startDate" must be a valid calendar date in YYYY-MM-DD format.';
    }

    if (filter.endDate !== undefined && (!filter.endDate || !AppointmentService.isValidCalendarDate(filter.endDate))) {
      return 'Query parameter "endDate" must be a valid calendar date in YYYY-MM-DD format.';
    }

    if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
      return '"startDate" cannot be after "endDate".';
    }

    if (filter.status !== undefined && !AppointmentService.ALLOWED_STATUSES.includes(filter.status)) {
      return `Query parameter "status" must be one of: ${AppointmentService.ALLOWED_STATUSES.join(', ')}.`;
    }

    if (filter.serviceType !== undefined) {
      if (!AppointmentService.ALLOWED_SERVICE_TYPES.includes(filter.serviceType)) {
        return `Query parameter "serviceType" must be one of: ${AppointmentService.ALLOWED_SERVICE_TYPES.join(', ')}.`;
      }
    }

    if (filter.page !== undefined && (!Number.isInteger(filter.page) || filter.page < 1)) {
      return 'Query parameter "page" must be a positive integer greater than or equal to 1.';
    }

    if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 100)) {
      return 'Query parameter "limit" must be an integer between 1 and 100.';
    }

    return null;
  }
}
