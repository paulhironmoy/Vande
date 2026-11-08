/**
 * Working out a target (TARGET-METHOD.md): pure arithmetic, no physics, no coach. The physics part (what each of the
 * reference batter's options does on each ball) is reference.ts; this file turns those outcome tables into a target.
 *
 * The reference batter faces the 12 balls of a seed. On each ball he chooses one of the responses the coach offers for it
 * (recommended, safest, higher-scoring), and he plays it with a timing error (a Gaussian of REFERENCE_SIGMA_MS). He
 * chooses, from where the chase stands, the response that gives him the best chance of getting the runs still needed
 * (a finite dynamic program over the balls left and the runs needed; the balls are independent, so it is exact). A
 * tier's target is the largest target that he still reaches at least `TIER_SHARE` of the time, not below the tier's
 * floor; where that leaves him with less than `MIN_CHANCE`, the largest target he reaches that often instead (never
 * below `MIN_TARGET`); and the three tiers never share a number (ruling R-44: `tierTarget`, `targetsOf`).
 *
 * The timing error is not sampled at random: it is integrated at fixed equal-probability points of the Gaussian
 * (QUADRATURE_Z), so the same seed gives the same table on every machine, with no random number anywhere.
 *
 * The reference batter is a simulated batter. His success rate says how winnable a target is for a batter with that
 * timing who chooses well; it says nothing about how often a person wins (that is UNPROVEN until people have played).
 */
import {
  CHASE_BALLS,
  CHASE_MAX_RUNS_PER_BALL,
  CHASE_MAX_TARGET,
  type ChaseDifficulty,
  type ChasePolicyRef,
} from './types';

/**
 * The reference batter and the derivation. Bump `version` when anything below changes a target.
 * v1 (ruling R-34): shares 80 / 60 / 25 % and floors 7 / 10 / 14.
 * v2 (ruling R-44): adds the minimum chance (`MIN_CHANCE`) and the order rule; six Hard targets change, the other 762 do not.
 */
export const REFERENCE_POLICY: ChasePolicyRef = { id: 'best-play-timing-20', version: 2 };

/**
 * The policy versions whose stored per-seed counts (the coach's options and what each does over the 24 timing errors,
 * written by `scripts/chase-targets.mjs derive`) are the same as this version's. v2 changed only how a target is read
 * from the counts, not the coach, the physics or the timing points, so files written under v1 still make the v2 table.
 */
export const DERIVATION_POLICY_VERSIONS: readonly number[] = [1, 2];

/**
 * The reference batter's timing error: the standard deviation of his swing time against the ideal (ms). 20 ms is the
 * repository's own expert-timing model (the coach's execution spread, the EX5 expert, the FAIR6 policies). Ruling R-34.
 */
export const REFERENCE_SIGMA_MS = 20;

/** The share of the reference batter's innings that reach each tier's target, at least (ruling R-34). */
export const TIER_SHARE: Readonly<Record<ChaseDifficulty, number>> = { easy: 0.8, standard: 0.6, hard: 0.25 };

/**
 * No tier's target is lower than this (ruling R-34), except where the minimum-chance rule below lowers it. Easy starts at
 * 7 so that no target is one ball's work (a six is the most a ball scores), and the three tiers never share a number.
 * Where the share alone would give less (a seed whose balls are hard to score off) the floor raises the target, and the
 * reference batter then reaches it less often than the share says: the win rates in the table are the true ones.
 */
export const TIER_FLOOR: Readonly<Record<ChaseDifficulty, number>> = { easy: 7, standard: 10, hard: 14 };

/**
 * The least often the reference batter may reach a tier's target (ruling R-44). The floors alone left him almost no
 * chance on a few seeds whose balls are hard to score off (Hard 14 on c025: 0.03 %, on c136: 0.00 %). Where the answer of
 * the share and the floor would leave him with less than this, the target is the largest he reaches at least this often.
 */
export const MIN_CHANCE = 0.1;

/**
 * No target is lower than this, whatever the rules say (ruling R-44): a ball scores at most six, so 6 + 1 is the smallest
 * chase that is not one ball's work.
 */
export const MIN_TARGET = CHASE_MAX_RUNS_PER_BALL + 1;

/**
 * The midpoint quantiles of the standard normal, Φ⁻¹((j + 0.5) / 24): 24 equally likely timing errors, in
 * standard-deviation units (the error in ms is REFERENCE_SIGMA_MS times each). Written out so every engine uses the
 * identical numbers.
 */
export const QUADRATURE_Z: readonly number[] = [
  -2.036834132, -1.534120544, -1.258161561, -1.054472452, -0.887146559, -0.741594044, -0.61029461, -0.488776411,
  -0.37409541, -0.264146977, -0.157310685, -0.05224518, 0.05224518, 0.157310685, 0.264146977, 0.37409541, 0.488776411,
  0.61029461, 0.741594044, 0.887146559, 1.054472452, 1.258161561, 1.534120544, 2.036834132,
];

/**
 * What one response does on one ball, over the reference batter's timing errors: the share of errors that score each
 * number of runs and are not out (index = runs, 0..6; 5 never happens) and the share that are out. The shares sum to 1.
 */
export interface OutcomePmf {
  run: readonly number[];
  out: number;
}

/**
 * The table of outcomes for equally likely samples (a dismissal ends the innings, so it carries no runs). Each share is
 * a count divided by the number of samples, so a table rebuilt from its counts (`pmfFromCounts`) is bit-identical.
 */
export function pmfFromOutcomes(outcomes: ReadonlyArray<{ runs: number; out: boolean }>): OutcomePmf {
  const counts = [0, 0, 0, 0, 0, 0, 0, 0];
  for (const o of outcomes) counts[o.out ? 7 : o.runs]++;
  return pmfFromCounts(counts);
}

/** The counts of equally likely samples that scored 0 to 6 runs (index 0 to 6) and were out (index 7), as a table. */
export function pmfFromCounts(counts: readonly number[]): OutcomePmf {
  const n = counts.reduce((a, b) => a + b, 0);
  return { run: counts.slice(0, 7).map((c) => c / n), out: counts[7] / n };
}

/** A table as its counts out of `n` equally likely samples (the inverse of `pmfFromCounts`). */
export const countsOf = (p: OutcomePmf, n: number): number[] => [...p.run, p.out].map((x) => Math.round(x * n));

/** For each ball, the responses the reference batter may choose from (in the coach's order, at least one). */
export type BallChoices = ReadonlyArray<OutcomePmf>;

export interface OptimalChase {
  /** The reference batter's chance of getting the target with best play. */
  win: number;
  /** value[i][need]: his chance of getting `need` more runs from ball i (0-based) on, with best play. */
  value: number[][];
  /** choice[i][need]: the index of the response he picks on ball i when `need` runs are still needed. */
  choice: number[][];
}

/**
 * Best play against a target, by backward induction over the balls. With `need` runs still needed on ball i he picks
 * the response with the highest chance of winning (the first, in the coach's order, on a tie). Needs of zero or less
 * are won. Exact: the balls are independent and a dismissal ends the chase.
 */
export function optimalChase(balls: ReadonlyArray<BallChoices>, target: number): OptimalChase {
  const n = balls.length;
  const value: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(target + 1).fill(0));
  const choice: number[][] = Array.from({ length: n }, () => new Array<number>(target + 1).fill(0));
  for (let need = 0; need <= target; need++) value[n][need] = need <= 0 ? 1 : 0;
  for (let i = n - 1; i >= 0; i--) {
    value[i][0] = 1;
    for (let need = 1; need <= target; need++) {
      let best = -1;
      let bestIndex = 0;
      balls[i].forEach((o, k) => {
        let v = 0;
        for (let r = 0; r <= 6; r++) {
          const p = o.run[r];
          if (p) v += p * value[i + 1][Math.max(0, need - r)];
        }
        if (v > best + 1e-12) {
          best = v;
          bestIndex = k;
        }
      });
      value[i][need] = best;
      choice[i][need] = bestIndex;
    }
  }
  return { win: value[0][target], value, choice };
}

/** His chance of getting `target` with best play. */
export const winProbability = (balls: ReadonlyArray<BallChoices>, target: number): number =>
  optimalChase(balls, target).win;

export interface DerivedTarget {
  target: number;
  /** His chance of getting `target` (0..1). */
  win: number;
  /** True when the floor (TIER_FLOOR) raised the share's answer, so that his chance of reaching it was below the share. */
  floored: boolean;
  /** True when the minimum-chance rule (MIN_CHANCE) lowered the target, because his chance at the answer above was below it. */
  lowered: boolean;
  /** True when the order rule put the target one above the next easier tier's; his chance may then be below MIN_CHANCE. */
  raised: boolean;
}

/**
 * The largest target the reference batter still reaches with chance at least `share`, raised to `floor` when it would
 * be lower. His chance never falls as the target falls, so the answer is the last target of a scan from 1 that still
 * reaches the share (1e-12 forgives rounding in the sums). This is the answer of policy v1; `tierTarget` adds R-44.
 */
export function targetAtShare(balls: ReadonlyArray<BallChoices>, share: number, floor: number): DerivedTarget {
  let target = 0;
  for (let t = 1; t <= CHASE_MAX_TARGET; t++) {
    if (winProbability(balls, t) + 1e-12 < share) break;
    target = t;
  }
  const lo = Math.max(1, floor);
  if (target >= lo)
    return { target, win: winProbability(balls, target), floored: false, lowered: false, raised: false };
  return { target: lo, win: winProbability(balls, lo), floored: true, lowered: false, raised: false };
}

/**
 * One tier's target (ruling R-44): the answer of `targetAtShare` for the tier's share and floor, unless the reference
 * batter reaches that less often than `MIN_CHANCE`. Then it is the largest target he reaches at least `MIN_CHANCE` of the
 * time, but never below `MIN_TARGET`: a tier already at `MIN_TARGET` has nothing lower to move to, so it stays there even
 * if he reaches it less often than that. No target is lower than `MIN_TARGET`, whatever floor is asked for.
 */
export function tierTarget(balls: ReadonlyArray<BallChoices>, share: number, floor: number): DerivedTarget {
  const base = targetAtShare(balls, share, Math.max(floor, MIN_TARGET));
  if (base.win + 1e-12 >= MIN_CHANCE) return base;
  const least = targetAtShare(balls, MIN_CHANCE, MIN_TARGET);
  if (least.target >= base.target) return base;
  return { target: least.target, win: least.win, floored: base.floored, lowered: true, raised: false };
}

/**
 * Puts a tier one above the next easier tier when the rules above left it no higher (ruling R-44), so that the three
 * tiers of a seed never share a number. The reference batter's chance at the raised target can be below `MIN_CHANCE`.
 */
function above(balls: ReadonlyArray<BallChoices>, tier: DerivedTarget, easier: DerivedTarget): DerivedTarget {
  if (tier.target > easier.target) return tier;
  const target = easier.target + 1;
  return { ...tier, target, win: winProbability(balls, target), raised: true };
}

/** The three tiers' targets for a seed's balls. They rise strictly with the tier: Easy < Standard < Hard. */
export function targetsOf(balls: ReadonlyArray<BallChoices>): Record<ChaseDifficulty, DerivedTarget> {
  if (balls.length !== CHASE_BALLS) throw new RangeError(`a chase has ${CHASE_BALLS} balls, got ${balls.length}`);
  const easy = tierTarget(balls, TIER_SHARE.easy, TIER_FLOOR.easy);
  const standard = above(balls, tierTarget(balls, TIER_SHARE.standard, TIER_FLOOR.standard), easy);
  const hard = above(balls, tierTarget(balls, TIER_SHARE.hard, TIER_FLOOR.hard), standard);
  return { easy, standard, hard };
}
