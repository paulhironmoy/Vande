/** Small HTTP helpers shared by the routes. */

export const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };

export function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/** ISO timestamp truncated to the hour (UTC): the only time resolution the service stores or reports. */
export function receivedHour(now: Date): string {
  const d = new Date(now);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** The client address as Cloudflare reports it; used only to derive salted, per-minute rate-limit keys. */
export function clientAddress(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
}

/** Reads a request body up to `max` bytes; null when it is larger. */
export async function readBody(request: Request, max: number): Promise<string | null> {
  const lengthHeader = Number(request.headers.get('content-length') ?? '0');
  if (lengthHeader > max) return null;
  const text = await request.text();
  return text.length > max ? null : text;
}
