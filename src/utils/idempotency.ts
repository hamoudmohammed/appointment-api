import { createHash } from 'node:crypto';

export interface IdempotencyRecord {
  requestHash: string;
  statusCode: number;
  responseBody: unknown;
  createdAt: number;
  expiresAt: number;
}

export interface IdempotencyStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export class IdempotencyStore {
  private readonly store = new Map<string, IdempotencyRecord>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(options: IdempotencyStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000; // 24 hours default
    this.maxEntries = options.maxEntries ?? 1000;
  }

  public static computeRequestHash(payload: unknown): string {
    return createHash('sha256').update(stableStringify(payload)).digest('hex');
  }

  public get(key: string, now: number = Date.now()): IdempotencyRecord | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (now >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  public set(
    key: string,
    requestHash: string,
    statusCode: number,
    responseBody: unknown,
    now: number = Date.now()
  ): IdempotencyRecord {
    this.pruneExpired(now);

    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }

    const record: IdempotencyRecord = {
      requestHash,
      statusCode,
      responseBody,
      createdAt: now,
      expiresAt: now + this.ttlMs
    };

    this.store.set(key, record);
    return record;
  }

  public clear(): void {
    this.store.clear();
  }

  public size(now: number = Date.now()): number {
    this.pruneExpired(now);
    return this.store.size;
  }

  private pruneExpired(now: number): void {
    for (const [k, record] of this.store.entries()) {
      if (now >= record.expiresAt) {
        this.store.delete(k);
      }
    }
  }
}
