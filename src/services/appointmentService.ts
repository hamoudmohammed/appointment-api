import {
  Appointment,
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
  ServiceResult,
  AppointmentQueryFilter,
  PaginatedAppointmentsResult,
  AvailableSlotsResult,
  SlotInfo
} from '../types/appointment.js';
import { IAppointmentRepository } from '../repositories/appointmentRepository.js';
import { InMemoryAppointmentRepository } from '../repositories/inMemoryAppointmentRepository.js';

export class AppointmentService {
  constructor(
    private readonly repository: IAppointmentRepository = new InMemoryAppointmentRepository()
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

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return {
        success: false,
        error: 'Query parameter "date" must follow YYYY-MM-DD format.',
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

  private static readonly ALLOWED_SERVICE_TYPES = [
    'CONSULTATION',
    'CHECKUP',
    'TREATMENT',
    'FOLLOW_UP'
  ];

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

    // Validate date format YYYY-MM-DD
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dto.date || !dateRegex.test(dto.date)) {
      return 'Field "date" is required and must follow YYYY-MM-DD format.';
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

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (dto.date !== undefined && (!dto.date || !dateRegex.test(dto.date))) {
      return 'Field "date" must follow YYYY-MM-DD format.';
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dto.time !== undefined && (!dto.time || !timeRegex.test(dto.time))) {
      return 'Field "time" must follow HH:mm (24h) format.';
    }

    if (dto.status !== undefined && dto.status !== 'CONFIRMED' && dto.status !== 'CANCELLED') {
      return 'Field "status" must be either "CONFIRMED" or "CANCELLED".';
    }

    return null;
  }

  private validateFilter(filter: AppointmentQueryFilter): string | null {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (filter.date !== undefined && (!filter.date || !dateRegex.test(filter.date))) {
      return 'Query parameter "date" must follow YYYY-MM-DD format.';
    }

    if (filter.startDate !== undefined && (!filter.startDate || !dateRegex.test(filter.startDate))) {
      return 'Query parameter "startDate" must follow YYYY-MM-DD format.';
    }

    if (filter.endDate !== undefined && (!filter.endDate || !dateRegex.test(filter.endDate))) {
      return 'Query parameter "endDate" must follow YYYY-MM-DD format.';
    }

    if (filter.startDate && filter.endDate && filter.startDate > filter.endDate) {
      return '"startDate" cannot be after "endDate".';
    }

    if (filter.status !== undefined && filter.status !== 'CONFIRMED' && filter.status !== 'CANCELLED') {
      return 'Query parameter "status" must be either "CONFIRMED" or "CANCELLED".';
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
