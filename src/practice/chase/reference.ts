/**
 * The reference batter's side of a target (TARGET-METHOD.md): what each response the coach offers does on each of the 12
 * balls of a seed, through the frozen physics, over his timing errors. It only calls public functions of the game,
 * physics and coach modules; it changes nothing in them. It is slow on purpose (the coach reads every ball, then every
 * response is played at 24 timing errors), so it is run once per seed by scripts/chase-targets.mjs and the answers are
 * kept in targets.ts. The app never imports this file.
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type CoachOptionKind,
  type Decision,
  type DeliveryRecord,
  type DeliveryResult,
  type Handedness,
  type PitchCondition,
  type PracticeOverPlan,
} from '@/contracts/practice';
import { autoField, flight, resolveDelivery } from '@/physics';
import { analyzeBall } from '@/practice/coach';
import { ballSeed } from '@/practice/game';
import { swingOf, type EvalBall, type Intent } from '@/practice/game/evaluate';
import { chaseOvers } from './plan';
import {
  QUADRATURE_Z,
  REFERENCE_SIGMA_MS,
  pmfFromOutcomes,
  targetsOf,
  type DerivedTarget,
  type OutcomePmf,
} from './derive';
import type { ChaseDefinition, ChaseDifficulty } from './types';

/** One response the reference batter may choose on a ball (the coach's pick, as an intent). */
export interface ReferenceOption {
  kind: CoachOptionKind;
  decision: Decision;
  /** Null is a leave. */
  intent: Intent;
}

/** A ball of the chase with the responses on offer. */
export interface ReferenceBall {
  ball: EvalBall;
  options: ReferenceOption[];
}

/** The six balls of an over for a batter of either hand: the flights and the automatic field of Practice. */
export function overBallsFor(
  plan: PracticeOverPlan,
  conditions: PitchCondition,
  overIndex: number,
  handedness: Handedness,
): EvalBall[] {
  const field = autoField(plan.bowler, conditions, handedness, plan.ball);
  return plan.balls.map((p, ballIndex) => {
    const seed = ballSeed(plan, ballIndex);
    return {
      over: plan,
      overIndex,
      ballIndex,
      conditions,
      seed,
      flight: flight({ plan: p, bowler: plan.bowler, conditions, seed, handedness, ball: plan.ball }),
      field,
    };
  });
}

/** The 12 balls of a chase as the evaluation harness plays them (right-handed unless asked otherwise). */
export function chaseEvalBalls(def: ChaseDefinition, handedness: Handedness = 'right'): EvalBall[] {
  return chaseOvers(def, handedness).flatMap((s) => overBallsFor(s.plan, def.conditions, s.overIndex, handedness));
}

/** One ball played for an intent and a timing error (ms, + late) by a batter of either hand. */
export function playHanded(
  ball: EvalBall,
  intent: Intent,
  errorMs: number,
  assist: AssistLevel,
  handedness: Handedness = 'right',
): DeliveryResult {
  return resolveDelivery({
    flight: ball.flight,
    swing: swingOf(ball, intent, errorMs),
    field: ball.field,
    bowler: ball.over.bowler,
    conditions: ball.conditions,
    handedness,
    assist,
    tierToleranceMs: 0,
  });
}

/** The responses the coach offers for one ball: recommended first, then the safest and higher-scoring when different. */
export function coachOptions(ball: EvalBall, assist: AssistLevel, handedness: Handedness = 'right'): ReferenceOption[] {
  const record: DeliveryRecord = {
    version: PRACTICE_SIM_VERSION,
    overIndex: ball.overIndex,
    ballIndex: ball.ballIndex,
    bowler: ball.over.bowler,
    plan: ball.flight.plan,
    seed: ball.seed,
    conditions: ball.conditions,
    ball: ball.over.ball,
    field: ball.field,
    handedness,
    assist,
    tierToleranceMs: 0,
    swing: null,
    runs: 0,
    dismissal: null,
  };
  return analyzeBall(record).options.map((o) => ({
    kind: o.kind,
    decision: o.decision,
    intent: o.swing
      ? {
          kind: o.swing.kind,
          directionDeg: o.swing.directionDeg,
          elevation: o.swing.elevation,
          power: o.swing.power,
          footwork: o.swing.footwork,
        }
      : null,
  }));
}

/** The chase's balls with the coach's options for each (about 0.5 s of coach work per ball). */
export function referenceBalls(
  def: ChaseDefinition,
  assist: AssistLevel = 'play',
  handedness: Handedness = 'right',
): ReferenceBall[] {
  return chaseEvalBalls(def, handedness).map((ball) => ({ ball, options: coachOptions(ball, assist, handedness) }));
}

/**
 * What one response does on one ball over the reference batter's timing errors: it is played at each of the 24
 * equally likely errors (one play for a leave, which timing cannot change) through the real physics.
 */
export function optionPmf(
  ball: EvalBall,
  intent: Intent,
  assist: AssistLevel,
  sigmaMs: number = REFERENCE_SIGMA_MS,
  z: readonly number[] = QUADRATURE_Z,
  handedness: Handedness = 'right',
): OutcomePmf {
  const errors = intent ? z.map((q) => q * sigmaMs) : [0];
  return pmfFromOutcomes(
    errors.map((e) => {
      const r = playHanded(ball, intent, e, assist, handedness);
      return { runs: r.outcome.runs, out: r.outcome.dismissal !== null };
    }),
  );
}

/** The outcome tables of every option of every ball. */
export function referencePmfs(
  balls: readonly ReferenceBall[],
  assist: AssistLevel = 'play',
  sigmaMs: number = REFERENCE_SIGMA_MS,
  z: readonly number[] = QUADRATURE_Z,
  handedness: Handedness = 'right',
): OutcomePmf[][] {
  return balls.map((b) => b.options.map((o) => optionPmf(b.ball, o.intent, assist, sigmaMs, z, handedness)));
}

export interface DerivedChase {
  seed: string;
  assist: AssistLevel;
  sigmaMs: number;
  targets: Record<ChaseDifficulty, DerivedTarget>;
}

/** The targets of a seed: the coach's options for every ball, played over the timing errors, then the dynamic program. */
export function deriveTargets(
  def: ChaseDefinition,
  opts: { assist?: AssistLevel; sigmaMs?: number; balls?: readonly ReferenceBall[] } = {},
): DerivedChase {
  const assist = opts.assist ?? 'play';
  const sigmaMs = opts.sigmaMs ?? REFERENCE_SIGMA_MS;
  const balls = opts.balls ?? referenceBalls(def, assist);
  return { seed: def.seed, assist, sigmaMs, targets: targetsOf(referencePmfs(balls, assist, sigmaMs)) };
}
