/**
 * Daily Six: one common challenge per IST day (reset 00:00 IST), three attempts (overs A, B and C, the same for
 * everyone), each a solo innings with the usual one-ball protocol, revealed as soon as it is done. The best of three
 * counts for the leaderboards; a finished attempt on consecutive days builds a streak.
 */
import type { DailyAttemptResponse, DailyResultResponse, DailyView, MatchEventLog } from '@/contracts';
import { MATCH_ID_RE } from '@/net/shared/ids';
import type { RequestContext } from '../http/context';
import { requireActor } from '../http/context';
import { fail } from '../http/errors';
import type { Reply } from '../http/router';
import { callMatch } from '../match/client';
import { randomId } from '../security/crypto';
import { SQL } from '../storage/sql';
import { playerRefOf, requireAccount } from '../profile/model';
import { istDay, nextIstMidnight, previousDay } from '../time';
import { dailySalt } from './salt';

export const DAILY_ATTEMPTS = 3;

/** The day's conditions and the commits of its three sealed overs (hashes only), cached per isolate. */
const challengeCache = new Map<string, { conditions: DailyView['conditions']; overCommits: DailyView['overCommits'] }>();

async function challengeFor(ctx: RequestContext, day: string): Promise<{ conditions: DailyView['conditions']; overCommits: DailyView['overCommits'] }> {
  const salt = await dailySalt(ctx.env, ctx.deps.logger);
  const engine = ctx.deps.engines.current();
  const key = `${engine.ENGINE_VERSION}|${day}|${salt.slice(0, 16)}`;
  const hit = challengeCache.get(key);
  if (hit) return hit;
  const commits = ctx.deps.helpers.dailyCommits;
  if (!commits) fail('unavailable', 'the daily challenge is not available');
  try {
    const { conditions } = engine.dailyChallenge(day, salt);
    const list = commits(day, salt);
    const hashes = ([1, 2, 3] as const).map((a) => list.find((c) => c.attempt === a)?.hash ?? '');
    if (!hashes.every((h) => /^[0-9a-f]{64}$/.test(h))) throw new Error('bad daily commits');
    const value = { conditions: { pitch: conditions.pitch, weather: conditions.weather }, overCommits: hashes as DailyView['overCommits'] };
    if (challengeCache.size >= 8) challengeCache.delete(challengeCache.keys().next().value as string);
    challengeCache.set(key, value);
    return value;
  } catch {
    return fail('unavailable', 'the daily challenge is not available');
  }
}

export async function getDaily(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const day = istDay(ctx.now);
  const [attempts, score, streak] = await Promise.all([
    ctx.env.DB.prepare(SQL.dailyAttemptRow).bind(day, actor.uid).first<{ started: number; finished: number; current_id: string | null }>(),
    ctx.env.DB.prepare(SQL.dailyScoreRow).bind(day, actor.uid).first<{ best_score: number }>(),
    ctx.env.DB.prepare(SQL.streakRow).bind(actor.uid).first<{ streak: number; last_day: string }>(),
  ]);
  const alive = streak && (streak.last_day === day || streak.last_day === previousDay(day));
  const challenge = await challengeFor(ctx, day);
  const view: DailyView = {
    day,
    conditions: challenge.conditions,
    overCommits: challenge.overCommits,
    attemptsUsed: attempts?.started ?? 0,
    attemptsMax: DAILY_ATTEMPTS,
    bestScore: score?.best_score ?? null,
    streak: alive ? streak.streak : 0,
    resetsAt: new Date(nextIstMidnight(ctx.now)).toISOString(),
  };
  return { status: 200, body: view };
}

/** Starts the next attempt, or returns the one in progress (an attempt is never lost to a closed app). */
export async function startAttempt(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  const day = istDay(ctx.now);
  const account = await requireAccount(ctx.env.DB, actor.uid);
  await challengeFor(ctx, day);
  const fresh = randomId('m');
  const claimed = await ctx.env.DB.prepare(SQL.claimDailyAttempt).bind(day, actor.uid, fresh, DAILY_ATTEMPTS).first<{ started: number }>();
  let attemptId = fresh;
  let attempt: number;
  if (claimed) {
    attempt = claimed.started;
  } else {
    const row = await ctx.env.DB.prepare(SQL.dailyAttemptRow).bind(day, actor.uid).first<{ started: number; current_id: string | null }>();
    if (!row?.current_id) fail('conflict', 'all three Daily Six attempts are used; the next challenge starts at 00:00 IST');
    attemptId = row.current_id;
    attempt = row.started;
  }
  await callMatch(ctx.env, ctx.cfg, attemptId, {
    op: 'create_daily',
    matchId: attemptId,
    day,
    attempt: attempt as 1 | 2 | 3,
    player: { uid: actor.uid, ref: playerRefOf(account) },
    city: account.city,
    batByMs: nextIstMidnight(ctx.now),
  });
  const body: DailyAttemptResponse = { attemptId, attempt: attempt as 1 | 2 | 3 };
  return { status: claimed ? 201 : 200, body };
}

export async function attemptResult(ctx: RequestContext): Promise<Reply> {
  const actor = requireActor(ctx);
  if (!MATCH_ID_RE.test(ctx.params.id)) fail('not_found', 'attempt not found');
  const r = await callMatch<{ score: number; day: string; counted?: boolean; log: MatchEventLog }>(ctx.env, ctx.cfg, ctx.params.id, { op: 'daily_result', uid: actor.uid });
  const best = await ctx.env.DB.prepare(SQL.dailyScoreRow).bind(r.body.day, actor.uid).first<{ best_score: number }>();
  // The row may not be written yet, so a counted attempt is part of the best; one over the integrity limit (more than
  // one late or missed ball) never is, and with nothing counted yet there is no best (null).
  const counted = r.body.counted !== false;
  const bestScore = counted ? Math.max(best?.best_score ?? r.body.score, r.body.score) : (best?.best_score ?? null);
  const body: DailyResultResponse = { score: r.body.score, counted, bestScore, log: r.body.log };
  return { status: 200, body };
}
