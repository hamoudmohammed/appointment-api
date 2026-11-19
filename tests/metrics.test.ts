import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsCollector } from '../src/utils/metrics.js';

describe('MetricsCollector', () => {
  let metrics: MetricsCollector;

  beforeEach(() => {
    metrics = new MetricsCollector();
  });

  test('normalizes dynamic numerical IDs to prevent high cardinality', () => {
    assert.strictEqual(metrics.normalizePath('/appointments/42'), '/appointments/:id');
    assert.strictEqual(metrics.normalizePath('/appointments/999?date=2026-11-20'), '/appointments/:id');
    assert.strictEqual(metrics.normalizePath('/appointments/slots'), '/appointments/slots');
    assert.strictEqual(metrics.normalizePath('/health/live'), '/health/live');
  });

  test('records requests and formats them in Prometheus format', () => {
    metrics.recordRequest('GET', '/appointments', 200);
    metrics.recordRequest('GET', '/appointments', 200);
    metrics.recordRequest('POST', '/appointments', 201);
    metrics.recordRequest('GET', '/appointments/5', 200);

    const output = metrics.getPrometheusMetrics();

    assert.match(output, /# HELP http_requests_total/);
    assert.match(output, /# TYPE http_requests_total counter/);
    assert.match(output, /http_requests_total\{method="GET",path="\/appointments",status="200"\} 2/);
    assert.match(output, /http_requests_total\{method="POST",path="\/appointments",status="201"\} 1/);
    assert.match(output, /http_requests_total\{method="GET",path="\/appointments\/:id",status="200"\} 1/);
    assert.match(output, /nodejs_process_uptime_seconds \d+/);
    assert.match(output, /nodejs_process_heap_bytes \d+/);
    assert.match(output, /nodejs_process_rss_bytes \d+/);
  });

  test('resets request metrics correctly', () => {
    metrics.recordRequest('GET', '/appointments', 200);
    metrics.reset();
    const output = metrics.getPrometheusMetrics();
    assert.strictEqual(output.includes('method="GET",path="/appointments"'), false);
  });
});
