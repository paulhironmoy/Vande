/**
 * The Daily Top 100 cutoff (cron at 00:00 IST, retried by the sweeper; idempotent and safe to run twice or at once).
 *
 * It ranks the IST day that just ended with src/engine/ranking.ts (`rankTop100`: the best three of the first five
 * eligible matches, late answers and timing-audit flags as hard rules, each opponent's long-term effort as the
 * anti-tanking baseline) from the match_results rows the reveals wrote (ratings before the match, the engine's
 * per-player performance, late and missed-ball counts, audit flags, Auto flags), then in ONE D1 batch writes the frozen entries, the
 * permanent `youtube_top100` badges (kept whatever happens to consent) and one highlight job per best match. The
 * batch starts with a plain INSERT of the day row: a second run (repeated, or concurrent with its own snapshot) fails
 * on it and its whole transaction rolls back, so exactly one ranking is ever written. Ranked players are then told
 * (push "top100"), tracked by `notified`.
 */
import type { Top100Entry } from '@/contracts';
import type { Top100MatchInput, Top100PlayerDay } from '@/engine/ranking';
type Perf = Top100MatchInput['performance'];
import type { Config } from '../config';
import type { D1StatementLike, Env } from '../env';
import type { WorkerDeps } from '../http/context';
import { warnOnce } from '../http/log';
import { SQL } from '../storage/sql';
import { istDay, previousDay } from '../time';
import { jobStatements, type DayResultRow } from '../highlights/jobs';
import { HSQL } from '../highlights/sql';

export const TOP100_LIMIT = 100;
export const TOP100_BADGE = 'youtube_top100';
/** A long-term effort baseline needs this many rated matches behind it. */
const BASELINE_MIN_MATCHES = 5;
const PAGE = 2000;

export interface CutoffReport {
  day: string;
  status: 'frozen' | 'already_frozen' | 'unavailable';
  ranked: number;
  players: number;
  jobs: number;
}

async function dayRows(env: Env, day: string): Promise<DayResultRow[]> {
  const out: DayResultRow[] = [];
  let after = '';
  for (let i = 0; i < 1000; i++) {
    const { results } = await env.DB.prepare(HSQL.dayResults).bind(day, after, PAGE).all<DayResultRow>();
    out.push(...results);
    if (results.length < PAGE) break;
    after = results[results.length - 1].match_id;
  }
  return out;
}

/** engine.matchPerformance of one side as the reveal stored it; null when the engine could not say (an engine error). */
function performanceOf(r: DayResultRow, seat: 0 | 1): Perf | null {
  const [te, cl, ex] = seat === 0 ? [r.te0, r.cl0, r.ex0] : [r.te1, r.cl1, r.ex1];
  return te === null || cl === null || ex === null ? null : { tacticalEfficiency: te, clutch: cl, execution: ex };
}

/**
 * Each active player's matches of the day, from their point of view, in the order they finished. A match without the
 * engine's performance for both sides is ineligible for both players and left out: a stand-in 0 would mark the
 * opponent as not trying and wipe the win credit of whoever played it (`missingPerformance` counts them).
 */
export function playerDays(day: string, rows: readonly DayResultRow[]): { players: Top100PlayerDay[]; uidOf: Map<string, string>; effort: Map<string, number>; missingPerformance: number } {
  const byPlayer = new Map<string, { alias: string; uid: string; list: Array<{ ms: number; m: Omit<Top100MatchInput, 'order'> }> }>();
  const effort = new Map<string, number>();
  let missingPerformance = 0;
  const sorted = rows.slice().sort((a, b) => a.revealed_ms - b.revealed_ms || (a.match_id < b.match_id ? -1 : 1));
  for (const r of sorted) {
    const perf = [performanceOf(r, 0), performanceOf(r, 1)] as const;
    const complete = perf[0] !== null && perf[1] !== null;
    if (!complete) missingPerformance++;
    for (const seat of [0, 1] as const) {
      const other = (1 - seat) as 0 | 1;
      const pid = seat === 0 ? r.pid0 : r.pid1;
      const status = seat === 0 ? r.st0 : r.st1;
      if (!pid || status !== 'active') continue;
      const uid = seat === 0 ? r.uid0 : r.uid1;
      const p = byPlayer.get(pid) ?? { alias: (seat === 0 ? r.alias0 : r.alias1) ?? '', uid, list: [] };
      byPlayer.set(pid, p);
      const ef = seat === 0 ? r.ef0 : r.ef1;
      const rated = seat === 0 ? r.rm0 : r.rm1;
      if (ef !== null && rated !== null && rated >= BASELINE_MIN_MATCHES) effort.set(pid, ef);
      const mine = perf[seat];
      const theirs = perf[other];
      // The player still took part that day; the match just cannot count.
      if (mine === null || theirs === null) continue;
      // Late answers plus missed balls (shown, then settled as leaves): the engine's `lateAnswers` rule covers both.
      const irregular = [r.late0 + r.missed0, r.late1 + r.missed1];
      const suspect = [r.suspect0 === 1, r.suspect1 === 1];
      p.list.push({
        ms: r.revealed_ms,
        m: {
          matchId: r.match_id,
          day,
          kind: r.kind,
          ...(r.kind === 'cup' && r.stage ? { stage: r.stage } : {}),
          opponentId: (other === 0 ? r.pid0 : r.pid1) ?? `x:${r.match_id}`,
          result: r.winner === null ? 'tied' : r.winner === seat ? 'won' : 'lost',
          opponentRating: (other === 0 ? r.r0 : r.r1) ?? 1200,
          rating: (seat === 0 ? r.r0 : r.r1) ?? 1200,
          performance: mine,
          opponentPerformance: theirs,
          auto: r.auto0 === 1 || r.auto1 === 1,
          practice: false,
          lateAnswers: [irregular[seat], irregular[other]],
          timingSuspicious: [suspect[seat], suspect[other]],
        },
      });
    }
  }
  const players: Top100PlayerDay[] = [];
  const uidOf = new Map<string, string>();
  for (const [pid, p] of byPlayer) {
    uidOf.set(pid, p.uid);
    players.push({ playerId: pid, alias: p.alias, day, matches: p.list.map((x, order) => ({ ...x.m, order })) });
  }
  return { players, uidOf, effort, missingPerformance };
}

export async function runTop100Cutoff(env: Env, deps: WorkerDeps, cfg: Config, day: string): Promise<CutoffReport> {
  const db = env.DB;
  const frozen = await db.prepare(HSQL.dayFrozen).bind(day).first<{ ranked: number; players: number; notified: number }>();
  if (frozen) {
    if (frozen.notified === 0) await notifyRanked(env, deps, day);
    return { day, status: 'already_frozen', ranked: frozen.ranked, players: frozen.players, jobs: 0 };
  }
  const rank = deps.helpers.rankTop100;
  if (!rank) {
    warnOnce(deps.logger, 'rankTop100', 'the ranking helper is not configured; the Top 100 cutoff is off');
    return { day, status: 'unavailable', ranked: 0, players: 0, jobs: 0 };
  }
  const now = deps.now();
  const rows = await dayRows(env, day);
  const { players, uidOf, effort, missingPerformance } = playerDays(day, rows);
  if (missingPerformance > 0) {
    deps.metrics.count('top100_missing_performance', [], missingPerformance);
    deps.logger.log('warn', { evt: 'top100_missing_performance', day, matches: missingPerformance });
  }
  const entries: Top100Entry[] = rank(players, TOP100_LIMIT, effort);
  const byMatch = new Map(rows.map((r) => [r.match_id, r]));
  // First in the transaction, without ON CONFLICT: if another run froze the day, this batch fails and writes nothing.
  const statements: D1StatementLike[] = [db.prepare(HSQL.insertDay).bind(day, now, entries.length, players.length)];
  for (const e of entries) {
    const uid = uidOf.get(e.playerId);
    if (!uid) continue;
    statements.push(db.prepare(HSQL.insertEntry).bind(day, e.rank, uid, e.playerId, e.alias, e.score, JSON.stringify(e.matchIds), e.bestMatchId, JSON.stringify(e.components)));
    statements.push(db.prepare(SQL.addBadge).bind(uid, TOP100_BADGE));
  }
  const jobs = await jobStatements(env, deps, cfg, day, entries, byMatch, now);
  statements.push(...jobs.statements);
  try {
    await db.batch(statements);
  } catch (e) {
    const won = await db.prepare(HSQL.dayFrozen).bind(day).first<{ ranked: number; players: number }>();
    if (won) return { day, status: 'already_frozen', ranked: won.ranked, players: won.players, jobs: 0 };
    throw e;
  }
  deps.metrics.count('top100_frozen', [], 1);
  deps.logger.log('info', { evt: 'top100_frozen', day, ranked: entries.length, players: players.length, jobs: jobs.jobs });
  await notifyRanked(env, deps, day);
  return { day, status: 'frozen', ranked: entries.length, players: players.length, jobs: jobs.jobs };
}

/** Tells every ranked player once per day (collapse key per day and player); retried until it goes through. */
async function notifyRanked(env: Env, deps: WorkerDeps, day: string): Promise<void> {
  if (!env.NOTIFY_QUEUE) return;
  const { results } = await env.DB.prepare(HSQL.entriesOfDay).bind(day).all<{ uid: string }>();
  try {
    for (const r of results) {
      if (r.uid.startsWith('x:')) continue;
      await env.NOTIFY_QUEUE.send({ v: 1, kind: 'top100', uid: r.uid, dedupe: `top100:${day}:${r.uid}` });
    }
    await env.DB.prepare(HSQL.markNotified).bind(day).run();
  } catch {
    deps.logger.log('warn', { evt: 'top100_notify_failed', day });
  }
}

/** The day the 00:00 IST cutoff closes: the IST day that just ended. */
export function cutoffDay(nowMs: number): string {
  return previousDay(istDay(nowMs));
}
