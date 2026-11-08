// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PRACTICE_SIM_VERSION } from '@/contracts/practice';
import { sha256Hex } from '@/engine/sha256';
import {
  CHASE_DIFFICULTIES,
  CHASE_MAX_TARGET,
  CHASE_SEED_COUNT,
  DEFAULT_CHASE_DIFFICULTY,
  chaseDefinitionError,
  chaseSeedAt,
  chaseSeedIndex,
  makeChase,
  nextChaseSeed,
  pickChaseSeed,
  targetOf,
  type ChaseDifficulty,
} from '@/practice/chase';
import {
  MIN_CHANCE,
  MIN_TARGET,
  REFERENCE_POLICY,
  REFERENCE_SIGMA_MS,
  TIER_FLOOR,
  TIER_SHARE,
} from '@/practice/chase/derive';
import { TARGET_TABLE } from '@/practice/chase/targets';

const SEEDS = Array.from({ length: CHASE_SEED_COUNT }, (_, i) => chaseSeedAt(i));

describe('the seed pool', () => {
  it('has 256 distinct seeds, c000 to c255, and knows its own', () => {
    expect(SEEDS).toHaveLength(256);
    expect(new Set(SEEDS).size).toBe(256);
    expect(SEEDS[0]).toBe('c000');
    expect(SEEDS[255]).toBe('c255');
    SEEDS.forEach((s, i) => expect(chaseSeedIndex(s)).toBe(i));
    for (const bad of ['c256', 'c-1', 'C001', 'c01', 'c0001', '', 'x', 'c 01', '000'])
      expect(chaseSeedIndex(bad)).toBeNull();
    expect(() => chaseSeedAt(256)).toThrow(RangeError);
    expect(() => chaseSeedAt(-1)).toThrow(RangeError);
    expect(() => chaseSeedAt(1.5)).toThrow(RangeError);
  });

  it('picks a seed from a number in [0, 1), the same seed for the same number', () => {
    expect(pickChaseSeed(0)).toBe('c000');
    expect(pickChaseSeed(0.5)).toBe('c128');
    expect(pickChaseSeed(0.999999)).toBe('c255');
    expect(pickChaseSeed(1)).toBe('c255');
    expect(pickChaseSeed(-3)).toBe('c000');
    expect(pickChaseSeed(Number.NaN)).toBe('c000');
    expect(pickChaseSeed(0.3)).toBe(pickChaseSeed(0.3));
    // Every seed is reachable.
    const seen = new Set(Array.from({ length: 1024 }, (_, k) => pickChaseSeed(k / 1024)));
    expect(seen.size).toBe(256);
  });

  it('goes round: the next seed after c255 is c000', () => {
    expect(nextChaseSeed('c000')).toBe('c001');
    expect(nextChaseSeed('c255')).toBe('c000');
    expect(nextChaseSeed('nonsense')).toBe('c000');
  });
});

describe('the chase a seed makes', () => {
  it('is a valid definition for every seed and difficulty, with the target in range', () => {
    for (const seed of SEEDS)
      for (const d of CHASE_DIFFICULTIES) {
        const def = makeChase(seed, d)!;
        expect(def, `${seed} ${d}`).not.toBeNull();
        expect(chaseDefinitionError(def), `${seed} ${d}`).toBeNull();
        expect(def).toMatchObject({
          seed,
          difficulty: d,
          overs: 2,
          balls: 12,
          wickets: 1,
          simVersion: PRACTICE_SIM_VERSION,
          bowling: 'club',
          conditions: 'balanced',
        });
        expect(def.target).toBeGreaterThanOrEqual(1);
        expect(def.target).toBeLessThanOrEqual(CHASE_MAX_TARGET);
      }
  });

  it('takes its target from the table row of the difficulty asked for', () => {
    for (const seed of ['c000', 'c031', 'c128', 'c255'])
      for (const d of CHASE_DIFFICULTIES)
        expect(makeChase(seed, d)!.target).toBe(TARGET_TABLE.targets[d][chaseSeedIndex(seed)!]);
    expect(makeChase('c031', 'easy')!.target).toBeLessThan(makeChase('c031', 'hard')!.target);
  });

  it('is Standard by default and null for a seed outside the pool', () => {
    expect(DEFAULT_CHASE_DIFFICULTY).toBe('standard');
    expect(makeChase('c010')).toEqual(makeChase('c010', 'standard'));
    expect(makeChase('c256')).toBeNull();
    expect(makeChase('whatever')).toBeNull();
    expect(targetOf('c256', 'easy')).toBeNull();
  });

  it('is the same every time, byte for byte, in any order', () => {
    const once = SEEDS.map((s) => JSON.stringify(makeChase(s, 'hard')));
    const backwards = [...SEEDS]
      .reverse()
      .map((s) => JSON.stringify(makeChase(s, 'hard')))
      .reverse();
    expect(backwards).toEqual(once);
    expect(SEEDS.map((s) => JSON.stringify(makeChase(s, 'hard')))).toEqual(once);
  });

  it('gives a fresh object each time, so nobody can change a chase for the next one', () => {
    const a = makeChase('c040')!;
    a.target = 70;
    a.policy.id = 'tampered';
    const b = makeChase('c040')!;
    expect(b.target).not.toBe(70);
    expect(b.policy.id).not.toBe('tampered');
  });

  it('takes nothing but a seed and a difficulty: no result, no history, no player', () => {
    expect(makeChase.length).toBeLessThanOrEqual(2);
    expect(targetOf.length).toBe(2);
  });
});

describe('the target table', () => {
  const T = TARGET_TABLE;
  const provisional = T.policy.id === 'provisional';

  it('has one target and one reference win rate for every seed at every difficulty', () => {
    for (const d of CHASE_DIFFICULTIES) {
      expect(T.targets[d], d).toHaveLength(CHASE_SEED_COUNT);
      expect(T.winPercent[d], d).toHaveLength(CHASE_SEED_COUNT);
      for (const t of T.targets[d]) expect(Number.isInteger(t) && t >= 1 && t <= CHASE_MAX_TARGET).toBe(true);
      for (const w of T.winPercent[d]) expect(Number.isInteger(w) && w >= 0 && w <= 100).toBe(true);
    }
  });

  it('never gets easier as the difficulty goes up, for any seed', () => {
    SEEDS.forEach((_, i) => {
      expect(T.targets.easy[i]).toBeLessThanOrEqual(T.targets.standard[i]);
      expect(T.targets.standard[i]).toBeLessThanOrEqual(T.targets.hard[i]);
    });
  });

  it('gives the three difficulties of a seed three different targets', () => {
    SEEDS.forEach((_, i) => {
      expect(T.targets.easy[i], `c${i} easy < standard`).toBeLessThan(T.targets.standard[i]);
      expect(T.targets.standard[i], `c${i} standard < hard`).toBeLessThan(T.targets.hard[i]);
    });
  });

  it('is in step with the method: a floor, each target reached at least as often as its share asks (unless the floor raised it), and a minimum chance', () => {
    if (provisional) return; // the placeholder carries no win rates
    // Policy version 2 (ruling R-44) is the shares and floors of version 1 plus the minimum chance and the order rule.
    expect(T.policy).toEqual(REFERENCE_POLICY);
    expect(T.sigmaMs).toBe(REFERENCE_SIGMA_MS);
    expect(T.minChance).toBe(MIN_CHANCE);
    expect(T.minTarget).toBe(MIN_TARGET);
    for (const d of CHASE_DIFFICULTIES) {
      expect(T.tierShare[d]).toBe(TIER_SHARE[d]);
      expect(T.tierFloor[d]).toBe(TIER_FLOOR[d]);
      SEEDS.forEach((_, i) => {
        const target = T.targets[d][i];
        const percent = T.winPercent[d][i];
        // No target is one ball's work, whatever lowered it.
        expect(target, `${chaseSeedAt(i)} ${d}`).toBeGreaterThanOrEqual(MIN_TARGET);
        if (target >= TIER_FLOOR[d]) {
          // Only the floor can leave a target below its share: it raised the target, so the reference batter reaches it less often.
          if (target > TIER_FLOOR[d]) expect(percent).toBeGreaterThanOrEqual(Math.round(100 * TIER_SHARE[d]));
        } else {
          // Changed from "every target is at least its floor" by ruling R-44: below its floor a target can only be the
          // minimum-chance rule's (the reference batter reaches it at least 10% of the time, a rounded percent of 10 or
          // more), or the order rule's, which puts a tier one above the easier one (min-chance.test.ts works out why).
          const easier = d === 'hard' ? 'standard' : 'easy';
          const orderRule = d !== 'easy' && target === T.targets[easier][i] + 1;
          expect(orderRule || percent >= Math.round(100 * MIN_CHANCE), `${chaseSeedAt(i)} ${d}`).toBe(true);
        }
      });
    }
    // A harder tier is reached less often, seed by seed.
    SEEDS.forEach((_, i) => {
      expect(T.winPercent.easy[i]).toBeGreaterThanOrEqual(T.winPercent.standard[i]);
      expect(T.winPercent.standard[i]).toBeGreaterThanOrEqual(T.winPercent.hard[i]);
    });
  });

  it('has not been edited by hand: its digest is the hash of its numbers', () => {
    if (provisional) {
      expect(T.digest).toBe('provisional');
      return;
    }
    expect(sha256Hex(JSON.stringify({ targets: T.targets, winPercent: T.winPercent }))).toBe(T.digest);
  });

  it('shows more than a handful of different targets: it is not one number', () => {
    for (const d of CHASE_DIFFICULTIES as readonly ChaseDifficulty[])
      expect(new Set(T.targets[d]).size).toBeGreaterThanOrEqual(3);
  });
});
