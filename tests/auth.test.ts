import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { validateApiKey } from '../src/utils/auth.js';

describe('API Key Authentication', () => {
  const secretKey = 'test-secret-api-key';

  test('fails when no auth header is provided', () => {
    const fakeReq = { headers: {} } as IncomingMessage;
    const result = validateApiKey(fakeReq, secretKey);
    assert.strictEqual(result.authenticated, false);
    assert.match(result.error ?? '', /Missing API key/);
  });

  test('fails when invalid API key is provided via X-API-Key', () => {
    const fakeReq = {
      headers: { 'x-api-key': 'wrong-key' }
    } as unknown as IncomingMessage;
    const result = validateApiKey(fakeReq, secretKey);
    assert.strictEqual(result.authenticated, false);
    assert.match(result.error ?? '', /Invalid API key/);
  });

  test('succeeds with matching X-API-Key header', () => {
    const fakeReq = {
      headers: { 'x-api-key': secretKey }
    } as unknown as IncomingMessage;
    const result = validateApiKey(fakeReq, secretKey);
    assert.strictEqual(result.authenticated, true);
    assert.strictEqual(result.error, undefined);
  });

  test('succeeds with Authorization: Bearer <key>', () => {
    const fakeReq = {
      headers: { authorization: `Bearer ${secretKey}` }
    } as unknown as IncomingMessage;
    const result = validateApiKey(fakeReq, secretKey);
    assert.strictEqual(result.authenticated, true);
  });

  test('succeeds with Authorization: ApiKey <key>', () => {
    const fakeReq = {
      headers: { authorization: `ApiKey ${secretKey}` }
    } as unknown as IncomingMessage;
    const result = validateApiKey(fakeReq, secretKey);
    assert.strictEqual(result.authenticated, true);
  });
});
