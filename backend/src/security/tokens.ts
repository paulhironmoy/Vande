/**
 * Bearer and capability tokens. All MACs are HMAC-SHA256 with purpose keys derived (HKDF) from the TOKEN_KEYS
 * keyring, so an access-token key can never verify a ball token or an invite.
 *
 *   access  at1.<kid>.<payload>.<mac>      15-minute bearer token: { sub, pid, sid, iat, exp }
 *   refresh rt1.<familyId>.<secret>        opaque; only SHA-256(secret) is stored (rotated on every refresh)
 *   ball    bt1.<kid>.<payload>.<mac>      single-use binding of one revealed delivery to its answer
 *   invite  <payload>.<mac>                compact binary: version, kind, match id, 128-bit nonce, expiry (≥ 256 bits)
 *   export  xt1.<kid>.<payload>.<mac>      short-lived download link for a data export
 */
import { concatBytes, fromBase32, fromBase64Url, fromUtf8, toBase32, toBase64Url, utf8, bytes, type Bytes } from './encoding';
import { hmac, hmacKeyFor, randomBytes, timingSafeEqual, type KeyPurpose } from './crypto';
import type { Keyring } from './keyring';

async function mac(ring: Keyring, kid: string, purpose: KeyPurpose, data: string | Uint8Array): Promise<Bytes | null> {
  const material = ring.all.get(kid);
  if (!material) return null;
  return hmac(await hmacKeyFor(material, kid, purpose), data);
}

/** Signs a JSON payload: `<prefix>.<kid>.<b64url(json)>.<b64url(mac)>`. */
async function signJson(ring: Keyring, prefix: string, purpose: KeyPurpose, payload: object): Promise<string> {
  const body = toBase64Url(utf8(JSON.stringify(payload)));
  const head = `${prefix}.${ring.active.kid}.${body}`;
  const m = (await mac(ring, ring.active.kid, purpose, head)) as Bytes;
  return `${head}.${toBase64Url(m)}`;
}

/** Verifies and decodes a JSON token; null when malformed, signed by an unknown key or tampered with. */
async function verifyJson<T>(ring: Keyring, prefix: string, purpose: KeyPurpose, token: string, maxLength = 2048): Promise<T | null> {
  if (typeof token !== 'string' || token.length > maxLength) return null;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== prefix) return null;
  const expected = await mac(ring, parts[1], purpose, `${parts[0]}.${parts[1]}.${parts[2]}`);
  const given = fromBase64Url(parts[3]);
  if (!expected || !given || !timingSafeEqual(expected, given)) return null;
  const raw = fromBase64Url(parts[2]);
  if (!raw) return null;
  try {
    return JSON.parse(fromUtf8(raw)) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------------------------------------------

export interface AccessClaims {
  /** Internal account id (never shown to other players). */
  sub: string;
  /** Public player id. */
  pid: string;
  /** Session family id (revoked together on refresh-token reuse). */
  sid: string;
  /** Seconds since the epoch. */
  iat: number;
  exp: number;
}

export function issueAccessToken(ring: Keyring, claims: AccessClaims): Promise<string> {
  return signJson(ring, 'at1', 'access', claims);
}

export async function verifyAccessToken(ring: Keyring, token: string, nowMs: number): Promise<AccessClaims | null> {
  const c = await verifyJson<AccessClaims>(ring, 'at1', 'access', token);
  if (!c || typeof c.sub !== 'string' || typeof c.pid !== 'string' || typeof c.sid !== 'string') return null;
  if (typeof c.exp !== 'number' || c.exp * 1000 <= nowMs) return null;
  if (typeof c.iat !== 'number' || c.iat * 1000 > nowMs + 60_000) return null;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Refresh tokens
// ---------------------------------------------------------------------------------------------------------------

export function newRefreshToken(familyId: string): { token: string; secret: string } {
  const secret = toBase64Url(randomBytes(32));
  return { token: `rt1.${familyId}.${secret}`, secret };
}

export function parseRefreshToken(token: unknown): { familyId: string; secret: string } | null {
  if (typeof token !== 'string' || token.length > 128) return null;
  const m = /^rt1\.(s[a-z2-7]{26})\.([A-Za-z0-9_-]{43})$/.exec(token);
  return m ? { familyId: m[1], secret: m[2] } : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Ball tokens
// ---------------------------------------------------------------------------------------------------------------

export interface BallClaims {
  /** Match id. */
  m: string;
  /** Batting player's seat. */
  p: 0 | 1;
  /** Ball index (0–5, or 6 for the Super Ball). */
  b: number;
  /** 128-bit token id; the match keeps it as the outstanding ball until answered. */
  t: string;
  /** Server time (ms) the delivery was revealed: the ball's clock. */
  r: number;
}

export function issueBallToken(ring: Keyring, claims: BallClaims): Promise<string> {
  return signJson(ring, 'bt1', 'ball', claims);
}

export async function verifyBallToken(ring: Keyring, token: unknown): Promise<BallClaims | null> {
  if (typeof token !== 'string') return null;
  const c = await verifyJson<BallClaims>(ring, 'bt1', 'ball', token, 512);
  if (!c || typeof c.m !== 'string' || (c.p !== 0 && c.p !== 1) || !Number.isInteger(c.b) || typeof c.t !== 'string' || typeof c.r !== 'number') return null;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Invite tokens (compact so WhatsApp links stay short): 38-byte payload + 16-byte MAC → 74 characters.
// ---------------------------------------------------------------------------------------------------------------

export type InviteKind = 'duel' | 'cup';
const KIND_BYTE: Record<InviteKind, number> = { duel: 1, cup: 2 };
const INVITE_VERSION = 1;

export interface InviteClaims {
  kind: InviteKind;
  /** Match id (`m…`) or cup id (`c…`): a one-letter prefix and 16 bytes of base32. */
  targetId: string;
  /** 128-bit nonce, hex; the target stores it and must match it. */
  nonce: string;
  /** Expiry, ms since the epoch (second resolution). */
  expMs: number;
}

export async function issueInviteToken(ring: Keyring, claims: InviteClaims): Promise<string> {
  const id = fromBase32(claims.targetId.slice(1), 16);
  const nonce = fromHexStrict(claims.nonce, 16);
  if (!id || !nonce) throw new Error('bad invite claims');
  const exp = bytes(4);
  new DataView(exp.buffer).setUint32(0, Math.floor(claims.expMs / 1000));
  const payload = concatBytes(Uint8Array.of(INVITE_VERSION, KIND_BYTE[claims.kind]), id, nonce, exp);
  const m = (await mac(ring, ring.active.kid, 'invite', payload)) as Bytes;
  return `${toBase64Url(payload)}.${toBase64Url(m.slice(0, 16))}`;
}

/**
 * Verifies an invite token against every key in the ring. Null for anything malformed or tampered with, so callers
 * answer one indistinguishable not-found for forged, unknown and mistyped tokens. Expiry is checked by the caller
 * (an expired invite gets its own answer).
 */
export async function verifyInviteToken(ring: Keyring, token: unknown): Promise<InviteClaims | null> {
  if (typeof token !== 'string' || token.length > 100) return null;
  const m = /^([A-Za-z0-9_-]{51})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!m) return null;
  const payload = fromBase64Url(m[1]);
  const given = fromBase64Url(m[2]);
  if (!payload || payload.length !== 38 || !given || given.length !== 16) return null;
  let valid = false;
  for (const kid of ring.all.keys()) {
    const expected = await mac(ring, kid, 'invite', payload);
    if (expected && timingSafeEqual(expected.slice(0, 16), given)) valid = true;
  }
  if (!valid || payload[0] !== INVITE_VERSION) return null;
  const kind = payload[1] === 1 ? 'duel' : payload[1] === 2 ? 'cup' : null;
  if (!kind) return null;
  const prefix = kind === 'duel' ? 'm' : 'c';
  const expSec = new DataView(payload.buffer, payload.byteOffset + 34, 4).getUint32(0);
  return { kind, targetId: `${prefix}${toBase32(payload.slice(2, 18))}`, nonce: hexOf(payload.slice(18, 34)), expMs: expSec * 1000 };
}

// ---------------------------------------------------------------------------------------------------------------
// Export download tokens
// ---------------------------------------------------------------------------------------------------------------

export interface ExportClaims {
  x: string;
  exp: number;
}

export function issueExportToken(ring: Keyring, claims: ExportClaims): Promise<string> {
  return signJson(ring, 'xt1', 'export', claims);
}

export async function verifyExportToken(ring: Keyring, token: unknown, nowMs: number): Promise<ExportClaims | null> {
  if (typeof token !== 'string') return null;
  const c = await verifyJson<ExportClaims>(ring, 'xt1', 'export', token, 512);
  if (!c || typeof c.x !== 'string' || typeof c.exp !== 'number' || c.exp <= nowMs) return null;
  return c;
}

// ---------------------------------------------------------------------------------------------------------------

function hexOf(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

function fromHexStrict(hex: string, n: number): Bytes | null {
  if (!new RegExp(`^[0-9a-f]{${n * 2}}$`).test(hex)) return null;
  const out = bytes(n);
  for (let i = 0; i < n; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
