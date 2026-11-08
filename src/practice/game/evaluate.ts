/**
 * Evaluation harness for the release gates (release/player-experience: FAIR6, EX5, EX6, EX7, EX9): play policies
 * against random overs, the reference over and every pitch through the real pipeline (flight → resolveDelivery), and
 * report runs, boundaries and dismissals. Node scripts use it (scripts/practice-properties.mjs); the app never imports
 * it (it is not exported from the game index).
 *
 * Everything is deterministic: deliveries come from seeded overs, and a policy's timing error is a seeded normal draw
 * (deterministic Box–Muller with vec.ts dlog/dcos), so the same arguments always give the same numbers.
 */
import type {
  AssistLevel,
  BallFlight,
  BowlerFamily,
  ContactKind,
  DeliveryResult,
  Difficulty,
  FieldLayout,
  Footwork,
  NormalizedSwing,
  PitchCondition,
  PracticeOverPlan,
} from '@/contracts/practice';
import { autoField, batTravelMs, flight, idealTimeFor, resolveDelivery } from '@/physics';
import { rngFromKey } from '@/engine/prng';
import { PI, dcos, dlog } from '@/physics/vec';
import { ballSeed, randomOver } from './overs';
import { PRACTICE_MAX_OVERS } from '@/contracts/practice';
import { simulate } from '@/physics/ball';
import { PITCHES, BOUNDARY_R, PITCH_HALF } from '@/physics/constants';
import { simulateFielding } from '@/physics/fielding';

/** One delivery to play: the over it belongs to, its flight and field. */
export interface EvalBall {
  over: PracticeOverPlan;
  overIndex: number;
  ballIndex: number;
  conditions: PitchCondition;
  seed: string;
  flight: BallFlight;
  field: FieldLayout;
}

/** A batting intent: an attacking or defensive swing, or null to leave the ball. */
export type Intent = { kind: 'attack' | 'defend'; directionDeg: number; elevation: number; power: number; footwork: Footwork } | null;

/** What a policy does with a ball: its intent and its timing error (ms, + late) against the ideal for its footwork. */
export type Policy = (ball: EvalBall) => { intent: Intent; errorMs: number };

export const PITCH_LIST: readonly PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];

/** The six balls of an over as EvalBalls (flights and the automatic field). */
export function overBalls(over: PracticeOverPlan, conditions: PitchCondition, overIndex = 0): EvalBall[] {
  const field = autoField(over.bowler, conditions, 'right', over.ball);
  return over.balls.map((plan, ballIndex) => {
    const seed = ballSeed(over, ballIndex);
    return { over, overIndex, ballIndex, conditions, seed, flight: flight({ plan, bowler: over.bowler, conditions, seed, ball: over.ball }), field };
  });
}

/** `n` random overs of a difficulty, cycling through the pitches (or the given ones). */
export function evalOvers(opts: { difficulty: Difficulty; overs: number; key: string; assist?: AssistLevel; conditions?: readonly PitchCondition[]; family?: BowlerFamily }): EvalBall[][] {
  const pitches = opts.conditions ?? PITCH_LIST;
  const out: EvalBall[][] = [];
  for (let i = 0; i < opts.overs; i++) {
    const conditions = pitches[i % pitches.length];
    const over = randomOver({ seed: `${opts.key}|${opts.difficulty}|${i}`, conditions, assist: opts.assist ?? 'play', difficulty: opts.difficulty, ...(opts.family ? { family: opts.family } : {}) });
    out.push(overBalls(over, conditions, i));
  }
  return out;
}

/** Independent, capped Practice innings. A pitch stays fixed within each innings, as it does in the app. */
export function evalInnings(opts: { difficulty: Difficulty; innings: number; key: string; assist?: AssistLevel }): EvalBall[][][] {
  return Array.from({ length: opts.innings }, (_, i) => evalOvers({
    difficulty: opts.difficulty,
    overs: PRACTICE_MAX_OVERS,
    key: `${opts.key}|innings|${i}`,
    assist: opts.assist,
    conditions: [PITCH_LIST[i % PITCH_LIST.length]],
  }));
}

/** A deterministic standard normal draw for a key (Box–Muller on two seeded uniforms). */
export function gaussian(key: string): number {
  const r = rngFromKey(`vande-eval-gauss|${key}`);
  const u1 = Math.max(1e-12, r.float());
  const u2 = r.float();
  return Math.sqrt(-2 * dlog(u1)) * dcos(2 * PI * u2);
}

/** The swing for an intent against a ball, `errorMs` off the ideal contact for the intent's footwork. */
export function swingOf(ball: EvalBall, intent: Intent, errorMs: number): NormalizedSwing | null {
  if (!intent) return null;
  const ideal = idealTimeFor(ball.flight, intent.footwork);
  return { kind: intent.kind, startT: ideal - batTravelMs(intent.kind, intent.power) / 1000 + errorMs / 1000, directionDeg: intent.directionDeg, power: intent.power, elevation: intent.elevation, footwork: intent.footwork };
}

/** Resolve one ball for an intent and timing error. */
export function playBall(ball: EvalBall, intent: Intent, errorMs: number, assist: AssistLevel): DeliveryResult {
  return resolveDelivery({ flight: ball.flight, swing: swingOf(ball, intent, errorMs), field: ball.field, bowler: ball.over.bowler, conditions: ball.conditions, handedness: 'right', assist, tierToleranceMs: 0 });
}

/** A fixed intent every ball, with a seeded timing error of σ ms (0 = perfect timing). */
export function fixedPolicy(intent: Intent, sigmaMs: number, key = 'fixed'): Policy {
  return (b) => ({ intent, errorMs: sigmaMs > 0 ? sigmaMs * gaussian(`${key}|${b.over.seed}|${b.ballIndex}`) : 0 });
}

export interface PolicyStats {
  overs: number;
  balls: number;
  runs: number;
  fours: number;
  sixes: number;
  dismissals: number;
  /** Overs in which the batter was out at least once (each ball is played regardless). */
  oversWithDismissal: number;
  runsPerOver: number;
  boundariesPerOver: number;
  dismissalsPerBall: number;
  dismissalRatePerOver: number;
  contacts: Partial<Record<ContactKind, number>>;
  dismissalKinds: Record<string, number>;
}

/** Play a policy through overs (every ball of every over, whatever happened before) and total the outcomes. */
export function playPolicy(overs: readonly EvalBall[][], policy: Policy, assist: AssistLevel, each?: (b: EvalBall, r: DeliveryResult, intent: Intent) => void): PolicyStats {
  const s: PolicyStats = { overs: overs.length, balls: 0, runs: 0, fours: 0, sixes: 0, dismissals: 0, oversWithDismissal: 0, runsPerOver: 0, boundariesPerOver: 0, dismissalsPerBall: 0, dismissalRatePerOver: 0, contacts: {}, dismissalKinds: {} };
  for (const over of overs) {
    let out = false;
    for (const b of over) {
      const p = policy(b);
      const r = playBall(b, p.intent, p.errorMs, assist);
      each?.(b, r, p.intent);
      s.balls++;
      s.runs += r.outcome.runs;
      if (r.outcome.boundary === 4) s.fours++;
      if (r.outcome.boundary === 6) s.sixes++;
      s.contacts[r.contact.kind] = (s.contacts[r.contact.kind] ?? 0) + 1;
      if (r.outcome.dismissal) {
        s.dismissals++;
        s.dismissalKinds[r.outcome.dismissal] = (s.dismissalKinds[r.outcome.dismissal] ?? 0) + 1;
        out = true;
      }
    }
    if (out) s.oversWithDismissal++;
  }
  const n = Math.max(1, s.overs);
  s.runsPerOver = s.runs / n;
  s.boundariesPerOver = (s.fours + s.sixes) / n;
  s.dismissalsPerBall = s.dismissals / Math.max(1, s.balls);
  s.dismissalRatePerOver = s.oversWithDismissal / n;
  return s;
}

interface InningsSample {
  runs: number;
  balls: number;
  dismissed: boolean;
  completed: boolean;
}

export interface InningsPolicyStats {
  innings: number;
  runs: number;
  balls: number;
  dismissals: number;
  completed: number;
  meanRuns: number;
  dismissalRate: number;
  samples: InningsSample[];
}

/** Stop at the first wicket or the real ten-over cap. This never extrapolates independent per-ball averages. */
export function playInnings(innings: readonly (readonly EvalBall[][])[], policy: Policy, assist: AssistLevel): InningsPolicyStats {
  const samples: InningsSample[] = [];
  for (const overs of innings) {
    const sample: InningsSample = { runs: 0, balls: 0, dismissed: false, completed: false };
    inningsLoop: for (const over of overs.slice(0, PRACTICE_MAX_OVERS)) {
      for (const ball of over.slice(0, 6)) {
        const choice = policy(ball);
        const result = playBall(ball, choice.intent, choice.errorMs, assist);
        sample.balls++;
        sample.runs += result.outcome.runs;
        if (result.outcome.dismissal) {
          sample.dismissed = true;
          break inningsLoop;
        }
      }
    }
    sample.completed = !sample.dismissed && sample.balls === PRACTICE_MAX_OVERS * 6;
    samples.push(sample);
  }
  const runs = samples.reduce((n, s) => n + s.runs, 0);
  const balls = samples.reduce((n, s) => n + s.balls, 0);
  const dismissals = samples.filter((s) => s.dismissed).length;
  return { innings: samples.length, runs, balls, dismissals, completed: samples.filter((s) => s.completed).length,
    meanRuns: runs / Math.max(1, samples.length), dismissalRate: dismissals / Math.max(1, samples.length), samples };
}

/** Owner-approved FAIR6 clauses, kept explicit so a high boundary count cannot hide a safe productive fixed input. */
export function fixedInputClauses(stats: readonly PolicyStats[]) {
  const productive = stats.filter((s) => s.runsPerOver >= 1);
  return {
    boundaryPass: stats.length > 0 && stats.every((s) => s.boundariesPerOver < 2),
    productiveDismissalPass: productive.every((s) => s.dismissalsPerBall >= 0.1),
    productiveInputs: productive.length,
    unsafeProductiveInputs: productive.filter((s) => s.dismissalsPerBall < 0.1).length,
  };
}

/**
 * Aerial field-placement mechanism, independent of ground-protection arcs. The launch grid is fixed before any
 * result is observed. For every flight with a descending, catch-height opportunity inside the rope, compare the
 * same ball and same fielder at that intercept versus opposite it across the ground centre. This is an isolated mechanism
 * test, not a population claim about eleven-player fields or a substitute for the grounded scoring experiment.
 */
export function evaluateAerialFielding() {
  let total = 0;
  let eligible = 0;
  let protectedCatches = 0;
  let gapCatches = 0;
  const excluded: Record<string, number> = {};
  const examples: Array<{ pitch: PitchCondition; bearing: number; speedKph: number; elevationDeg: number; protectedResult: string; gapResult: string }> = [];
  for (const pitch of PITCH_LIST) for (const bearing of [-135, -90, -45, 0, 45, 90, 135, 180])
    for (const speedKph of [70, 100, 130]) for (const elevationDeg of [30, 45, 60]) {
      total++;
      const angle = bearing * Math.PI / 180;
      const elevation = elevationDeg * Math.PI / 180;
      const speed = speedKph / 3.6;
      const from = { x: 0, y: 0.7, z: PITCH_HALF - 1.6 };
      const flight = simulate({ t: 0, p: from, v: { x: speed * Math.cos(elevation) * Math.sin(angle), y: speed * Math.sin(elevation), z: -speed * Math.cos(elevation) * Math.cos(angle) }, spin: { x: 0, y: 0, z: 0 } }, { pitch: PITCHES[pitch] });
      const firstGround = flight.bounces[0]?.t ?? Infinity;
      const opportunity = flight.samples.find((s) => s.t < firstGround && s.v.y < 0 && s.p.y >= 0.3 && s.p.y <= 2 && Math.hypot(s.p.x, s.p.z) < BOUNDARY_R - 1);
      if (!opportunity) {
        const reason = flight.boundary?.onFull ? 'clears_rope_before_descending_to_catch_height' : 'no_descending_catch_height_sample';
        excluded[reason] = (excluded[reason] ?? 0) + 1;
        continue;
      }
      eligible++;
      const post = { t0: 0, samples: flight.samples, bounces: flight.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: flight.boundary };
      const fielder = { id: 'aerial-probe', role: 'cover' as const, x: opportunity.p.x, z: opportunity.p.z };
      const opposite = { ...fielder, x: -fielder.x, z: -fielder.z };
      // Keep the return receivers in both arms, as required by the fielding pipeline. Only the test fielder moves.
      const receivers = [{ id: 'keeper', role: 'keeper' as const, x: 0, z: PITCH_HALF + 2 }, { id: 'bowler', role: 'bowler' as const, x: 0, z: -PITCH_HALF }];
      const protectedResult = simulateFielding({ id: 'aerial/protected', fielders: [fielder, ...receivers] }, post).play.kind;
      const gapResult = simulateFielding({ id: 'aerial/gap', fielders: [opposite, ...receivers] }, post).play.kind;
      if (protectedResult === 'caught') protectedCatches++;
      if (gapResult === 'caught') gapCatches++;
      if (examples.length < 12 || protectedResult !== 'caught' || gapResult === 'caught') examples.push({ pitch, bearing, speedKph, elevationDeg, protectedResult, gapResult });
    }
  const samplePass = eligible > 0 && protectedCatches > 0;
  const catchRiskPass = samplePass && gapCatches <= 0.5 * protectedCatches;
  return { method: 'fixed 288-launch grid; actual integrator; isolated identical fielder at descending intercept vs opposite ground centre; 4 pitches, 8 bearings, 3 speeds, 3 elevations', total, eligible, excluded, protectedCatches, gapCatches, samplePass, catchRiskPass, pass: samplePass && catchRiskPass, examples };
}

/** The fixed-input grid for exploit searches: every stroke family by direction, elevation, power and footwork. */
const GRID_DIRECTIONS = [-160, -135, -110, -90, -70, -50, -35, -15, 0, 15, 35, 50, 70, 95, 120, 150] as const;
// Include the actual UI's grounded value (0), as well as the earlier near-ground and aerial probes.
const GRID_ELEVATIONS = [0, 0.05, 0.4, 0.85] as const;
const GRID_POWERS = [0.4, 0.7, 1] as const;
const GRID_FOOTWORK: readonly Footwork[] = ['auto', 'forward', 'back'];

export function fixedInputGrid(): Intent[] {
  const out: Intent[] = [null];
  for (const footwork of GRID_FOOTWORK) for (const directionDeg of [-30, 0, 30]) out.push({ kind: 'defend', directionDeg, elevation: 0, power: 0.15, footwork });
  for (const footwork of GRID_FOOTWORK)
    for (const directionDeg of GRID_DIRECTIONS)
      for (const elevation of GRID_ELEVATIONS) for (const power of GRID_POWERS) out.push({ kind: 'attack', directionDeg, elevation, power, footwork });
  return out;
}

export function intentLabel(i: Intent): string {
  if (!i) return 'leave';
  return `${i.kind} ${i.directionDeg}° el ${i.elevation} pw ${i.power} ${i.footwork}`;
}
