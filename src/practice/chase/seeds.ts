/**
 * The chase seeds and the chase a seed makes. The seeds are a fixed pool of names ("c000" … "c255"), so that the target
 * of every one of them is already worked out (targets.ts) and a chase starts at once, whatever the phone: working a
 * target out takes the reference batter several seconds of physics (TARGET-METHOD.md). The same seed and difficulty
 * always give the same chase, and nothing a player does can change one.
 */
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { TARGET_TABLE } from './targets';
import {
  CHASE_BALLS,
  CHASE_OVERS,
  CHASE_VERSION,
  CHASE_WICKETS,
  DEFAULT_CHASE_DIFFICULTY,
  type ChaseDefinition,
  type ChaseDifficulty,
} from './types';

export const CHASE_SEED_COUNT = 256 as const;

/** The seed at a pool index (0..255): "c000" … "c255". */
export function chaseSeedAt(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index >= CHASE_SEED_COUNT)
    throw new RangeError(`chase seed index ${index}`);
  return `c${String(index).padStart(3, '0')}`;
}

/** The pool index of a seed, or null when it is not in the pool. */
export function chaseSeedIndex(seed: string): number | null {
  const m = /^c(\d{3})$/.exec(seed);
  if (!m) return null;
  const i = Number(m[1]);
  return i < CHASE_SEED_COUNT ? i : null;
}

/** A pool seed for a number in [0, 1) (the caller supplies the random number, so this stays pure). */
export function pickChaseSeed(unit: number): string {
  const u = Number.isFinite(unit) ? Math.min(Math.max(unit, 0), 0.999999999) : 0;
  return chaseSeedAt(Math.floor(u * CHASE_SEED_COUNT));
}

/** The next pool seed after `seed` (wrapping), for "a different chase" without a random number. */
export function nextChaseSeed(seed: string): string {
  const i = chaseSeedIndex(seed);
  return chaseSeedAt(i === null ? 0 : (i + 1) % CHASE_SEED_COUNT);
}

/** The target of a pool seed at a difficulty, from the table, or null for a seed outside the pool. */
export function targetOf(seed: string, difficulty: ChaseDifficulty): { target: number; winPercent: number } | null {
  const i = chaseSeedIndex(seed);
  if (i === null) return null;
  const target = TARGET_TABLE.targets[difficulty]?.[i];
  const winPercent = TARGET_TABLE.winPercent[difficulty]?.[i];
  return target === undefined || winPercent === undefined ? null : { target, winPercent };
}

/**
 * The chase of a pool seed at a difficulty (Standard by default), or null for a seed outside the pool. The 12 balls
 * are the same at every difficulty; only the target differs. Pure: no clock, no random numbers, no state.
 */
export function makeChase(
  seed: string,
  difficulty: ChaseDifficulty = DEFAULT_CHASE_DIFFICULTY,
): ChaseDefinition | null {
  const t = targetOf(seed, difficulty);
  if (!t) return null;
  return {
    v: CHASE_VERSION,
    simVersion: PRACTICE_SIM_VERSION,
    seed,
    difficulty,
    overs: CHASE_OVERS,
    balls: CHASE_BALLS,
    wickets: CHASE_WICKETS,
    target: t.target,
    bowling: 'club',
    conditions: 'balanced',
    policy: { ...TARGET_TABLE.policy },
    referenceWinRate: Math.round(t.winPercent) / 100,
  };
}
