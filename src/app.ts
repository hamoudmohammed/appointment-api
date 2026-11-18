import { IncomingMessage, ServerResponse } from 'node:http';
import { AppointmentService } from './services/appointmentService.js';
import {
  CreateAppointmentDTO,
  UpdateAppointmentDTO,
  AppointmentQueryFilter,
  AppointmentStatus
} from './types/appointment.js';
import { openApiSpec, swaggerUiHtml } from './docs/openapi.js';
import {
  applySecurityAndCorsHeaders,
  getClientIp,
  MemoryRateLimiter
} from './utils/security.js';

let currentService = new AppointmentService();
let currentRateLimiter = new MemoryRateLimiter();

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
  // Apply CORS and hardened security headers to all responses
  applySecurityAndCorsHeaders(res);

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

    // Health check endpoint (exempt from rate limiting, vital for Docker, Kubernetes, AWS ALB)
    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
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

    // OpenAPI 3.0 specification JSON
    if (method === 'GET' && pathname === '/openapi.json') {
      sendJson(res, 200, openApiSpec);
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

    // DELETE /appointments/:id
    if (method === 'DELETE' && singleMatch) {
      const id = parseInt(singleMatch[1], 10);
      const result = await currentService.delete(id);
      if (!result.success) {
        sendJson(res, 404, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 200, { message: 'Appointment deleted successfully', data: result.data });
      return;
    }

    // POST /appointments
    if (method === 'POST' && pathname === '/appointments') {
      const body = await parseJsonBody(req);
      const result = await currentService.create(body as CreateAppointmentDTO);
      if (!result.success) {
        const statusCode = result.errorType === 'CONFLICT' ? 409 : 400;
        sendJson(res, statusCode, { error: result.error, errorType: result.errorType });
        return;
      }
      sendJson(res, 201, { message: 'Appointment created successfully', data: result.data });
      return;
    }

    // Fallback: 404 Route Not Found
    sendJson(res, 404, { error: `Route ${method} ${pathname} not found.` });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    const statusCode = message === 'Payload Too Large' ? 413 : 500;
    sendJson(res, statusCode, { error: message });
  }
}
