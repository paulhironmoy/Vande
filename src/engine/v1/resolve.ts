/**
 * Resolving one ball (engine v1): validated input → timing grade → outcome distribution → seeded draw → BallOutcome
 * with factors, an explanation key and presentation cues. The draw comes from sfc32 seeded by
 * SHA-256(`vande/v1/ball|seed|innings|ball`); five floats are always drawn in the same order (outcome, two for the executed path, six distance, camera variety).
 */
import type { BallOutcome, BattingInput, Conditions, ExecutionGrade, FieldSetting, OverPlan, ShotType, TimingGrade } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { rngFromKey } from '../prng';
import { isLegalZone, timingGrade } from './batting';
import { buildCues } from './cues';
import { deliveryPath, deliveryTiming, executedPath, planDelivery } from './delivery';
import { evaluate, pickAtom, type Atom, type BallContext, type DeliveryCore, type Evaluation, type ModelInput, type PrevBall } from './model';
import {
  K_ADVANTAGE,
  K_MATCHUP_MIDDLE,
  MID_BASE,
  NEW_BATTER_A,
  PITCH_VAR,
  POWER_ADVANTAGE,
  POWER_MATCHUP,
  POWER_TIMING,
  SHOTS,
  TIMING_POWER,
  VARIANTS,
  W_EXECUTION,
  W_PITCH,
  W_SETUP,
  WEATHER_VAR,
} from './tables';
import { executionQuality } from './traces';

export const EXPLAIN_KEYS: readonly string[] = [
  ...VARIANTS.flatMap((v) => SHOTS.filter((s) => s !== 'leave').map((s) => `explain.${v}_vs_${s}`)),
  'explain.timing_perfect',
  'explain.timing_good',
  'explain.timing_early',
  'explain.timing_late',
  'explain.timing_very_early',
  'explain.timing_very_late',
  'explain.no_shot',
  'explain.loose_ball',
  'explain.pinpoint',
  'explain.pitch_green',
  'explain.pitch_hard',
  'explain.pitch_slow',
  'explain.weather_humid',
  'explain.weather_dew',
  'explain.field_gap',
  'explain.field_ring',
  'explain.field_deep',
  'explain.field_packed',
  'explain.field_slips',
  'explain.field_close',
  'explain.setup_worked',
  'explain.repeat_lined_up',
  'explain.new_batter',
  'explain.against_the_line',
  'explain.leave_safe',
  'explain.leave_survived',
  'explain.leave_straight',
  'explain.unanswered',
  'explain.last_ball_scramble',
  'explain.run_out_risk',
  'explain.stumped_charge',
  'explain.dead_ball',
];

/** How good the result was for the batter (-1 wicket … +1 six). */
function goodness(a: Atom): number {
  if (a.wicket) return -1;
  if (a.kind === 'six') return 1;
  if (a.kind === 'four') return 0.8;
  if (a.runs >= 2) return 0.4;
  if (a.runs === 1) return 0.1;
  return a.kind === 'dot_block' ? -0.1 : -0.3;
}

/**
 * The one-line tactical explanation: the factor that pushed this result hardest in its direction. Contributions are
 * weighted by how much each factor moves the chance of middling the ball plus the power of the shot; a perfect release
 * is the most common grade, so it only explains a result when it clearly dominated. Some results explain themselves
 * (a catch in the deep, a slip catch, a stumping, a run out, a leave).
 */
export function explainKeyFor(inp: ModelInput, ev: Evaluation, atom: Atom): string {
  const { d, shot, timing, cond, ctx, field } = inp;
  if (timing === 'interrupted') return 'explain.unanswered';
  if (shot === 'leave') return atom.wicket ? 'explain.leave_straight' : ev.pWicket > 0 ? 'explain.leave_survived' : 'explain.leave_safe';
  if (timing === 'no_shot') return 'explain.no_shot';
  if (atom.wicket === 'run_out') return atom.tag === 'scramble' ? 'explain.last_ball_scramble' : 'explain.run_out_risk';
  if (atom.wicket === 'stumped') return 'explain.stumped_charge';
  if (atom.wicket === 'caught' && (atom.tag === 'deep' || atom.tag === 'both')) return 'explain.field_deep';
  if (atom.wicket === 'caught' && atom.tag === 'slips' && field === 'attacking') return 'explain.field_slips';
  if (atom.wicket === 'caught' && atom.tag === 'close') return 'explain.field_close';
  const f = ev.factors;
  // A defended dot is the batter's choice working as intended: explain it by the matchup.
  if (shot === 'defend' && atom.kind === 'dot_block') return `explain.${d.variant}_vs_defend`;
  const both = K_ADVANTAGE + POWER_ADVANTAGE;
  const timingDelta = MID_BASE[timing] - MID_BASE.good + POWER_TIMING * (TIMING_POWER[timing] - TIMING_POWER.good);
  const contributions: Array<[string, number]> = [
    ['matchup', (K_MATCHUP_MIDDLE + POWER_MATCHUP) * f.matchup],
    ['timing', timingDelta],
    ['execution', both * W_EXECUTION * f.execution * (inp.grade === 'perfect' ? 0.5 : 1)],
    ['pitch', both * W_PITCH * f.pitch],
    ['field', 0.4 * f.field * (atom.kind === 'dot_fielded' || atom.kind === 'four' || atom.kind === 'runs' ? 1.5 : 1)],
    ['setup', both * W_SETUP * f.setup],
    ['new_batter', ctx.newBatter ? both * NEW_BATTER_A : 0],
  ];
  const g = goodness(atom);
  let best: [string, number] | null = null;
  for (const c of contributions) {
    const aligned = g >= 0 ? c[1] > 0 : c[1] < 0;
    if (!aligned) continue;
    if (!best || Math.abs(c[1]) > Math.abs(best[1])) best = c;
  }
  if (!best) for (const c of contributions) if (!best || Math.abs(c[1]) > Math.abs(best[1])) best = c;
  const which = best ? best[0] : 'matchup';
  switch (which) {
    case 'timing':
      return `explain.timing_${timing}`;
    case 'execution':
      return f.execution > 0 ? 'explain.loose_ball' : 'explain.pinpoint';
    case 'pitch': {
      const w = WEATHER_VAR[cond.weather][d.variant] ?? 0;
      const pv = PITCH_VAR[cond.pitch][d.variant];
      return cond.weather !== 'clear' && Math.abs(w) > Math.abs(pv) ? `explain.weather_${cond.weather}` : `explain.pitch_${cond.pitch}`;
    }
    case 'field':
      if (atom.tag === 'slips') return 'explain.field_slips';
      if (atom.tag === 'close') return 'explain.field_close';
      if (shot === 'defend') return f.field < 0 ? 'explain.field_close' : 'explain.field_gap';
      return f.field >= 0.5 ? 'explain.field_gap' : f.field <= -0.55 ? 'explain.field_packed' : f.field < 0 && shot === 'loft' ? 'explain.field_deep' : f.field < 0 ? 'explain.field_ring' : 'explain.field_deep';
    case 'setup':
      return f.setup < 0 ? 'explain.setup_worked' : 'explain.repeat_lined_up';
    case 'new_batter':
      return 'explain.new_batter';
    default:
      if (!ev.natural && f.matchup < 0 && g < 0) return 'explain.against_the_line';
      return `explain.${d.variant}_vs_${shot}`;
  }
}

export interface ResolveBallArgs {
  seed: string;
  conditions: Conditions;
  plan: OverPlan;
  input: BattingInput | null;
  innings: 0 | 1;
  ball: number;
  /** Main-innings outcomes so far (for setup, repetition and the new-batter rule). */
  previous: readonly BallOutcome[];
}

export function contextFor(ball: number, previous: readonly BallOutcome[], d: DeliveryCore): BallContext {
  const superBall = ball === SUPER_BALL_INDEX;
  const last = previous.length ? previous[previous.length - 1] : null;
  // How many times the batter has already seen this exact delivery (same variant, length and line) in this over.
  let repeats = 0;
  if (!superBall) for (const o of previous) if (o.delivery.variant === d.variant && o.delivery.length === d.length && o.delivery.line === d.line) repeats++;
  const prev: PrevBall | null =
    !superBall && last
      ? { variant: last.delivery.variant, line: last.delivery.line, length: last.delivery.length, intensity: last.delivery.intensity, intent: last.delivery.intent, grade: last.executionGrade }
      : null;
  return {
    ball,
    superBall,
    lastBall: superBall || ball === 5,
    newBatter: !superBall && (ball === 0 || (last !== null && last.wicket !== null)),
    prev,
    repeats,
  };
}

/** Execution quality of a sealed delivery (an implausible trace counts as a loose ball). */
export function deliveryExecution(gesture: OverPlan['balls'][number]['gesture']): { quality: number; grade: ExecutionGrade } {
  const ex = executionQuality(gesture);
  return ex.ok ? { quality: ex.quality, grade: ex.grade } : { quality: 0, grade: 'loose' };
}

export function modelInputFor(
  d: DeliveryCore,
  grade: ExecutionGrade,
  shot: ShotType,
  zone: BattingInput['zone'],
  timing: TimingGrade,
  field: FieldSetting,
  conditions: Conditions,
  ctx: BallContext,
): ModelInput {
  return { d, grade, shot, zone, timing, field, cond: conditions, ctx };
}

export function resolveBall(a: ResolveBallArgs): BallOutcome {
  const planned = planDelivery(a.plan, a.ball);
  const d: DeliveryCore = { variant: planned.variant, line: planned.line, length: planned.length, intensity: planned.intensity, intent: planned.intent };
  const exec = deliveryExecution(planned.gesture);
  const timingWindows = deliveryTiming(d, a.conditions);
  let shot: ShotType;
  let zone: BattingInput['zone'];
  let timing: TimingGrade;
  // Robustness (never throw): an input that could not pass validation (unknown shot, illegal zone) is treated as
  // unanswered, and a non-finite tap as no tap. Validated inputs are never affected.
  const input = a.input && (SHOTS as readonly string[]).includes(a.input.shot) && isLegalZone(a.input.shot, a.input.zone) ? a.input : null;
  if (!input) {
    shot = 'leave';
    zone = null;
    timing = 'interrupted';
  } else {
    shot = input.shot;
    zone = shot === 'defend' || shot === 'leave' ? null : input.zone;
    const tap = typeof input.tapMs === 'number' && Number.isFinite(input.tapMs) ? input.tapMs : null;
    timing = shot === 'leave' ? 'no_shot' : timingGrade(tap, timingWindows);
  }
  const ctx = contextFor(a.ball, a.previous, d);
  const inp = modelInputFor(d, exec.grade, shot, zone, timing, a.plan.field, a.conditions, ctx);
  const ev = evaluate(inp);

  const rng = rngFromKey(`vande/v1/ball|${a.seed}|${a.innings}|${a.ball}`);
  const atom = pickAtom(ev.atoms, rng.float());
  const path = executedPath(deliveryPath(d, a.conditions), d, exec.grade, rng);
  const sixDistance = Math.round(64 + 30 * ev.power + rng.float() * 10);
  const variety = rng.float();

  const leaving = shot === 'leave' || timing === 'no_shot' || timing === 'interrupted';
  const cues = buildCues({ d, conditions: a.conditions, path, shot, zone, atom, leaving, sixDistance, variety, superBall: ctx.superBall, lastBall: ctx.lastBall });
  return {
    ball: a.ball,
    delivery: d,
    execution: exec.quality,
    executionGrade: exec.grade,
    shot,
    zone,
    timing,
    contact: atom.contact,
    runs: atom.runs,
    wicket: atom.wicket,
    fielder: atom.fielder,
    factors: { ...ev.factors, explainKey: explainKeyFor(inp, ev, atom) },
    cues,
  };
}
