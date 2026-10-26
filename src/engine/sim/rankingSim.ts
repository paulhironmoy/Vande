/**
 * Daily Top 100 simulation (not shipped): a pool of real engine matches between honest players of three skill levels
 * and two kinds of tanking partner, scored by engine.matchPerformance, then resampled into player days to show that
 * grinding more matches cannot buy rank and that colluding pairs gain nothing.
 */
import type { MatchKind } from '@/contracts';
import { rngFromKey, type Sfc32 } from '../prng';
import { rankTop100, top100DayScore, type Top100MatchInput, type Top100PlayerDay } from '../ranking';
import { engineV1 as engine } from '../v1';
import { hexSeed, playMatch, type SimPlayer } from './harness';

export const RANK_TYPES: Record<string, SimPlayer & { rating: number }> = {
  skilled: { bat: { strategy: 'oracle', skill: 'skilled' }, bowl: { strategy: 'starter_mix', skill: 'skilled' }, rating: 1400 },
  average: { bat: { strategy: 'heuristic', skill: 'average' }, bowl: { strategy: 'starter_mix', skill: 'average' }, rating: 1200 },
  casual: { bat: { strategy: 'heuristic', skill: 'unskilled' }, bowl: { strategy: 'random', skill: 'unskilled' }, rating: 1050 },
  /** Throws matches outright: blocks or leaves everything, bowls anything. */
  hardTank: { bat: { strategy: 'fixed:defend', skill: 'unskilled' }, bowl: { strategy: 'random', skill: 'unskilled' }, rating: 1200 },
  /** Throws matches quietly: random shots and loose bowling, so it still looks like play. */
  softTank: { bat: { strategy: 'random', skill: 'unskilled' }, bowl: { strategy: 'random', skill: 'unskilled' }, rating: 1200 },
};
export const HONEST = ['skilled', 'average', 'casual'] as const;

export interface PoolRecord {
  result: 'won' | 'lost' | 'tied';
  perf: { tacticalEfficiency: number; clutch: number; execution: number };
  oppPerf: { tacticalEfficiency: number; clutch: number; execution: number };
}

/** pool[a][b] = matches of type a (seat alternates) against type b, from a's point of view. */
export type Pool = Record<string, Record<string, PoolRecord[]>>;

export function buildPool(pairs: Array<[string, string]>, perPair: number, key = 'rank'): Pool {
  const pool: Pool = {};
  for (const [a, b] of pairs)
    for (let i = 0; i < perPair; i++) {
      const rng = rngFromKey(`sim/rankpool|${key}|${a}|${b}|${i}`);
      const aSeat = i % 2 === 0 ? 0 : 1;
      const players: [SimPlayer, SimPlayer] = aSeat === 0 ? [RANK_TYPES[a], RANK_TYPES[b]] : [RANK_TYPES[b], RANK_TYPES[a]];
      const r = playMatch(players, { pitch: rng.pick(['green', 'hard', 'slow'] as const), weather: rng.pick(['clear', 'humid', 'dew'] as const) }, hexSeed(rng), { buildLog: true });
      const log = r.log!;
      const bSeat = aSeat === 0 ? 1 : 0;
      const winner = log.result.winner;
      const res = (seat: 0 | 1): PoolRecord['result'] => (winner === null ? 'tied' : winner === seat ? 'won' : 'lost');
      const pa = engine.matchPerformance(log, aSeat);
      const pb = engine.matchPerformance(log, bSeat);
      ((pool[a] ??= {})[b] ??= []).push({ result: res(aSeat), perf: pa, oppPerf: pb });
      ((pool[b] ??= {})[a] ??= []).push({ result: res(bSeat), perf: pb, oppPerf: pa });
    }
  return pool;
}

function input(rec: PoolRecord, k: number, me: string, opp: string, oppId: string, day: string, kind: MatchKind = 'duel'): Top100MatchInput {
  return {
    matchId: `${day}-${k}-${oppId}`,
    day,
    order: k,
    kind,
    opponentId: oppId,
    result: rec.result,
    opponentRating: RANK_TYPES[opp].rating,
    rating: RANK_TYPES[me].rating,
    performance: rec.perf,
    opponentPerformance: rec.oppPerf,
    auto: false,
    practice: false,
    lateAnswers: [0, 0],
    timingSuspicious: [false, false],
  };
}

const OPP_WEIGHTS: Array<[string, number]> = [
  ['skilled', 0.2],
  ['average', 0.55],
  ['casual', 0.25],
];
function pickOpp(rng: Sfc32): string {
  let u = rng.float();
  for (const [t, w] of OPP_WEIGHTS) {
    u -= w;
    if (u < 0) return t;
  }
  return 'average';
}

/** `n` honest matches for a player of `type` against random honest opponents. */
export function honestDay(pool: Pool, type: string, n: number, rng: Sfc32, day: string, startOrder = 0): Top100MatchInput[] {
  const out: Top100MatchInput[] = [];
  for (let k = 0; k < n; k++) {
    const opp = pickOpp(rng);
    const recs = pool[type][opp];
    out.push(input(recs[Math.floor(rng.float() * recs.length)], startOrder + k, type, opp, `opp-${day}-${startOrder + k}`, day));
  }
  return out;
}

/** Mean and 90th percentile of the day score for `n` matches a day. */
export function grindCurve(pool: Pool, type: string, ns: readonly number[], days: number): Array<{ n: number; mean: number; p90: number }> {
  return ns.map((n) => {
    const scores: number[] = [];
    for (let d = 0; d < days; d++) {
      const rng = rngFromKey(`sim/grind|${type}|${n}|${d}`);
      scores.push(top100DayScore('me', 'day', honestDay(pool, type, n, rng, 'day')).score);
    }
    scores.sort((a, b) => a - b);
    return { n, mean: scores.reduce((s, x) => s + x, 0) / days, p90: scores[Math.floor(0.9 * (days - 1))] };
  });
}

/** A population with mixed skill and volume, ranked: who makes the Top 100? */
export function rankRace(pool: Pool, players: number, key = 'race'): { bySkill: Record<string, { players: number; top: number }>; byVolume: Record<string, { players: number; top: number }>; volumeWithinSkill: Record<string, Record<number, number>> } {
  const rng = rngFromKey(`sim/race|${key}`);
  const volumes = [1, 3, 5, 8, 12, 20];
  const roster: Array<Top100PlayerDay & { type: string; n: number }> = [];
  for (let i = 0; i < players; i++) {
    const u = rng.float();
    const type = u < 0.15 ? 'skilled' : u < 0.7 ? 'average' : 'casual';
    const n = rng.pick(volumes);
    roster.push({ playerId: `p${String(i).padStart(5, '0')}`, alias: `P${i}`, day: 'day', matches: honestDay(pool, type, n, rng, 'day'), type, n });
  }
  const top = new Set(rankTop100(roster).map((e) => e.playerId));
  const bySkill: Record<string, { players: number; top: number }> = {};
  const byVolume: Record<string, { players: number; top: number }> = {};
  const within: Record<string, Record<number, { players: number; top: number }>> = {};
  for (const p of roster) {
    const inTop = top.has(p.playerId) ? 1 : 0;
    (bySkill[p.type] ??= { players: 0, top: 0 }).players++;
    bySkill[p.type].top += inTop;
    (byVolume[String(p.n)] ??= { players: 0, top: 0 }).players++;
    byVolume[String(p.n)].top += inTop;
    ((within[p.type] ??= {})[p.n] ??= { players: 0, top: 0 }).players++;
    within[p.type][p.n].top += inTop;
  }
  const volumeWithinSkill: Record<string, Record<number, number>> = {};
  for (const [t, m] of Object.entries(within)) volumeWithinSkill[t] = Object.fromEntries(Object.entries(m).map(([n, v]) => [Number(n), v.top / v.players]));
  return { bySkill, byVolume, volumeWithinSkill };
}

/**
 * Collusion: player A (type `a`) plays two of its five matches against a partner who throws them (`tank`). Returns
 * A's mean day score honest vs colluding, and the pair's combined score, for three baseline situations:
 * the partner plays only the thrown matches (no same-day baseline), plays three honest matches too (same-day median),
 * or the platform supplies the partner's long-term effort (the partner's honest median).
 */
export function collusion(pool: Pool, a: string, tank: string, partnerHonest: string, days: number): Record<string, { a: number; pair: number }> {
  const out: Record<string, { a: number; pair: number }> = {};
  const scenarios = ['honest', 'no_baseline', 'same_day_baseline', 'long_term_baseline'] as const;
  const partnerEffort = median(pool[partnerHonest].average.map((r) => r.perf.tacticalEfficiency));
  for (const sc of scenarios) {
    let sumA = 0;
    let sumPair = 0;
    for (let d = 0; d < days; d++) {
      const rng = rngFromKey(`sim/collude|${a}|${tank}|${sc}|${d}`);
      if (sc === 'honest') {
        const aDay = honestDay(pool, a, 5, rng, 'day');
        const bDay = honestDay(pool, partnerHonest, 5, rng, 'day');
        const ranked = scorePair(aDay, bDay, new Map());
        sumA += ranked.a;
        sumPair += ranked.a + ranked.b;
        continue;
      }
      // Two thrown matches between A and B first, then honest matches.
      const aDay: Top100MatchInput[] = [];
      const bDay: Top100MatchInput[] = [];
      for (let k = 0; k < 2; k++) {
        const recs = pool[a][tank];
        const rec = recs[Math.floor(rng.float() * recs.length)];
        aDay.push({ ...input(rec, k, a, partnerHonest, 'B', 'day'), matchId: `AB-${k}` });
        bDay.push({ ...input({ result: rec.result === 'won' ? 'lost' : rec.result === 'lost' ? 'won' : 'tied', perf: rec.oppPerf, oppPerf: rec.perf }, k, partnerHonest, a, 'A', 'day'), matchId: `AB-${k}` });
      }
      aDay.push(...honestDay(pool, a, 3, rng, 'day', 2));
      if (sc !== 'no_baseline') bDay.push(...honestDay(pool, partnerHonest, 3, rng, 'day', 2));
      const long = sc === 'long_term_baseline' ? new Map([['B', partnerEffort]]) : new Map<string, number>();
      const ranked = scorePair(aDay, bDay, long);
      sumA += ranked.a;
      sumPair += ranked.a + ranked.b;
    }
    out[sc] = { a: sumA / days, pair: sumPair / days };
  }
  return out;
}

function scorePair(aDay: Top100MatchInput[], bDay: Top100MatchInput[], long: Map<string, number>): { a: number; b: number } {
  const entries = rankTop100(
    [
      { playerId: 'A', alias: 'A', day: 'day', matches: aDay },
      { playerId: 'B', alias: 'B', day: 'day', matches: bDay },
    ],
    100,
    long,
  );
  const get = (id: string) => entries.find((e) => e.playerId === id)?.score ?? 0;
  return { a: get('A'), b: get('B') };
}

function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
