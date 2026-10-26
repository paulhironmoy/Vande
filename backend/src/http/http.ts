/** HTTP helpers shared by every route. Salvaged from the previous Worker (limitKey, readBody). */

export const JSON_HEADERS: Record<string, string> = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/** ISO timestamp truncated to the hour (UTC): the only activity-time resolution the service stores or reports. */
export function hourIso(ms: number): string {
  const d = new Date(ms);
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

/** ISO timestamp rounded up to the next whole minute (deadlines are public rules at minute resolution). */
export function minuteIso(ms: number): string {
  return new Date(Math.ceil(ms / 60_000) * 60_000).toISOString();
}

/** UTC calendar day, YYYY-MM-DD. */
export function dayIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The client address exactly as Cloudflare reports it (`cf-connecting-ip`), or '' when absent. Never
 * `x-forwarded-for`: any client can set that header. Used only to derive salted rate-limit keys, never stored.
 */
export function clientAddress(request: Request): string {
  return (request.headers.get('cf-connecting-ip') ?? '').trim();
}

/** Every request without a usable address shares this key, so it is limited like one busy network, never unlimited. */
export const NO_ADDRESS_KEY = 'no-address';

const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

/** The eight 16-bit groups of an IPv6 address (zone ids and an embedded IPv4 tail allowed), or null. */
function ipv6Groups(raw: string): number[] | null {
  let s = raw.split('%')[0];
  const lastColon = s.lastIndexOf(':');
  if (lastColon < 0) return null;
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (!IPV4_RE.test(tail)) return null;
    const p = tail.split('.').map(Number);
    s = `${s.slice(0, lastColon + 1)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : fill < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The network a per-address limit applies to: an IPv4 address as itself (/32), an IPv6 address by its prefix (/64 by
 * default: one home or office network, or one mobile device, so rotating addresses inside it gains nothing), an
 * IPv4-mapped IPv6 address as its IPv4. Anonymous routes pass a shorter prefix (/56 or /48) because one rented
 * server holds thousands of /64s. Anything missing or unparsable shares NO_ADDRESS_KEY.
 */
export function limitKey(address: string, v6Prefix: 48 | 56 | 64 = 64): string {
  const ip = (address ?? '').trim().toLowerCase();
  if (!ip) return NO_ADDRESS_KEY;
  if (IPV4_RE.test(ip)) return `v4:${ip}`;
  const g = ipv6Groups(ip);
  if (!g) return NO_ADDRESS_KEY;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return `v4:${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  const kept = g.slice(0, 4);
  if (v6Prefix === 56) kept[3] &= 0xff00;
  if (v6Prefix === 48) kept[3] = 0;
  return `v6:${kept.map((x) => x.toString(16).padStart(4, '0')).join(':')}::/${v6Prefix}`;
}

/**
 * Reads a request body up to `max` bytes; null when it is larger. Streams the body and stops as soon as the limit is
 * passed, so a request without (or with a false) content-length is never buffered whole.
 */
export async function readBody(request: Request, max: number): Promise<string | null> {
  const lengthHeader = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(lengthHeader) && lengthHeader > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(all);
}
