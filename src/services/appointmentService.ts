import { Appointment, CreateAppointmentDTO, UpdateAppointmentDTO, ServiceResult } from '../types/appointment.js';

export class AppointmentService {
  private appointments: Appointment[] = [
    {
      id: 1,
      customer: 'Max Mustermann',
      date: '2026-11-20',
      time: '10:00',
      status: 'CONFIRMED',
      createdAt: '2026-11-14T10:00:00.000Z'
    }
  ];
  private nextId = 2;

  public getAll(): Appointment[] {
    return [...this.appointments];
  }

  public getById(id: number): Appointment | undefined {
    return this.appointments.find((item) => item.id === id);
  }

  public create(dto: CreateAppointmentDTO): ServiceResult<Appointment> {
    // 1. Syntax & Format Validation
    const validationError = this.validateDTO(dto);
    if (validationError) {
      return { success: false, error: validationError, errorType: 'VALIDATION_ERROR' };
    }

    // 2. Domain Rule: Prevent double booking for the same slot
    const slotTaken = this.appointments.some(
      (item) => item.date === dto.date && item.time === dto.time && item.status === 'CONFIRMED'
    );

    if (slotTaken) {
      return {
        success: false,
        error: `Time slot on ${dto.date} at ${dto.time} is already booked. Please choose another time.`,
        errorType: 'CONFLICT'
      };
    }

    // 3. Persist new appointment
    const newAppointment: Appointment = {
      id: this.nextId++,
      customer: dto.customer.trim(),
      date: dto.date,
      time: dto.time,
      status: 'CONFIRMED',
      createdAt: new Date().toISOString()
    };

    this.appointments.push(newAppointment);
    return { success: true, data: newAppointment };
  }

  public update(id: number, dto: UpdateAppointmentDTO): ServiceResult<Appointment> {
    const appointmentIndex = this.appointments.findIndex((item) => item.id === id);
    if (appointmentIndex === -1) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    const current = this.appointments[appointmentIndex];

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
      const slotTaken = this.appointments.some(
        (item) =>
          item.id !== id &&
          item.date === targetDate &&
          item.time === targetTime &&
          item.status === 'CONFIRMED'
      );

      if (slotTaken) {
        return {
          success: false,
          error: `Time slot on ${targetDate} at ${targetTime} is already booked. Please choose another time.`,
          errorType: 'CONFLICT'
        };
      }
    }

    // Apply updates
    const updatedAppointment: Appointment = {
      ...current,
      customer: dto.customer !== undefined ? dto.customer.trim() : current.customer,
      date: targetDate,
      time: targetTime,
      status: targetStatus
    };

    this.appointments[appointmentIndex] = updatedAppointment;
    return { success: true, data: updatedAppointment };
  }

  public delete(id: number): ServiceResult<Appointment> {
    const index = this.appointments.findIndex((item) => item.id === id);
    if (index === -1) {
      return {
        success: false,
        error: `Appointment with ID ${id} not found.`,
        errorType: 'NOT_FOUND'
      };
    }

    const [deleted] = this.appointments.splice(index, 1);
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
