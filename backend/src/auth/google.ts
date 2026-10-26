/**
 * Google ID-token verification for account linking and recovery (no SDK). Verifies an RS256 JWT against Google's
 * published JWKS (cached per isolate for the response's max-age, refetched at most once a minute for an unknown key
 * id), then checks issuer, audience (GOOGLE_CLIENT_IDS: the web and Android OAuth client ids), expiry and issue time.
 * Only the `sub` claim is used, and only as HMAC(IDENTITY_PEPPER, "google:" + sub); email and name are never read.
 * Disabled (503) until GOOGLE_CLIENT_IDS is configured.
 */
import { fromBase64Url, fromUtf8, utf8 } from '../security/encoding';

export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const CLOCK_SKEW_S = 60;

export interface GoogleVerifier {
  verify(idToken: string, audiences: readonly string[], nowMs: number): Promise<{ sub: string } | null>;
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

export interface GoogleVerifierOptions {
  fetch(url: string): Promise<Response>;
  jwksUrl?: string;
}

export function createGoogleVerifier(opts: GoogleVerifierOptions): GoogleVerifier {
  const url = opts.jwksUrl ?? GOOGLE_JWKS_URL;
  let keys = new Map<string, Promise<CryptoKey | null>>();
  let expiresAt = 0;
  let lastFetch = -Infinity;
  let inflight: Promise<void> | null = null;

  async function refresh(nowMs: number): Promise<void> {
    lastFetch = nowMs;
    const res = await opts.fetch(url);
    if (!res.ok) throw new Error(`jwks ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const next = new Map<string, Promise<CryptoKey | null>>();
    for (const k of body.keys ?? []) {
      if (!k.kid || k.kty !== 'RSA' || !k.n || !k.e) continue;
      next.set(
        k.kid,
        crypto.subtle
          .importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
          .catch(() => null),
      );
    }
    keys = next;
    const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '');
    expiresAt = nowMs + Math.min(Number(maxAge?.[1] ?? 3600), 86400) * 1000;
  }

  async function keyFor(kid: string, nowMs: number): Promise<CryptoKey | null> {
    const stale = nowMs >= expiresAt;
    if ((stale || !keys.has(kid)) && nowMs - lastFetch >= 60_000) {
      inflight ??= refresh(nowMs).finally(() => (inflight = null));
      await inflight.catch(() => undefined);
    }
    return (await keys.get(kid)) ?? null;
  }

  return {
    async verify(idToken, audiences, nowMs) {
      if (typeof idToken !== 'string' || idToken.length > 4096 || audiences.length === 0) return null;
      const parts = idToken.split('.');
      if (parts.length !== 3) return null;
      let header: { alg?: string; kid?: string };
      let claims: { iss?: string; aud?: string | string[]; exp?: number; iat?: number; sub?: string; azp?: string };
      try {
        header = JSON.parse(fromUtf8(fromBase64Url(parts[0]) ?? new Uint8Array())) as typeof header;
        claims = JSON.parse(fromUtf8(fromBase64Url(parts[1]) ?? new Uint8Array())) as typeof claims;
      } catch {
        return null;
      }
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null;
      const sig = fromBase64Url(parts[2]);
      const key = await keyFor(header.kid, nowMs);
      if (!sig || !key) return null;
      const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, utf8(`${parts[0]}.${parts[1]}`)).catch(() => false);
      if (!valid) return null;
      const nowS = nowMs / 1000;
      if (!claims.iss || !ISSUERS.includes(claims.iss)) return null;
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!aud.some((a) => typeof a === 'string' && audiences.includes(a))) return null;
      if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_S < nowS) return null;
      if (typeof claims.iat !== 'number' || claims.iat - CLOCK_SKEW_S > nowS) return null;
      if (typeof claims.sub !== 'string' || !/^[0-9A-Za-z_-]{1,255}$/.test(claims.sub)) return null;
      return { sub: claims.sub };
    },
  };
}
