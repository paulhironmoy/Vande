/**
 * Auth routes: guest sign-up (no phone, no email), refresh rotation, Google linking and recovery, passkey linking
 * and recovery (adapter; off until configured). Also the bearer-token check every signed-in route uses.
 */
import type { GuestSignupRequest, LinkGoogleRequest, RefreshRequest, SessionTokens } from '@/contracts';
import { AVATAR_SEED_RE, starterKit } from '@/net/shared/kits';
import { checkAlias, generatedAlias } from '@/net/shared/alias';
import { isLocaleId } from '@/net/shared/ids';
import type { Actor, RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import { dayIso, hourIso } from '../http/http';
import type { Reply } from '../http/router';
import { enforceDailyCap, networkKey } from '../guards/limits';
import { audit } from '../ops/audit';
import { hmac, hmacKeyFor, randomBytes, randomHex, randomId } from '../security/crypto';
import { toHex, utf8 } from '../security/encoding';
import { identityPepper, tokenKeys } from '../security/secrets';
import { verifyAccessToken } from '../security/tokens';
import { SQL } from '../storage/sql';
import { activeAccount, requireAccount } from '../profile/model';
import { createGoogleVerifier, type GoogleVerifier } from './google';
import { newSession, refreshSession, revokeFamily, revokeOtherFamilies, sessionLive, signInExisting } from './sessions';

function obj(body: unknown): Record<string, unknown> {
  if (body === undefined) return {};
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('invalid', 'body must be a JSON object');
  return body as Record<string, unknown>;
}

/**
 * For sensitive routes: the actor, and only while the access token's session family is live (not signed out, not
 * revoked by "sign out other devices", recovery or refresh-token reuse). 401 otherwise, at once.
 */
export async function requireLiveSession(ctx: RequestContext): Promise<Actor> {
  const actor = requireActor(ctx);
  if (!(await sessionLive(ctx.env.DB, actor.uid, actor.sid, ctx.now))) {
    fail('unauthorized', 'this device was signed out; sign in again', { headers: { 'www-authenticate': 'Bearer error="invalid_token"' } });
  }
  return actor;
}

/** Bearer access token → actor, or 401. */
export async function authenticate(ctx: RequestContext): Promise<Actor> {
  const header = ctx.request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(\S{20,2048})$/i.exec(header);
  if (!m) fail('unauthorized', 'sign in required', { headers: { 'www-authenticate': 'Bearer' } });
  const claims = await verifyAccessToken(tokenKeys(ctx.env, ctx.deps.logger), m[1], ctx.now);
  if (!claims) fail('unauthorized', 'access token invalid or expired', { headers: { 'www-authenticate': 'Bearer error="invalid_token"' } });
  return { uid: claims.sub, playerId: claims.pid, sid: claims.sid };
}

export async function guestSignup(ctx: RequestContext): Promise<Reply> {
  const b = obj(ctx.body) as Partial<GuestSignupRequest>;
  // VANDE Cricket is for players aged 18 and over (docs/PRIVACY_AND_CONSENT.md, age policy): no account without the
  // age screen's confirmation. Recovery of an existing account (Google, passkey) does not ask again.
  if (b.adultConfirmed !== true) {
    ctx.deps.metrics.count('guest_refused_age');
    fail('forbidden', 'VANDE Cricket is for players aged 18 and over. Confirm your age in the app to play online.');
  }
  if (!isLocaleId(b.locale)) fail('invalid', 'locale is required and must be a supported locale');
  let alias: string;
  if (b.alias === undefined || b.alias === null || b.alias === '') {
    alias = generatedAlias(randomBytes(3));
  } else {
    const check = checkAlias(b.alias);
    if (!check.ok) {
      await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: null, action: 'alias_rejected', detail: { reason: check.reason } });
      fail('invalid', `alias not allowed (${check.reason})`);
    }
    alias = check.value;
  }
  if (b.avatarSeed !== undefined && (typeof b.avatarSeed !== 'string' || !AVATAR_SEED_RE.test(b.avatarSeed))) fail('invalid', 'avatarSeed must be 8–32 lowercase letters and digits');
  const avatarSeed = b.avatarSeed ?? randomHex(8);
  const ring = tokenKeys(ctx.env, ctx.deps.logger);
  await enforceDailyCap(
    { env: ctx.env, cfg: ctx.cfg, metrics: ctx.deps.metrics, salt: ctx.salt, ip: ctx.ip, now: ctx.now },
    'day-guest',
    networkKey(ctx.cfg, ctx.ip, 'anonymous'),
    ctx.cfg.rate.guestsPerNetworkPerDay,
  );
  const uid = randomId('u');
  const playerId = randomId('p');
  const kit = starterKit(randomBytes(3));
  const session = await newSession(ctx.env.DB, ring, uid, playerId, ctx.now);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(SQL.insertAccount).bind(uid, playerId, alias, avatarSeed, JSON.stringify(kit), b.locale, dayIso(ctx.now), ctx.now),
    session.statement,
  ]);
  ctx.deps.metrics.count('guest_created');
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid, action: 'account_created' });
  return { status: 201, body: session.tokens satisfies SessionTokens };
}

export async function refresh(ctx: RequestContext): Promise<Reply> {
  const b = obj(ctx.body) as Partial<RefreshRequest>;
  const ring = tokenKeys(ctx.env, ctx.deps.logger);
  const tokens = await refreshSession(
    {
      db: ctx.env.DB,
      ring,
      log: ctx.deps.logger,
      metrics: ctx.deps.metrics,
      now: ctx.now,
      playerIdOf: async (uid) => (await activeAccount(ctx.env.DB, uid))?.player_id ?? null,
    },
    b.refreshToken,
  );
  return { status: 200, body: tokens };
}

/** POST /v1/auth/logout: signs this device out (its refresh family is revoked; idempotent). */
export async function logout(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  if (await revokeFamily(ctx.env.DB, actor.uid, actor.sid, ctx.now)) {
    ctx.deps.metrics.count('session_signed_out');
    await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'session_signed_out' });
  }
  return { status: 200, body: { ok: true } };
}

/** POST /v1/auth/revoke-others: signs out every other device of the account; answers how many sessions ended. */
export async function revokeOthers(ctx: RequestContext): Promise<Reply> {
  const actor = await requireLiveSession(ctx);
  await requireAccount(ctx.env.DB, actor.uid);
  const revoked = await revokeOtherFamilies(ctx.env.DB, actor.uid, actor.sid, ctx.now);
  ctx.deps.metrics.count('sessions_revoked', ['others'], revoked);
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'sessions_revoked', detail: { reason: 'others', count: revoked } });
  return { status: 200, body: { revoked } };
}

// ---- linked identities -------------------------------------------------------------------------------------------

let isolateVerifier: GoogleVerifier | null = null;

function googleVerifier(ctx: RequestContext): GoogleVerifier {
  if (ctx.deps.google) return ctx.deps.google;
  isolateVerifier ??= createGoogleVerifier({ fetch: (url) => ctx.deps.fetch(url) });
  return isolateVerifier;
}

function googleAudiences(ctx: RequestContext): string[] {
  const ids = (ctx.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ids.length === 0) fail('unavailable', 'Google sign-in is not configured');
  return ids;
}

async function subjectHash(ctx: RequestContext, provider: 'google' | 'passkey', subject: string): Promise<string> {
  const pepper = identityPepper(ctx.env, ctx.deps.logger);
  return toHex(await hmac(await hmacKeyFor(utf8(pepper), 'pepper', 'identity'), `${provider}:${subject}`));
}

async function link(ctx: RequestContext, provider: 'google' | 'passkey', subject: string): Promise<Reply> {
  const actor = await requireLiveSession(ctx);
  await requireAccount(ctx.env.DB, actor.uid);
  const hash = await subjectHash(ctx, provider, subject);
  const existing = await ctx.env.DB.prepare(SQL.identityBySubject).bind(provider, hash).first<{ uid: string }>();
  if (existing && existing.uid !== actor.uid) fail('conflict', `this ${provider === 'google' ? 'Google account' : 'passkey'} is already linked to another player`);
  if (!existing) {
    const mine = await ctx.env.DB.prepare(SQL.identitiesOfUid).bind(actor.uid).all<{ provider: string }>();
    if (mine.results.some((r) => r.provider === provider)) fail('conflict', `a ${provider === 'google' ? 'Google account' : 'passkey'} is already linked to this player`);
    await ctx.env.DB.prepare(SQL.insertIdentity).bind(provider, hash, actor.uid, hourIso(ctx.now)).run();
    ctx.deps.metrics.count('account_linked', [provider]);
    await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'account_linked', detail: { provider } });
  }
  return { status: 200, body: { linked: true } };
}

async function recover(ctx: RequestContext, provider: 'google' | 'passkey', subject: string): Promise<Reply> {
  const hash = await subjectHash(ctx, provider, subject);
  const found = await ctx.env.DB.prepare(SQL.identityBySubject).bind(provider, hash).first<{ uid: string }>();
  const account = found ? await activeAccount(ctx.env.DB, found.uid) : null;
  if (!account) fail('not_found', 'no player is linked to this sign-in');
  const { tokens, familyId } = await signInExisting(ctx.env.DB, tokenKeys(ctx.env, ctx.deps.logger), account.uid, account.player_id, ctx.now);
  // Recovery is for a new device: every other device is signed out (a lost or stolen phone keeps nothing).
  const revoked = await revokeOtherFamilies(ctx.env.DB, account.uid, familyId, ctx.now);
  if (revoked > 0) ctx.deps.metrics.count('sessions_revoked', ['recovery'], revoked);
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: account.uid, action: 'account_recovered', detail: { provider, revokedOthers: revoked } });
  return { status: 200, body: tokens };
}

async function googleSubject(ctx: RequestContext): Promise<string> {
  const audiences = googleAudiences(ctx);
  const b = obj(ctx.body) as Partial<LinkGoogleRequest>;
  if (typeof b.idToken !== 'string') fail('invalid', 'idToken is required');
  const verified = await googleVerifier(ctx).verify(b.idToken, audiences, ctx.now);
  if (!verified) fail('unauthorized', 'Google credential could not be verified');
  return verified.sub;
}

export async function linkGoogle(ctx: RequestContext): Promise<Reply> {
  return link(ctx, 'google', await googleSubject(ctx));
}

/** Recovery on a new device (extra route, see the report: `POST /v1/auth/google` → SessionTokens). */
export async function signInGoogle(ctx: RequestContext): Promise<Reply> {
  return recover(ctx, 'google', await googleSubject(ctx));
}

function passkeys(ctx: RequestContext) {
  if (ctx.env.PASSKEYS_ENABLED !== '1' || !ctx.deps.passkeys) fail('unavailable', 'passkeys are not configured');
  return ctx.deps.passkeys;
}

function credentialOf(ctx: RequestContext): string {
  const b = obj(ctx.body);
  if (typeof b.credential !== 'string' || b.credential.length > 16_384) fail('invalid', 'credential is required');
  return b.credential;
}

export async function linkPasskey(ctx: RequestContext): Promise<Reply> {
  const verifier = passkeys(ctx);
  const actor = requireActor(ctx);
  const verified = await verifier.verifyRegistration(actor.uid, credentialOf(ctx), ctx.now);
  if (!verified) fail('unauthorized', 'passkey could not be verified');
  return link(ctx, 'passkey', verified.credentialId);
}

export async function signInPasskey(ctx: RequestContext): Promise<Reply> {
  const verifier = passkeys(ctx);
  const verified = await verifier.verifyAssertion(credentialOf(ctx), ctx.now);
  if (!verified) fail('unauthorized', 'passkey could not be verified');
  return recover(ctx, 'passkey', verified.credentialId);
}

/** Test hook. */
export function __resetGoogleVerifierForTests(): void {
  isolateVerifier = null;
}
