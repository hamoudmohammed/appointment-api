import { IncomingMessage } from 'node:http';

export interface AuthValidationResult {
  authenticated: boolean;
  error?: string;
}

/**
 * Validates administrative API Key authentication.
 * Accepts API keys via:
 * 1. `X-API-Key` header
 * 2. `Authorization: Bearer <key>` header
 * 3. `Authorization: ApiKey <key>` header
 */
export function validateApiKey(
  req: IncomingMessage,
  expectedKey: string = process.env.ADMIN_API_KEY || 'admin-secret-key-123'
): AuthValidationResult {
  const xApiKey = req.headers['x-api-key'];
  const authHeader = req.headers['authorization'];

  let providedKey: string | undefined;

  if (typeof xApiKey === 'string' && xApiKey.trim().length > 0) {
    providedKey = xApiKey.trim();
  } else if (typeof authHeader === 'string' && authHeader.trim().length > 0) {
    const trimmed = authHeader.trim();
    if (trimmed.startsWith('Bearer ') || trimmed.startsWith('ApiKey ')) {
      providedKey = trimmed.slice(7).trim();
    } else {
      providedKey = trimmed;
    }
  }

  if (!providedKey) {
    return {
      authenticated: false,
      error: 'Unauthorized: Missing API key. Please provide the X-API-Key header or Authorization: Bearer <key>.'
    };
  }

  if (providedKey !== expectedKey) {
    return {
      authenticated: false,
      error: 'Unauthorized: Invalid API key provided.'
    };
  }

  return { authenticated: true };
}
