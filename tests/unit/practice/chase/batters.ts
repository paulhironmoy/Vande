/**
 * Scripted batters: input policies for the chase tests and sweeps. Each is a pure function of the ball due next and its
 * number (and a seeded random draw where it says so), so a run is repeatable. They are test tools: nothing here is
 * shipped, and none of them sees the score, the target or the situation.
 */
import type { NormalizedSwing } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import type { NextDelivery } from '@/practice/game';
import { swingFor, type Batter } from './helpers';

const attack =
  (directionDeg: number, power = 0.7, elevation = 0, errorMs = 0) =>
  (next: NextDelivery): NormalizedSwing =>
    swingFor(next, { kind: 'attack', directionDeg, power, elevation, errorMs });

const defend =
  (errorMs = 0) =>
  (next: NextDelivery): NormalizedSwing =>
    swingFor(next, { kind: 'defend', errorMs });

/** Reads the ball (length and line), as a club batter would, and picks a stroke for it. */
const reader: Batter = (next) => {
  const p = next.plan;
  const wide = p.lineM > 0.3;
  if (wide && p.lengthM > 4) return null;
  if (p.lengthM >= 7) return swingFor(next, { kind: 'attack', directionDeg: -55, power: 0.8, elevation: 0.3 });
  if (p.lengthM < 3.2) return swingFor(next, { kind: 'attack', directionDeg: 0, power: 0.7 });
  if (p.lineM < -0.05) return swingFor(next, { kind: 'attack', directionDeg: -35, power: 0.6 });
  return swingFor(next, { kind: 'defend' });
};

/** A different stroke every ball from a seeded draw: kind, direction, power, loft, timing, or a leave. */
const randomBatter =
  (key: string): Batter =>
  (next, n) => {
    const rng = rngFromKey(`chase-batter|${key}|${next.seed}|${n}`);
    const u = rng.float();
    if (u < 0.12) return null;
    const errorMs = (rng.float() - 0.5) * 120;
    if (u < 0.35) return swingFor(next, { kind: 'defend', errorMs });
    return swingFor(next, {
      kind: 'attack',
      directionDeg: -80 + 160 * rng.float(),
      power: 0.5 + 0.5 * rng.float(),
      elevation: rng.float() < 0.3 ? 0.4 + 0.4 * rng.float() : 0,
      errorMs,
    });
  };

/** At least twenty different input policies: the fixed ones the fairness check names, and some that change their mind. */
export const BATTERS: ReadonlyArray<readonly [string, Batter]> = [
  ['leave', () => null],
  ['forward defence', defend()],
  ['defence a little late', defend(30)],
  ['straight drive', attack(0)],
  ['cover drive', attack(40)],
  ['cut', attack(70, 0.8)],
  ['pull', attack(-60, 0.8, 0.3)],
  ['flick', attack(-40, 0.6)],
  ['lofted straight', attack(0, 0.85, 0.75)],
  ['lofted leg side', attack(-35, 0.85, 0.75)],
  ['sweep', attack(-90, 0.7)],
  ['hard hitter', attack(15, 1)],
  ['early drive', attack(0, 0.7, 0, -30)],
  ['late drive', attack(0, 0.7, 0, 30)],
  ['reads the ball', reader],
  ['random A', randomBatter('A')],
  ['random B', randomBatter('B')],
  ['random C', randomBatter('C')],
  ['defend then attack', (next, n) => (n % 2 === 1 ? defend()(next) : attack(10)(next))],
  ['leaves the wide ones', (next) => (next.plan.lineM > 0.25 ? null : defend()(next))],
  ['attack every third ball', (next, n) => (n % 3 === 0 ? attack(25, 0.9)(next) : defend()(next))],
  ['left-field slogger', attack(-120, 0.9)],
];
