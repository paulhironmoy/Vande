/**
 * Verified dares (Lite) — deployment-ready, switched off until DARE_SIGNING_KEY is set and the app is built with
 * VITE_LITE_VERIFIED_DARES. Protocol and canonical signed string: src/community/liteDareProtocol.ts.
 *
 *   POST /v1/lite/attempts                    start: replay the dare and the friend's answer, draw the twist
 *   POST /v1/lite/attempts/:attemptId/grade   grade the twist once, sign the reply fields, count today's goal
 *   GET  /v1/lite/goal/:day                   today's real share of answers that found the best move
 *
 * The game rules are not copied: the Worker bundles the app's own engine, replay, scoring, card kinds and twist pool
 * through the `@/` alias (backend/tsconfig.json paths, resolved by wrangler's bundler), so a dare is replayed and
 * graded exactly as the app plays it.
 *
 * Replay verification (marker 'v') is opt-in with LITE_VERIFY_REPLAY=1: replaying a late question costs up to about
 * 20 ms of CPU, over the Workers free plan's 10 ms per request, so it needs Workers Paid. The free-plan default skips
 * the replay, records the app's claim (checking what needs no replay: indexes, fair-play correctness, kind shape) and
 * signs with marker 't' (twist graded by the server, dare part as claimed).
 *
 * Fails closed: without RATE_SALT (and ALLOW_UNLIMITED_WRITES), without a usable DARE_SIGNING_KEY, or with
 * KILL_LITE_DARES=1, start and grade answer 503 and the app falls back to local twists and unsigned replies.
 */
import { actionKindOf } from '@/components/game/cards/actionKind';
import { LITE_POINTS, bestOf, evaluateAll, rankOf } from '@/lite/points';
import { LITE_SCENARIO_ID, applyToken, replayDare } from '@/lite/replay';
import { getScenario } from '@/engine';
import { dareIdentity, pickTwist, secureRandom, twistById } from '@/lite/twists';
import type { TwistKind, TwistOutcome } from '@/lite/contracts';
import { isDarePath } from '@/share/dare';
import {
  ANSWER_PATH_RE,
  ATTEMPT_ID_RE,
  DEVICE_KEY_RE,
  MARKER_SCOPE,
  NONCE_RE,
  TWIST_KINDS,
  TWIST_OPTION_RE,
  bytesToHex,
  liteDareCanonical,
  type LiteAnswerClaim,
  type LiteDareRef,
  type LiteGoalResponse,
  type LiteGradeResponse,
  type LiteStartResponse,
  type VerifiedMarker,
} from '@/community/liteDareProtocol';
import {
  DEFAULT_MIN_COHORT,
  DEFAULT_RATE_LIMIT_DARES_PER_MINUTE,
  DEFAULT_RATE_LIMIT_READS_PER_MINUTE,
  LITE_ATTEMPT_RETENTION_DAYS,
  LITE_GOAL_CACHE_SECONDS,
  LITE_GOAL_RETENTION_DAYS,
  MAX_BODY_BYTES,
} from './contract';
import type { D1Like } from './d1';
import { JSON_HEADERS, json, readBody, receivedHour } from './http';
import { checkRateLimit } from './ratelimit';
import { signHex, signingKey } from './signing';
import { SQL } from './sql';
import { isRealUtcDate } from './validate';

export interface LiteEnv {
  DB: D1Like;
  MIN_COHORT?: string;
  RATE_SALT?: string;
  ALLOW_UNLIMITED_WRITES?: string;
  RATE_LIMIT_READS_PER_MINUTE?: string;
  /** Secret (wrangler secret put DARE_SIGNING_KEY): the P-256 private key as a JWK. Missing = 503. */
  DARE_SIGNING_KEY?: string;
  /** Start and grade requests per address per minute. */
  RATE_LIMIT_DARES_PER_MINUTE?: string;
  /** '1' switches start and grade off (503) without removing the secret. */
  KILL_LITE_DARES?: string;
  /** '1' replays every dare and answer before signing (marker 'v'). Needs Workers Paid CPU limits; default off ('t'). */
  LITE_VERIFY_REPLAY?: string;
}

export interface LiteContext {
  now: Date;
  url: URL;
  cors: Record<string, string>;
  ip: string;
  cache?: { match(request: Request): Promise<Response | undefined>; put(request: Request, response: Response): Promise<void> };
  waitUntil?: (p: Promise<unknown>) => void;
}

const MAX_SEED = 0xffffffff;
const MIN_DEADLINE = 1_000_000_000;
const MAX_DEADLINE = 0xffffffff;
const STEP_RE = /^[dr](?:0|[1-9]\d?)$/;

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

export interface StartInput {
  dare: LiteDareRef;
  deviceKey: string;
  nonce: string;
  answerPath: string;
  claim: LiteAnswerClaim;
}

export interface GradeInput {
  deviceKey: string;
  twistAnswer: string | null;
}

type Checked<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function unknownKeys(o: Record<string, unknown>, known: string[], prefix = ''): string[] {
  return Object.keys(o)
    .filter((k) => !known.includes(k))
    .map((k) => `unexpected field ${prefix}${k}`);
}

export function validateStart(raw: unknown): Checked<StartInput> {
  if (!isObj(raw)) return { ok: false, errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  if (raw.v !== 1) errors.push('v must be 1');
  const d = raw.dare;
  if (!isObj(d)) errors.push('dare must be an object');
  else {
    if (!isInt(d.seed, 0, MAX_SEED)) errors.push('dare.seed invalid');
    if (typeof d.path !== 'string' || !isDarePath(d.path)) errors.push('dare.path invalid');
    if (typeof d.step !== 'string' || !STEP_RE.test(d.step)) errors.push('dare.step invalid');
    if (!isInt(d.deadline, MIN_DEADLINE, MAX_DEADLINE)) errors.push('dare.deadline invalid');
    errors.push(...unknownKeys(d, ['seed', 'path', 'step', 'deadline'], 'dare.'));
  }
  if (typeof raw.deviceKey !== 'string' || !DEVICE_KEY_RE.test(raw.deviceKey)) errors.push('deviceKey must be 64 lowercase hex');
  if (typeof raw.nonce !== 'string' || !NONCE_RE.test(raw.nonce)) errors.push('nonce must be 6 base36 characters');
  if (typeof raw.answerPath !== 'string' || !ANSWER_PATH_RE.test(raw.answerPath)) errors.push('answerPath invalid');
  else if (isObj(d) && typeof d.step === 'string') {
    const last = raw.answerPath.split('.').pop() ?? '';
    if (last.slice(0, last.indexOf('-')) !== d.step) errors.push('answerPath must answer the dared step');
  }
  const c = raw.claim;
  if (!isObj(c)) errors.push('claim must be an object');
  else {
    if (!isInt(c.points, 0, 9999)) errors.push('claim.points invalid');
    if (typeof c.best !== 'boolean') errors.push('claim.best invalid');
    if (typeof c.kind !== 'string' || !(TWIST_KINDS as readonly string[]).includes(c.kind)) errors.push('claim.kind invalid');
    else if (isObj(d) && typeof d.step === 'string' && (d.step.startsWith('r') !== (c.kind === 'rule'))) errors.push('claim.kind does not fit the dared step');
    errors.push(...unknownKeys(c, ['points', 'best', 'kind'], 'claim.'));
  }
  errors.push(...unknownKeys(raw, ['v', 'dare', 'deviceKey', 'nonce', 'answerPath', 'claim']));
  if (errors.length) return { ok: false, errors };
  const dare = d as Record<string, unknown>;
  return {
    ok: true,
    value: {
      dare: { seed: dare.seed as number, path: dare.path as string, step: dare.step as string, deadline: dare.deadline as number },
      deviceKey: raw.deviceKey as string,
      nonce: raw.nonce as string,
      answerPath: raw.answerPath as string,
      claim: { points: (c as Record<string, unknown>).points as number, best: (c as Record<string, unknown>).best as boolean, kind: (c as Record<string, unknown>).kind as TwistKind },
    },
  };
}

export function validateGrade(raw: unknown): Checked<GradeInput> {
  if (!isObj(raw)) return { ok: false, errors: ['body must be a JSON object'] };
  const errors: string[] = [];
  if (raw.v !== 1) errors.push('v must be 1');
  if (typeof raw.deviceKey !== 'string' || !DEVICE_KEY_RE.test(raw.deviceKey)) errors.push('deviceKey must be 64 lowercase hex');
  if (!(raw.twistAnswer === null || (typeof raw.twistAnswer === 'string' && TWIST_OPTION_RE.test(raw.twistAnswer)))) errors.push('twistAnswer must be a..d or null');
  errors.push(...unknownKeys(raw, ['v', 'deviceKey', 'twistAnswer']));
  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { deviceKey: raw.deviceKey as string, twistAnswer: raw.twistAnswer as string | null } };
}

// ---------------------------------------------------------------------------------------------------------------
// Game checks (the app's own engine, replay and scoring)
// ---------------------------------------------------------------------------------------------------------------

export interface VerifiedAnswer {
  points: number;
  best: boolean;
  kind: TwistKind;
}

/**
 * Replays the dare exactly like the Lite screen's takeDare, applies the friend's clue scans, and scores their answer
 * the way the reveal does (rank 1, ties included, is the best move). Throws when anything does not replay.
 */
export function evaluateLiteAnswer(dare: LiteDareRef, answerPath: string): VerifiedAnswer {
  const { state: atStep, scenario } = replayDare(dare);
  const tokens = answerPath.split('.');
  const answer = tokens.pop() ?? '';
  let state = atStep;
  for (const tok of tokens) {
    if (!/^e\d+$/.test(tok)) throw new Error('only clue scans may precede the answer');
    state = applyToken(state, scenario, tok);
  }
  const m = /^([dr])(\d+)-(\d+)$/.exec(answer);
  if (!m || `${m[1]}${m[2]}` !== dare.step) throw new Error('the answer is not for the dared step');
  const optionIndex = Number(m[3]);
  if (m[1] === 'd') {
    const d = scenario.decisions[Number(m[2])];
    const o = d?.options[optionIndex];
    if (!d || !o) throw new Error('bad move');
    const evals = evaluateAll(state, scenario, d);
    return { points: evals[optionIndex].pts, best: rankOf(evals, o.id).rank === 1, kind: actionKindOf(bestOf(evals).option.tags) };
  }
  const rm = scenario.rightsMoments[Number(m[2])];
  const o = rm?.options[optionIndex];
  if (!rm || !o) throw new Error('bad answer');
  return { points: o.correct ? LITE_POINTS.fairPlayCorrect : 0, best: o.correct, kind: 'rule' };
}

/**
 * Without replay (marker 't'): accept the app's claim after the checks that need no replay. The answer must name a
 * real option of the dared question; fair-play answers are scored from the content (they do not depend on the game
 * state), so only move points, the move's best flag and the move kind come from the claim.
 */
export function claimedLiteAnswer(dare: LiteDareRef, answerPath: string, claim: LiteAnswerClaim): VerifiedAnswer {
  const scenario = getScenario(LITE_SCENARIO_ID);
  const answer = answerPath.split('.').pop() ?? '';
  const m = /^([dr])(\d+)-(\d+)$/.exec(answer);
  if (!m || `${m[1]}${m[2]}` !== dare.step) throw new Error('the answer is not for the dared step');
  for (const tok of answerPath.split('.').slice(0, -1)) if (!scenario.evidence[Number(tok.slice(1))]) throw new Error('bad clue');
  const optionIndex = Number(m[3]);
  if (m[1] === 'd') {
    const d = scenario.decisions[Number(m[2])];
    if (!d?.options[optionIndex]) throw new Error('bad move');
    if (claim.kind === 'rule') throw new Error('a move kind is needed');
    return { points: claim.points, best: claim.best, kind: claim.kind };
  }
  const o = scenario.rightsMoments[Number(m[2])]?.options[optionIndex];
  if (!o) throw new Error('bad answer');
  return { points: o.correct ? LITE_POINTS.fairPlayCorrect : 0, best: o.correct, kind: 'rule' };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return bytesToHex(new Uint8Array(digest));
}

function newAttemptId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// ---------------------------------------------------------------------------------------------------------------
// Storage rows
// ---------------------------------------------------------------------------------------------------------------

export interface AttemptRow {
  attempt_id: string;
  dare_key: string;
  device_key: string;
  seed: number;
  path: string;
  step: string;
  deadline: number;
  nonce: string;
  answer_path: string;
  points: number;
  best: number;
  kind: string;
  twist_id: string;
  marker: string;
  twist_answer: string | null;
  outcome: string | null;
  sig: string | null;
  created_at: number;
  graded_at: number | null;
}

const OUTCOME: Record<string, TwistOutcome> = { r: 'right', w: 'wrong', s: 'skipped' };

function scopeOf(marker: string | null | undefined): LiteStartResponse['verified'] {
  return MARKER_SCOPE[marker === 'v' ? 'v' : 't'];
}

function startResponse(row: AttemptRow, created: boolean): LiteStartResponse {
  return {
    attemptId: row.attempt_id,
    twistId: row.twist_id,
    kind: row.kind as TwistKind,
    nonce: row.nonce,
    points: Number(row.points),
    best: Number(row.best) === 1,
    verified: scopeOf(row.marker),
    created,
  };
}

function gradeResponse(row: AttemptRow, graded: boolean): LiteGradeResponse {
  const twist = OUTCOME[row.outcome ?? 's'] ?? 'skipped';
  const out: LiteGradeResponse = {
    attemptId: row.attempt_id,
    points: Number(row.points),
    best: Number(row.best) === 1,
    twist,
    nonce: row.nonce,
    verified: scopeOf(row.marker),
    sig: row.sig ?? '',
    graded,
  };
  if (twist !== 'skipped') out.twistId = row.twist_id;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------------------------

const MATCH = /^\/v1\/lite\/(?:(attempts)|attempts\/([^/]+)\/(grade)|goal\/([^/]+))$/;

let warnedUnlimited = false;

/** Shared write gate: kill switch, signing key, body size, salt (fail closed) and the per-address dare budget. */
async function writeGate(request: Request, env: LiteEnv, ctx: LiteContext): Promise<{ error: Response } | { key: CryptoKey; text: string }> {
  const { cors } = ctx;
  if (request.method !== 'POST') return { error: json({ error: 'method not allowed' }, 405, cors) };
  if (env.KILL_LITE_DARES === '1') return { error: json({ error: 'service not configured', detail: 'verified dares are switched off' }, 503, { ...cors, 'retry-after': '3600' }) };
  const key = await signingKey(env.DARE_SIGNING_KEY);
  if (!key) return { error: json({ error: 'service not configured', detail: 'DARE_SIGNING_KEY is not set; verified dares are disabled' }, 503, { ...cors, 'retry-after': '3600' }) };
  const text = await readBody(request, MAX_BODY_BYTES);
  if (text === null) return { error: json({ error: 'payload too large' }, 413, cors) };
  if (!env.RATE_SALT) {
    if (env.ALLOW_UNLIMITED_WRITES !== '1') return { error: json({ error: 'service not configured', detail: 'RATE_SALT is not set; writes are disabled' }, 503, { ...cors, 'retry-after': '3600' }) };
    if (!warnedUnlimited) {
      warnedUnlimited = true;
      console.warn('[vande-community] RATE_SALT is not set and ALLOW_UNLIMITED_WRITES=1: dare rate limiting is OFF. Do not run this in production.');
    }
  } else if (ctx.ip) {
    const limit = Number(env.RATE_LIMIT_DARES_PER_MINUTE ?? DEFAULT_RATE_LIMIT_DARES_PER_MINUTE) || DEFAULT_RATE_LIMIT_DARES_PER_MINUTE;
    const rl = await checkRateLimit(env.DB, ctx.ip, env.RATE_SALT, limit, ctx.now.getTime(), 'dare');
    if (!rl.allowed) return { error: json({ error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' }) };
  }
  return { key, text };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function start(request: Request, env: LiteEnv, ctx: LiteContext): Promise<Response> {
  const gate = await writeGate(request, env, ctx);
  if ('error' in gate) return gate.error;
  const { cors, now } = ctx;
  const parsed = parseJson(gate.text);
  if (parsed === undefined) return json({ error: 'invalid json' }, 400, cors);
  const checked = validateStart(parsed);
  if (!checked.ok) return json({ error: 'invalid request', details: checked.errors }, 400, cors);
  const input = checked.value;
  const dareKey = (await sha256Hex(dareIdentity(input.dare))).slice(0, 32);

  const existing = await env.DB.prepare(SQL.liteAttemptByPair).bind(dareKey, input.deviceKey).first<AttemptRow>();
  if (existing) return json(startResponse(existing, false), 200, cors);

  const replay = env.LITE_VERIFY_REPLAY === '1';
  const marker: VerifiedMarker = replay ? 'v' : 't';
  let verified: VerifiedAnswer;
  try {
    verified = replay ? evaluateLiteAnswer(input.dare, input.answerPath) : claimedLiteAnswer(input.dare, input.answerPath, input.claim);
  } catch {
    return json({ error: replay ? 'dare could not be replayed' : 'answer does not fit the dare' }, 400, cors);
  }
  const twist = pickTwist(verified.kind, [], secureRandom);
  if (!twist) return json({ error: 'no twist available' }, 503, cors);

  const attemptId = newAttemptId();
  const inserted = await env.DB.prepare(SQL.liteInsertAttempt)
    .bind(
      attemptId,
      dareKey,
      input.deviceKey,
      input.dare.seed,
      input.dare.path,
      input.dare.step,
      input.dare.deadline,
      input.nonce,
      input.answerPath,
      verified.points,
      verified.best ? 1 : 0,
      verified.kind,
      twist.id,
      marker,
      now.getTime(),
    )
    .run();
  const row = await env.DB.prepare(SQL.liteAttemptByPair).bind(dareKey, input.deviceKey).first<AttemptRow>();
  if (!row) return json({ error: 'internal error' }, 500, cors);
  const created = (inserted.meta?.changes ?? 0) > 0 && row.attempt_id === attemptId;
  return json(startResponse(row, created), created ? 201 : 200, cors);
}

async function grade(request: Request, env: LiteEnv, ctx: LiteContext, attemptId: string): Promise<Response> {
  const gate = await writeGate(request, env, ctx);
  if ('error' in gate) return gate.error;
  const { cors, now } = ctx;
  if (!ATTEMPT_ID_RE.test(attemptId)) return json({ error: 'attempt not found' }, 404, cors);
  const parsed = parseJson(gate.text);
  if (parsed === undefined) return json({ error: 'invalid json' }, 400, cors);
  const checked = validateGrade(parsed);
  if (!checked.ok) return json({ error: 'invalid request', details: checked.errors }, 400, cors);
  const input = checked.value;

  const row = await env.DB.prepare(SQL.liteAttemptById).bind(attemptId).first<AttemptRow>();
  // The same answer for a wrong device key as for a missing attempt: no oracle for other people's attempt ids.
  if (!row || row.device_key !== input.deviceKey) return json({ error: 'attempt not found' }, 404, cors);
  if (row.outcome) return json(gradeResponse(row, false), 200, cors);

  const twist = twistById(row.twist_id);
  if (!twist) return json({ error: 'twist no longer available' }, 409, cors);
  let outcome: 'r' | 'w' | 's' = 's';
  if (input.twistAnswer !== null) {
    if (!twist.options.some((o) => o.id === input.twistAnswer)) return json({ error: 'invalid request', details: ['twistAnswer is not an option of this twist'] }, 400, cors);
    outcome = input.twistAnswer === twist.best ? 'r' : 'w';
  }
  const marker = (row.marker === 't' ? 't' : 'v') as VerifiedMarker;
  const twistOutcome = OUTCOME[outcome];
  const canonical = liteDareCanonical(
    {
      dare: { seed: Number(row.seed), path: row.path, step: row.step, deadline: Number(row.deadline) },
      points: Number(row.points),
      best: Number(row.best) === 1,
      twistId: outcome === 's' ? undefined : row.twist_id,
      twist: twistOutcome,
      nonce: row.nonce,
    },
    marker,
  );
  const sig = `${marker}${await signHex(gate.key, canonical)}`;
  const updated = await env.DB.prepare(SQL.liteGradeAttempt).bind(attemptId, input.twistAnswer ?? '', outcome, sig, now.getTime()).run();
  const graded = (updated.meta?.changes ?? 0) > 0;
  if (graded) await env.DB.prepare(SQL.liteBumpGoal).bind(now.toISOString().slice(0, 10), Number(row.best) === 1 ? 1 : 0, receivedHour(now)).run();
  const stored = graded ? { ...row, twist_answer: input.twistAnswer ?? '', outcome, sig, graded_at: now.getTime() } : await env.DB.prepare(SQL.liteAttemptById).bind(attemptId).first<AttemptRow>();
  if (!stored || !stored.outcome) return json({ error: 'internal error' }, 500, cors);
  return json(gradeResponse(stored, graded), 200, cors);
}

/** Public goal numbers: the count always, the best-move share only from MIN_COHORT graded answers. */
export function publicGoal(day: string, answers: number, best: number, now: Date, minCohort: number): LiteGoalResponse {
  const ready = answers >= minCohort;
  const out: LiteGoalResponse = { day, answers, minCohort, ready, asOf: receivedHour(now) };
  if (ready && answers > 0) {
    out.best = best;
    out.share = Math.round((best / answers) * 1000) / 10;
  }
  return out;
}

async function goal(request: Request, env: LiteEnv, ctx: LiteContext, dayRaw: string): Promise<Response> {
  const { cors, now, url } = ctx;
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405, cors);
  const day = decodeURIComponent(dayRaw);
  if (!isRealUtcDate(day)) return json({ error: 'invalid day' }, 400, cors);
  const headers = { ...cors, 'cache-control': `public, max-age=${LITE_GOAL_CACHE_SECONDS}` };
  const key = new Request(url.toString(), { method: 'GET' });
  if (ctx.cache) {
    const hit = await ctx.cache.match(key).catch(() => undefined);
    if (hit) return new Response(hit.body, { status: hit.status, headers: { ...JSON_HEADERS, ...headers, 'x-cache': 'hit' } });
  }
  if (env.RATE_SALT && ctx.ip) {
    const limit = Number(env.RATE_LIMIT_READS_PER_MINUTE ?? DEFAULT_RATE_LIMIT_READS_PER_MINUTE) || DEFAULT_RATE_LIMIT_READS_PER_MINUTE;
    const rl = await checkRateLimit(env.DB, ctx.ip, env.RATE_SALT, limit, now.getTime(), 'read');
    if (!rl.allowed) return json({ error: 'rate limited' }, 429, { ...cors, 'retry-after': '60' });
  }
  const row = await env.DB.prepare(SQL.liteGoalRow).bind(day).first<{ answers: number; best: number }>();
  const minCohort = Number(env.MIN_COHORT ?? DEFAULT_MIN_COHORT) || DEFAULT_MIN_COHORT;
  const response = json(publicGoal(day, Number(row?.answers ?? 0), Number(row?.best ?? 0), now, minCohort), 200, { ...headers, 'x-cache': 'miss' });
  if (ctx.cache) {
    const put = ctx.cache.put(key, response.clone()).catch(() => undefined);
    if (ctx.waitUntil) ctx.waitUntil(put);
    else await put;
  }
  return response;
}

/** Routes /v1/lite/*; null for any other path. */
export async function handleLite(request: Request, env: LiteEnv, ctx: LiteContext): Promise<Response | null> {
  const m = MATCH.exec(ctx.url.pathname);
  if (!m) return ctx.url.pathname.startsWith('/v1/lite/') ? json({ error: 'not found' }, 404, ctx.cors) : null;
  if (m[1]) return start(request, env, ctx);
  if (m[3]) return grade(request, env, ctx, decodeURIComponent(m[2]));
  return goal(request, env, ctx, m[4]);
}

/** Scheduled cleanup: attempts after 7 days, goal rows after the results retention. */
export async function pruneLite(db: D1Like, now: Date): Promise<void> {
  await db.prepare(SQL.pruneLiteAttempts).bind(now.getTime() - LITE_ATTEMPT_RETENTION_DAYS * 86400000).run();
  const cutoffDay = new Date(now.getTime() - LITE_GOAL_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
  await db.prepare(SQL.pruneLiteGoal).bind(cutoffDay).run();
}
