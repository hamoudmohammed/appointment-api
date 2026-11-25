import { IncomingMessage, ServerResponse } from 'node:http';
import { AppointmentService } from './services/appointmentService.js';
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
import { IdempotencyStore } from './utils/idempotency.js';
import { sendHtml, sendJson } from './http/helpers.js';
import { handleAppointmentRoutes } from './routes/appointmentRoutes.js';

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

    // Appointment domain routes
    const handled = await handleAppointmentRoutes(req, res, url, method, {
      service: currentService,
      idempotencyStore: currentIdempotencyStore,
      adminApiKey: currentAdminApiKey
    });
    if (handled) {
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
