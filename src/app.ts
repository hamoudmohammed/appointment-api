import { IncomingMessage, ServerResponse } from 'node:http';
import { AppointmentService } from './services/appointmentService.js';
import {
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
  AppointmentQueryFilter,
  AppointmentStatus,
  AppointmentServiceType
} from './types/appointment.js';
import { openApiSpec, swaggerUiHtml } from './docs/openapi.js';
import {
  applySecurityAndCorsHeaders,
  getClientIp,
  MemoryRateLimiter
} from './utils/security.js';
import { Logger } from './utils/logger.js';
import { DatabaseHealthStatus } from './db/pool.js';
import { validateApiKey } from './utils/auth.js';
import { globalMetrics } from './utils/metrics.js';
import { exportToCsv, exportToIcs } from './utils/exporter.js';
import { IdempotencyStore } from './utils/idempotency.js';

export type DatabaseHealthChecker = () => Promise<DatabaseHealthStatus>;

let currentService = new AppointmentService();
let currentRateLimiter = new MemoryRateLimiter();
let currentIdempotencyStore = new IdempotencyStore();
let currentAdminApiKey = process.env.ADMIN_API_KEY || '';
let currentDbHealthChecker: DatabaseHealthChecker = async () => ({
  status: 'healthy',
  storage: 'in-memory',
  latencyMs: 0
});

export function setAdminApiKey(key: string): void {
  currentAdminApiKey = key;
}

export function getAdminApiKey(): string {
  return currentAdminApiKey;
}

export function setAppointmentService(service: AppointmentService): void {
  currentService = service;
}

export function getAppointmentService(): AppointmentService {
  return currentService;
}

export function setRateLimiter(limiter: MemoryRateLimiter): void {
  currentRateLimiter = limiter;
}

export function getRateLimiter(): MemoryRateLimiter {
  return currentRateLimiter;
}

export function setIdempotencyStore(store: IdempotencyStore): void {
  currentIdempotencyStore = store;
}

export function getIdempotencyStore(): IdempotencyStore {
  return currentIdempotencyStore;
}

export function setDatabaseHealthChecker(checker: DatabaseHealthChecker): void {
  currentDbHealthChecker = checker;
}

export function getDatabaseHealthChecker(): DatabaseHealthChecker {
  return currentDbHealthChecker;
}

// Maximum allowed payload size: 1 MB
const MAX_PAYLOAD_SIZE = 1024 * 1024;

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAYLOAD_SIZE) {
        reject(new Error('Payload Too Large'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        const bodyText = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(bodyText));
      } catch (err) {
        reject(new Error('Invalid JSON format'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(html);
}

export async function requestHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const startTime = performance.now();
  const requestId = Logger.getOrCreateRequestId(req);

  // Set correlation ID header on response
  res.setHeader('X-Request-Id', requestId);

  // Apply CORS and hardened security headers to all responses
  applySecurityAndCorsHeaders(res);

  // Log completion when response finishes
  Logger.logRequest(req, res, requestId, startTime);

  // Track request metrics for Prometheus
  globalMetrics.attachToResponse(req, res);

  // Handle CORS Preflight request immediately
  if (req.method?.toUpperCase() === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    const method = req.method?.toUpperCase();

    // Health & Liveness probes (exempt from rate limiting, vital for Docker, Kubernetes, AWS ALB)
    if (method === 'GET' && (pathname === '/health' || pathname === '/health/live')) {
      const memoryUsage = process.memoryUsage();
      sendJson(res, 200, {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptimeSeconds: Math.floor(process.uptime()),
        memory: {
          rssMb: Number((memoryUsage.rss / 1024 / 1024).toFixed(2)),
          heapUsedMb: Number((memoryUsage.heapUsed / 1024 / 1024).toFixed(2))
        }
      });
      return;
    }

    // Database Readiness probe (verifies database connectivity and connection pool health)
    if (method === 'GET' && pathname === '/health/ready') {
      const dbStatus = await currentDbHealthChecker();
      const statusCode = dbStatus.status === 'healthy' ? 200 : 503;
      sendJson(res, statusCode, {
        status: dbStatus.status,
        timestamp: new Date().toISOString(),
        database: dbStatus
      });
      return;
    }

    // Prometheus Metrics endpoint (for scraping by Prometheus / Grafana)
    if (method === 'GET' && pathname === '/metrics') {
      res.writeHead(200, {
        'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(globalMetrics.getPrometheusMetrics());
      return;
    }

    // Rate Limiting check
    const clientIp = getClientIp(req);
    const rateCheck = currentRateLimiter.check(clientIp);
    res.setHeader('X-RateLimit-Limit', '100');
    res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());
    res.setHeader('X-RateLimit-Reset', new Date(rateCheck.resetTime).toISOString());

    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfterSeconds.toString());
      sendJson(res, 429, {
        error: 'Too many requests. Please try again later.',
        errorType: 'RATE_LIMIT_EXCEEDED',
        retryAfterSeconds: rateCheck.retryAfterSeconds
      });
      return;
    }

    // Interactive Swagger UI documentation
    if (method === 'GET' && (pathname === '/docs' || pathname === '/docs/')) {
      sendHtml(res, 200, swaggerUiHtml);
      return;
    }

    // POST /auth/verify (Live verification of API Key)
    if (method === 'POST' && pathname === '/auth/verify') {
      if (!currentAdminApiKey) {
        sendJson(res, 503, {
          valid: false,
          error: 'Administrative operations are disabled because ADMIN_API_KEY is not configured on this server.',
          errorType: 'SERVER_MISCONFIGURED'
        });
        return;
      }

      const auth = validateApiKey(req, currentAdminApiKey);
      if (!auth.authenticated) {
        sendJson(res, 401, {
          valid: false,
          error: auth.error,
          errorType: 'UNAUTHORIZED'
        });
        return;
      }

      sendJson(res, 200, {
        valid: true,
        message: 'API Key successfully verified and authorized.'
      });
      return;
    }

    // OpenAPI 3.0 specification JSON
    if (method === 'GET' && pathname === '/openapi.json') {
      sendJson(res, 200, openApiSpec);
      return;
    }

    // GET /appointments/export (Supports format=ics and format=csv)
    if (method === 'GET' && pathname === '/appointments/export') {
      const format = (url.searchParams.get('format') || 'ics').toLowerCase();
      if (format !== 'ics' && format !== 'csv') {
        sendJson(res, 400, {
          error: 'Query parameter "format" must be either "ics" or "csv".',
          errorType: 'VALIDATION_ERROR'
        });
        return;
      }

      const filter: AppointmentQueryFilter = {
        date: url.searchParams.get('date') ?? undefined,
        startDate: url.searchParams.get('startDate') ?? undefined,
        endDate: url.searchParams.get('endDate') ?? undefined,
        status: (url.searchParams.get('status') as AppointmentStatus) ?? undefined,
        customer: url.searchParams.get('customer') ?? undefined,
        email: url.searchParams.get('email') ?? undefined,
        serviceType: (url.searchParams.get('serviceType') as AppointmentServiceType) ?? undefined,
        limit: 100
      };

      const result = await currentService.getAll(filter);
      if (!result.success) {
        sendJson(res, 400, { error: result.error, errorType: result.errorType });
        return;
      }

      const items = result.data?.data || [];

      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="appointments.csv"',
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(exportToCsv(items));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="appointments.ics"',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(exportToIcs(items));
      return;
    }

    // GET /appointments
    if (method === 'GET' && pathname === '/appointments') {
      const pageParam = url.searchParams.get('page');
      const limitParam = url.searchParams.get('limit');
      const page = pageParam !== null ? Number(pageParam) : undefined;
      const limit = limitParam !== null ? Number(limitParam) : undefined;

      const filter: AppointmentQueryFilter = {
        date: url.searchParams.get('date') ?? undefined,
        startDate: url.searchParams.get('startDate') ?? undefined,
        endDate: url.searchParams.get('endDate') ?? undefined,
        status: (url.searchParams.get('status') as AppointmentStatus) ?? undefined,
        customer: url.searchParams.get('customer') ?? undefined,
        email: url.searchParams.get('email') ?? undefined,
        serviceType: (url.searchParams.get('serviceType') as AppointmentServiceType) ?? undefined,
        page,
        limit
      };

      const result = await currentService.getAll(filter);
      if (!result.success) {
        sendJson(res, 400, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, result.data);
      return;
    }

    // GET /appointments/slots
    if (method === 'GET' && pathname === '/appointments/slots') {
      const dateParam = url.searchParams.get('date') ?? undefined;
      const result = await currentService.getAvailableSlots(dateParam);
      if (!result.success) {
        sendJson(res, 400, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, result.data);
      return;
    }

    // GET /appointments/stats
    if (method === 'GET' && pathname === '/appointments/stats') {
      const startDate = url.searchParams.get('startDate') ?? undefined;
      const endDate = url.searchParams.get('endDate') ?? undefined;
      const result = await currentService.getStats({ startDate, endDate });
      if (!result.success) {
        sendJson(res, 400, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, result.data);
      return;
    }

    // Quick action routes (/appointments/:id/cancel, /appointments/:id/complete)
    const cancelMatch = pathname.match(/^\/appointments\/(\d+)\/cancel$/);
    if (method === 'POST' && cancelMatch) {
      const id = parseInt(cancelMatch[1], 10);
      const result = await currentService.cancelAppointment(id);
      if (!result.success) {
        const statusCode = result.errorType === 'NOT_FOUND' ? 404 : 400;
        sendJson(res, statusCode, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, { message: 'Appointment cancelled successfully', data: result.data });
      return;
    }

    const completeMatch = pathname.match(/^\/appointments\/(\d+)\/complete$/);
    if (method === 'POST' && completeMatch) {
      const id = parseInt(completeMatch[1], 10);
      const result = await currentService.completeAppointment(id);
      if (!result.success) {
        const statusCode = result.errorType === 'NOT_FOUND' ? 404 : 400;
        sendJson(res, statusCode, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, { message: 'Appointment marked as completed successfully', data: result.data });
      return;
    }

    // Single appointment export (/appointments/:id/export)
    const singleExportMatch = pathname.match(/^\/appointments\/(\d+)\/export$/);
    if (method === 'GET' && singleExportMatch) {
      const id = parseInt(singleExportMatch[1], 10);
      const item = await currentService.getById(id);
      if (!item) {
        sendJson(res, 404, { error: `Appointment with ID ${id} not found.` });
        return;
      }

      const format = (url.searchParams.get('format') || 'ics').toLowerCase();
      if (format !== 'ics' && format !== 'csv') {
        sendJson(res, 400, {
          error: 'Query parameter "format" must be either "ics" or "csv".',
          errorType: 'VALIDATION_ERROR'
        });
        return;
      }

      if (format === 'csv') {
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="appointment-${id}.csv"`,
          'X-Content-Type-Options': 'nosniff'
        });
        res.end(exportToCsv([item]));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="appointment-${id}.ics"`,
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(exportToIcs([item]));
      return;
    }

    // Single appointment routes (/appointments/:id)
    const singleMatch = pathname.match(/^\/appointments\/(\d+)$/);

    // GET /appointments/:id
    if (method === 'GET' && singleMatch) {
      const id = parseInt(singleMatch[1], 10);
      const item = await currentService.getById(id);
      if (!item) {
        sendJson(res, 404, { error: `Appointment with ID ${id} not found.` });
        return;
      }
      sendJson(res, 200, { data: item });
      return;
    }

    // PATCH /appointments/:id
    if (method === 'PATCH' && singleMatch) {
      const id = parseInt(singleMatch[1], 10);
      const body = await parseJsonBody(req);
      const result = await currentService.update(id, body as UpdateAppointmentDTO);
      if (!result.success) {
        let statusCode = 400;
        if (result.errorType === 'NOT_FOUND') statusCode = 404;
        else if (result.errorType === 'CONFLICT') statusCode = 409;
        sendJson(res, statusCode, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, { message: 'Appointment updated successfully', data: result.data });
      return;
    }

    // DELETE /appointments/:id (Protected by API Key Authentication)
    if (method === 'DELETE' && singleMatch) {
      if (!currentAdminApiKey) {
        sendJson(res, 503, {
          error: 'Administrative operations are disabled because ADMIN_API_KEY is not configured on this server.',
          errorType: 'SERVER_MISCONFIGURED'
        });
        return;
      }

      const auth = validateApiKey(req, currentAdminApiKey);
      if (!auth.authenticated) {
        sendJson(res, 401, { error: auth.error, errorType: 'UNAUTHORIZED' });
        return;
      }

      const id = parseInt(singleMatch[1], 10);
      const result = await currentService.delete(id);
      if (!result.success) {
        sendJson(res, 404, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, { message: 'Appointment deleted successfully', data: result.data });
      return;
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
          return;
        }
      }

      let requestHash: string | undefined;
      if (idempotencyKey) {
        requestHash = IdempotencyStore.computeRequestHash(body);
        const existing = currentIdempotencyStore.get(idempotencyKey);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            sendJson(res, 409, {
              error: 'Idempotency-Key was already used with a different request payload.',
              errorType: 'IDEMPOTENCY_CONFLICT'
            });
            return;
          }
          res.setHeader('Idempotency-Key', idempotencyKey);
          res.setHeader('Idempotency-Replayed', 'true');
          sendJson(res, existing.statusCode, existing.responseBody);
          return;
        }
      }

      const result = await currentService.create(body as CreateAppointmentDTO);
      if (!result.success) {
        const statusCode = result.errorType === 'CONFLICT' ? 409 : 400;
        sendJson(res, statusCode, { error: result.error, errorType: result.errorType });
        return;
      }

      const responsePayload = { message: 'Appointment created successfully', data: result.data };
      if (idempotencyKey && requestHash) {
        currentIdempotencyStore.set(idempotencyKey, requestHash, 201, responsePayload);
        res.setHeader('Idempotency-Key', idempotencyKey);
        res.setHeader('Idempotency-Replayed', 'false');
      }

      sendJson(res, 201, responsePayload);
      return;
    }

    // Fallback: 404 Route Not Found
    sendJson(res, 404, { error: `Route ${method} ${pathname} not found.` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    let statusCode = 500;
    let errorType = 'INTERNAL_SERVER_ERROR';

    if (message === 'Payload Too Large') {
      statusCode = 413;
      errorType = 'PAYLOAD_TOO_LARGE';
    } else if (message === 'Invalid JSON format') {
      statusCode = 400;
      errorType = 'VALIDATION_ERROR';
    }

    if (statusCode >= 500) {
      Logger.error('Unhandled request exception', {
        requestId,
        method: req.method?.toUpperCase(),
        path: req.url,
        statusCode,
        error: message
      });
    }
    sendJson(res, statusCode, { error: message, errorType });
  }
}
