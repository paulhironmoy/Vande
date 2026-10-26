/**
 * Balance experiments built on the harness. Every function is deterministic for its key and returns plain,
 * JSON-serialisable, mergeable results so scripts/simulate-balance.mjs can fan them out to worker threads.
 */
import type { BallOutcome, Conditions, MatchEventLog, OverPlan, PlayerRef } from '@/contracts';
import { commitHash } from '../canonical';
import { rngFromKey, type Sfc32 } from '../prng';
import { engineV1 as engine } from '../v1';
import { dayIndex } from '../v1/policies';
import { PITCHES, WEATHERS } from '../v1/tables';
import {
  ARCHETYPES,
  bowlPlan,
  hexSeed,
  playInnings,
  playMatch,
  type BatPolicy,
  type BowlPolicy,
  type SimPlayer,
  type SkillId,
} from './harness';

// ---------------------------------------------------------------------------------------------------------------
// Populations
// ---------------------------------------------------------------------------------------------------------------

const SKILLS: readonly SkillId[] = ['unskilled', 'average', 'skilled'];
const GHOST_IDS = ['anchor', 'swinger', 'enforcer', 'trickster', 'maestro'] as const;
export const FIXED_SHOTS = ['defend', 'rotate', 'drive', 'cut_pull', 'sweep', 'loft'] as const;

type Weighted<T> = Array<[T, number]>;

function pickWeighted<T>(rng: Sfc32, items: Weighted<T>): T {
  let total = 0;
  for (const [, w] of items) total += w;
  let u = rng.float() * total;
  for (const [item, w] of items) {
    u -= w;
    if (u < 0) return item;
  }
  return items[items.length - 1][0];
}

const BAT_MIX: Weighted<BatPolicy['strategy']> = [
  ['random', 10],
  ['heuristic', 25],
  ['oracle', 20],
  ['auto', 5],
  ...GHOST_IDS.map((g): [BatPolicy['strategy'], number] => [`ghost:${g}`, 3]),
  ...FIXED_SHOTS.map((s): [BatPolicy['strategy'], number] => [`fixed:${s}`, 25 / 6]),
];
const BOWL_MIX: Weighted<BowlPolicy['strategy']> = [
  ['random', 15],
  ...Object.keys(ARCHETYPES).map((a): [BowlPolicy['strategy'], number] => [a as BowlPolicy['strategy'], 33 / Object.keys(ARCHETYPES).length]),
  ['optimised', 12],
  ['optimised_starters', 5],
  ['auto', 10],
  ...GHOST_IDS.map((g): [BowlPolicy['strategy'], number] => [`ghost:${g}`, 5]),
];

const BOWL_MIX_NO_OPTIMISER = BOWL_MIX.filter(([s]) => s !== 'optimised' && s !== 'optimised_starters');

/** A random player from the mixed population (`optimiser: false` leaves out the optimiser-built overs: CI speed). */
export function samplePlayer(rng: Sfc32, opts: { optimiser?: boolean } = {}): SimPlayer {
  return {
    bat: { strategy: pickWeighted(rng, BAT_MIX), skill: rng.pick(SKILLS) },
    bowl: { strategy: pickWeighted(rng, opts.optimiser === false ? BOWL_MIX_NO_OPTIMISER : BOWL_MIX), skill: rng.pick(SKILLS) },
  };
}

export function sampleConditions(rng: Sfc32): Conditions {
  return { pitch: rng.pick(PITCHES), weather: rng.pick(WEATHERS) };
}

/**
 * Reference batters used to judge bowling policies: best-response (oracle) batters across the skill range, so that a
 * "dominant" over is one that beats informed batting, not one that exploits a simple scripted batter.
 */
export const REFERENCE_BATTERS: Weighted<BatPolicy> = [
  [{ strategy: 'oracle', skill: 'average' }, 60],
  [{ strategy: 'oracle', skill: 'skilled' }, 20],
  [{ strategy: 'oracle', skill: 'unskilled' }, 20],
];
/** Reference bowling used to judge batting policies. */
export const REFERENCE_BOWLERS: Weighted<BowlPolicy> = [
  [{ strategy: 'random', skill: 'average' }, 15],
  ...Object.keys(ARCHETYPES).map((a): [BowlPolicy, number] => [{ strategy: a as BowlPolicy['strategy'], skill: 'average' }, 35 / Object.keys(ARCHETYPES).length]),
  [{ strategy: 'optimised', skill: 'average' }, 20],
  [{ strategy: 'auto', skill: 'average' }, 10],
  ...GHOST_IDS.map((g): [BowlPolicy, number] => [{ strategy: `ghost:${g}`, skill: 'average' }, 4]),
];
/** A typical human: thinks about the delivery and the field, average timing, a sensible starter over. */
export const AVERAGE_HUMAN: SimPlayer = { bat: { strategy: 'heuristic', skill: 'average' }, bowl: { strategy: 'starter_mix', skill: 'average' } };

// ---------------------------------------------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------------------------------------------

/** Outcome counts: [balls, dots, 1s, 2s, 3s, 4s, 6s, wickets]. */
export type OutcomeCounts = [number, number, number, number, number, number, number, number];
const zeroCounts = (): OutcomeCounts => [0, 0, 0, 0, 0, 0, 0, 0];
function addOutcome(c: OutcomeCounts, o: BallOutcome): void {
  c[0]++;
  if (o.wicket) c[7]++;
  else if (o.runs === 0) c[1]++;
  else if (o.runs === 1) c[2]++;
  else if (o.runs === 2) c[3]++;
  else if (o.runs === 3) c[4]++;
  else if (o.runs === 4) c[5]++;
  else c[6]++;
}

/** Per-strategy innings and match record. */
export interface Record_ {
  innings: number;
  runs: number;
  runsSq: number;
  wickets: number;
  won: number;
  lost: number;
  tied: number;
}
const zeroRecord = (): Record_ => ({ innings: 0, runs: 0, runsSq: 0, wickets: 0, won: 0, lost: 0, tied: 0 });

export interface MixedStats {
  matches: number;
  innings: number;
  runsHist: number[];
  wicketsHist: number[];
  ballsFacedHist: number[];
  balls: OutcomeCounts;
  byShot: Record<string, OutcomeCounts>;
  byVariant: Record<string, OutcomeCounts>;
  byPitch: Record<string, Record_>;
  byWeather: Record<string, Record_>;
  batStrategy: Record<string, Record_>;
  batSkill: Record<string, Record_>;
  bowlStrategy: Record<string, Record_>;
  bowlSkill: Record<string, Record_>;
  wicketKinds: Record<string, number>;
  contacts: Record<string, number>;
  timings: Record<string, number>;
  executions: Record<string, number>;
  decidedBy: Record<string, number>;
  superBallUsed: number;
  seatWins: [number, number];
  /** Matches between identical players (seat bias check). */
  mirror: { matches: number; seat0: number; seat1: number };
  superBallRuns: OutcomeCounts;
  anomalyCount: number;
  anomalies: string[];
  verified: number;
  verifyFailures: string[];
}

export function emptyStats(): MixedStats {
  return {
    matches: 0,
    innings: 0,
    runsHist: new Array(37).fill(0),
    wicketsHist: [0, 0, 0],
    ballsFacedHist: new Array(7).fill(0),
    balls: zeroCounts(),
    byShot: {},
    byVariant: {},
    byPitch: {},
    byWeather: {},
    batStrategy: {},
    batSkill: {},
    bowlStrategy: {},
    bowlSkill: {},
    wicketKinds: {},
    contacts: {},
    timings: {},
    executions: {},
    decidedBy: {},
    superBallUsed: 0,
    seatWins: [0, 0],
    mirror: { matches: 0, seat0: 0, seat1: 0 },
    superBallRuns: zeroCounts(),
    anomalyCount: 0,
    anomalies: [],
    verified: 0,
    verifyFailures: [],
  };
}

const bump = (o: Record<string, number>, k: string, n = 1) => {
  o[k] = (o[k] ?? 0) + n;
};
function rec(o: Record<string, Record_>, k: string): Record_ {
  return (o[k] ??= zeroRecord());
}

function mergeCounts(a: OutcomeCounts, b: OutcomeCounts): void {
  for (let i = 0; i < a.length; i++) a[i] += b[i];
}
function mergeRecordMap(a: Record<string, Record_>, b: Record<string, Record_>): void {
  for (const [k, v] of Object.entries(b)) {
    const t = rec(a, k);
    t.innings += v.innings;
    t.runs += v.runs;
    t.runsSq += v.runsSq;
    t.wickets += v.wickets;
    t.won += v.won;
    t.lost += v.lost;
    t.tied += v.tied;
  }
}
function mergeCountMap(a: Record<string, OutcomeCounts>, b: Record<string, OutcomeCounts>): void {
  for (const [k, v] of Object.entries(b)) mergeCounts((a[k] ??= zeroCounts()), v);
}
function mergeNumMap(a: Record<string, number>, b: Record<string, number>): void {
  for (const [k, v] of Object.entries(b)) bump(a, k, v);
}

export function mergeStats(a: MixedStats, b: MixedStats): MixedStats {
  a.matches += b.matches;
  a.innings += b.innings;
  b.runsHist.forEach((v, i) => (a.runsHist[i] += v));
  b.wicketsHist.forEach((v, i) => (a.wicketsHist[i] += v));
  b.ballsFacedHist.forEach((v, i) => (a.ballsFacedHist[i] += v));
  mergeCounts(a.balls, b.balls);
  mergeCountMap(a.byShot, b.byShot);
  mergeCountMap(a.byVariant, b.byVariant);
  mergeRecordMap(a.byPitch, b.byPitch);
  mergeRecordMap(a.byWeather, b.byWeather);
  mergeRecordMap(a.batStrategy, b.batStrategy);
  mergeRecordMap(a.batSkill, b.batSkill);
  mergeRecordMap(a.bowlStrategy, b.bowlStrategy);
  mergeRecordMap(a.bowlSkill, b.bowlSkill);
  mergeNumMap(a.wicketKinds, b.wicketKinds);
  mergeNumMap(a.contacts, b.contacts);
  mergeNumMap(a.timings, b.timings);
  mergeNumMap(a.executions, b.executions);
  mergeNumMap(a.decidedBy, b.decidedBy);
  a.superBallUsed += b.superBallUsed;
  a.seatWins[0] += b.seatWins[0];
  a.seatWins[1] += b.seatWins[1];
  a.mirror.matches += b.mirror.matches;
  a.mirror.seat0 += b.mirror.seat0;
  a.mirror.seat1 += b.mirror.seat1;
  mergeCounts(a.superBallRuns, b.superBallRuns);
  a.anomalyCount += b.anomalyCount;
  a.anomalies.push(...b.anomalies.slice(0, Math.max(0, 50 - a.anomalies.length)));
  a.verified += b.verified;
  a.verifyFailures.push(...b.verifyFailures.slice(0, 20));
  return a;
}

const PLAYERS: [PlayerRef, PlayerRef] = [0, 1].map((i) => ({
  id: `sim${i}`,
  alias: `Sim ${i}`,
  avatar: { seed: `sim${i}` },
  kit: { id: 'kit', primary: '#123', secondary: '#abc', pattern: 'plain' as const },
  kind: 'ghost' as const,
})) as [PlayerRef, PlayerRef];

/** Builds a revealed log with real commit hashes and verifies it (the full audit path). */
export async function buildAndVerify(rec: ReturnType<typeof playMatch>): Promise<string | null> {
  const seed = rec.seed;
  const salts = [`salt-${seed}-0`, `salt-${seed}-1`];
  const commits = (await Promise.all(
    [0, 1].map(async (p) => ({ player: p as 0 | 1, hash: await commitHash(rec.plans[p], salts[p]), sig: 'sim', keyId: 'sim', lockedHour: '2026-10-25T00', salt: salts[p] })),
  )) as MatchEventLog['commits'];
  const log = engine.buildMatchLog({
    matchId: `sim-${seed}`,
    kind: 'duel',
    seed,
    conditions: rec.conditions,
    players: PLAYERS,
    commits,
    plans: rec.plans,
    inputs: rec.inputs,
    innings: rec.states,
    meta: { createdHour: '2026-10-25T00', revealedHour: '2026-10-25T01' },
  });
  const v = await engine.verifyMatchLog(log);
  if (!v.ok) return v.errors.join(',');
  const tampered = JSON.parse(JSON.stringify(log)) as MatchEventLog;
  tampered.innings[0].runs += 1;
  if ((await engine.verifyMatchLog(tampered)).ok) return 'tampered log verified';
  return null;
}

const label = (p: { strategy: string }) => p.strategy;

/** Mixed-population matches [start, start + count) for `key`; every `verifyEvery`-th match is fully audited. */
export async function runMixed(key: string, start: number, count: number, verifyEvery = 0, opts: { optimiser?: boolean } = {}): Promise<MixedStats> {
  const st = emptyStats();
  for (let m = start; m < start + count; m++) {
    const rng = rngFromKey(`sim/mixed|${key}|${m}`);
    const mirror = m % 10 === 0;
    const a = samplePlayer(rng, opts);
    const players: [SimPlayer, SimPlayer] = mirror ? [a, a] : [a, samplePlayer(rng, opts)];
    const cond = sampleConditions(rng);
    const seed = hexSeed(rng);
    const r = playMatch(players, cond, seed);
    st.matches++;
    st.anomalyCount += r.anomalies.length;
    if (r.anomalies.length && st.anomalies.length < 50) st.anomalies.push(...r.anomalies.slice(0, 3).map((x) => `${seed}: ${x}`));
    if (verifyEvery && m % verifyEvery === 0) {
      st.verified++;
      const err = await buildAndVerify(r);
      if (err) st.verifyFailures.push(`${seed}: ${err}`);
    }
    const winner = r.result.winner;
    if (winner !== null) st.seatWins[winner]++;
    if (mirror) {
      st.mirror.matches++;
      if (winner === 0) st.mirror.seat0++;
      else if (winner === 1) st.mirror.seat1++;
    }
    bump(st.decidedBy, r.result.decidedBy);
    if (r.result.decidedBy !== 'runs') {
      st.superBallUsed++;
      for (const s of r.states) if (s.superBall) addOutcome(st.superBallRuns, s.superBall);
    }
    for (const i of [0, 1] as const) {
      const runs = r.runs[i];
      const w = r.wickets[i];
      st.innings++;
      st.runsHist[runs]++;
      st.wicketsHist[w]++;
      st.ballsFacedHist[r.outcomes[i].length]++;
      const res = winner === null ? 'tied' : winner === i ? 'won' : 'lost';
      const opp = i === 0 ? 1 : 0;
      const recs = [
        rec(st.byPitch, cond.pitch),
        rec(st.byWeather, cond.weather),
        rec(st.batStrategy, label(players[i].bat)),
        rec(st.batSkill, `${label(players[i].bat)}/${players[i].bat.skill}`),
      ];
      for (const t of recs) {
        t.innings++;
        t.runs += runs;
        t.runsSq += runs * runs;
        t.wickets += w;
        t[res]++;
      }
      // Bowling strategy of the opponent, credited with the runs conceded and the opponent's result.
      for (const t of [rec(st.bowlStrategy, label(players[opp].bowl)), rec(st.bowlSkill, `${label(players[opp].bowl)}/${players[opp].bowl.skill}`)]) {
        t.innings++;
        t.runs += runs;
        t.runsSq += runs * runs;
        t.wickets += w;
        const oppRes = winner === null ? 'tied' : winner === opp ? 'won' : 'lost';
        t[oppRes]++;
      }
      for (const o of r.outcomes[i]) {
        addOutcome(st.balls, o);
        addOutcome((st.byShot[o.shot] ??= zeroCounts()), o);
        addOutcome((st.byVariant[o.delivery.variant] ??= zeroCounts()), o);
        if (o.wicket) bump(st.wicketKinds, o.wicket);
        bump(st.contacts, o.contact);
        bump(st.timings, o.timing);
        bump(st.executions, o.executionGrade);
      }
    }
  }
  return st;
}

// ---------------------------------------------------------------------------------------------------------------
// Cells: one batting policy against one bowling policy on one pitch
// ---------------------------------------------------------------------------------------------------------------

export interface Cell {
  innings: number;
  runs: number;
  runsSq: number;
  wickets: number;
  fours: number;
  sixes: number;
  anomalies: number;
}
const zeroCell = (): Cell => ({ innings: 0, runs: 0, runsSq: 0, wickets: 0, fours: 0, sixes: 0, anomalies: 0 });
export function mergeCell(a: Cell, b: Cell): Cell {
  a.innings += b.innings;
  a.runs += b.runs;
  a.runsSq += b.runsSq;
  a.wickets += b.wickets;
  a.fours += b.fours;
  a.sixes += b.sixes;
  a.anomalies += b.anomalies;
  return a;
}

function innings(bat: BatPolicy, bowl: BowlPolicy, cond: Conditions, key: string, i: number, cell: Cell, planOverride?: (rng: Sfc32) => OverPlan): void {
  const rng = rngFromKey(`sim/cell|${key}|${i}`);
  const seed = hexSeed(rng);
  const plan = planOverride ? planOverride(rng) : bowlPlan(bowl, cond, rng, `${seed}/bowl`);
  const r = playInnings(bat, plan, 0, cond, seed, rng);
  cell.innings++;
  cell.runs += r.state.runs;
  cell.runsSq += r.state.runs * r.state.runs;
  cell.wickets += r.state.wickets;
  for (const o of r.state.outcomes) {
    if (o.dead) continue;
    if (o.runs === 4) cell.fours++;
    else if (o.runs === 6) cell.sixes++;
  }
  cell.anomalies += r.anomalies.length;
}

/** A bowling policy against the reference batters on one pitch (weather mixed). */
export function bowlingCell(bowl: BowlPolicy, pitch: Conditions['pitch'], key: string, start: number, count: number): Cell {
  const cell = zeroCell();
  for (let i = start; i < start + count; i++) {
    const rng = rngFromKey(`sim/bowlcell|${key}|${i}`);
    const bat = pickWeighted(rng, REFERENCE_BATTERS);
    innings(bat, bowl, { pitch, weather: rng.pick(WEATHERS) }, `${key}|b`, i, cell);
  }
  return cell;
}

const REFERENCE_BOWLERS_NO_OPTIMISER = REFERENCE_BOWLERS.filter(([b]) => b.strategy !== 'optimised');

/** A batting policy against the reference bowling on one pitch (weather mixed; `optimiser: false` for CI speed). */
export function battingCell(bat: BatPolicy, pitch: Conditions['pitch'], key: string, start: number, count: number, opts: { optimiser?: boolean } = {}): Cell {
  const cell = zeroCell();
  for (let i = start; i < start + count; i++) {
    const rng = rngFromKey(`sim/batcell|${key}|${i}`);
    const bowl = pickWeighted(rng, opts.optimiser === false ? REFERENCE_BOWLERS_NO_OPTIMISER : REFERENCE_BOWLERS);
    innings(bat, bowl, { pitch, weather: rng.pick(WEATHERS) }, `${key}|a`, i, cell);
  }
  return cell;
}

/** Head-to-head matches: player A (seat alternates) against player B; returns A's wins, losses and ties. */
export function headToHead(a: SimPlayer, b: SimPlayer, key: string, start: number, count: number): { won: number; lost: number; tied: number; runsFor: number; runsAgainst: number } {
  const out = { won: 0, lost: 0, tied: 0, runsFor: 0, runsAgainst: 0 };
  for (let m = start; m < start + count; m++) {
    const rng = rngFromKey(`sim/h2h|${key}|${m}`);
    const cond = sampleConditions(rng);
    const aSeat = m % 2 === 0 ? 0 : 1;
    const players: [SimPlayer, SimPlayer] = aSeat === 0 ? [a, b] : [b, a];
    const r = playMatch(players, cond, hexSeed(rng));
    out.runsFor += r.runs[aSeat];
    out.runsAgainst += r.runs[aSeat === 0 ? 1 : 0];
    if (r.result.winner === null) out.tied++;
    else if (r.result.winner === aSeat) out.won++;
    else out.lost++;
  }
  return out;
}

/** Daily Six: average daily score and runs of a batter against each of the three daily overs over `days` days. */
export function dailyExperiment(bat: BatPolicy, firstDay: string, days: number, perOver: number): { score: [number, number, number]; runs: [number, number, number]; n: number; byPitch: Record<string, number[]> } {
  const score: [number, number, number] = [0, 0, 0];
  const runs: [number, number, number] = [0, 0, 0];
  const byPitch: Record<string, number[]> = {};
  const first = dayIndex(firstDay);
  let n = 0;
  for (let k = 0; k < days; k++) {
    const day = dayString(first + k);
    const ch = engine.dailyChallenge(day);
    for (let o = 0; o < 3; o++)
      for (let t = 0; t < perOver; t++) {
        const rng = rngFromKey(`sim/daily|${day}|${o}|${t}`);
        const r = playInnings(bat, ch.overs[o], 0, ch.conditions, hexSeed(rng), rng);
        const sc = engine.dailyScore(engine.summarise(r.state, 0));
        score[o] += sc;
        runs[o] += r.state.runs;
        (byPitch[ch.conditions.pitch] ??= [0, 0])[0] += sc;
        byPitch[ch.conditions.pitch][1]++;
      }
    n++;
  }
  const per = n * perOver;
  return { score: score.map((s) => s / per) as [number, number, number], runs: runs.map((s) => s / per) as [number, number, number], n: per, byPitch };
}

/** YYYY-MM-DD for a day number since 1970-01-01 (civil-from-days, pure integer arithmetic). */
export function dayString(days: number): string {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
