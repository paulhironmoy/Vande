/**
 * A small, deterministic stand-in for the Sealed Six engine, owned by the platform workstream. It implements the
 * SealedSixEngineApi contract closely enough to exercise the Worker's orchestration (sealing, one-ball reveals,
 * tokens, deadlines, reveal) and follows the published input rules of GAME_RULES.md §4a (trace shapes, release
 * meter, tap bounds). Its outcome model is a toy: integration tests switch to the real `@/engine` once it lands
 * (backend/test/realEngine.test.ts runs automatically as soon as the engine stops throwing).
 */
import { BALLS_PER_OVER, ENGINE_VERSION, EVENT_SCHEMA_VERSION, SUPER_BALL_INDEX, WICKETS_PER_INNINGS } from '@/contracts';
import { autoXiSeed, timingAudit } from '@/engine';
import { matchEligibility, rankTop100, updateRatings } from '@/engine/ranking';
import { sha256Hex as sha256Sync } from '@/engine/sha256';
import type { EngineHelpers } from '../src/engines';
import type {
  CommitRecord,
  BallOutcome,
  BattingInput,
  Contact,
  DeliveryFamily,
  DeliveryPlan,
  DeliveryVariant,
  FieldZone,
  InningsState,
  InningsSummary,
  InputTrace,
  MatchEvent,
  MatchEventLog,
  MatchResult,
  OverPlan,
  RevealedDelivery,
  Runs,
  SealedSixEngineApi,
  TimingGrade,
} from '@/contracts';

const FAMILY: Record<DeliveryVariant, DeliveryFamily> = {
  yorker: 'pace',
  good_length: 'pace',
  bouncer: 'pace',
  slower: 'pace',
  inswing: 'swing',
  outswing: 'swing',
  offspin: 'spin',
  legspin: 'spin',
};
const VARIANTS = Object.keys(FAMILY) as DeliveryVariant[];
const STARTER: DeliveryVariant[] = ['good_length', 'yorker', 'bouncer', 'offspin'];
const BUDGET = 16;
const SUPER_BALL_ALLOWANCE = 4;
const SWEET_SPOT_MS = 800;

function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

function traceErrors(trace: InputTrace, label: string, min = 2): string[] {
  const errors: string[] = [];
  const s = trace.samples;
  if (s.length < min || s.length > 120) errors.push(`${label}: ${min}–120 samples`);
  if (s.length > 0 && s[0][0] !== 0) errors.push(`${label}: timestamps start at 0`);
  for (let i = 0; i < s.length; i++) {
    const [t, x, y] = s[i];
    if (![t, x, y].every(Number.isFinite) || x < 0 || x > 1 || y < 0 || y > 1) errors.push(`${label}: coordinates in 0..1`);
    if (i > 0 && t <= s[i - 1][0]) errors.push(`${label}: strictly increasing timestamps`);
    if (i > 0) {
      const dt = t - s[i - 1][0];
      const dist = Math.hypot(x - s[i - 1][1], y - s[i - 1][2]);
      if (dt > 0 && dist / dt > 0.03) errors.push(`${label}: teleporting samples`);
    }
  }
  return [...new Set(errors)];
}

function energy(d: Omit<DeliveryPlan, 'gesture'>): number {
  return d.intensity + (d.variant === 'yorker' || d.variant === 'bouncer' ? 1 : 0);
}

function lengthOk(d: DeliveryPlan): boolean {
  if (d.variant === 'yorker') return d.length === 'full';
  if (d.variant === 'bouncer') return d.length === 'short';
  return true;
}

function releaseOf(trace: InputTrace): number {
  return trace.samples[trace.samples.length - 1]?.[0] ?? 0;
}

function quality(trace: InputTrace): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(releaseOf(trace) - SWEET_SPOT_MS) / 160));
}

function grade(q: number): 'perfect' | 'good' | 'loose' {
  return q >= 0.85 ? 'perfect' : q >= 0.5 ? 'good' : 'loose';
}

function timingFor(d: Omit<DeliveryPlan, 'gesture'>) {
  const base = FAMILY[d.variant] === 'spin' ? 1000 : 900;
  return { releaseToContactMs: base - 80 * d.intensity, perfectMs: 30, goodMs: 80, edgeMs: 160 };
}

function timingGrade(input: BattingInput | null, delivery: RevealedDelivery): TimingGrade {
  if (!input) return 'interrupted';
  if (input.shot === 'leave' || input.tapMs === null) return 'no_shot';
  const d = input.tapMs - delivery.timing.releaseToContactMs;
  const a = Math.abs(d);
  if (a <= delivery.timing.perfectMs) return 'perfect';
  if (a <= delivery.timing.goodMs) return 'good';
  if (a <= delivery.timing.edgeMs) return d < 0 ? 'early' : 'late';
  return d < 0 ? 'very_early' : 'very_late';
}

function deliveryOf(plan: OverPlan, ball: number): DeliveryPlan {
  return ball === SUPER_BALL_INDEX ? plan.superBall : plan.balls[ball];
}

function reveal(plan: OverPlan, ball: number): RevealedDelivery {
  const d = deliveryOf(plan, ball);
  const h = fnv(`${d.variant}|${d.line}|${d.length}|${d.intensity}`);
  return {
    ball,
    variant: d.variant,
    family: FAMILY[d.variant],
    line: d.line,
    length: d.length,
    intensity: d.intensity,
    timing: timingFor(d),
    path: {
      speedKph: FAMILY[d.variant] === 'spin' ? 80 + d.intensity * 5 : 120 + d.intensity * 10,
      releaseHeightM: 2.1,
      bounceAtM: d.length === 'full' ? 18 : d.length === 'good' ? 15 : 11,
      lineAtBatM: { wide_off: 0.45, off: 0.15, middle: 0, leg: -0.15 }[d.line],
      swingM: d.variant === 'inswing' ? -0.2 : d.variant === 'outswing' ? 0.2 : 0,
      turnM: d.variant === 'offspin' ? -0.15 : d.variant === 'legspin' ? 0.15 : 0,
      heightAtBatM: d.length === 'short' ? 1.4 : d.length === 'full' ? 0.15 : 0.7,
      spinRpm: FAMILY[d.variant] === 'spin' ? 1800 : 600 + (h % 200),
      seamUpright: FAMILY[d.variant] !== 'spin',
    },
  };
}

const RUN_TABLE: Record<string, Runs[]> = {
  perfect: [4, 6, 4, 2, 1, 6, 4, 3],
  good: [1, 2, 4, 1, 0, 2, 1, 4],
  early: [0, 1, 0, 1, 2, 0, 1, 0],
  late: [1, 0, 0, 1, 0, 2, 0, 1],
  very_early: [0, 0, 1, 0, 0, 0, 0, 0],
  very_late: [0, 0, 0, 1, 0, 0, 0, 0],
  no_shot: [0],
  interrupted: [0],
};

function contactFor(t: TimingGrade, roll: number): Contact {
  if (t === 'interrupted' || t === 'no_shot') return 'none';
  if (t === 'perfect') return 'middle';
  if (t === 'good') return roll % 5 === 0 ? 'thick_edge' : 'middle';
  if (t === 'early' || t === 'late') return roll % 3 === 0 ? 'thin_edge' : 'thick_edge';
  return roll % 2 === 0 ? 'miss' : 'thin_edge';
}

function startInnings(innings: 0 | 1): InningsState {
  return { innings, nextBall: 0, runs: 0, wickets: 0, outcomes: [], superBall: null, mainDone: false, done: false };
}

function resolveNextBall(state: InningsState, args: { seed: string; plan: OverPlan; input: BattingInput | null }) {
  if (state.done) throw new Error('innings is complete');
  const ball = state.nextBall;
  const plan = deliveryOf(args.plan, ball);
  const delivery = reveal(args.plan, ball);
  const timing = timingGrade(args.input, delivery);
  const roll = fnv(`${args.seed}|${state.innings}|${ball}|${args.input?.shot ?? '-'}|${args.input?.zone ?? '-'}|${timing}|${quality(plan.gesture).toFixed(2)}`);
  const table = RUN_TABLE[timing];
  let runs: Runs = args.input && args.input.shot !== 'defend' ? table[roll % table.length] : 0;
  const risky = args.input && (args.input.shot === 'loft' || args.input.shot === 'sweep');
  // Toy rule: a risky shot (loft, sweep) badly mistimed is always out; other badly mistimed shots sometimes.
  const wicket = args.input && args.input.shot !== 'leave' && (timing === 'very_early' || timing === 'very_late') && (risky || roll % 4 === 0) ? 'caught' : null;
  if (wicket) runs = 0;
  const contact = contactFor(timing, roll);
  const zone = (args.input?.zone ?? null) as FieldZone | null;
  const outcome: BallOutcome = {
    ball,
    delivery: { variant: plan.variant, line: plan.line, length: plan.length, intensity: plan.intensity, intent: plan.intent },
    execution: quality(plan.gesture),
    executionGrade: grade(quality(plan.gesture)),
    shot: args.input?.shot ?? 'leave',
    zone,
    timing,
    contact,
    runs,
    wicket,
    fielder: wicket ? (zone ?? 'mid_off') : null,
    factors: { matchup: 0, timing: timing === 'perfect' ? 1 : 0, execution: quality(plan.gesture), pitch: 0, field: 0, setup: 0, risk: risky ? 0.6 : 0.2, explainKey: 'explain.fake' },
    cues: {
      bowlerAction: FAMILY[plan.variant] === 'spin' ? 'spin_off' : 'pace_long',
      path: delivery.path,
      batterAnim: args.input ? (args.input.shot === 'leave' ? 'leave' : 'drive') : 'leave',
      footwork: 'still',
      fate: wicket ? { kind: 'wicket', wicket, zone } : runs === 0 ? { kind: 'dot_block', zone: null } : runs === 4 ? { kind: 'four', zone: zone ?? 'cover', bounces: true } : runs === 6 ? { kind: 'six', zone: zone ?? 'mid_on', distanceM: 78 } : { kind: 'runs', runs: runs as 1 | 2 | 3, zone: zone ?? 'point' },
      crowd: runs >= 4 || wicket ? 0.9 : 0.3,
      celebration: wicket ? 'wicket' : runs === 6 ? 'six' : runs === 4 ? 'boundary' : 'none',
      slowMotion: Boolean(wicket) || runs === 6,
      key: Boolean(wicket) || runs >= 4,
      cameras: [{ shot: 'broadcast_end', atMs: 0, durationMs: 2000 }],
    },
  };
  const next: InningsState = { ...state, outcomes: [...state.outcomes] };
  if (ball === SUPER_BALL_INDEX) {
    next.superBall = outcome;
    next.done = true;
    next.nextBall = SUPER_BALL_INDEX + 1;
  } else {
    // Like the real engine: after the second wicket the rest of the over is still bowled and answered (the batter
    // cannot tell), but those balls are dead: no runs, no wicket, left out of the summary.
    const dead = state.wickets >= WICKETS_PER_INNINGS;
    const counted: BallOutcome = dead ? { ...outcome, runs: 0, wicket: null, fielder: null, dead: true } : outcome;
    next.outcomes.push(counted);
    next.runs += dead ? 0 : runs;
    next.wickets += !dead && wicket ? 1 : 0;
    if (ball === BALLS_PER_OVER - 1) {
      next.mainDone = true;
      next.nextBall = SUPER_BALL_INDEX;
    } else {
      next.nextBall = ball + 1;
    }
    return { state: next, outcome: counted, feedback: { ball, timing, contact } };
  }
  return { state: next, outcome, feedback: { ball, timing, contact } };
}

function summarise(state: InningsState, batter: 0 | 1): InningsSummary {
  const live = state.outcomes.filter((o) => !o.dead);
  return { batter, bowler: (1 - batter) as 0 | 1, balls: live, runs: state.runs, wickets: state.wickets, ballsFaced: live.length };
}

function trace(seed: number, releaseMs: number, n = 6, pointer: InputTrace['pointer'] = 'touch'): InputTrace {
  const samples: Array<[number, number, number]> = [];
  for (let i = 0; i < n; i++) {
    const t = i === n - 1 ? releaseMs : Math.round((releaseMs / (n - 1)) * i);
    samples.push([t, 0.4 + ((seed + i) % 7) * 0.01, 0.8 - i * 0.02]);
  }
  return { pointer, samples };
}

function autoOver(seed: string): OverPlan {
  const h = fnv(seed);
  const shapes: Array<Omit<DeliveryPlan, 'gesture'>> = [
    { variant: 'good_length', line: 'off', length: 'good', intensity: 2, intent: 'contain' },
    { variant: 'yorker', line: 'middle', length: 'full', intensity: 2, intent: 'attack' },
    { variant: 'good_length', line: 'off', length: 'good', intensity: 1, intent: 'setup' },
    { variant: 'bouncer', line: 'leg', length: 'short', intensity: 1, intent: 'attack' },
    { variant: 'offspin', line: 'off', length: 'good', intensity: 1, intent: 'contain' },
    { variant: 'good_length', line: 'wide_off', length: 'good', intensity: 1, intent: 'contain' },
  ];
  const balls = shapes.map((s, i) => ({ ...s, gesture: trace(h + i, 760 + ((h >> i) % 70), 5 + i) })) as OverPlan['balls'];
  return { v: 1, field: 'balanced', balls, superBall: { variant: 'yorker', line: 'middle', length: 'full', intensity: 2, intent: 'attack', gesture: trace(h + 9, 790, 4) } };
}

function result(i0: InningsState, i1: InningsState): MatchResult {
  const base = { playerOfMatch: (i0.runs >= i1.runs ? 0 : 1) as 0 | 1, turningPointEvent: 1 };
  if (i0.runs !== i1.runs) return { ...base, winner: i0.runs > i1.runs ? 0 : 1, tie: false, decidedBy: 'runs', marginRuns: Math.abs(i0.runs - i1.runs) };
  const s0 = i0.superBall?.runs ?? 0;
  const s1 = i1.superBall?.runs ?? 0;
  if (s0 !== s1) return { ...base, winner: s0 > s1 ? 0 : 1, tie: false, decidedBy: 'super_ball', marginRuns: 0 };
  if (i0.wickets !== i1.wickets) return { ...base, winner: i0.wickets < i1.wickets ? 0 : 1, tie: false, decidedBy: 'wickets_lost', marginRuns: 0 };
  return { ...base, winner: null, tie: true, decidedBy: 'tie', marginRuns: 0 };
}

const DAILY_CONDITIONS = { pitch: 'hard', weather: 'clear' } as const;

/** The day's overs depend on the server salt (unsalted: the offline practice version). */
function dailyOvers(day: string, serverSalt = ''): [OverPlan, OverPlan, OverPlan] {
  return [autoOver(`${day}|${serverSalt}|a`), autoOver(`${day}|${serverSalt}|b`), autoOver(`${day}|${serverSalt}|c`)];
}

/** One-way commit salt of a daily over (the fake's version of the engine's dailyCommitSalt). */
function dailyCommitSalt(day: string, attempt: number, serverSalt: string): string {
  return sha256Sync(`fake/daily-commit|${day}|${attempt}|${serverSalt}`).slice(0, 32);
}

/** The fake's `dailyCommits` (synchronous SHA-256, the same digest as its commitHash). */
export function fakeDailyCommits(day: string, serverSalt: string): Array<{ attempt: 1 | 2 | 3; hash: string; salt: string }> {
  const overs = dailyOvers(day, serverSalt);
  return ([1, 2, 3] as const).map((attempt) => {
    const salt = dailyCommitSalt(day, attempt, serverSalt);
    return { attempt, hash: sha256Sync(stable(overs[attempt - 1]) + salt), salt };
  });
}

/** Helpers that match the fake engine (the audit and the ranking maths are the engine's own: contract types only). */
/** Without `unlocksEarned`: fake matches never unlock anything (realEngine.test.ts covers unlocks with the real rules). */
export const fakeHelpers: Partial<EngineHelpers> = { timingAudit, dailyCommits: fakeDailyCommits, updateRatings, rankTop100, matchEligibility, autoXiSeed };

function dailyLog(a: Parameters<SealedSixEngineApi['buildDailyLog']>[0]): MatchEventLog {
  if (!a.innings.mainDone) throw new Error('fake engine: the daily innings is not finished');
  const plan = dailyOvers(a.day, a.serverSalt)[a.attempt - 1];
  const salt = dailyCommitSalt(a.day, a.attempt, a.serverSalt);
  const summary = summarise(a.innings, 0);
  const events: MatchEvent[] = [{ t: 'innings_start', innings: 0, batter: 0, field: plan.field }];
  let runs = 0;
  let wickets = 0;
  summary.balls.forEach((o, n) => {
    runs += o.runs;
    wickets += o.wicket ? 1 : 0;
    events.push({ t: 'ball', innings: 0, ball: o.ball, outcome: o, score: { runs, wickets, ballsLeft: wickets >= WICKETS_PER_INNINGS ? 0 : BALLS_PER_OVER - n - 1 } });
  });
  events.push({ t: 'innings_end', innings: 0, runs: summary.runs, wickets: summary.wickets });
  const score = fakeEngine.dailyScore(summary);
  // Like the real engine: a daily log carries its score in `dailyScore`; marginRuns is 0 there.
  const r: MatchResult = { winner: null, tie: false, decidedBy: 'forfeit_none', marginRuns: 0, dailyScore: score, playerOfMatch: 0, turningPointEvent: 1 };
  events.push({ t: 'result', result: r });
  const commit: CommitRecord = { player: 1, hash: sha256Sync(stable(plan) + salt), sig: '', keyId: '', lockedHour: a.meta.createdHour, salt };
  return {
    schema: EVENT_SCHEMA_VERSION,
    engine: ENGINE_VERSION,
    matchId: a.attemptId,
    kind: 'daily',
    seed: a.seed,
    conditions: { ...DAILY_CONDITIONS },
    players: [a.player, a.setter],
    commits: [{ player: 0, hash: '', sig: '', keyId: '', lockedHour: a.meta.createdHour }, commit],
    plans: [plan, plan],
    inputs: [a.inputs.filter((x): x is BattingInput => x !== null), []],
    innings: [summary, { batter: 1, bowler: 0, balls: [], runs: 0, wickets: 0, ballsFaced: 0 }],
    superBall: { used: false, outcomes: null },
    result: r,
    events,
    meta: a.meta,
    // Not part of the contract: the toy verifier needs the leaves' positions to re-run the innings.
    ...({ fakeInputs: [a.inputs, []] } as object),
  } as MatchEventLog;
}

export const fakeEngine: SealedSixEngineApi = {
  ENGINE_VERSION,
  OVER_ENERGY_BUDGET: BUDGET,
  STARTER_VARIANTS: STARTER,
  energyCost: energy,
  validatePlan(plan, unlocked) {
    const errors: string[] = [];
    const all = [...plan.balls, plan.superBall];
    all.forEach((d, i) => {
      const label = i === 6 ? 'super ball' : `ball ${i + 1}`;
      if (!VARIANTS.includes(d.variant)) errors.push(`${label}: unknown delivery`);
      else if (!unlocked.includes(d.variant)) errors.push(`${label}: ${d.variant} is locked`);
      if (!lengthOk(d)) errors.push(`${label}: length does not fit ${d.variant}`);
      errors.push(...traceErrors(d.gesture, `${label} gesture`));
      const dur = releaseOf(d.gesture);
      if (dur < 40 || dur > 1500) errors.push(`${label} gesture: 40–1,500 ms`);
    });
    const total = plan.balls.reduce((n, d) => n + energy(d), 0);
    if (total > BUDGET) errors.push(`over uses ${total} energy, budget ${BUDGET}`);
    if (energy(plan.superBall) > SUPER_BALL_ALLOWANCE) errors.push('super ball over its allowance');
    const keys = all.map((d) => (d.gesture.samples.length >= 4 ? JSON.stringify(d.gesture.samples) : null)).filter(Boolean);
    if (new Set(keys).size !== keys.length) errors.push('identical gestures reused');
    if (all.filter((d) => Math.abs(releaseOf(d.gesture) - SWEET_SPOT_MS) <= 2).length >= 6) errors.push('robotic releases');
    return errors.length ? { ok: false, errors } : { ok: true, plan };
  },
  executionQuality(t) {
    const errors = traceErrors(t, 'gesture');
    if (errors.length) return { ok: false, errors };
    const q = quality(t);
    return { ok: true, quality: q, grade: grade(q) };
  },
  canonicalPlan: (plan) => stable(plan),
  commitHash: (plan, salt) => sha256Hex(stable(plan) + salt),
  revealDelivery: (plan, ball) => reveal(plan, ball),
  validateBattingInput(input, delivery) {
    const errors: string[] = [];
    if (input.ball !== delivery.ball) errors.push('input for another ball');
    const noZone = input.shot === 'defend' || input.shot === 'leave';
    if (noZone !== (input.zone === null)) errors.push('zone does not fit the shot');
    if (input.tapMs !== null && (input.tapMs < 0 || input.tapMs > delivery.timing.releaseToContactMs + 600)) errors.push('tap outside the window');
    errors.push(...traceErrors(input.trace, 'trace', input.shot === 'leave' ? 0 : 1));
    const duration = releaseOf(input.trace);
    if (input.clientElapsedMs < (input.tapMs ?? 0) || input.clientElapsedMs < duration) errors.push('elapsed time shorter than the tap');
    return errors.length ? { ok: false, errors } : { ok: true, input };
  },
  startInnings,
  resolveNextBall: (state, args) => resolveNextBall(state, args),
  summarise,
  buildMatchLog(a) {
    const s0 = summarise(a.innings[0], 0);
    const s1 = summarise(a.innings[1], 1);
    const events: MatchEvent[] = [];
    for (const i of [0, 1] as const) {
      const st = a.innings[i];
      events.push({ t: 'innings_start', innings: i, batter: i, field: a.plans[(1 - i) as 0 | 1].field });
      let runs = 0;
      let wickets = 0;
      st.outcomes.filter((o) => !o.dead).forEach((o, n) => {
        runs += o.runs;
        wickets += o.wicket ? 1 : 0;
        events.push({ t: 'ball', innings: i, ball: o.ball, outcome: o, score: { runs, wickets, ballsLeft: BALLS_PER_OVER - n - 1 } });
      });
      events.push({ t: 'innings_end', innings: i, runs: st.runs, wickets: st.wickets });
    }
    const tie = a.innings[0].runs === a.innings[1].runs;
    if (tie) events.push({ t: 'super_ball_start' });
    const r = result(a.innings[0], a.innings[1]);
    events.push({ t: 'result', result: r });
    const inputs = a.inputs.map((list) => list.filter((x): x is BattingInput => x !== null)) as [BattingInput[], BattingInput[]];
    return {
      schema: EVENT_SCHEMA_VERSION,
      engine: ENGINE_VERSION,
      matchId: a.matchId,
      kind: a.kind,
      seed: a.seed,
      conditions: a.conditions,
      players: a.players,
      commits: a.commits,
      plans: a.plans,
      inputs,
      innings: [s0, s1],
      superBall: { used: tie, outcomes: tie && a.innings[0].superBall && a.innings[1].superBall ? [a.innings[0].superBall, a.innings[1].superBall] : null },
      result: r,
      events,
      meta: a.meta,
      // Not part of the contract: the toy verifier needs the leaves' positions to re-run the innings.
      ...({ fakeInputs: a.inputs } as object),
    } as MatchEventLog;
  },
  async verifyMatchLog(log) {
    const errors: string[] = [];
    const daily = log.kind === 'daily';
    if (daily && (stable(log.plans[0]) !== stable(log.plans[1]) || log.inputs[1].length > 0)) errors.push('not a daily log');
    for (const i of daily ? ([1] as const) : ([0, 1] as const)) {
      const c = log.commits[i];
      if (!c.salt || (await sha256Hex(stable(log.plans[i]) + c.salt)) !== c.hash) errors.push(`commit ${i} does not match its plan`);
    }
    const replayInputs = (log as unknown as { fakeInputs?: [Array<BattingInput | null>, Array<BattingInput | null>] }).fakeInputs;
    if (replayInputs) {
      for (const i of daily ? ([0] as const) : ([0, 1] as const)) {
        let st = startInnings(i);
        for (const input of replayInputs[i]) st = resolveNextBall(st, { seed: log.seed, plan: log.plans[(1 - i) as 0 | 1], input }).state;
        if (st.runs !== log.innings[i].runs || st.wickets !== log.innings[i].wickets) errors.push(`innings ${i} does not replay`);
      }
    }
    return errors.length ? { ok: false, errors } : { ok: true };
  },
  autoOver: (seed) => autoOver(seed),
  autoBat(seed, delivery, _field) {
    const tap = delivery.timing.releaseToContactMs + ((fnv(seed) % 41) - 20);
    return { v: 1, ball: delivery.ball, shot: 'defend', zone: null, tapMs: tap, trace: { pointer: 'touch', samples: [[0, 0.5, 0.7], [tap, 0.5, 0.6]] }, clientElapsedMs: tap + 40 };
  },
  GHOSTS: [{ id: 'ghost-steady', nameKey: 'ghost.steady.name', styleKey: 'ghost.steady.style', difficulty: 1 }],
  ghostPlan: (_id, seed) => autoOver(seed),
  ghostBat(_id, seed, delivery) {
    return fakeEngine.autoBat(seed, delivery);
  },
  dailyChallenge: (day, serverSalt) => ({ conditions: { ...DAILY_CONDITIONS }, overs: dailyOvers(day, serverSalt) }),
  buildDailyLog: (a) => dailyLog(a),
  dailyScore: (s) => s.runs * 10 - s.wickets * 5,
  matchPerformance: () => ({ tacticalEfficiency: 0.5, clutch: 0.5, execution: 0.5 }),
};

// ---- builders for tests ---------------------------------------------------------------------------------------------

/** A legal over (distinct, human-looking gestures). `variant` changes every ball, e.g. to test locked deliveries. */
export function testPlan(seed = 1, overrides: Partial<Pick<DeliveryPlan, 'variant' | 'length'>> = {}): OverPlan {
  const plan = autoOver(`test-${seed}`);
  if (overrides.variant) plan.balls = plan.balls.map((b) => ({ ...b, variant: overrides.variant as DeliveryVariant, length: overrides.length ?? b.length })) as OverPlan['balls'];
  return plan;
}

/** A batting input that answers a revealed delivery with a drive timed `offsetMs` from the ideal contact. */
export function testShot(delivery: RevealedDelivery, offsetMs = 0, shot: BattingInput['shot'] = 'drive'): BattingInput {
  const tap = Math.max(0, delivery.timing.releaseToContactMs + offsetMs);
  const zone: FieldZone | null = shot === 'defend' || shot === 'leave' ? null : 'cover';
  return { v: 1, ball: delivery.ball, shot, zone, tapMs: shot === 'leave' ? null : tap, trace: { pointer: 'touch', samples: [[0, 0.5, 0.8], [Math.round(tap / 2), 0.45, 0.6], [tap, 0.4, 0.45]] }, clientElapsedMs: tap + 120 };
}
