/**
 * Fixed swing lists for the chase journeys (tests/e2e/chase-flow.spec.ts), found with the same physics as the app
 * (release/product-sequence/stage-3-chase/CHASE-UI/PATHS.md has the method and the scripts; re-run it if the target
 * table changes and a list stops doing what its name says). Seeds are pool seeds (src/practice/chase).
 *
 * WIN: the best swing for each of the 12 balls of c012 (a drive in the direction that scores most, exactly on time),
 *   found ball by ball; the chase ends at the target, so the later swings are simply not used. It reaches 44 runs in
 *   12 balls, so a higher target than today's still wins.
 * LOSS_WICKET: c004, a block, then the second ball left: it is bowled (a leave that hits the stumps).
 * LOSS_BALLS: c002, twelve blocks: none is out, none scores.
 * Each list gives the same result at the three timing helps (0, 12 and 20 ms: verify.mjs).
 */
import { block, type Swing } from './practice-helpers';

export interface ChasePath {
  seed: string;
  swings: Swing[];
}

export const WIN: ChasePath = {
  seed: 'c012',
  swings: [
    { kind: 'attack', contactErrorMs: 0, directionDeg: 0, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: -20, power: 1, elevation: 0 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 0, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: -45, power: 1, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: -45, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 0, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 20, power: 1, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: 0, power: 0.7, elevation: 0 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: -45, power: 0.7, elevation: 0.8 },
    { kind: 'attack', contactErrorMs: 0, directionDeg: -45, power: 1, elevation: 0.8 },
  ],
};

export const LOSS_WICKET: ChasePath = { seed: 'c004', swings: [block(), 'leave'] };

export const LOSS_BALLS: ChasePath = { seed: 'c002', swings: Array.from({ length: 12 }, () => block()) };
