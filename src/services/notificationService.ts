import { EventEmitter } from 'node:events';
import { Appointment } from '../types/appointment.js';
import { Logger } from '../utils/logger.js';

export type DomainEventType =
  | 'appointment:created'
  | 'appointment:confirmed'
  | 'appointment:cancelled'
  | 'appointment:rescheduled'
  | 'appointment:completed'
  | 'appointment:no_show';

export interface DomainEvent<T = unknown> {
  type: DomainEventType;
  timestamp: string;
  data: T;
}

export interface SentNotification {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  eventType: DomainEventType;
  timestamp: string;
}

export class DomainEventBus extends EventEmitter {
  public dispatch<T>(type: DomainEventType, data: T): void {
    const event: DomainEvent<T> = {
      type,
      timestamp: new Date().toISOString(),
      data
    };
    this.emit(type, event);
    this.emit('*', event);
  }
}

export const domainEventBus = new DomainEventBus();

export class NotificationService {
  private sentNotifications: SentNotification[] = [];

  constructor(private readonly eventBus: DomainEventBus = domainEventBus) {
    this.registerListeners();
  }

  private registerListeners(): void {
    this.eventBus.on('appointment:created', (evt: DomainEvent<Appointment>) => {
      this.handleAppointmentCreated(evt.data);
    });

    this.eventBus.on('appointment:cancelled', (evt: DomainEvent<Appointment>) => {
      this.handleAppointmentCancelled(evt.data);
    });

    this.eventBus.on('appointment:rescheduled', (evt: DomainEvent<{ appointment: Appointment; oldDate: string; oldTime: string }>) => {
      this.handleAppointmentRescheduled(evt.data.appointment, evt.data.oldDate, evt.data.oldTime);
    });

    this.eventBus.on('appointment:completed', (evt: DomainEvent<Appointment>) => {
      this.handleAppointmentCompleted(evt.data);
    });

    this.eventBus.on('appointment:confirmed', (evt: DomainEvent<Appointment>) => {
      this.handleAppointmentConfirmed(evt.data);
    });

    this.eventBus.on('appointment:no_show', (evt: DomainEvent<Appointment>) => {
      this.handleAppointmentNoShow(evt.data);
    });
  }

  private handleAppointmentCreated(appointment: Appointment): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Booking Confirmation: ${appointment.serviceType} on ${appointment.date}`;
    const body = `Dear ${appointment.customer},\n\nYour appointment (${appointment.serviceType}) has been confirmed for ${appointment.date} at ${appointment.time}.\nBooking ID: #${appointment.id}\n${appointment.notes ? `Notes: ${appointment.notes}\n` : ''}\nThank you for choosing our service.`;

    this.recordNotification('appointment:created', recipient, subject, body);
  }

  private handleAppointmentCancelled(appointment: Appointment): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Cancellation Notice: Appointment #${appointment.id}`;
    const body = `Dear ${appointment.customer},\n\nYour appointment on ${appointment.date} at ${appointment.time} has been cancelled.\nIf you wish to reschedule, please visit our booking portal.`;

    this.recordNotification('appointment:cancelled', recipient, subject, body);
  }

  private handleAppointmentRescheduled(appointment: Appointment, oldDate: string, oldTime: string): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Appointment Rescheduled: #${appointment.id}`;
    const body = `Dear ${appointment.customer},\n\nYour appointment previously scheduled for ${oldDate} at ${oldTime} has been successfully moved to ${appointment.date} at ${appointment.time}.`;

    this.recordNotification('appointment:rescheduled', recipient, subject, body);
  }

  private handleAppointmentCompleted(appointment: Appointment): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Thank You for Your Visit: Appointment #${appointment.id}`;
    const body = `Dear ${appointment.customer},\n\nThank you for attending your ${appointment.serviceType} appointment today. We look forward to seeing you again.`;

    this.recordNotification('appointment:completed', recipient, subject, body);
  }

  private handleAppointmentConfirmed(appointment: Appointment): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Appointment Confirmed: #${appointment.id}`;
    const body = `Dear ${appointment.customer},\n\nYour ${appointment.serviceType} appointment with ${appointment.provider} on ${appointment.date} at ${appointment.time} has been confirmed.`;

    this.recordNotification('appointment:confirmed', recipient, subject, body);
  }

  private handleAppointmentNoShow(appointment: Appointment): void {
    const recipient = appointment.email || appointment.customer;
    const subject = `Missed Appointment Notice: Appointment #${appointment.id}`;
    const body = `Dear ${appointment.customer},\n\nYou were marked as a no-show for your appointment on ${appointment.date} at ${appointment.time}. Please contact us if you would like to reschedule.`;

    this.recordNotification('appointment:no_show', recipient, subject, body);
  }

  private recordNotification(eventType: DomainEventType, recipient: string, subject: string, body: string): void {
    const record: SentNotification = {
      id: `ntf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      recipient,
      subject,
      body,
      eventType,
      timestamp: new Date().toISOString()
    };

    this.sentNotifications.push(record);
    Logger.info(`[NotificationService] Sent ${eventType} notification to ${recipient}`, {
      extra: { subject, recipient }
    });
  }

  public getSentNotifications(): SentNotification[] {
    return [...this.sentNotifications];
  }

  public clearHistory(): void {
    this.sentNotifications = [];
  }
}

export const globalNotificationService = new NotificationService();
