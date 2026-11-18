import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { getClientIp } from './security.js';

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string | undefined;
  method?: string | undefined;
  path?: string | undefined;
  statusCode?: number | undefined;
  durationMs?: number | undefined;
  ip?: string | undefined;
  error?: string | undefined;
  extra?: Record<string, unknown> | undefined;
}

export class Logger {
  private static isTest = process.env.NODE_ENV === 'test';

  public static getOrCreateRequestId(req: IncomingMessage): string {
    const existing = req.headers['x-request-id'];
    if (typeof existing === 'string' && existing.trim().length > 0) {
      return existing.trim();
    }
    return randomUUID();
  }

  public static info(message: string, context: Partial<LogEntry> = {}): void {
    Logger.log('INFO', message, context);
  }

  public static warn(message: string, context: Partial<LogEntry> = {}): void {
    Logger.log('WARN', message, context);
  }

  public static error(message: string, context: Partial<LogEntry> = {}): void {
    Logger.log('ERROR', message, context);
  }

  public static debug(message: string, context: Partial<LogEntry> = {}): void {
    Logger.log('DEBUG', message, context);
  }

  private static log(level: LogLevel, message: string, context: Partial<LogEntry>): void {
    // Suppress standard logs during automated test runs unless explicitly debugged
    if (Logger.isTest && !process.env.DEBUG_TESTS) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      requestId: context.requestId,
      method: context.method,
      path: context.path,
      statusCode: context.statusCode,
      durationMs: context.durationMs !== undefined ? Number(context.durationMs.toFixed(2)) : undefined,
      ip: context.ip,
      error: context.error,
      extra: context.extra
    };

    const serialized = JSON.stringify(entry);

    if (level === 'ERROR') {
      console.error(serialized);
    } else if (level === 'WARN') {
      console.warn(serialized);
    } else {
      console.log(serialized);
    }
  }

  public static logRequest(req: IncomingMessage, res: ServerResponse, requestId: string, startTime: number): void {
    res.on('finish', () => {
      const durationMs = performance.now() - startTime;
      const statusCode = res.statusCode;
      const clientIp = getClientIp(req);
      const url = req.url ?? '/';

      const level: LogLevel = statusCode >= 500 ? 'ERROR' : statusCode >= 400 ? 'WARN' : 'INFO';

      Logger.log(level, `HTTP ${req.method} ${url} ${statusCode}`, {
        requestId,
        method: req.method?.toUpperCase(),
        path: url,
        statusCode,
        durationMs,
        ip: clientIp
      });
    });
  }
}
