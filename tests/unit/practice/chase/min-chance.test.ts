// @vitest-environment node
/**
 * Ruling R-44 on the real seeds: the minimum chance and the order rule change exactly six Hard targets of the 256-seed table.
 * `fixtures/min-chance-seeds.json` (made by `node scripts/chase-targets.mjs min-chance-fixture`) holds, for every seed the two
 * rules change, the reference batter's recorded outcome tables at 20 ms (counts out of 24 timing errors, for each of the
 * coach's responses on each of the 12 balls) and the targets of policy version 1 and of this policy. These tests work the
 * targets out again from the recorded tables and check them against the shipped table and against `makeChase`.
 */
import { describe, expect, it } from 'vitest';
import { CHASE_DIFFICULTIES, CHASE_SEED_COUNT, chaseSeedAt, chaseSeedIndex, makeChase } from '@/practice/chase';
import {
  MIN_CHANCE,
  MIN_TARGET,
  REFERENCE_POLICY,
  TIER_FLOOR,
  TIER_SHARE,
  pmfFromCounts,
  targetAtShare,
  targetsOf,
  winProbability,
} from '@/practice/chase/derive';
import { TARGET_TABLE } from '@/practice/chase/targets';
import fixture from './fixtures/min-chance-seeds.json';

const seeds = fixture.seeds;
const pmfsOf = (counts: number[][][]) => counts.map((ball) => ball.map((c) => pmfFromCounts(c)));

/** The six Hard targets of ruling R-44, pinned: [version 1, this policy]. c136 ends one above its Standard 10 (order rule). */
const SIX: Record<string, readonly [number, number]> = {
  c011: [14, 13],
  c021: [14, 13],
  c025: [14, 11],
  c136: [14, 11],
  c169: [14, 12],
  c229: [14, 13],
};

describe('the six seeds that the minimum chance changes (ruling R-44)', () => {
  it('are the six the ruling expects, all at Hard, and nothing else changes on them', () => {
    expect(fixture.policy).toEqual(REFERENCE_POLICY);
    expect(fixture.minChance).toBe(MIN_CHANCE);
    expect(fixture.minTarget).toBe(MIN_TARGET);
    expect(seeds.map((s) => s.seed)).toEqual(Object.keys(SIX));
    for (const s of seeds) {
      expect([s.v1.hard.target, s.v2.hard.target], s.seed).toEqual(SIX[s.seed]);
      expect(s.v2.easy.target, s.seed).toBe(s.v1.easy.target);
      expect(s.v2.standard.target, s.seed).toBe(s.v1.standard.target);
    }
  });

  it('were nearly unwinnable at Hard with the floor alone: the reference batter reached 14 less than 10% of the time', () => {
    for (const s of seeds) {
      const pmfs = pmfsOf(s.pmfCounts);
      const old = targetAtShare(pmfs, TIER_SHARE.hard, TIER_FLOOR.hard);
      expect(old.target, s.seed).toBe(14);
      expect(old.win, s.seed).toBeLessThan(MIN_CHANCE);
      expect(old.win, s.seed).toBeCloseTo(s.v1.hard.win, 6);
    }
    // The table's whole-percent column hides how close c229 is: 9.76% is shown as 10%, and it is under the line.
    const c229 = pmfsOf(seeds.find((s) => s.seed === 'c229')!.pmfCounts);
    expect(winProbability(c229, 14)).toBeLessThan(0.1);
    expect(Math.round(100 * winProbability(c229, 14))).toBe(10);
  });

  it('get, from the recorded tables, the targets and the reasons the fixture records', () => {
    for (const s of seeds) {
      const t = targetsOf(pmfsOf(s.pmfCounts));
      for (const d of CHASE_DIFFICULTIES) {
        expect(t[d].target, `${s.seed} ${d}`).toBe(s.v2[d].target);
        expect(t[d].win, `${s.seed} ${d}`).toBeCloseTo(s.v2[d].win, 6);
        expect([t[d].floored, t[d].lowered, t[d].raised], `${s.seed} ${d}`).toEqual([
          s.v2[d].floored,
          s.v2[d].lowered,
          s.v2[d].raised,
        ]);
      }
    }
  });

  it('are brought to the largest target the reference batter reaches at least 10% of the time', () => {
    for (const s of seeds.filter((x) => x.seed !== 'c136')) {
      const pmfs = pmfsOf(s.pmfCounts);
      const hard = targetsOf(pmfs).hard;
      expect(hard).toMatchObject({ floored: true, lowered: true, raised: false });
      expect(hard.win, s.seed).toBeGreaterThanOrEqual(MIN_CHANCE);
      expect(winProbability(pmfs, hard.target + 1), s.seed).toBeLessThan(MIN_CHANCE);
      expect(hard.target).toBeGreaterThanOrEqual(MIN_TARGET);
    }
  });

  it('keep Hard above Standard on c136: the line is crossed at Standard 10, so Hard is 11 and is reached under 10%', () => {
    const pmfs = pmfsOf(seeds.find((s) => s.seed === 'c136')!.pmfCounts);
    // Without the order rule Hard would be 10, the same as Standard: 14.0% at 10, 4.3% at 11, so the line is between them.
    expect(winProbability(pmfs, 10)).toBeGreaterThanOrEqual(MIN_CHANCE);
    expect(winProbability(pmfs, 11)).toBeLessThan(MIN_CHANCE);
    const t = targetsOf(pmfs);
    expect(t.standard.target).toBe(10);
    expect(t.hard).toMatchObject({ target: 11, floored: true, lowered: true, raised: true });
    // The one target of the table that the reference batter reaches under 10% of the time: 4.3%, said plainly.
    expect(t.hard.win).toBeCloseTo(0.043174, 5);
    expect(t.hard.win).toBeLessThan(MIN_CHANCE);
  });

  it('are what the shipped table and makeChase say, with the same reference chance', () => {
    for (const s of seeds) {
      const i = chaseSeedIndex(s.seed)!;
      const t = targetsOf(pmfsOf(s.pmfCounts));
      for (const d of CHASE_DIFFICULTIES) {
        expect(TARGET_TABLE.targets[d][i], `${s.seed} ${d}`).toBe(t[d].target);
        expect(TARGET_TABLE.winPercent[d][i], `${s.seed} ${d}`).toBe(Math.round(100 * t[d].win));
        const def = makeChase(s.seed, d)!;
        expect(def.target).toBe(t[d].target);
        expect(def.policy).toEqual(REFERENCE_POLICY);
        expect(def.referenceWinRate).toBe(Math.round(100 * t[d].win) / 100);
      }
    }
  });

  it('are the only targets of the whole table that sit below their tier floor, and all of them are at least 7', () => {
    const below: string[] = [];
    for (let i = 0; i < CHASE_SEED_COUNT; i++)
      for (const d of CHASE_DIFFICULTIES) {
        const target = TARGET_TABLE.targets[d][i];
        expect(target).toBeGreaterThanOrEqual(MIN_TARGET);
        if (target < TIER_FLOOR[d]) below.push(`${chaseSeedAt(i)} ${d} ${target}`);
      }
    expect(below.sort()).toEqual(seeds.map((s) => `${s.seed} hard ${s.v2.hard.target}`).sort());
    expect(TARGET_TABLE.minChance).toBe(MIN_CHANCE);
    expect(TARGET_TABLE.minTarget).toBe(MIN_TARGET);
    expect(TARGET_TABLE.policy).toEqual(REFERENCE_POLICY);
  });

  it('leave the reference batter at least 10% on every other target of the table, except c136 Hard', () => {
    for (let i = 0; i < CHASE_SEED_COUNT; i++)
      for (const d of CHASE_DIFFICULTIES) {
        // The table keeps whole percents (rounded): a chance of 9.5% to 10% is shown as 10, so 10 is the lowest a row can show.
        if (chaseSeedAt(i) === 'c136' && d === 'hard') {
          expect(TARGET_TABLE.winPercent.hard[i]).toBe(4);
        } else {
          expect(TARGET_TABLE.winPercent[d][i], `${chaseSeedAt(i)} ${d}`).toBeGreaterThanOrEqual(
            Math.round(100 * MIN_CHANCE),
          );
        }
      }
  });
});
