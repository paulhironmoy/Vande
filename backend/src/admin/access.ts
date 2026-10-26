/**
 * Admin authentication. Production: Cloudflare Access in front of the admin console adds `Cf-Access-Jwt-Assertion`
 * to every request that passed its login; the Worker verifies that JWT itself (RS256 against the team's published
 * keys at https://<team domain>/cdn-cgi/access/certs, issuer https://<team domain>, audience CF_ACCESS_AUD, expiry)
 * and never trusts the header without checking it. Local and development only: `Authorization: Bearer <ADMIN_TOKEN>`
 * (≥ 32 characters), refused when ENVIRONMENT is production. Without either, every admin route answers 401.
 */
import type { RequestContext } from '../http/context';
import { fail } from '../http/errors';
import { timingSafeEqual } from '../security/crypto';
import { fromBase64Url, fromUtf8, utf8 } from '../security/encoding';

const CLOCK_SKEW_S = 60;
const TEAM_RE = /^[a-z0-9-]{1,63}\.cloudflareaccess\.com$/;

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
}

const jwksCache = new Map<string, { keys: Map<string, Promise<CryptoKey | null>>; expiresAt: number; lastFetch: number }>();

async function keyFor(ctx: RequestContext, team: string, kid: string): Promise<CryptoKey | null> {
  const url = `https://${team}/cdn-cgi/access/certs`;
  let entry = jwksCache.get(url);
  const now = ctx.now;
  if (!entry || ((now >= entry.expiresAt || !entry.keys.has(kid)) && now - entry.lastFetch >= 60_000)) {
    const keys = new Map<string, Promise<CryptoKey | null>>();
    let expiresAt = now + 3_600_000;
    try {
      const res = await ctx.deps.fetch(url);
      if (res.ok) {
        const body = (await res.json()) as { keys?: Jwk[] };
        for (const k of body.keys ?? []) {
          if (!k.kid || k.kty !== 'RSA' || !k.n || !k.e) continue;
          keys.set(k.kid, crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']).catch(() => null));
        }
        const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
        if (maxAge) expiresAt = now + Math.min(Number(maxAge[1]), 86_400) * 1000;
      }
    } catch {
      /* keep what we had */
    }
    entry = keys.size > 0 || !entry ? { keys, expiresAt, lastFetch: now } : { ...entry, lastFetch: now };
    jwksCache.set(url, entry);
  }
  return (await entry.keys.get(kid)) ?? null;
}

/** The verified Access identity (email for people, common_name for service tokens), or null. */
export async function verifyAccessJwt(ctx: RequestContext, token: string): Promise<string | null> {
  const team = ctx.env.CF_ACCESS_TEAM_DOMAIN ?? '';
  const aud = ctx.env.CF_ACCESS_AUD ?? '';
  if (!TEAM_RE.test(team) || !/^[0-9a-f]{64}$/.test(aud) || token.length > 8192) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header: { alg?: string; kid?: string };
  let claims: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; nbf?: number; email?: string; common_name?: string; sub?: string };
  try {
    header = JSON.parse(fromUtf8(fromBase64Url(parts[0]) ?? new Uint8Array())) as typeof header;
    claims = JSON.parse(fromUtf8(fromBase64Url(parts[1]) ?? new Uint8Array())) as typeof claims;
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
  const sig = fromBase64Url(parts[2]);
  const key = await keyFor(ctx, team, header.kid);
  if (!sig || !key) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, utf8(`${parts[0]}.${parts[1]}`)).catch(() => false);
  if (!ok) return null;
  const nowS = ctx.now / 1000;
  if (claims.iss !== `https://${team}`) return null;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return null;
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_S > nowS) return null;
  if (typeof claims.iat === 'number' && claims.iat - CLOCK_SKEW_S > nowS) return null;
  const id = claims.email ?? claims.common_name ?? claims.sub;
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : null;
}

export async function authenticateAdmin(ctx: RequestContext): Promise<{ id: string; via: 'access' | 'token' }> {
  const jwt = ctx.request.headers.get('cf-access-jwt-assertion');
  if (jwt) {
    const id = await verifyAccessJwt(ctx, jwt);
    if (id) return { id, via: 'access' };
    fail('unauthorized', 'admin sign-in required');
  }
  const token = ctx.env.ADMIN_TOKEN ?? '';
  const bearer = /^Bearer (\S+)$/.exec(ctx.request.headers.get('authorization') ?? '')?.[1] ?? '';
  if (!ctx.cfg.production && token.length >= 32 && bearer && timingSafeEqual(bearer, token)) return { id: 'dev-token', via: 'token' };
  return fail('unauthorized', 'admin sign-in required');
}

export function __resetAccessKeysForTests(): void {
  jwksCache.clear();
}
