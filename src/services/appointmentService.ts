import { Appointment, CreateAppointmentDTO, UpdateAppointmentDTO, ServiceResult } from '../types/appointment.js';
import { IAppointmentRepository } from '../repositories/appointmentRepository.js';
import { InMemoryAppointmentRepository } from '../repositories/inMemoryAppointmentRepository.js';

export class AppointmentService {
  constructor(
    private readonly repository: IAppointmentRepository = new InMemoryAppointmentRepository()
  ) {}

  public async getAll(): Promise<Appointment[]> {
    return this.repository.findAll();
  }

  public async getById(id: number): Promise<Appointment | undefined> {
    return this.repository.findById(id);
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

  private validateDTO(dto: CreateAppointmentDTO): string | null {
    if (!dto || typeof dto !== 'object') {
      return 'Request body must be a valid JSON object.';
    }

    if (!dto.customer || typeof dto.customer !== 'string' || dto.customer.trim().length === 0) {
      return 'Field "customer" is required and cannot be empty.';
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
      dto.date === undefined &&
      dto.time === undefined &&
      dto.status === undefined
    ) {
      return 'At least one field (customer, date, time, status) must be provided for update.';
    }

    if (dto.customer !== undefined) {
      if (typeof dto.customer !== 'string' || dto.customer.trim().length === 0) {
        return 'Field "customer" cannot be empty.';
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
}
