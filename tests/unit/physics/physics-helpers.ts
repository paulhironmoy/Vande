import type { AssistLevel, BallFlight, BowlerProfile, Footwork, NormalizedSwing, PitchCondition, PracticeDeliveryPlan } from '@/contracts/practice';
import { batTravelMs } from '@/physics/bat';
import { strike } from '@/physics/contact';
import { flight } from '@/physics/delivery';

export const PACE: BowlerProfile = { family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'test-pace' };
export const OFFSPIN: BowlerProfile = { family: 'spin', spinType: 'finger', arm: 'right', lookSeed: 'test-spin' };
export const LEGSPIN: BowlerProfile = { family: 'spin', spinType: 'wrist', arm: 'right', lookSeed: 'test-spin' };

export function plan(p: Partial<PracticeDeliveryPlan> = {}): PracticeDeliveryPlan {
  return { variation: 'stock', lengthM: 6.5, lineM: 0.05, speedKph: 136, ...p };
}

export function fly(p: Partial<PracticeDeliveryPlan> = {}, bowler: BowlerProfile = PACE, conditions: PitchCondition = 'balanced', seed = 't1', handedness: 'right' | 'left' = 'right'): BallFlight {
  return flight({ plan: plan(p), bowler, conditions, seed, handedness });
}

/** A swing timed `errorMs` late (− early) against the ideal contact for its footwork. */
export function timedSwing(f: BallFlight, errorMs: number, s: Partial<NormalizedSwing> = {}, footwork: Footwork = 'auto'): NormalizedSwing {
  const kind = s.kind ?? 'attack';
  const power = s.power ?? 0.6;
  const base = { kind, power, directionDeg: s.directionDeg ?? 0, elevation: s.elevation ?? 0.1, footwork, startT: 0 };
  const ideal = strike(f, base, { assist: 'learn' }).idealT;
  return { ...base, startT: ideal - batTravelMs(kind, power) / 1000 + errorMs / 1000 };
}

export function play(f: BallFlight, errorMs: number, s: Partial<NormalizedSwing> = {}, assist: AssistLevel = 'real', footwork: Footwork = 'auto') {
  return strike(f, timedSwing(f, errorMs, s, footwork), { assist });
}

export const EDGES = new Set(['inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);
