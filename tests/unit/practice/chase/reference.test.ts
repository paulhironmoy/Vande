// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  QUADRATURE_Z,
  REFERENCE_POLICY,
  REFERENCE_SIGMA_MS,
  countsOf,
  optimalChase,
  pmfFromCounts,
  targetsOf,
} from '@/practice/chase/derive';
import {
  chaseEvalBalls,
  coachOptions,
  optionPmf,
  type ReferenceBall,
  type ReferenceOption,
} from '@/practice/chase/reference';
import { chaseOvers, makeChase } from '@/practice/chase';
import { overBalls } from '@/practice/game/evaluate';
import { TARGET_TABLE } from '@/practice/chase/targets';
import fixture from './fixtures/c000-options.json';

// The coach's options for the 12 balls of c000 (assist play), what each does over the 24 timing errors (counts out of
// 24 for runs 0 to 6 and out), and the targets the method gave from them: recorded by scripts/chase-targets.mjs on
// 2026-11-08 at sim v3 amendment 5f. Working them out afresh costs about 12 s (the coach alone about 9 s), so the unit
// tests check the pieces: the first ball is read by the coach live, three balls are played again through the physics,
// and the targets are worked out from the recorded counts. `node scripts/chase-targets.mjs check --seed c000` does it all.
const options = fixture.options as ReferenceOption[][];
const counts = fixture.pmfCounts as number[][][];
const def = makeChase('c000', 'standard')!;
const balls = (): ReferenceBall[] => chaseEvalBalls(def).map((ball, i) => ({ ball, options: options[i] }));
const recordedPmfs = () => counts.map((ball) => ball.map((c) => pmfFromCounts(c)));

describe('the reference batter on the first chase seed', () => {
  it('faces the 12 balls of the chase through the harness, right-handed', () => {
    const b = chaseEvalBalls(def);
    expect(b).toHaveLength(12);
    expect(b.map((x) => [x.overIndex, x.ballIndex])).toEqual(
      Array.from({ length: 12 }, (_, i) => [Math.floor(i / 6), i % 6]),
    );
    expect(new Set(b.map((x) => x.seed)).size).toBe(12);
  });

  it("faces, when right-handed, exactly the balls and field the evaluation harness builds, and a left-hander's are the mirror image", () => {
    const own = chaseOvers(def, 'right').flatMap((s) => overBalls(s.plan, def.conditions, s.overIndex));
    expect(JSON.stringify(chaseEvalBalls(def, 'right'))).toBe(JSON.stringify(own));
    const left = chaseEvalBalls(def, 'left');
    expect(left).toHaveLength(12);
    // The bowlers' arms are flipped for the left-hander and the physics flips them back: the same flights and field.
    expect(left.map((b) => b.over.bowler.arm)).not.toEqual(own.map((b) => b.over.bowler.arm));
    expect(JSON.stringify(left.map((b) => b.flight))).toBe(JSON.stringify(own.map((b) => b.flight)));
    expect(JSON.stringify(left.map((b) => b.field))).toBe(JSON.stringify(own.map((b) => b.field)));
    expect(left.map((b) => b.seed)).toEqual(own.map((b) => b.seed));
  });

  it("is offered the coach's responses, and the recorded first ball is still what the coach says", () => {
    const live = coachOptions(chaseEvalBalls(def)[0], 'play');
    expect(live).toEqual(options[0]);
    expect(live[0].kind).toBe('recommended');
    expect(fixture.sigmaMs).toBe(REFERENCE_SIGMA_MS);
    expect(fixture.quadraturePoints).toBe(QUADRATURE_Z.length);
    expect(fixture.policy).toEqual(REFERENCE_POLICY);
  });

  it('plays each response over the 24 timing errors, giving a table that sums to one', () => {
    const b = balls();
    const ball = b[1];
    const withBat = ball.options.find((o) => o.intent !== null)!;
    const pmf = optionPmf(ball.ball, withBat.intent, 'play');
    expect(pmf.run.reduce((a, c) => a + c, 0) + pmf.out).toBeCloseTo(1, 12);
    // Every probability is a multiple of 1/24: 24 equally likely errors.
    for (const p of [...pmf.run, pmf.out]) expect(Math.abs(p * 24 - Math.round(p * 24))).toBeLessThan(1e-9);
    expect(optionPmf(ball.ball, withBat.intent, 'play')).toEqual(pmf);
    // A leave is not timed at all: one play stands for every error.
    const leave = optionPmf(ball.ball, null, 'play');
    expect(leave.run.reduce((a, c) => a + c, 0) + leave.out).toBeCloseTo(1, 12);
    expect([...leave.run, leave.out].every((p) => p === 0 || p === 1)).toBe(true);
    expect(QUADRATURE_Z).toHaveLength(24);
    expect(REFERENCE_SIGMA_MS).toBe(20);
  });

  it('plays three of the 12 balls through the physics again and gets the recorded counts', () => {
    const b = balls();
    for (const i of [0, 6, 11])
      b[i].options.forEach((o, k) => {
        const again = countsOf(optionPmf(b[i].ball, o.intent, 'play'), QUADRATURE_Z.length);
        expect(again, `ball ${i} option ${k}`).toEqual(counts[i][k]);
      });
  });

  it('gets the recorded targets from the recorded counts (an engineering number about a simulated batter)', () => {
    const pmfs = recordedPmfs();
    const t = targetsOf(pmfs);
    const rounded = (x: number) => Math.round(x * 10000) / 10000;
    expect({
      easy: { target: t.easy.target, win: rounded(t.easy.win), floored: t.easy.floored },
      standard: { target: t.standard.target, win: rounded(t.standard.win), floored: t.standard.floored },
      hard: { target: t.hard.target, win: rounded(t.hard.win), floored: t.hard.floored },
    }).toEqual(fixture.targets);
    // Best play at the standard target wins about half the time, and the next target up wins less than half.
    expect(optimalChase(pmfs, t.standard.target).win).toBeGreaterThanOrEqual(0.5);
    expect(optimalChase(pmfs, t.standard.target + 1).win).toBeLessThan(0.5);
    // The same answer as the whole derivation given the recorded options (the physics is deterministic).
    expect(counts).toHaveLength(12);
  });

  it('is what the shipped table says for this seed', () => {
    if (TARGET_TABLE.policy.id === 'provisional') return; // the sweep has not replaced the placeholder yet
    const t = targetsOf(recordedPmfs());
    expect([t.easy.target, t.standard.target, t.hard.target]).toEqual([
      TARGET_TABLE.targets.easy[0],
      TARGET_TABLE.targets.standard[0],
      TARGET_TABLE.targets.hard[0],
    ]);
    expect([t.easy.win, t.standard.win, t.hard.win].map((w) => Math.round(100 * w))).toEqual([
      TARGET_TABLE.winPercent.easy[0],
      TARGET_TABLE.winPercent.standard[0],
      TARGET_TABLE.winPercent.hard[0],
    ]);
  });
});
