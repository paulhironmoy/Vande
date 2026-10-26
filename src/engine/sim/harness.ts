/**
 * Balance and fairness simulation harness (not shipped: nothing in the app imports it). Used by
 * scripts/simulate-balance.mjs (100,000+ matches) and the CI smoke test (tests/unit/engine/balance-smoke.test.ts).
 *
 * Players are modelled as a batting strategy + timing skill and a bowling strategy + execution skill. Every match is
 * played through the public engine API exactly like a real one (reveal → input → validate → resolve → log), and every
 * ball is checked for impossible outcomes.
 */
import type {
  BallOutcome,
  BattingInput,
  Conditions,
  DeliveryTiming,
  DeliveryVariant,
  FieldSetting,
  FieldZone,
  InningsState,
  MatchEventLog,
  OverPlan,
  PlayerRef,
  RevealedDelivery,
  ShotType,
  TimingGrade,
} from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { rngFromKey, type Sfc32 } from '../prng';
import { engineV1 as engine } from '../v1';
import { deliveryTiming } from '../v1/delivery';
import { evaluate, type BallContext, type DeliveryCore } from '../v1/model';
import { energyCost } from '../v1/plan';
import { battingInputFor, fitBudget, fitSuperBall, naturalZone, readShot, releaseFor, type DeliverySpec } from '../v1/policies';
import {
  ALLOWED_LENGTHS,
  FIELD_SETTINGS,
  INTENSITIES,
  INTENTS,
  INTENT_BOUNDARY,
  INTENT_WICKET,
  LEGAL_ZONES,
  LINES,
  OVER_ENERGY_BUDGET,
  SHOTS,
  STARTER_VARIANTS,
  SUPER_BALL_ALLOWANCE,
  VARIANTS,
  type AttackShot,
} from '../v1/tables';
import { synthExecutionTrace } from '../v1/traces';
import { decideResult } from '../v1/match';

// ---------------------------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------------------------

export type SkillId = 'unskilled' | 'average' | 'skilled';
/**
 * Batting: timing spread (ms) and anchoring on the previous ball's flight time (a fraction of the difference, capped at
 * ANCHOR_CAP_MS): after a fast ball a batter tends to be early on a slow one.
 */
export const BAT_SKILLS: Record<SkillId, { sigma: number; anchor: number }> = {
  unskilled: { sigma: 95, anchor: 0.15 },
  average: { sigma: 55, anchor: 0.1 },
  skilled: { sigma: 30, anchor: 0.05 },
};
/** Bowling: release-meter spread (ms). */
export const BOWL_SKILLS: Record<SkillId, number> = { unskilled: 70, average: 35, skilled: 18 };
export const ANCHOR_CAP_MS = 40;
/** Timing bias (ms, negative = early) from expecting the previous ball's pace. */
export function anchorBias(anchor: number, flightMs: number, prevFlightMs: number): number {
  const b = -anchor * (flightMs - prevFlightMs);
  return b > ANCHOR_CAP_MS ? ANCHOR_CAP_MS : b < -ANCHOR_CAP_MS ? -ANCHOR_CAP_MS : b;
}

// ---------------------------------------------------------------------------------------------------------------
// Timing distribution (sim only: uses Math.exp, never consensus-critical)
// ---------------------------------------------------------------------------------------------------------------

function phi(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export const GRADES: readonly TimingGrade[] = ['perfect', 'good', 'early', 'late', 'very_early', 'very_late'];

/** Probability of each timing grade when the tap error is N(bias, sigma). */
export function timingDistribution(t: DeliveryTiming, sigma: number, bias: number): number[] {
  const c = (x: number) => phi((x - bias) / sigma);
  const p = t.perfectMs;
  const g = t.goodMs;
  const e = t.edgeMs;
  return [c(p) - c(-p), c(g) - c(p) + (c(-p) - c(-g)), c(-g) - c(-e), c(e) - c(g), c(-e), 1 - c(e)];
}

// ---------------------------------------------------------------------------------------------------------------
// Options and the oracle batter
// ---------------------------------------------------------------------------------------------------------------

export interface Option {
  shot: ShotType;
  zone: FieldZone | null;
}
export const OPTIONS: readonly Option[] = SHOTS.flatMap((shot): Option[] => (LEGAL_ZONES[shot].length === 0 ? [{ shot, zone: null }] : LEGAL_ZONES[shot].map((zone) => ({ shot, zone }))));

/**
 * What a batter knows when a ball is bowled. Runs and wickets are sealed until the reveal, so a batter never knows
 * the score or whether a wicket has fallen: only the field, the deliveries seen so far and how many balls are left.
 */
export interface BatView {
  delivery: RevealedDelivery;
  field: FieldSetting;
  conditions: Conditions;
  /** Including this ball. */
  ballsLeft: number;
  prev: RevealedDelivery | null;
  repeats: number;
  superBall: boolean;
}

function phaseOf(view: { conditions: Conditions; delivery: RevealedDelivery; superBall: boolean }): 'early' | 'mid' | 'last' {
  if (view.superBall || view.delivery.ball >= 5) return 'last';
  return view.conditions.pitch === 'green' && view.delivery.ball <= 2 ? 'early' : 'mid';
}

function ctxFor(ball: number, phase: 'early' | 'mid' | 'last', repeats: number, newBatter: boolean, prev: BallContext['prev'] = null): BallContext {
  const b = phase === 'early' ? Math.min(ball, 2) : phase === 'last' ? (ball === SUPER_BALL_INDEX ? SUPER_BALL_INDEX : 5) : Math.max(3, Math.min(ball, 4));
  return { ball: b, superBall: b === SUPER_BALL_INDEX, lastBall: phase === 'last', newBatter, prev, repeats };
}

/** Probability of a perfect, good and loose release for a bowler with release spread `sigma` ms. */
export function execProbs(sigma: number): [number, number, number] {
  const perfect = 2 * phi(24 / sigma) - 1;
  const good = 2 * phi(80 / sigma) - 1 - perfect;
  return [perfect, good, Math.max(0, 1 - perfect - good)];
}
const EXEC_GRADES = ['perfect', 'good', 'loose'] as const;
/** What a batter expects from a sealed intent: the average of the three intents' multipliers. */
const UNKNOWN_INTENT = {
  wicket: (INTENT_WICKET.attack + INTENT_WICKET.contain + INTENT_WICKET.setup) / 3,
  boundary: (INTENT_BOUNDARY.attack + INTENT_BOUNDARY.contain + INTENT_BOUNDARY.setup) / 3,
};

/**
 * Per option and timing grade: expected runs and wicket probability as the batter sees it — the intent is unknown
 * (averaged over attack/contain/setup) and the execution is unknown (an average bowler's release distribution).
 */
const tableCache = new Map<string, Float32Array>();
export function optionTable(d: DeliveryCore, field: FieldSetting, cond: Conditions, phase: 'early' | 'mid' | 'last', repeats: number, superBall: boolean): Float32Array {
  const key = `${d.variant}|${d.line}|${d.length}|${d.intensity}|${field}|${cond.pitch}|${cond.weather}|${phase}|${repeats}|${superBall ? 1 : 0}`;
  const hit = tableCache.get(key);
  if (hit) return hit;
  const out = new Float32Array(OPTIONS.length * GRADES.length * 2);
  const ex = execProbs(BOWL_SKILLS.average);
  const ctx = superBall ? { ...ctxFor(SUPER_BALL_INDEX, 'last', 0, false), superBall: true } : ctxFor(phase === 'early' ? 1 : phase === 'last' ? 5 : 3, phase, repeats, false);
  OPTIONS.forEach((o, i) => {
    const grades = o.shot === 'leave' ? (['no_shot'] as const) : GRADES;
    grades.forEach((grade, g) => {
      let er = 0;
      let pw = 0;
      EXEC_GRADES.forEach((eg, k) => {
        if (ex[k] < 0.01) return;
        const ev = evaluate({ d: { ...d, intent: 'contain' }, grade: eg, shot: o.shot, zone: o.zone, timing: grade, field, cond, ctx, intentMult: UNKNOWN_INTENT });
        er += ex[k] * ev.expectedRuns;
        pw += ex[k] * ev.pWicket;
      });
      if (o.shot === 'leave') {
        for (let gg = 0; gg < GRADES.length; gg++) {
          out[(i * GRADES.length + gg) * 2] = er;
          out[(i * GRADES.length + gg) * 2 + 1] = pw;
        }
      } else {
        out[(i * GRADES.length + g) * 2] = er;
        out[(i * GRADES.length + g) * 2 + 1] = pw;
      }
    });
  });
  if (tableCache.size > 60000) tableCache.clear();
  tableCache.set(key, out);
  return out;
}

/**
 * Runs a wicket is expected to cost from here, for a batter who cannot see the (sealed) wickets: the first wicket is
 * cheap, the second ends the innings, and the chance that one has already fallen grows ball by ball.
 */
export function lambdaFor(ball: number, ballsLeftAfter: number, superBall: boolean): number {
  if (superBall || ballsLeftAfter <= 0) return 0;
  const likelyOneDown = Math.min(0.6, 0.09 * ball);
  return (0.5 + 1.2 * likelyOneDown) * ballsLeftAfter;
}

export function bestOption(table: Float32Array, probs: number[], lambda: number, allowed?: (o: Option) => boolean): { index: number; value: number } {
  let best = -1;
  let bestV = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < OPTIONS.length; i++) {
    if (allowed && !allowed(OPTIONS[i])) continue;
    let v = 0;
    for (let g = 0; g < GRADES.length; g++) {
      const k = (i * GRADES.length + g) * 2;
      v += probs[g] * (table[k] - lambda * table[k + 1]);
    }
    if (v > bestV) {
      bestV = v;
      best = i;
    }
  }
  return { index: best, value: bestV };
}

function core(d: RevealedDelivery): DeliveryCore {
  return { variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: 'setup' };
}

// ---------------------------------------------------------------------------------------------------------------
// Batting strategies
// ---------------------------------------------------------------------------------------------------------------

export type BatStrategyId =
  | 'random'
  | 'heuristic'
  | 'oracle'
  | 'auto'
  | `ghost:${string}`
  | `fixed:${AttackShot}`;

export interface BatPolicy {
  strategy: BatStrategyId;
  skill: SkillId;
}

export function chooseShot(policy: BatPolicy, view: BatView, rng: Sfc32): Option {
  const d = view.delivery;
  switch (policy.strategy) {
    case 'random': {
      const shot = rng.pick(SHOTS);
      const zones = LEGAL_ZONES[shot];
      return { shot, zone: zones.length ? rng.pick(zones) : null };
    }
    case 'heuristic': {
      // A thinking human: reads the ball and the field; all-out on the last ball, careful with the last wicket.
      const aggression = view.superBall || view.ballsLeft === 1 ? 0.95 : 0.5;
      return readShot(d, aggression, rng, { field: view.field });
    }
    case 'oracle': {
      const skill = BAT_SKILLS[policy.skill];
      const table = optionTable(core(d), view.field, view.conditions, phaseOf(view), Math.min(view.repeats, 3), view.superBall);
      const bias = view.prev ? anchorBias(skill.anchor, d.timing.releaseToContactMs, view.prev.timing.releaseToContactMs) : 0;
      const probs = timingDistribution(d.timing, skill.sigma, bias);
      const o = OPTIONS[bestOption(table, probs, lambdaFor(d.ball, view.ballsLeft - 1, view.superBall)).index];
      return o;
    }
    default: {
      if (policy.strategy.startsWith('fixed:')) {
        const shot = policy.strategy.slice(6) as AttackShot;
        return { shot, zone: naturalZone(shot, d, [], view.field) };
      }
      throw new Error(`chooseShot: ${policy.strategy}`);
    }
  }
}

/** Tap time for a simulated human: N(ideal + anchoring bias, sigma). */
export function humanTap(policy: BatPolicy, view: BatView, rng: Sfc32): number {
  const skill = BAT_SKILLS[policy.skill];
  const d = view.delivery;
  const prevFlight = view.prev ? view.prev.timing.releaseToContactMs : 600;
  const bias = anchorBias(skill.anchor, d.timing.releaseToContactMs, prevFlight);
  return d.timing.releaseToContactMs + bias + rng.normal() * skill.sigma;
}

export function batInput(policy: BatPolicy, view: BatView, rng: Sfc32, seed: string): BattingInput {
  if (policy.strategy === 'auto') return engine.autoBat(seed, view.delivery, view.field);
  if (policy.strategy.startsWith('ghost:')) return engine.ghostBat(policy.strategy.slice(6), seed, view.delivery, view.field);
  const o = chooseShot(policy, view, rng);
  const tap = o.shot === 'leave' ? null : humanTap(policy, view, rng);
  return battingInputFor(rng, view.delivery, o.shot, o.zone, tap);
}

// ---------------------------------------------------------------------------------------------------------------
// Bowling strategies
// ---------------------------------------------------------------------------------------------------------------

export type BowlStrategyId =
  | 'random'
  | 'stock'
  | 'pace_barrage'
  | 'yorker_spam'
  | 'bouncer_spam'
  | 'swing_only'
  | 'spin_only'
  | 'slower_mix'
  | 'contain_all'
  | 'attack_all'
  | 'setup_combos'
  | 'starter_mix'
  | 'optimised'
  | 'optimised_starters'
  | 'auto'
  | `ghost:${string}`
  | `fixed_over:${string}`;

export interface BowlPolicy {
  strategy: BowlStrategyId;
  skill: SkillId;
  field?: FieldSetting;
}

const S = (variant: DeliveryVariant, line: DeliverySpec['line'], length: DeliverySpec['length'], intensity: DeliverySpec['intensity'], intent: DeliverySpec['intent']): DeliverySpec => ({
  variant,
  line,
  length,
  intensity,
  intent,
});

export interface OverSpec {
  field: FieldSetting;
  balls: DeliverySpec[];
  superBall: DeliverySpec;
}

export const ARCHETYPES: Record<string, OverSpec> = {
  stock: {
    field: 'balanced',
    balls: [S('good_length', 'off', 'good', 2, 'contain'), S('good_length', 'off', 'good', 2, 'contain'), S('good_length', 'middle', 'good', 2, 'contain'), S('good_length', 'off', 'good', 2, 'attack'), S('good_length', 'wide_off', 'good', 2, 'contain'), S('good_length', 'off', 'good', 2, 'attack')],
    superBall: S('good_length', 'off', 'good', 2, 'attack'),
  },
  pace_barrage: {
    field: 'sweeper',
    balls: [S('bouncer', 'middle', 'short', 3, 'attack'), S('yorker', 'middle', 'full', 3, 'attack'), S('bouncer', 'middle', 'short', 3, 'attack'), S('yorker', 'off', 'full', 3, 'attack'), S('bouncer', 'leg', 'short', 3, 'attack'), S('yorker', 'middle', 'full', 3, 'attack')],
    superBall: S('yorker', 'middle', 'full', 2, 'attack'),
  },
  yorker_spam: {
    field: 'balanced',
    balls: [0, 1, 2, 3, 4, 5].map((i) => S('yorker', i % 2 ? 'off' : 'middle', 'full', 2, 'attack')),
    superBall: S('yorker', 'middle', 'full', 2, 'attack'),
  },
  bouncer_spam: {
    field: 'sweeper',
    balls: [0, 1, 2, 3, 4, 5].map((i) => S('bouncer', i % 2 ? 'leg' : 'middle', 'short', 2, 'attack')),
    superBall: S('bouncer', 'middle', 'short', 2, 'attack'),
  },
  swing_only: {
    field: 'attacking',
    balls: [S('outswing', 'off', 'full', 2, 'setup'), S('inswing', 'middle', 'full', 2, 'attack'), S('outswing', 'off', 'good', 2, 'attack'), S('inswing', 'off', 'good', 2, 'contain'), S('outswing', 'off', 'full', 2, 'setup'), S('inswing', 'middle', 'full', 2, 'attack')],
    superBall: S('inswing', 'middle', 'full', 2, 'attack'),
  },
  spin_only: {
    field: 'balanced',
    balls: [S('offspin', 'off', 'good', 2, 'contain'), S('legspin', 'middle', 'good', 2, 'attack'), S('offspin', 'middle', 'good', 3, 'setup'), S('legspin', 'off', 'good', 1, 'attack'), S('offspin', 'middle', 'full', 1, 'attack'), S('legspin', 'middle', 'good', 2, 'attack')],
    superBall: S('offspin', 'middle', 'good', 3, 'attack'),
  },
  slower_mix: {
    field: 'balanced',
    balls: [S('good_length', 'off', 'good', 3, 'setup'), S('slower', 'off', 'good', 2, 'attack'), S('yorker', 'middle', 'full', 2, 'attack'), S('slower', 'middle', 'full', 2, 'attack'), S('good_length', 'off', 'good', 1, 'contain'), S('slower', 'off', 'good', 2, 'attack')],
    superBall: S('slower', 'middle', 'good', 2, 'attack'),
  },
  contain_all: {
    field: 'sweeper',
    balls: [S('good_length', 'off', 'good', 2, 'contain'), S('yorker', 'off', 'full', 2, 'contain'), S('good_length', 'wide_off', 'good', 2, 'contain'), S('bouncer', 'off', 'short', 2, 'contain'), S('offspin', 'off', 'good', 2, 'contain'), S('yorker', 'middle', 'full', 2, 'contain')],
    superBall: S('yorker', 'off', 'full', 2, 'contain'),
  },
  attack_all: {
    field: 'attacking',
    balls: [S('good_length', 'off', 'full', 2, 'attack'), S('yorker', 'middle', 'full', 2, 'attack'), S('good_length', 'off', 'good', 2, 'attack'), S('bouncer', 'middle', 'short', 2, 'attack'), S('offspin', 'middle', 'good', 2, 'attack'), S('yorker', 'middle', 'full', 2, 'attack')],
    superBall: S('yorker', 'middle', 'full', 2, 'attack'),
  },
  setup_combos: {
    field: 'balanced',
    balls: [S('bouncer', 'middle', 'short', 2, 'setup'), S('yorker', 'middle', 'full', 2, 'attack'), S('outswing', 'off', 'good', 2, 'setup'), S('inswing', 'middle', 'full', 2, 'attack'), S('slower', 'off', 'good', 1, 'setup'), S('yorker', 'off', 'full', 3, 'attack')],
    superBall: S('yorker', 'middle', 'full', 2, 'attack'),
  },
  starter_mix: {
    field: 'balanced',
    balls: [S('good_length', 'off', 'good', 2, 'contain'), S('bouncer', 'middle', 'short', 2, 'setup'), S('yorker', 'middle', 'full', 2, 'attack'), S('offspin', 'off', 'good', 2, 'contain'), S('good_length', 'wide_off', 'good', 2, 'attack'), S('yorker', 'off', 'full', 2, 'attack')],
    superBall: S('yorker', 'middle', 'full', 2, 'attack'),
  },
};

export function randomSpec(rng: Sfc32, variants: readonly DeliveryVariant[] = VARIANTS, allowance?: number): DeliverySpec {
  for (;;) {
    const variant = rng.pick(variants);
    const d: DeliverySpec = { variant, line: rng.pick(LINES), length: rng.pick(ALLOWED_LENGTHS[variant]), intensity: rng.pick(INTENSITIES), intent: rng.pick(INTENTS) };
    if (allowance === undefined || energyCost(d) <= allowance) return d;
  }
}

export function randomOverSpec(rng: Sfc32, variants: readonly DeliveryVariant[] = VARIANTS): OverSpec {
  return {
    field: rng.pick(FIELD_SETTINGS),
    balls: fitBudget([0, 1, 2, 3, 4, 5].map(() => randomSpec(rng, variants))),
    superBall: randomSpec(rng, variants, SUPER_BALL_ALLOWANCE),
  };
}

export function specToPlan(rng: Sfc32, spec: OverSpec, sigma: number): OverPlan {
  const balls = fitBudget(spec.balls);
  const sb = fitSuperBall(spec.superBall);
  const g = (d: DeliverySpec) => ({ ...d, gesture: synthExecutionTrace(rng, releaseFor(rng, sigma)) });
  return { v: 1, field: spec.field, balls: balls.map(g) as OverPlan['balls'], superBall: g(sb) };
}

// ---------------------------------------------------------------------------------------------------------------
// Analytic over value and the optimiser (finds the strongest over for given conditions)
// ---------------------------------------------------------------------------------------------------------------

export const REFERENCE_BATTER = { sigma: BAT_SKILLS.average.sigma, lambda: 1.2 };

/**
 * Expected batting value conceded by an over against an oracle batter of average skill (lower is better for the
 * bowler): the batter picks the best option for what it can see; the value is then taken under the over's true
 * intents, sequencing and the bowler's execution distribution.
 */
export function overValue(spec: OverSpec, cond: Conditions, sigma = REFERENCE_BATTER.sigma, bowlSigma = BOWL_SKILLS.average): number {
  const ex = execProbs(bowlSigma);
  let total = 0;
  let prev: BallContext['prev'] = null;
  spec.balls.forEach((d, k) => {
    let repeats = 0;
    for (let j = 0; j < k; j++) if (spec.balls[j].variant === d.variant && spec.balls[j].length === d.length && spec.balls[j].line === d.line) repeats++;
    repeats = Math.min(repeats, 3);
    const phase: 'early' | 'mid' | 'last' = k >= 5 ? 'last' : cond.pitch === 'green' && k <= 2 ? 'early' : 'mid';
    const table = optionTable(d, spec.field, cond, phase, repeats, false);
    const timing = deliveryTiming(d, cond);
    const prevFlight = k > 0 ? deliveryTiming(spec.balls[k - 1], cond).releaseToContactMs : 600;
    const probs = timingDistribution(timing, sigma, anchorBias(BAT_SKILLS.average.anchor, timing.releaseToContactMs, prevFlight));
    const lambda = k >= 5 ? 0 : REFERENCE_BATTER.lambda;
    const choice = OPTIONS[bestOption(table, probs, lambda).index];
    let v = 0;
    EXEC_GRADES.forEach((eg, x) => {
      if (ex[x] < 1e-6) return;
      // The previous ball's execution matters for its setup; use the likeliest grade for it.
      const ctx: BallContext = { ball: k, superBall: false, lastBall: k >= 5, newBatter: k === 0, prev, repeats };
      if (choice.shot === 'leave') {
        const ev = evaluate({ d, grade: eg, shot: 'leave', zone: null, timing: 'no_shot', field: spec.field, cond, ctx });
        v += ex[x] * (ev.expectedRuns - lambda * ev.pWicket);
      } else
        GRADES.forEach((grade, g) => {
          if (probs[g] < 1e-4) return;
          const ev = evaluate({ d, grade: eg, shot: choice.shot, zone: choice.zone, timing: grade, field: spec.field, cond, ctx });
          v += ex[x] * probs[g] * (ev.expectedRuns - lambda * ev.pWicket);
        });
    });
    total += v;
    prev = { variant: d.variant, line: d.line, length: d.length, intensity: d.intensity, intent: d.intent, grade: ex[0] >= ex[1] ? 'perfect' : 'good' };
  });
  return total;
}

function mutate(rng: Sfc32, spec: OverSpec, variants: readonly DeliveryVariant[]): OverSpec {
  const balls = spec.balls.map((b) => ({ ...b }));
  const r = rng.float();
  const i = rng.int(0, 5);
  if (r < 0.15) {
    const j = rng.int(0, 5);
    const t = balls[i];
    balls[i] = balls[j];
    balls[j] = t;
  } else if (r < 0.45) balls[i] = randomSpec(rng, variants);
  else if (r < 0.6) balls[i].line = rng.pick(LINES);
  else if (r < 0.72) balls[i].length = rng.pick(ALLOWED_LENGTHS[balls[i].variant]);
  else if (r < 0.86) balls[i].intensity = rng.pick(INTENSITIES);
  else balls[i].intent = rng.pick(INTENTS);
  return { ...spec, balls };
}

const legal = (balls: DeliverySpec[]) => balls.reduce((s, b) => s + energyCost(b), 0) <= OVER_ENERGY_BUDGET;

/** Hill-climbing search for the over that concedes the least value; deterministic for a given key. */
/**
 * Simulated-annealing search for the over that concedes the least value; deterministic for a given key. The first
 * restart begins from the best hand-made archetype that only uses allowed variants, the others from random overs.
 */
export function optimiseOver(cond: Conditions, field: FieldSetting, variants: readonly DeliveryVariant[], key: string, iterations = 1200, restarts = 4): { spec: OverSpec; value: number } {
  const rng = rngFromKey(`sim/optimise|${key}|${cond.pitch}|${cond.weather}|${field}|${variants.join(',')}`);
  const allowedArchetypes = Object.values(ARCHETYPES).filter((a) => a.balls.every((b) => variants.includes(b.variant)));
  let best: OverSpec | null = null;
  let bestV = Number.POSITIVE_INFINITY;
  for (let r = 0; r < restarts; r++) {
    let cur: OverSpec;
    if (r === 0 && allowedArchetypes.length) {
      let seedSpec = allowedArchetypes[0];
      let seedV = Number.POSITIVE_INFINITY;
      for (const a of allowedArchetypes) {
        const v = overValue({ ...a, field, balls: fitBudget(a.balls) }, cond);
        if (v < seedV) {
          seedV = v;
          seedSpec = a;
        }
      }
      cur = { ...seedSpec, field, balls: fitBudget(seedSpec.balls) };
    } else cur = { field, balls: fitBudget([0, 1, 2, 3, 4, 5].map(() => randomSpec(rng, variants))), superBall: S('yorker', 'middle', 'full', 2, 'attack') };
    let curV = overValue(cur, cond);
    for (let it = 0; it < iterations; it++) {
      const next = mutate(rng, cur, variants);
      next.balls = fitBudget(next.balls);
      if (!legal(next.balls)) continue;
      const v = overValue(next, cond);
      const temperature = 0.4 * (1 - it / iterations) + 0.005;
      if (v < curV || rng.float() < Math.exp(-(v - curV) / temperature)) {
        cur = next;
        curV = v;
      }
      if (curV < bestV) {
        bestV = curV;
        best = cur;
      }
    }
  }
  return { spec: best as OverSpec, value: bestV };
}

const optimisedCache = new Map<string, OverSpec>();
export function importOptimised(entries: Array<[string, OverSpec]>): void {
  for (const [k, v] of entries) optimisedCache.set(k, v);
}
/** Best over (and field) for the conditions; `starters` restricts to the starter variants (unlock fairness test). */
export function optimisedSpec(cond: Conditions, starters: boolean, iterations = 1200): OverSpec {
  const key = `${cond.pitch}|${cond.weather}|${starters}|${iterations}`;
  const hit = optimisedCache.get(key);
  if (hit) return hit;
  let best: { spec: OverSpec; value: number } | null = null;
  for (const field of FIELD_SETTINGS) {
    const r = optimiseOver(cond, field, starters ? STARTER_VARIANTS : VARIANTS, 'main', iterations);
    if (!best || r.value < best.value) best = r;
  }
  const spec = { ...(best as { spec: OverSpec }).spec, superBall: bestSuperBall(cond, (best as { spec: OverSpec }).spec.field, starters ? STARTER_VARIANTS : VARIANTS) };
  optimisedCache.set(key, spec);
  return spec;
}

/** Best Super Ball within the allowance (the batter goes all out: no wicket cost). */
export function bestSuperBall(cond: Conditions, field: FieldSetting, variants: readonly DeliveryVariant[]): DeliverySpec {
  let best: DeliverySpec | null = null;
  let bestV = Number.POSITIVE_INFINITY;
  for (const variant of variants)
    for (const length of ALLOWED_LENGTHS[variant])
      for (const line of LINES)
        for (const intensity of INTENSITIES)
          for (const intent of INTENTS) {
            const d: DeliverySpec = { variant, line, length, intensity, intent };
            if (energyCost(d) > SUPER_BALL_ALLOWANCE) continue;
            const table = optionTable(d, field, cond, 'last', 0, true);
            const probs = timingDistribution(deliveryTiming(d, cond), REFERENCE_BATTER.sigma, 0);
            const choice = OPTIONS[bestOption(table, probs, 0).index];
            const ctx: BallContext = { ball: SUPER_BALL_INDEX, superBall: true, lastBall: true, newBatter: false, prev: null, repeats: 0 };
            let v = 0;
            GRADES.forEach((grade, g) => {
              const ev = evaluate({ d, grade: 'good', shot: choice.shot, zone: choice.zone, timing: choice.shot === 'leave' ? 'no_shot' : grade, field, cond, ctx });
              v += probs[g] * ev.expectedRuns;
            });
            if (v < bestV) {
              bestV = v;
              best = d;
            }
          }
  return best as DeliverySpec;
}

export function bowlPlan(policy: BowlPolicy, cond: Conditions, rng: Sfc32, seed: string): OverPlan {
  const sigma = BOWL_SKILLS[policy.skill];
  const s = policy.strategy;
  if (s === 'auto') return engine.autoOver(seed, cond);
  if (s.startsWith('ghost:')) return engine.ghostPlan(s.slice(6), seed, cond);
  if (s === 'random') return specToPlan(rng, randomOverSpec(rng), sigma);
  if (s === 'optimised' || s === 'optimised_starters') return specToPlan(rng, optimisedSpec(cond, s === 'optimised_starters'), sigma);
  if (s.startsWith('fixed_over:')) {
    const [pitch, starters] = s.slice(11).split('|');
    return specToPlan(rng, optimisedSpec({ pitch: pitch as Conditions['pitch'], weather: 'clear' }, starters === 'starters'), sigma);
  }
  const spec = ARCHETYPES[s];
  if (!spec) throw new Error(`bowlPlan: ${s}`);
  return specToPlan(rng, policy.field ? { ...spec, field: policy.field } : spec, sigma);
}

// ---------------------------------------------------------------------------------------------------------------
// Matches
// ---------------------------------------------------------------------------------------------------------------

export interface SimPlayer {
  bat: BatPolicy;
  bowl: BowlPolicy;
}

const PLAYERS: [PlayerRef, PlayerRef] = [0, 1].map((i) => ({
  id: `sim${i}`,
  alias: `Sim ${i}`,
  avatar: { seed: `sim${i}` },
  kit: { id: 'kit', primary: '#123', secondary: '#abc', pattern: 'plain' as const },
  kind: 'ghost' as const,
})) as [PlayerRef, PlayerRef];

const VALID_RUNS = new Set([0, 1, 2, 3, 4, 6]);

/** Impossible-outcome checks for one ball. */
export function checkOutcome(o: BallOutcome, d: RevealedDelivery): string[] {
  const errs: string[] = [];
  if (!VALID_RUNS.has(o.runs)) errs.push(`runs ${o.runs}`);
  if (o.wicket && o.runs !== 0) errs.push('runs on a wicket');
  if (o.timing === 'interrupted' && o.wicket) errs.push('unanswered ball took a wicket');
  if (o.shot === 'leave' && d.line === 'wide_off' && o.wicket) errs.push('wide leave out');
  if (o.shot === 'leave' && o.runs !== 0) errs.push('runs off a leave');
  if (o.contact === 'none' && o.runs !== 0) errs.push('runs without contact');
  if ((o.contact === 'miss' || o.contact === 'pad') && o.runs !== 0) errs.push('runs off a miss');
  if (o.wicket === 'lbw' && d.line === 'wide_off') errs.push('lbw outside off');
  if (o.wicket === 'stumped' && d.family !== 'spin') errs.push('stumped off pace');
  if (o.cues.fate.kind === 'six' && o.runs !== 6) errs.push('fate mismatch six');
  if (o.cues.fate.kind === 'four' && o.runs !== 4) errs.push('fate mismatch four');
  if (o.cues.fate.kind === 'wicket' && !o.wicket) errs.push('fate mismatch wicket');
  if ((o.runs === 4 || o.runs === 6) && o.fielder) errs.push('boundary with a fielder');
  if (o.runs === 6 && o.contact !== 'middle') errs.push('six off an edge');
  for (const k of ['matchup', 'timing', 'execution', 'pitch', 'field', 'setup'] as const) {
    const v = o.factors[k];
    if (!(v >= -1 && v <= 1)) errs.push(`factor ${k} ${v}`);
  }
  if (!(o.factors.risk >= 0 && o.factors.risk <= 1)) errs.push(`risk ${o.factors.risk}`);
  if (!(o.execution >= 0 && o.execution <= 1)) errs.push(`execution ${o.execution}`);
  if (!o.factors.explainKey.startsWith('explain.')) errs.push('explainKey');
  if (!(o.cues.crowd >= 0 && o.cues.crowd <= 1)) errs.push('crowd');
  if (!o.cues.cameras.length) errs.push('no cameras');
  let t = 0;
  for (const c of o.cues.cameras) {
    if (c.atMs < t - 1e-9 || c.durationMs <= 0) errs.push('camera order');
    t = c.atMs + c.durationMs;
  }
  return errs;
}

export interface MatchRecord {
  seed: string;
  conditions: Conditions;
  runs: [number, number];
  wickets: [number, number];
  superRuns: [number, number];
  result: MatchEventLog['result'];
  outcomes: [BallOutcome[], BallOutcome[]];
  fields: [FieldSetting, FieldSetting];
  plans: [OverPlan, OverPlan];
  inputs: [Array<BattingInput | null>, Array<BattingInput | null>];
  states: [InningsState, InningsState];
  log?: MatchEventLog;
  anomalies: string[];
}

export interface PlayOptions {
  /** Build the full event log (and keep it on the record). */
  buildLog?: boolean;
}

export interface InningsRecord {
  state: InningsState;
  inputs: Array<BattingInput | null>;
  anomalies: string[];
}

/** Plays one batting innings (six balls or two wickets, then the Super Ball) against a sealed plan. */
export function playInnings(bat: BatPolicy, plan: OverPlan, innings: 0 | 1, cond: Conditions, seed: string, rng: Sfc32): InningsRecord {
  const anomalies: string[] = [];
  const inputs: Array<BattingInput | null> = [];
  let state = engine.startInnings(innings);
  let prev: RevealedDelivery | null = null;
  const seen: string[] = [];
  while (!state.done) {
    const ball = state.mainDone ? SUPER_BALL_INDEX : state.nextBall;
    const delivery = engine.revealDelivery(plan, ball, cond);
    const superBall = ball === SUPER_BALL_INDEX;
    const key = `${delivery.variant}|${delivery.length}|${delivery.line}`;
    let repeats = 0;
    for (const k of seen) if (k === key) repeats++;
    if (!superBall) seen.push(key);
    const view: BatView = {
      delivery,
      field: plan.field,
      conditions: cond,
      ballsLeft: superBall ? 1 : 6 - ball,
      prev,
      repeats: superBall ? 0 : Math.min(3, repeats),
      superBall,
    };
    const input = batInput(bat, view, rng, `${seed}/bat${innings}`);
    const valid = engine.validateBattingInput(input, delivery);
    if (!valid.ok) anomalies.push(`input invalid (${bat.strategy}) ball ${ball}: ${valid.errors.join(',')}`);
    inputs[ball] = input;
    const r = engine.resolveNextBall(state, { seed, conditions: cond, plan, input });
    if (r.outcome.ball !== ball) anomalies.push(`ball ${innings}.${ball}: resolved ball ${r.outcome.ball}`);
    if (r.outcome.dead && (r.outcome.runs !== 0 || r.outcome.wicket)) anomalies.push(`ball ${innings}.${ball}: dead ball scored`);
    if (r.outcome.dead !== undefined && state.wickets < 2) anomalies.push(`ball ${innings}.${ball}: dead ball before the second wicket`);
    if (!r.outcome.dead && !superBall && state.wickets >= 2) anomalies.push(`ball ${innings}.${ball}: live ball after the second wicket`);
    for (const e of checkOutcome(r.outcome, delivery)) anomalies.push(`ball ${innings}.${ball}: ${e}`);
    state = r.state;
    if (!superBall) prev = delivery;
  }
  if (state.outcomes.length !== 6 || !state.superBall) anomalies.push(`innings ${innings} did not face six balls and the Super Ball`);
  if (state.wickets > 2) anomalies.push(`innings ${innings} more than two wickets`);
  if (state.runs > 36) anomalies.push(`innings ${innings} more than 36 runs`);
  return { state, inputs, anomalies };
}

export function playMatch(players: [SimPlayer, SimPlayer], cond: Conditions, seed: string, opts: PlayOptions = {}): MatchRecord {
  const rng = rngFromKey(`sim/match|${seed}`);
  const plans: [OverPlan, OverPlan] = [bowlPlan(players[0].bowl, cond, rng, `${seed}/p0`), bowlPlan(players[1].bowl, cond, rng, `${seed}/p1`)];
  const anomalies: string[] = [];
  for (const p of [0, 1] as const) {
    const v = engine.validatePlan(plans[p], VARIANTS);
    if (!v.ok) anomalies.push(`plan ${p} invalid: ${v.errors.join(',')}`);
  }
  const i0 = playInnings(players[0].bat, plans[1], 0, cond, seed, rng);
  const i1 = playInnings(players[1].bat, plans[0], 1, cond, seed, rng);
  anomalies.push(...i0.anomalies, ...i1.anomalies);
  const states: [InningsState, InningsState] = [i0.state, i1.state];
  const s0 = states[0].superBall as BallOutcome;
  const s1 = states[1].superBall as BallOutcome;
  let result: MatchEventLog['result'];
  let log: MatchEventLog | undefined;
  if (opts.buildLog) {
    const commits = [0, 1].map((p) => ({ player: p as 0 | 1, hash: '', sig: 'sim', keyId: 'sim', lockedHour: '2026-10-25T00', salt: `salt${p}` })) as MatchEventLog['commits'];
    log = engine.buildMatchLog({
      matchId: `sim-${seed}`,
      kind: 'ghost',
      seed,
      conditions: cond,
      players: PLAYERS,
      commits,
      plans,
      inputs: [i0.inputs, i1.inputs],
      innings: states,
      meta: { createdHour: '2026-10-25T00', revealedHour: '2026-10-25T01' },
    });
    result = log.result;
  } else {
    const base = decideResult([engine.summarise(states[0], 0), engine.summarise(states[1], 1)], [s0, s1]);
    result = { ...base, playerOfMatch: 0, turningPointEvent: 0 };
  }
  return {
    seed,
    conditions: cond,
    runs: [states[0].runs, states[1].runs],
    wickets: [states[0].wickets, states[1].wickets],
    superRuns: [s0.runs, s1.runs],
    result,
    outcomes: [states[0].outcomes.filter((o) => !o.dead), states[1].outcomes.filter((o) => !o.dead)],
    fields: [plans[1].field, plans[0].field],
    plans,
    inputs: [i0.inputs, i1.inputs],
    states,
    log,
    anomalies,
  };
}

export function hexSeed(rng: Sfc32): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += rng.nextU32().toString(16).padStart(8, '0');
  return s;
}
