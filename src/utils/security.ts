import { IncomingMessage, ServerResponse } from 'node:http';

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

interface ClientRecord {
  count: number;
  resetTime: number;
}

export class MemoryRateLimiter {
  private readonly clients = new Map<string, ClientRecord>();
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(options: Partial<RateLimiterOptions> = {}) {
    this.windowMs = options.windowMs ?? 60 * 1000; // default: 1 minute
    this.maxRequests = options.maxRequests ?? 100; // default: 100 requests per minute

    // Periodic cleanup every 2 minutes to prevent unbounded memory growth
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [ip, record] of this.clients.entries()) {
        if (now > record.resetTime) {
          this.clients.delete(ip);
        }
      }
    }, 2 * 60 * 1000);

    // Unref so this timer won't prevent process exit
    if (this.cleanupInterval && typeof this.cleanupInterval.unref === 'function') {
      this.cleanupInterval.unref();
    }
  }

  public check(ip: string): { allowed: boolean; remaining: number; resetTime: number; retryAfterSeconds: number } {
    const now = Date.now();
    let record = this.clients.get(ip);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + this.windowMs
      };
      this.clients.set(ip, record);
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetTime: record.resetTime,
        retryAfterSeconds: 0
      };
    }

    record.count++;

    if (record.count > this.maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        resetTime: record.resetTime,
        retryAfterSeconds
      };
    }

    return {
      allowed: true,
      remaining: this.maxRequests - record.count,
      resetTime: record.resetTime,
      retryAfterSeconds: 0
    };
  }

  public reset(): void {
    this.clients.clear();
  }

  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
    this.clients.clear();
  }
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

export function applySecurityAndCorsHeaders(res: ServerResponse): void {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, X-Requested-With, X-Request-Id, Idempotency-Key');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Hardened Security Headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
}
