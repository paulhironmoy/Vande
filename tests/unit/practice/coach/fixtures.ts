/** Records and swings for the coach tests: real deliveries, real swings, real physics. */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type BallCondition,
  type BowlerProfile,
  type DeliveryRecord,
  type DeliveryResult,
  type Footwork,
  type Handedness,
  type NormalizedSwing,
  type PitchCondition,
  type PracticeDeliveryPlan,
} from '@/contracts/practice';
import { autoField, batTravelMs, idealTimeFor, practiceFlight, resolveDelivery } from '@/physics';
import { REFERENCE_BALLS, REFERENCE_CONDITIONS, REFERENCE_OVER, type ReferenceBallId } from '@/practice/game';

export const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'coach-test-pace' };
export const OFFSPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'coach-test-spin' };
export const NEW_BALL: BallCondition = { colour: 'red', age: 'new' };

export interface RecordOpts {
  bowler?: BowlerProfile;
  conditions?: PitchCondition;
  assist?: AssistLevel;
  handedness?: Handedness;
  ball?: BallCondition;
  seed?: string;
  tierToleranceMs?: number;
}

/** A delivery record (left alone) for a plan. */
export function recordFor(plan: PracticeDeliveryPlan, o: RecordOpts = {}): DeliveryRecord {
  const bowler = o.bowler ?? PACE;
  const conditions = o.conditions ?? 'balanced';
  const handedness = o.handedness ?? 'right';
  return {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex: 0,
    bowler,
    plan,
    seed: o.seed ?? `coach-${plan.variation}-${plan.lengthM}-${plan.lineM}`,
    conditions,
    ball: o.ball ?? NEW_BALL,
    field: autoField(bowler, conditions, handedness),
    handedness,
    assist: o.assist ?? 'play',
    tierToleranceMs: o.tierToleranceMs ?? 0,
    swing: null,
    runs: 0,
    dismissal: null,
  };
}

/** The reference over's ball as an innings record. */
export function referenceRecord(id: ReferenceBallId, assist: AssistLevel = 'play'): DeliveryRecord {
  const rb = REFERENCE_BALLS.find((b) => b.id === id)!;
  return {
    version: PRACTICE_SIM_VERSION,
    overIndex: 0,
    ballIndex: rb.index,
    bowler: REFERENCE_OVER.bowler,
    plan: REFERENCE_OVER.balls[rb.index],
    seed: rb.seed,
    conditions: REFERENCE_CONDITIONS,
    ball: REFERENCE_OVER.ball,
    field: autoField(REFERENCE_OVER.bowler, REFERENCE_CONDITIONS, 'right'),
    handedness: 'right',
    assist,
    tierToleranceMs: 0,
    swing: null,
    runs: 0,
    dismissal: null,
  };
}

export interface SwingOpts {
  kind?: NormalizedSwing['kind'];
  power?: number;
  directionDeg?: number;
  elevation?: number;
  footwork?: Footwork;
  /** Timing error against the ideal for the footwork (ms, + late). */
  errorMs?: number;
}

/** A swing timed `errorMs` from the ideal contact for its footwork, on this record's flight. */
export function swingFor(record: DeliveryRecord, o: SwingOpts = {}): NormalizedSwing {
  const kind = o.kind ?? 'attack';
  const power = o.power ?? (kind === 'defend' ? 0.2 : 0.6);
  const footwork = o.footwork ?? 'auto';
  const ideal = idealTimeFor(practiceFlight(record), footwork);
  const startT = Math.round((ideal - batTravelMs(kind, power) / 1000 + (o.errorMs ?? 0) / 1000) * 1e4) / 1e4;
  return { kind, startT, directionDeg: o.directionDeg ?? 0, power, elevation: o.elevation ?? 0, footwork };
}

/** Play the record with a swing (null = leave): the attempt's record and its real result. */
export function play(
  record: DeliveryRecord,
  swing: NormalizedSwing | null,
): { record: DeliveryRecord; result: DeliveryResult } {
  const result = resolveDelivery({
    flight: practiceFlight(record),
    swing,
    field: record.field,
    bowler: record.bowler,
    conditions: record.conditions,
    handedness: record.handedness,
    assist: record.assist,
    tierToleranceMs: record.tierToleranceMs,
  });
  return { record: { ...record, swing, runs: result.outcome.runs, dismissal: result.outcome.dismissal }, result };
}

/** Re-simulate an option's swing on the same delivery. */
export function replayOption(record: DeliveryRecord, swing: NormalizedSwing | null): DeliveryResult {
  return play(record, swing).result;
}
