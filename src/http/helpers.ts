import { IncomingMessage, ServerResponse } from 'node:http';
import {
  AppointmentQueryFilter,
  AppointmentServiceType,
  AppointmentSortField,
  AppointmentStatus,
  ServiceErrorType,
  SortOrder
} from '../types/appointment.js';

// Maximum allowed payload size: 1 MB
export const MAX_PAYLOAD_SIZE = 1024 * 1024;

export async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
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
      } catch {
        reject(new Error('Invalid JSON format'));
      }
    });

    req.on('error', (err) => reject(err));
  });
}

export function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

export function sendHtml(res: ServerResponse, statusCode: number, html: string): void {
  res.writeHead(statusCode, {
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(html);
}

export function sendAttachment(
  res: ServerResponse,
  contentType: string,
  filename: string,
  body: string
): void {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

export function mapServiceErrorStatus(errorType?: ServiceErrorType): number {
  if (errorType === 'NOT_FOUND') return 404;
  if (errorType === 'CONFLICT') return 409;
  if (errorType === 'UNAUTHORIZED') return 401;
  return 400;
}

export function parseAppointmentQueryFilter(
  searchParams: URLSearchParams,
  options: { includePagination?: boolean; fixedLimit?: number } = {}
): AppointmentQueryFilter {
  const filter: AppointmentQueryFilter = {
    date: searchParams.get('date') ?? undefined,
    startDate: searchParams.get('startDate') ?? undefined,
    endDate: searchParams.get('endDate') ?? undefined,
    status: (searchParams.get('status') as AppointmentStatus) ?? undefined,
    customer: searchParams.get('customer') ?? undefined,
    email: searchParams.get('email') ?? undefined,
    provider: searchParams.get('provider') ?? undefined,
    serviceType: (searchParams.get('serviceType') as AppointmentServiceType) ?? undefined,
    q: searchParams.get('q') ?? undefined,
    sortBy: (searchParams.get('sortBy') as AppointmentSortField) ?? undefined,
    sortOrder: (searchParams.get('sortOrder')?.toLowerCase() as SortOrder) ?? undefined
  };

  if (options.fixedLimit !== undefined) {
    filter.limit = options.fixedLimit;
  } else if (options.includePagination) {
    const pageParam = searchParams.get('page');
    const limitParam = searchParams.get('limit');
    filter.page = pageParam !== null ? Number(pageParam) : undefined;
    filter.limit = limitParam !== null ? Number(limitParam) : undefined;
  }

  return filter;
}
