import { IncomingMessage, ServerResponse } from 'node:http';

export class MetricsCollector {
  private requestCounts = new Map<string, number>();

  public normalizePath(path: string): string {
    const pathname = path.split('?')[0];
    // Collapse dynamic numerical IDs (e.g. /appointments/1 -> /appointments/:id) to prevent high cardinality
    return pathname.replace(/\/appointments\/\d+$/, '/appointments/:id');
  }

  public recordRequest(method: string, path: string, statusCode: number): void {
    const normalizedPath = this.normalizePath(path);
    const key = `method="${method}",path="${normalizedPath}",status="${statusCode}"`;
    this.requestCounts.set(key, (this.requestCounts.get(key) || 0) + 1);
  }

  public getPrometheusMetrics(): string {
    const memory = process.memoryUsage();
    const uptime = Math.floor(process.uptime());

    const lines: string[] = [
      '# HELP http_requests_total Total number of HTTP requests processed.',
      '# TYPE http_requests_total counter'
    ];

    for (const [labels, count] of this.requestCounts.entries()) {
      lines.push(`http_requests_total{${labels}} ${count}`);
    }

    lines.push('');
    lines.push('# HELP nodejs_process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE nodejs_process_uptime_seconds gauge');
    lines.push(`nodejs_process_uptime_seconds ${uptime}`);

    lines.push('');
    lines.push('# HELP nodejs_process_heap_bytes Process heap memory used in bytes.');
    lines.push('# TYPE nodejs_process_heap_bytes gauge');
    lines.push(`nodejs_process_heap_bytes ${memory.heapUsed}`);

    lines.push('');
    lines.push('# HELP nodejs_process_rss_bytes Process resident set size in bytes.');
    lines.push('# TYPE nodejs_process_rss_bytes gauge');
    lines.push(`nodejs_process_rss_bytes ${memory.rss}`);

    return lines.join('\n') + '\n';
  }

  public attachToResponse(req: IncomingMessage, res: ServerResponse): void {
    res.on('finish', () => {
      const method = req.method?.toUpperCase() || 'UNKNOWN';
      const path = req.url || '/';
      this.recordRequest(method, path, res.statusCode);
    });
  }

  public reset(): void {
    this.requestCounts.clear();
  }
}

export const globalMetrics = new MetricsCollector();
