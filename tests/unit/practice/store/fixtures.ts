/** Hand-built Practice data for the store tests (structure only; the rules belong to src/practice/game). */
import {
  PRACTICE_SIM_VERSION,
  type BowlerProfile,
  type DeliveryRecord,
  type DeliveryResult,
  type FieldLayout,
  type PracticeDeliveryPlan,
  type PracticeInningsState,
  type PracticeOverPlan,
} from '@/contracts';

export const bowler: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'b1' };

export const field: FieldLayout = {
  id: 'balanced-pace',
  fielders: [
    { id: 'f0', role: 'keeper', x: 0, z: 14 },
    { id: 'f1', role: 'bowler', x: 0, z: -12 },
    { id: 'f2', role: 'slip', x: 2, z: 15 },
    { id: 'f3', role: 'point', x: 20, z: 8 },
    { id: 'f4', role: 'cover', x: 18, z: -6 },
    { id: 'f5', role: 'mid_off', x: 8, z: -20 },
    { id: 'f6', role: 'mid_on', x: -8, z: -20 },
    { id: 'f7', role: 'midwicket', x: -18, z: -4 },
    { id: 'f8', role: 'square_leg', x: -22, z: 9 },
    { id: 'f9', role: 'fine_leg', x: -20, z: 40 },
    { id: 'f10', role: 'third_man', x: 30, z: 45 },
  ],
};

export function plan(i = 0): PracticeDeliveryPlan {
  return { variation: i % 2 ? 'outswing' : 'stock', lengthM: 5 + i * 0.3, lineM: 0.1 * i, speedKph: 134 + i };
}

export function overPlan(seed = 'over-1'): PracticeOverPlan {
  return { version: PRACTICE_SIM_VERSION, bowler, balls: [plan(0), plan(1), plan(2), plan(3), plan(4), plan(5)], seed, source: 'random' };
}

export function record(overIndex: number, ballIndex: number, runs: DeliveryRecord['runs'] = 1, dismissal: DeliveryRecord['dismissal'] = null): DeliveryRecord {
  return {
    version: PRACTICE_SIM_VERSION,
    overIndex,
    ballIndex,
    bowler,
    plan: plan(ballIndex),
    seed: `over-${overIndex}:${ballIndex}`,
    conditions: 'balanced',
    field,
    handedness: 'right',
    assist: 'learn',
    tierToleranceMs: 0,
    swing: { kind: 'attack', startT: 0.42, directionDeg: 30, power: 0.7, elevation: 0.1, footwork: 'auto' },
    runs,
    dismissal,
  };
}

export function innings(over: Partial<PracticeInningsState> = {}): PracticeInningsState {
  return {
    version: PRACTICE_SIM_VERSION,
    id: 'inn-1',
    status: 'batting',
    conditions: 'balanced',
    assist: 'learn',
    handedness: 'right',
    runs: 9,
    balls: 8,
    overs: [{ plan: overPlan('over-0'), deliveries: [0, 1, 2, 3, 4, 5].map((b) => record(0, b)) }],
    current: { plan: overPlan('over-1'), field, deliveries: [record(1, 0, 2), record(1, 1, 1)] },
    inFlight: null,
    dismissal: null,
    ...over,
  };
}

/** A DeliveryResult with only the fields the metrics read filled meaningfully. */
export function result(over: { timing?: DeliveryResult['contact']['timing']; errorMs?: number | null; kind?: DeliveryResult['contact']['kind']; intended?: number | null; exit?: number | null; swing?: 'attack' | 'defend' | null; runs?: DeliveryResult['outcome']['runs']; boundary?: 4 | 6 | null; dismissal?: DeliveryResult['outcome']['dismissal'] } = {}): DeliveryResult {
  const swingKind = over.swing === undefined ? 'attack' : over.swing;
  return {
    version: PRACTICE_SIM_VERSION,
    flight: {} as DeliveryResult['flight'],
    footwork: 'forward',
    lbw: null,
    swing: swingKind ? { kind: swingKind, startT: 0.4, directionDeg: over.intended ?? 30, power: 0.7, elevation: 0, footwork: 'auto' } : null,
    contact: {
      kind: over.kind ?? 'middle',
      t: 0.5,
      timingErrorMs: over.errorMs === undefined ? 10 : over.errorMs,
      timing: over.timing ?? 'perfect',
      point: null,
      bladeU: 0.22,
      faceBearingDeg: 30,
      batSpeedKph: 80,
      exitSpeedKph: 110,
      exitBearingDeg: over.exit === undefined ? 34 : over.exit,
      exitElevationDeg: 5,
      intendedBearingDeg: over.intended === undefined ? 30 : over.intended,
    },
    bat: [],
    ball: [],
    fielders: [],
    events: [],
    outcome: { runs: over.runs ?? 4, boundary: over.boundary === undefined ? 4 : over.boundary, dismissal: over.dismissal ?? null, fielderId: null, endBearingDeg: 34, endDistanceM: 70, region: 'cover' },
    coaching: { reason: 'found_the_gap', timing: 'on_time', zone: 'cover', fielderRole: null, lbw: null },
    deadT: 4,
  };
}
