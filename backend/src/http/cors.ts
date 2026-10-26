/** CORS for the app's own origins only. Bearer tokens, never cookies, so credentials are never allowed. */

export function parseList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

export const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
export const ALLOWED_HEADERS = 'authorization, content-type, idempotency-key, x-request-id, x-vande-client';
/** x-decided-at: when a sealed Top 100 day is decided (GET /v1/top100/:day answers 409 before the cutoff). */
export const EXPOSED_HEADERS = 'x-request-id, retry-after, x-decided-at';

export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = ALLOWED_METHODS;
    headers['Access-Control-Allow-Headers'] = ALLOWED_HEADERS;
    headers['Access-Control-Expose-Headers'] = EXPOSED_HEADERS;
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

/** Non-browser clients (no Origin header: the render service, curl) are allowed; browsers must use an allow-listed origin. */
export function originAllowed(origin: string | null, allowed: string[]): boolean {
  if (origin === null) return true;
  return allowed.includes(origin);
}
