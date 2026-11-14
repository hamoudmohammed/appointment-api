import { Appointment, CreateAppointmentDTO, ServiceResult } from '../types/appointment.js';

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
    const validationError = this.validateDTO(dto);
    if (validationError) {
      return { success: false, error: validationError };
    }

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
}
