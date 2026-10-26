/** Worker routes for duels, invites and matches; the match's Durable Object does the real work. */
import type { Conditions, CreateDuelResponse, LockRequest, MatchView, PitchId, ShotRequest, WeatherId } from '@/contracts';
import { INVITE_CODE_RE, MATCH_ID_RE, inviteUrl } from '@/net/shared/ids';
import { MAX_MATCH_LIST, publicWebOrigin } from '../config';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { enforceDailyCap, enforceNetworkLimit } from '../guards/limits';
import { audit } from '../ops/audit';
import { randomBytes, randomId } from '../security/crypto';
import { tokenKeys } from '../security/secrets';
import { verifyInviteToken } from '../security/tokens';
import { SQL } from '../storage/sql';
import { playerRefOf, requireAccount, requireSocial, unlocksOf } from '../profile/model';
import { callMatch } from './client';
import { callCup } from '../cup/client';
import { isConditions } from './shape';
import { validAttribution } from '../highlights/public';
import { INVITE_CODE_GONE, tokenForInviteCode } from './inviteCodes';

const PITCHES: PitchId[] = ['green', 'hard', 'slow'];
const WEATHER: WeatherId[] = ['clear', 'humid', 'dew'];

function matchIdParam(ctx: RequestContext): string {
  const id = ctx.params.id;
  if (!MATCH_ID_RE.test(id)) fail('not_found', 'match not found');
  return id;
}

function idem(ctx: RequestContext): string {
  if (!ctx.idemKey) fail('invalid', 'Idempotency-Key header required');
  return ctx.idemKey;
}

export async function createDuel(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const body = (ctx.body ?? {}) as { conditions?: unknown; attributionCode?: unknown };
  if (typeof body !== 'object' || Array.isArray(body)) fail('invalid', 'body must be a JSON object');
  let conditions: Conditions;
  if (body.conditions === undefined) {
    const r = randomBytes(2);
    conditions = { pitch: PITCHES[r[0] % PITCHES.length], weather: WEATHER[r[1] % WEATHER.length] };
  } else if (isConditions(body.conditions)) {
    conditions = { pitch: body.conditions.pitch, weather: body.conditions.weather };
  } else {
    return fail('invalid', 'conditions must be { pitch, weather }');
  }
  await enforceDailyCap(
    { env: ctx.env, cfg: ctx.cfg, metrics: ctx.deps.metrics, salt: ctx.salt, ip: ctx.ip, uid: actor.uid, now: ctx.now },
    'day-duel',
    `u:${actor.uid}`,
    ctx.cfg.rate.duelsPerPlayerPerDay,
  );
  const account = await requireAccount(ctx.env.DB, actor.uid);
  // A duel started from a highlight landing credits it (invite opens, completion); an unknown code is ignored.
  const attribution = await validAttribution(ctx, body.attributionCode);
  const matchId = randomId('m');
  const lockByMs = ctx.now + ctx.cfg.duelLockMs;
  const created = await callMatch<{ inviteToken: string }>(ctx.env, ctx.cfg, matchId, {
    op: 'create',
    matchId,
    kind: 'duel',
    conditions,
    creator: { uid: actor.uid, ref: playerRefOf(account) },
    lockByMs,
    batByMs: lockByMs + ctx.cfg.duelBatMs,
    revealAtMs: null,
    inviteExpMs: lockByMs,
    reservedFor: null,
    rematchOf: null,
    ...(attribution ? { attribution } : {}),
  });
  await audit(ctx.env.DB, ctx.deps.logger, { at: ctx.now, uid: actor.uid, action: 'duel_created', target: matchId });
  const response: CreateDuelResponse = { matchId, inviteToken: created.body.inviteToken, inviteUrl: inviteUrl(publicWebOrigin(ctx.env), created.body.inviteToken, attribution ?? undefined) };
  return { status: 201, body: response };
}

/**
 * The invite behind /i/<token>: a short code (looked up in D1) or the signed token of an older link. Every code lookup
 * spends the per-network invite budget, also on the signed-in accept route (whose own network limit is the write
 * bucket), and a code that does not exist answers exactly like an expired one, so codes cannot be enumerated.
 */
async function inviteClaims(ctx: RequestContext) {
  let token = ctx.params.token;
  const byCode = INVITE_CODE_RE.test(token);
  if (byCode) {
    if (ctx.route.limit !== 'invite') await enforceNetworkLimit({ env: ctx.env, cfg: ctx.cfg, metrics: ctx.deps.metrics, salt: ctx.salt, ip: ctx.ip, now: ctx.now }, 'invite', ctx.actor ? 'signed' : 'anonymous');
    const behind = await tokenForInviteCode(ctx.env.DB, token, ctx.now);
    if (!behind) fail('deadline_passed', INVITE_CODE_GONE);
    token = behind;
  }
  const claims = await verifyInviteToken(tokenKeys(ctx.env, ctx.deps.logger), token);
  // Forged, mistyped and unknown tokens get one indistinguishable answer.
  if (!claims) fail(byCode ? 'deadline_passed' : 'not_found', byCode ? INVITE_CODE_GONE : 'invite not found');
  if (claims.expMs < ctx.now) fail('deadline_passed', byCode ? INVITE_CODE_GONE : claims.kind === 'cup' ? 'this cup has already started' : 'this invite has expired');
  return claims;
}

export async function invitePreview(ctx: RequestContext): Promise<Reply> {
  const claims = await inviteClaims(ctx);
  if (claims.kind === 'cup') return callCup(ctx.env, ctx.cfg, claims.targetId, { op: 'preview', nonce: claims.nonce });
  return callMatch(ctx.env, ctx.cfg, claims.targetId, { op: 'preview', nonce: claims.nonce });
}

export async function acceptInvite(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const claims = await inviteClaims(ctx);
  const account = await requireAccount(ctx.env.DB, actor.uid);
  const seat = { uid: actor.uid, ref: playerRefOf(account) };
  // Joining a cup is a social feature (a duel invite is a match: it keeps working during a suspension).
  if (claims.kind === 'cup') requireSocial(account, ctx.now);
  if (claims.kind === 'cup') return callCup(ctx.env, ctx.cfg, claims.targetId, { op: 'accept', nonce: claims.nonce, actor: seat, idem: idem(ctx) });
  return callMatch(ctx.env, ctx.cfg, claims.targetId, { op: 'accept', nonce: claims.nonce, actor: seat, idem: idem(ctx) });
}

export async function listMatches(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const rows = await ctx.env.DB.prepare(SQL.matchesOfUid).bind(actor.uid, MAX_MATCH_LIST).all<{ view_json: string }>();
  const views = rows.results.map((r) => JSON.parse(r.view_json) as MatchView);
  return { status: 200, body: views };
}

export function getMatch(ctx: RequestContext): Promise<Reply> {
  return callMatch(ctx.env, ctx.cfg, matchIdParam(ctx), { op: 'view', uid: requireActor(ctx).uid });
}

export async function lockOver(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const matchId = matchIdParam(ctx);
  const body = (ctx.body ?? {}) as Partial<LockRequest>;
  if (!body || typeof body !== 'object' || body.plan === undefined) fail('invalid', 'plan is required');
  const account = await requireAccount(ctx.env.DB, actor.uid);
  return callMatch(ctx.env, ctx.cfg, matchId, { op: 'lock', uid: actor.uid, plan: body.plan, unlocked: unlocksOf(account), idem: idem(ctx) });
}

export async function batNext(ctx: RequestContext): Promise<Reply> {
  const matchId = matchIdParam(ctx);
  const actor = requireActor(ctx);
  // Batting writes come from active accounts only (an unexpired token of a deleted account bats nowhere).
  await requireAccount(ctx.env.DB, actor.uid);
  return callMatch(ctx.env, ctx.cfg, matchId, { op: 'next', uid: actor.uid, idem: idem(ctx) });
}

export async function batShot(ctx: RequestContext): Promise<Reply> {
  const body = (ctx.body ?? {}) as Partial<ShotRequest>;
  if (!body || typeof body !== 'object' || body.input === undefined || body.ballToken === undefined) fail('invalid', 'input and ballToken are required');
  const matchId = matchIdParam(ctx);
  const actor = requireActor(ctx);
  await requireAccount(ctx.env.DB, actor.uid);
  return callMatch(ctx.env, ctx.cfg, matchId, { op: 'shot', uid: actor.uid, input: body.input, ballToken: body.ballToken, idem: idem(ctx) });
}

export function revealMatch(ctx: RequestContext): Promise<Reply> {
  return callMatch(ctx.env, ctx.cfg, matchIdParam(ctx), { op: 'reveal', uid: requireActor(ctx).uid });
}

export async function rematch(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const matchId = matchIdParam(ctx);
  const account = await requireAccount(ctx.env.DB, actor.uid);
  return callMatch(ctx.env, ctx.cfg, matchId, { op: 'rematch', uid: actor.uid, ref: playerRefOf(account), idem: idem(ctx) });
}
