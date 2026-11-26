import { IncomingMessage, ServerResponse } from 'node:http';
import { AppointmentService } from '../services/appointmentService.js';
import { CreateAppointmentDTO, UpdateAppointmentDTO } from '../types/appointment.js';
import { validateApiKey } from '../utils/auth.js';
import { exportToCsv, exportToIcs } from '../utils/exporter.js';
import { IdempotencyStore } from '../utils/idempotency.js';
import {
  mapServiceErrorStatus,
  parseAppointmentQueryFilter,
  parseJsonBody,
  sendAttachment,
  sendJson
} from '../http/helpers.js';

export interface AppointmentRouteContext {
  service: AppointmentService;
  idempotencyStore: IdempotencyStore;
  adminApiKey: string;
}

export async function handleAppointmentRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  method: string | undefined,
  ctx: AppointmentRouteContext
): Promise<boolean> {
  const { pathname } = url;
  const { service, idempotencyStore, adminApiKey } = ctx;

  // GET /appointments/export (Supports format=ics and format=csv)
  if (method === 'GET' && pathname === '/appointments/export') {
    const format = (url.searchParams.get('format') || 'ics').toLowerCase();
    if (format !== 'ics' && format !== 'csv') {
      sendJson(res, 400, {
        error: 'Query parameter "format" must be either "ics" or "csv".',
        errorType: 'VALIDATION_ERROR'
      });
      return true;
    }

    const filter = parseAppointmentQueryFilter(url.searchParams, { fixedLimit: 100 });
    const result = await service.getAll(filter);
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }

    const items = result.data?.data || [];
    if (format === 'csv') {
      sendAttachment(res, 'text/csv; charset=utf-8', 'appointments.csv', exportToCsv(items));
      return true;
    }

    sendAttachment(res, 'text/calendar; charset=utf-8', 'appointments.ics', exportToIcs(items));
    return true;
  }

  // GET /appointments
  if (method === 'GET' && pathname === '/appointments') {
    const filter = parseAppointmentQueryFilter(url.searchParams, { includePagination: true });
    const result = await service.getAll(filter);
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, result.data);
    return true;
  }

  // GET /appointments/slots
  if (method === 'GET' && pathname === '/appointments/slots') {
    const dateParam = url.searchParams.get('date') ?? undefined;
    const providerParam = url.searchParams.get('provider') ?? undefined;
    const slotDurationParam = url.searchParams.get('slotDuration');
    const slotDuration = slotDurationParam !== null ? Number(slotDurationParam) : undefined;

    const result = await service.getAvailableSlots(dateParam, providerParam, slotDuration);
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, result.data);
    return true;
  }

  // GET /appointments/next-available
  if (method === 'GET' && pathname === '/appointments/next-available') {
    const fromDate = url.searchParams.get('fromDate') ?? undefined;
    const fromTime = url.searchParams.get('fromTime') ?? undefined;
    const provider = url.searchParams.get('provider') ?? undefined;
    const slotDurationParam = url.searchParams.get('slotDuration');
    const daysAheadParam = url.searchParams.get('daysAhead');

    const result = await service.getNextAvailableSlot({
      fromDate,
      fromTime,
      provider,
      slotDuration: slotDurationParam !== null ? Number(slotDurationParam) : undefined,
      daysAhead: daysAheadParam !== null ? Number(daysAheadParam) : undefined
    });
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, result.data);
    return true;
  }

  // GET /appointments/upcoming
  if (method === 'GET' && pathname === '/appointments/upcoming') {
    const daysParam = url.searchParams.get('days');
    const hoursParam = url.searchParams.get('hours');
    const limitParam = url.searchParams.get('limit');
    const provider = url.searchParams.get('provider') ?? undefined;

    const result = await service.getUpcoming({
      days: daysParam !== null ? Number(daysParam) : undefined,
      hours: hoursParam !== null ? Number(hoursParam) : undefined,
      limit: limitParam !== null ? Number(limitParam) : undefined,
      provider
    });
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, result.data);
    return true;
  }

  // GET /appointments/stats
  if (method === 'GET' && pathname === '/appointments/stats') {
    const startDate = url.searchParams.get('startDate') ?? undefined;
    const endDate = url.searchParams.get('endDate') ?? undefined;
    const provider = url.searchParams.get('provider') ?? undefined;

    const result = await service.getStats({ startDate, endDate, provider });
    if (!result.success) {
      sendJson(res, 400, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, result.data);
    return true;
  }

  // Quick action routes (/appointments/:id/cancel, /complete, /no-show, /confirm)
  const cancelMatch = pathname.match(/^\/appointments\/(\d+)\/cancel$/);
  if (method === 'POST' && cancelMatch) {
    const id = parseInt(cancelMatch[1], 10);
    const result = await service.cancelAppointment(id);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment cancelled successfully', data: result.data });
    return true;
  }

  const completeMatch = pathname.match(/^\/appointments\/(\d+)\/complete$/);
  if (method === 'POST' && completeMatch) {
    const id = parseInt(completeMatch[1], 10);
    const result = await service.completeAppointment(id);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment marked as completed successfully', data: result.data });
    return true;
  }

  const noShowMatch = pathname.match(/^\/appointments\/(\d+)\/no-show$/);
  if (method === 'POST' && noShowMatch) {
    const id = parseInt(noShowMatch[1], 10);
    const result = await service.markNoShow(id);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment marked as no-show successfully', data: result.data });
    return true;
  }

  const confirmMatch = pathname.match(/^\/appointments\/(\d+)\/confirm$/);
  if (method === 'POST' && confirmMatch) {
    const id = parseInt(confirmMatch[1], 10);
    const result = await service.confirmAppointment(id);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment confirmed successfully', data: result.data });
    return true;
  }

  // Appointment audit history (/appointments/:id/history)
  const historyMatch = pathname.match(/^\/appointments\/(\d+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const id = parseInt(historyMatch[1], 10);
    const result = await service.getHistory(id);
    if (!result.success) {
      sendJson(res, 404, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, {
      appointmentId: id,
      total: result.data!.length,
      data: result.data
    });
    return true;
  }

  // Single appointment export (/appointments/:id/export)
  const singleExportMatch = pathname.match(/^\/appointments\/(\d+)\/export$/);
  if (method === 'GET' && singleExportMatch) {
    const id = parseInt(singleExportMatch[1], 10);
    const item = await service.getById(id);
    if (!item) {
      sendJson(res, 404, { error: `Appointment with ID ${id} not found.` });
      return true;
    }

    const format = (url.searchParams.get('format') || 'ics').toLowerCase();
    if (format !== 'ics' && format !== 'csv') {
      sendJson(res, 400, {
        error: 'Query parameter "format" must be either "ics" or "csv".',
        errorType: 'VALIDATION_ERROR'
      });
      return true;
    }

    if (format === 'csv') {
      sendAttachment(res, 'text/csv; charset=utf-8', `appointment-${id}.csv`, exportToCsv([item]));
      return true;
    }

    sendAttachment(
      res,
      'text/calendar; charset=utf-8',
      `appointment-${id}.ics`,
      exportToIcs([item])
    );
    return true;
  }

  // Single appointment routes (/appointments/:id)
  const singleMatch = pathname.match(/^\/appointments\/(\d+)$/);

  if (method === 'GET' && singleMatch) {
    const id = parseInt(singleMatch[1], 10);
    const item = await service.getById(id);
    if (!item) {
      sendJson(res, 404, { error: `Appointment with ID ${id} not found.` });
      return true;
    }
    sendJson(res, 200, { data: item });
    return true;
  }

  if (method === 'PATCH' && singleMatch) {
    const id = parseInt(singleMatch[1], 10);
    const body = await parseJsonBody(req);
    const result = await service.update(id, body as UpdateAppointmentDTO);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment updated successfully', data: result.data });
    return true;
  }

  if (method === 'DELETE' && singleMatch) {
    if (!adminApiKey) {
      sendJson(res, 503, {
        error: 'Administrative operations are disabled because ADMIN_API_KEY is not configured on this server.',
        errorType: 'SERVER_MISCONFIGURED'
      });
      return true;
    }

    const auth = validateApiKey(req, adminApiKey);
    if (!auth.authenticated) {
      sendJson(res, 401, { error: auth.error, errorType: 'UNAUTHORIZED' });
      return true;
    }

    const id = parseInt(singleMatch[1], 10);
    const result = await service.delete(id);
    if (!result.success) {
      sendJson(res, 404, { error: result.error, errorType: result.errorType });
      return true;
    }
    sendJson(res, 200, { message: 'Appointment deleted successfully', data: result.data });
    return true;
  }

  // POST /appointments (supports optional Idempotency-Key header for safe retries)
  if (method === 'POST' && pathname === '/appointments') {
    const body = await parseJsonBody(req);
    const rawIdempotencyKey = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof rawIdempotencyKey === 'string' ? rawIdempotencyKey.trim() : undefined;

    if (rawIdempotencyKey !== undefined) {
      if (!idempotencyKey || idempotencyKey.length > 128) {
        sendJson(res, 400, {
          error: 'Header "Idempotency-Key" must be a non-empty string of at most 128 characters.',
          errorType: 'VALIDATION_ERROR'
        });
        return true;
      }
    }

    let requestHash: string | undefined;
    if (idempotencyKey) {
      requestHash = IdempotencyStore.computeRequestHash(body);
      const existing = idempotencyStore.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          sendJson(res, 409, {
            error: 'Idempotency-Key was already used with a different request payload.',
            errorType: 'IDEMPOTENCY_CONFLICT'
          });
          return true;
        }
        res.setHeader('Idempotency-Key', idempotencyKey);
        res.setHeader('Idempotency-Replayed', 'true');
        sendJson(res, existing.statusCode, existing.responseBody);
        return true;
      }
    }

    const result = await service.create(body as CreateAppointmentDTO);
    if (!result.success) {
      sendJson(res, mapServiceErrorStatus(result.errorType), {
        error: result.error,
        errorType: result.errorType
      });
      return true;
    }

    const responsePayload = { message: 'Appointment created successfully', data: result.data };
    if (idempotencyKey && requestHash) {
      idempotencyStore.set(idempotencyKey, requestHash, 201, responsePayload);
      res.setHeader('Idempotency-Key', idempotencyKey);
      res.setHeader('Idempotency-Replayed', 'false');
    }

    sendJson(res, 201, responsePayload);
    return true;
  }

  return false;
}
