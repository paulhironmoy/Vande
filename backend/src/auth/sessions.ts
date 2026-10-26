/**
 * Sessions: short-lived HMAC access tokens and rotating refresh tokens (one family per signed-in device).
 *
 * Refresh: the presented secret's SHA-256 is compared with the family's current hash.
 *   - current → rotate (compare-and-swap on the generation), return a new pair;
 *   - previous, within REFRESH_GRACE_MS of the rotation → 409 conflict "refreshed elsewhere" (another tab or a retry
 *     without its Idempotency-Key; the client re-reads its stored token) and nothing changes;
 *   - previous, later → reuse of a rotated token: the whole family is revoked (theft signal), audit + metric;
 *   - anything else → 401 without side effects (garbage cannot revoke someone's session).
 * A retry of a refresh whose response was lost reuses its Idempotency-Key and gets the stored (encrypted) response.
 */
import type { SessionTokens } from '@/contracts';
import { ACCESS_TOKEN_TTL_S, DAY_MS, REFRESH_GRACE_MS, REFRESH_IDLE_DAYS } from '../config';
import type { D1Like, D1StatementLike } from '../env';
import { fail } from '../http/errors';
import { hourIso } from '../http/http';
import type { Logger } from '../http/log';
import { audit } from '../ops/audit';
import type { Metrics } from '../ops/metrics';
import { randomId, sha256Hex, timingSafeEqual } from '../security/crypto';
import type { Keyring } from '../security/keyring';
import { issueAccessToken, newRefreshToken, parseRefreshToken } from '../security/tokens';
import { SQL } from '../storage/sql';

interface SessionRow {
  family_id: string;
  uid: string;
  cur_hash: string;
  prev_hash: string | null;
  generation: number;
  rotated_ms: number;
  expires_ms: number;
  revoked: number;
}

async function tokensFor(ring: Keyring, uid: string, playerId: string, familyId: string, refreshToken: string, now: number): Promise<SessionTokens> {
  const iat = Math.floor(now / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_S;
  const accessToken = await issueAccessToken(ring, { sub: uid, pid: playerId, sid: familyId, iat, exp });
  return { playerId, accessToken, refreshToken, expiresAt: new Date(exp * 1000).toISOString() };
}

/** A new session family: the statement to insert it (batched with account creation) and the tokens. */
export async function newSession(db: D1Like, ring: Keyring, uid: string, playerId: string, now: number): Promise<{ statement: D1StatementLike; tokens: SessionTokens; familyId: string }> {
  const familyId = randomId('s');
  const { token, secret } = newRefreshToken(familyId);
  const statement = db.prepare(SQL.insertSession).bind(familyId, uid, await sha256Hex(secret), now, now + REFRESH_IDLE_DAYS * DAY_MS, hourIso(now));
  return { statement, tokens: await tokensFor(ring, uid, playerId, familyId, token, now), familyId };
}

export interface RefreshDeps {
  db: D1Like;
  ring: Keyring;
  log: Logger;
  metrics: Metrics;
  now: number;
  /** Resolves the public player id (and checks the account is active). */
  playerIdOf(uid: string): Promise<string | null>;
}

export async function refreshSession(d: RefreshDeps, presented: unknown): Promise<SessionTokens> {
  const parsed = parseRefreshToken(presented);
  if (!parsed) fail('unauthorized', 'invalid refresh token');
  const row = await d.db.prepare(SQL.sessionById).bind(parsed.familyId).first<SessionRow>();
  if (!row || row.revoked || row.expires_ms <= d.now) fail('unauthorized', 'session expired or revoked');
  const hash = await sha256Hex(parsed.secret);

  if (row.prev_hash && timingSafeEqual(hash, row.prev_hash) && !timingSafeEqual(hash, row.cur_hash)) {
    if (d.now - row.rotated_ms <= REFRESH_GRACE_MS) {
      fail('conflict', 'session was refreshed elsewhere; use the newest refresh token', { headers: { 'retry-after': '1' } });
    }
    await d.db.prepare(SQL.revokeSession).bind(row.family_id).run();
    d.metrics.count('refresh_reuse_revoked');
    await audit(d.db, d.log, { at: d.now, uid: row.uid, action: 'session_revoked_reuse', detail: { generation: row.generation } });
    fail('unauthorized', 'refresh token reuse detected; signed out');
  }
  if (!timingSafeEqual(hash, row.cur_hash)) fail('unauthorized', 'invalid refresh token');

  const playerId = await d.playerIdOf(row.uid);
  if (!playerId) fail('unauthorized', 'account not active');
  const { token, secret } = newRefreshToken(row.family_id);
  const res = await d.db
    .prepare(SQL.rotateSession)
    .bind(row.family_id, await sha256Hex(secret), d.now, d.now + REFRESH_IDLE_DAYS * DAY_MS, row.generation)
    .run();
  if ((res.meta?.changes ?? 0) === 0) fail('conflict', 'session was refreshed elsewhere; use the newest refresh token', { headers: { 'retry-after': '1' } });
  d.metrics.count('refresh_rotated');
  return tokensFor(d.ring, row.uid, playerId, row.family_id, token, d.now);
}

/** Sign-out on this device: revokes the caller's own family. True when it was still live. */
export async function revokeFamily(db: D1Like, uid: string, familyId: string, now: number): Promise<boolean> {
  const r = await db.prepare(SQL.revokeFamilyOfUid).bind(familyId, uid, now).run();
  return (r.meta?.changes ?? 0) > 0;
}

/** Revokes every other live family of the account (sign out other devices; recovery on a new device). */
export async function revokeOtherFamilies(db: D1Like, uid: string, keepFamilyId: string, now: number): Promise<number> {
  const r = await db.prepare(SQL.revokeOtherSessions).bind(uid, keepFamilyId, now).run();
  return r.meta?.changes ?? 0;
}

/**
 * Whether an access token's family is still live. Access tokens are verified statelessly (15 minutes); sensitive
 * routes (consent, deletion, profile edits, linking, export, revoking other devices) also ask this, so a signed-out or
 * revoked device can do none of those even with an unexpired access token.
 */
export async function sessionLive(db: D1Like, uid: string, familyId: string, now: number): Promise<boolean> {
  const row = await db.prepare(SQL.sessionState).bind(familyId).first<{ uid: string; revoked: number; expires_ms: number }>();
  return !!row && row.uid === uid && row.revoked === 0 && row.expires_ms > now;
}

/** Issues a new family for an existing account (recovery through a linked identity). */
export async function signInExisting(db: D1Like, ring: Keyring, uid: string, playerId: string, now: number): Promise<{ tokens: SessionTokens; familyId: string }> {
  const s = await newSession(db, ring, uid, playerId, now);
  await s.statement.run();
  return { tokens: s.tokens, familyId: s.familyId };
}
