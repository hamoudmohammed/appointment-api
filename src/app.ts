import { IncomingMessage, ServerResponse } from 'node:http';
import { AppointmentService } from './services/appointmentService.js';
import { CreateAppointmentDTO, UpdateAppointmentDTO } from './types/appointment.js';
import { openApiSpec, swaggerUiHtml } from './docs/openapi.js';

let currentService = new AppointmentService();

export function setAppointmentService(service: AppointmentService): void {
  currentService = service;
}

export function getAppointmentService(): AppointmentService {
  return currentService;
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
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);
    const { pathname } = url;
    const method = req.method?.toUpperCase();

    // Health check endpoint (vital for Docker, Kubernetes, AWS ALB)
    if (method === 'GET' && pathname === '/health') {
      sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
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
      const all = await currentService.getAll();
      sendJson(res, 200, { count: all.length, data: all });
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
