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
  NextAvailableSlotFilter,
  NextAvailableSlotResult,
  SlotInfo,
  AppointmentStatsFilter,
  AppointmentStatsResult,
  AppointmentHistoryAction,
  AppointmentHistoryEntry,
  AppointmentServiceOptions,
  BusinessHoursConfig,
  ALLOWED_SLOT_DURATIONS,
  ALLOWED_SORT_FIELDS,
  ALLOWED_SORT_ORDERS,
  DEFAULT_PROVIDER
} from '../types/appointment.js';
import { IAppointmentRepository } from '../repositories/appointmentRepository.js';
import { InMemoryAppointmentRepository } from '../repositories/inMemoryAppointmentRepository.js';
import { domainEventBus, DomainEventBus } from './notificationService.js';

export class AppointmentService {
  private readonly businessHours: BusinessHoursConfig;
  private readonly enforceBusinessHours: boolean;
  private readonly allowPastDates: boolean;
  private readonly nowProvider: () => Date;

  constructor(
    private readonly repository: IAppointmentRepository = new InMemoryAppointmentRepository(),
    private readonly eventBus: DomainEventBus = domainEventBus,
    options: AppointmentServiceOptions = {}
  ) {
    this.businessHours = {
      start: options.businessHours?.start ?? AppointmentService.BUSINESS_HOURS.start,
      end: options.businessHours?.end ?? AppointmentService.BUSINESS_HOURS.end,
      slotDurationMinutes:
        options.businessHours?.slotDurationMinutes ?? AppointmentService.BUSINESS_HOURS.slotDurationMinutes
    };
    this.enforceBusinessHours = options.enforceBusinessHours ?? true;
    this.allowPastDates = options.allowPastDates ?? process.env.PREVENT_PAST_BOOKING !== 'true';
    this.nowProvider = options.now ?? (() => new Date());
  }

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

  public async getHistory(id: number): Promise<ServiceResult<AppointmentHistoryEntry[]>> {
    const existing = await this.repository.findById(id);
    if (!existing) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    const entries = await this.repository.findHistoryByAppointmentId(id);
    return { success: true, data: entries };
  }

  public static readonly BUSINESS_HOURS = {
    start: '08:00',
    end: '17:00',
    slotDurationMinutes: 30
  };

  public static getOptionsFromEnv(env: Record<string, string | undefined> = process.env): AppointmentServiceOptions {
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    const rawStart = env.BUSINESS_HOURS_START?.trim();
    const rawEnd = env.BUSINESS_HOURS_END?.trim();
    const rawDuration = env.SLOT_DURATION_MINUTES?.trim();

    let start = AppointmentService.BUSINESS_HOURS.start;
    let end = AppointmentService.BUSINESS_HOURS.end;

    const candidateStart = rawStart && timeRegex.test(rawStart) ? rawStart : start;
    const candidateEnd = rawEnd && timeRegex.test(rawEnd) ? rawEnd : end;

    if (AppointmentService.timeToMinutes(candidateStart) < AppointmentService.timeToMinutes(candidateEnd)) {
      start = candidateStart;
      end = candidateEnd;
    }

    let slotDurationMinutes = AppointmentService.BUSINESS_HOURS.slotDurationMinutes;
    if (rawDuration) {
      const parsedDuration = Number(rawDuration);
      if (
        Number.isInteger(parsedDuration) &&
        (ALLOWED_SLOT_DURATIONS as readonly number[]).includes(parsedDuration)
      ) {
        slotDurationMinutes = parsedDuration;
      }
    }

    return {
      businessHours: {
        start,
        end,
        slotDurationMinutes
      },
      allowPastDates: env.PREVENT_PAST_BOOKING !== 'true'
    };
  }

  private static timeToMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  private isWithinBusinessHours(timeStr: string): boolean {
    const minutes = AppointmentService.timeToMinutes(timeStr);
    const startMinutes = AppointmentService.timeToMinutes(this.businessHours.start);
    const endMinutes = AppointmentService.timeToMinutes(this.businessHours.end);
    return minutes >= startMinutes && minutes < endMinutes;
  }

  private isPastDate(dateStr: string): boolean {
    const todayIso = this.nowProvider().toISOString().split('T')[0];
    return dateStr < todayIso;
  }

  private generateDailySlots(slotDurationMinutes: number = this.businessHours.slotDurationMinutes): string[] {
    const slots: string[] = [];
    let currentMinutes = AppointmentService.timeToMinutes(this.businessHours.start);
    const endMinutes = AppointmentService.timeToMinutes(this.businessHours.end);

    while (currentMinutes < endMinutes) {
      const h = Math.floor(currentMinutes / 60).toString().padStart(2, '0');
      const m = (currentMinutes % 60).toString().padStart(2, '0');
      slots.push(`${h}:${m}`);
      currentMinutes += slotDurationMinutes;
    }
    return slots;
  }

  public async getAvailableSlots(
    date?: string,
    provider?: string,
    slotDurationMinutes?: number
  ): Promise<ServiceResult<AvailableSlotsResult>> {
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

    const effectiveDuration = slotDurationMinutes ?? this.businessHours.slotDurationMinutes;
    if (
      !Number.isInteger(effectiveDuration) ||
      !(ALLOWED_SLOT_DURATIONS as readonly number[]).includes(effectiveDuration)
    ) {
      return {
        success: false,
        error: `Query parameter "slotDuration" must be one of: ${ALLOWED_SLOT_DURATIONS.join(', ')} (minutes).`,
        errorType: 'VALIDATION_ERROR'
      };
    }

    const targetProvider = provider !== undefined ? provider.trim() : DEFAULT_PROVIDER;
    if (targetProvider.length === 0 || targetProvider.length > 100) {
      return {
        success: false,
        error: 'Query parameter "provider" must be a non-empty string of at most 100 characters.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const { items } = await this.repository.findAll({
      date,
      status: 'CONFIRMED',
      provider: targetProvider,
      limit: 100
    });

    const normalizedProvider = targetProvider.toLowerCase();
    const bookedSet = new Set(
      items
        .filter((item) => item.provider.toLowerCase() === normalizedProvider)
        .map((item) => item.time)
    );
    const allSlots = this.generateDailySlots(effectiveDuration);

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
        provider: targetProvider,
        businessHours: {
          start: this.businessHours.start,
          end: this.businessHours.end,
          slotDurationMinutes: effectiveDuration
        },
        totalSlots,
        availableCount,
        bookedCount,
        availableSlots,
        slots
      }
    };
  }

  private static addDaysIso(dateStr: string, days: number): string {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().split('T')[0];
  }

  public async getNextAvailableSlot(
    filter: NextAvailableSlotFilter = {}
  ): Promise<ServiceResult<NextAvailableSlotResult>> {
    const now = this.nowProvider();
    const todayIso = now.toISOString().split('T')[0];
    const nowTimeStr = now.toISOString().slice(11, 16);

    const fromDate = filter.fromDate ?? todayIso;
    if (!AppointmentService.isValidCalendarDate(fromDate)) {
      return {
        success: false,
        error: 'Query parameter "fromDate" must be a valid calendar date in YYYY-MM-DD format.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (filter.fromTime !== undefined && !timeRegex.test(filter.fromTime)) {
      return {
        success: false,
        error: 'Query parameter "fromTime" must follow HH:mm (24h) format.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const daysAhead = filter.daysAhead ?? 14;
    if (!Number.isInteger(daysAhead) || daysAhead < 1 || daysAhead > 30) {
      return {
        success: false,
        error: 'Query parameter "daysAhead" must be an integer between 1 and 30.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const effectiveDuration = filter.slotDuration ?? this.businessHours.slotDurationMinutes;
    if (
      !Number.isInteger(effectiveDuration) ||
      !(ALLOWED_SLOT_DURATIONS as readonly number[]).includes(effectiveDuration)
    ) {
      return {
        success: false,
        error: `Query parameter "slotDuration" must be one of: ${ALLOWED_SLOT_DURATIONS.join(', ')} (minutes).`,
        errorType: 'VALIDATION_ERROR'
      };
    }

    const targetProvider = filter.provider !== undefined ? filter.provider.trim() : DEFAULT_PROVIDER;
    if (targetProvider.length === 0 || targetProvider.length > 100) {
      return {
        success: false,
        error: 'Query parameter "provider" must be a non-empty string of at most 100 characters.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const endDate = AppointmentService.addDaysIso(fromDate, daysAhead - 1);
    const { items } = await this.repository.findAll({
      startDate: fromDate,
      endDate,
      status: 'CONFIRMED',
      provider: targetProvider,
      page: 1,
      limit: 10000
    });

    const normalizedProvider = targetProvider.toLowerCase();
    const bookedByDate = new Map<string, Set<string>>();
    for (const item of items) {
      if (item.provider.toLowerCase() !== normalizedProvider) continue;
      let set = bookedByDate.get(item.date);
      if (!set) {
        set = new Set<string>();
        bookedByDate.set(item.date, set);
      }
      set.add(item.time);
    }

    const dailySlots = this.generateDailySlots(effectiveDuration);
    const effectiveFromTime =
      filter.fromTime ?? (fromDate === todayIso ? nowTimeStr : undefined);

    for (let offset = 0; offset < daysAhead; offset++) {
      const candidateDate = AppointmentService.addDaysIso(fromDate, offset);
      const booked = bookedByDate.get(candidateDate);
      const minTime = offset === 0 ? effectiveFromTime : undefined;

      for (const slot of dailySlots) {
        if (minTime && slot < minTime) continue;
        if (!booked?.has(slot)) {
          return {
            success: true,
            data: {
              found: true,
              provider: targetProvider,
              slotDurationMinutes: effectiveDuration,
              searchedFromDate: fromDate,
              daysSearched: offset + 1,
              nextAvailable: { date: candidateDate, time: slot }
            }
          };
        }
      }
    }

    return {
      success: true,
      data: {
        found: false,
        provider: targetProvider,
        slotDurationMinutes: effectiveDuration,
        searchedFromDate: fromDate,
        daysSearched: daysAhead,
        nextAvailable: null
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
      provider: filter?.provider,
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

    const byProvider: Record<string, number> = {};
    const timeSlotCounts = new Map<string, number>();
    const dateCounts = new Map<string, number>();

    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      byServiceType[item.serviceType] = (byServiceType[item.serviceType] ?? 0) + 1;
      byProvider[item.provider] = (byProvider[item.provider] ?? 0) + 1;
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
        byProvider,
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

    // 2. Domain Rule: Prevent double booking for the same slot & provider
    const provider = dto.provider ? dto.provider.trim() : DEFAULT_PROVIDER;
    const slotTaken = await this.repository.findConfirmedBySlot(dto.date, dto.time, undefined, provider);
    if (slotTaken) {
      return {
        success: false,
        error: `Time slot on ${dto.date} at ${dto.time} for provider "${provider}" is already booked. Please choose another time or provider.`,
        errorType: 'CONFLICT'
      };
    }

    // 3. Persist new appointment (with database-level unique constraint handling)
    try {
      const newAppointment = await this.repository.create({
        customer: dto.customer.trim(),
        email: dto.email ? dto.email.trim() : undefined,
        phone: dto.phone ? dto.phone.trim() : undefined,
        provider,
        serviceType: dto.serviceType || 'CONSULTATION',
        notes: dto.notes ? dto.notes.trim() : undefined,
        date: dto.date,
        time: dto.time,
        status: 'CONFIRMED'
      });

      await this.repository.addHistory({
        appointmentId: newAppointment.id,
        action: 'CREATED',
        newValues: {
          customer: newAppointment.customer,
          provider: newAppointment.provider,
          serviceType: newAppointment.serviceType,
          date: newAppointment.date,
          time: newAppointment.time,
          status: newAppointment.status
        }
      });

      this.eventBus.dispatch('appointment:created', newAppointment);

      return { success: true, data: newAppointment };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        return {
          success: false,
          error: `Time slot on ${dto.date} at ${dto.time} for provider "${provider}" is already booked. Please choose another time or provider.`,
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
    const targetProvider = dto.provider !== undefined ? dto.provider.trim() : current.provider;

    // Check slot conflict if the status is CONFIRMED
    if (targetStatus === 'CONFIRMED') {
      const slotTaken = await this.repository.findConfirmedBySlot(
        targetDate,
        targetTime,
        id,
        targetProvider
      );
      if (slotTaken) {
        return {
          success: false,
          error: `Time slot on ${targetDate} at ${targetTime} for provider "${targetProvider}" is already booked. Please choose another time or provider.`,
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
        provider: dto.provider !== undefined ? dto.provider.trim() : undefined,
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

      // Record audit history for modified fields
      const trackedFields: Array<keyof Appointment> = [
        'customer',
        'email',
        'phone',
        'provider',
        'serviceType',
        'notes',
        'date',
        'time',
        'status'
      ];
      const previousValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const field of trackedFields) {
        if (current[field] !== updatedAppointment[field]) {
          previousValues[field] = current[field] ?? null;
          newValues[field] = updatedAppointment[field] ?? null;
        }
      }

      if (Object.keys(newValues).length > 0) {
        let action: AppointmentHistoryAction = 'UPDATED';
        if (updatedAppointment.status !== current.status) {
          if (updatedAppointment.status === 'CANCELLED') action = 'CANCELLED';
          else if (updatedAppointment.status === 'COMPLETED') action = 'COMPLETED';
          else if (updatedAppointment.status === 'NO_SHOW') action = 'NO_SHOW';
          else if (updatedAppointment.status === 'CONFIRMED') action = 'CONFIRMED';
        } else if (
          updatedAppointment.date !== current.date ||
          updatedAppointment.time !== current.time
        ) {
          action = 'RESCHEDULED';
        }

        await this.repository.addHistory({
          appointmentId: id,
          action,
          previousValues,
          newValues
        });
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
      } else if (dto.status === 'NO_SHOW') {
        this.eventBus.dispatch('appointment:no_show', updatedAppointment);
      } else if (dto.status === 'CONFIRMED' && current.status !== 'CONFIRMED') {
        this.eventBus.dispatch('appointment:confirmed', updatedAppointment);
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
      await this.repository.addHistory({
        appointmentId: id,
        action: 'CANCELLED',
        previousValues: { status: current.status },
        newValues: { status: 'CANCELLED' }
      });
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
      await this.repository.addHistory({
        appointmentId: id,
        action: 'COMPLETED',
        previousValues: { status: current.status },
        newValues: { status: 'COMPLETED' }
      });
      this.eventBus.dispatch('appointment:completed', updated);
    }
    return { success: true, data: updated! };
  }

  public async markNoShow(id: number): Promise<ServiceResult<Appointment>> {
    const current = await this.repository.findById(id);
    if (!current) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    if (current.status === 'NO_SHOW') {
      return { success: true, data: current };
    }

    if (current.status === 'CANCELLED') {
      return {
        success: false,
        error: 'Cannot mark a cancelled appointment as no-show.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    if (current.status === 'COMPLETED') {
      return {
        success: false,
        error: 'Cannot mark a completed appointment as no-show.',
        errorType: 'VALIDATION_ERROR'
      };
    }

    const updated = await this.repository.update(id, { status: 'NO_SHOW' });
    if (updated) {
      await this.repository.addHistory({
        appointmentId: id,
        action: 'NO_SHOW',
        previousValues: { status: current.status },
        newValues: { status: 'NO_SHOW' }
      });
      this.eventBus.dispatch('appointment:no_show', updated);
    }
    return { success: true, data: updated! };
  }

  public async confirmAppointment(id: number): Promise<ServiceResult<Appointment>> {
    const current = await this.repository.findById(id);
    if (!current) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    if (current.status === 'CONFIRMED') {
      return { success: true, data: current };
    }

    if (current.status !== 'PENDING') {
      return {
        success: false,
        error: `Cannot confirm an appointment with status "${current.status}". Only PENDING appointments can be confirmed.`,
        errorType: 'VALIDATION_ERROR'
      };
    }

    const slotTaken = await this.repository.findConfirmedBySlot(
      current.date,
      current.time,
      id,
      current.provider
    );
    if (slotTaken) {
      return {
        success: false,
        error: `Time slot on ${current.date} at ${current.time} for provider "${current.provider}" is already booked. Please choose another time or provider.`,
        errorType: 'CONFLICT'
      };
    }

    try {
      const updated = await this.repository.update(id, { status: 'CONFIRMED' });
      if (updated) {
        await this.repository.addHistory({
          appointmentId: id,
          action: 'CONFIRMED',
          previousValues: { status: current.status },
          newValues: { status: 'CONFIRMED' }
        });
        this.eventBus.dispatch('appointment:confirmed', updated);
      }
      return { success: true, data: updated! };
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === '23505') {
        return {
          success: false,
          error: `Time slot on ${current.date} at ${current.time} for provider "${current.provider}" is already booked. Please choose another time or provider.`,
          errorType: 'CONFLICT'
        };
      }
      throw err;
    }
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

    if (dto.provider !== undefined && dto.provider !== null) {
      if (typeof dto.provider !== 'string' || dto.provider.trim().length === 0 || dto.provider.trim().length > 100) {
        return 'Field "provider" must be a non-empty string of at most 100 characters.';
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

    if (!this.allowPastDates && this.isPastDate(dto.date)) {
      return 'Field "date" cannot be in the past.';
    }

    // Validate time format HH:mm (24-hour)
    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!dto.time || !timeRegex.test(dto.time)) {
      return 'Field "time" is required and must follow HH:mm (24h) format.';
    }

    if (this.enforceBusinessHours && !this.isWithinBusinessHours(dto.time)) {
      return `Field "time" must be within business hours (${this.businessHours.start} - ${this.businessHours.end}).`;
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
      dto.provider === undefined &&
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

    if (dto.provider !== undefined && dto.provider !== null) {
      if (typeof dto.provider !== 'string' || dto.provider.trim().length === 0 || dto.provider.trim().length > 100) {
        return 'Field "provider" must be a non-empty string of at most 100 characters.';
      }
    }

    if (dto.serviceType !== undefined && dto.serviceType !== null) {
      if (!AppointmentService.ALLOWED_SERVICE_TYPES.includes(dto.serviceType)) {
        return `Field "serviceType" must be one of: ${AppointmentService.ALLOWED_SERVICE_TYPES.join(', ')}.`;
      }
    }

    if (dto.date !== undefined) {
      if (!dto.date || !AppointmentService.isValidCalendarDate(dto.date)) {
        return 'Field "date" must be a valid calendar date in YYYY-MM-DD format.';
      }
      if (!this.allowPastDates && this.isPastDate(dto.date)) {
        return 'Field "date" cannot be in the past.';
      }
    }

    const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (dto.time !== undefined) {
      if (!dto.time || !timeRegex.test(dto.time)) {
        return 'Field "time" must follow HH:mm (24h) format.';
      }
      if (this.enforceBusinessHours && !this.isWithinBusinessHours(dto.time)) {
        return `Field "time" must be within business hours (${this.businessHours.start} - ${this.businessHours.end}).`;
      }
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

    if (filter.q !== undefined && filter.q.trim().length > 200) {
      return 'Query parameter "q" must be at most 200 characters long.';
    }

    if (
      filter.sortBy !== undefined &&
      !(ALLOWED_SORT_FIELDS as readonly string[]).includes(filter.sortBy)
    ) {
      return `Query parameter "sortBy" must be one of: ${ALLOWED_SORT_FIELDS.join(', ')}.`;
    }

    if (
      filter.sortOrder !== undefined &&
      !(ALLOWED_SORT_ORDERS as readonly string[]).includes(filter.sortOrder)
    ) {
      return `Query parameter "sortOrder" must be one of: ${ALLOWED_SORT_ORDERS.join(', ')}.`;
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
