// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FieldLayout } from '@/contracts/practice';
import { rngFromKey } from '@/engine/prng';
import { autoField, pointFromStriker } from '@/physics/field';
import { simulateFielding } from '@/physics/fielding';
import { RUNNING, autoRuns, runCompletionS, runEvents, sprintS } from '@/physics/running';
import { stubShot, type StubShot } from '../practice/game/stubTrajectory';

const FIELD = autoField({ family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'r' }, 'balanced');
/** Keeper, bowler and nine fielders all on the off side: a leg-side ball has to be chased a long way. */
const OFF_SIDE: FieldLayout = {
  id: 'test/off-side',
  fielders: [
    FIELD.fielders.find((f) => f.role === 'keeper')!,
    FIELD.fielders.find((f) => f.role === 'bowler')!,
    ...[[30, 25], [60, 22], [90, 22], [120, 15], [150, 14], [45, 50], [75, 55], [105, 52], [135, 45]].map(([b, d], i) => ({ id: `o${i}`, role: 'cover' as const, ...pointFromStriker(b, d) })),
  ],
};

function runsFor(shot: StubShot, field: FieldLayout = FIELD): number | 'boundary' | 'caught' {
  const ball = stubShot(shot);
  const r = simulateFielding(field, ball);
  if (r.play.kind === 'boundary') return 'boundary';
  if (r.play.kind === 'caught') return 'caught';
  return autoRuns(ball.t0, r.play.returnT).runs;
}

describe('run times', () => {
  it('one in about 3.2 s, two in about 6.3 s, three in about 9.3 s', () => {
    const [one, two, three] = runCompletionS();
    expect(one).toBeCloseTo(3.23, 2);
    expect(two).toBeCloseTo(6.26, 2);
    expect(three).toBeCloseTo(9.3, 2);
    expect(sprintS()).toBeGreaterThan(2.5);
    expect(sprintS()).toBeLessThan(3.2);
  });
});

describe('autoRuns', () => {
  const [one, two, three] = runCompletionS();
  const m = RUNNING.SAFETY_MARGIN_S;
  it('takes a run only with the safety margin to spare', () => {
    expect(autoRuns(0, one + m - 0.01).runs).toBe(0);
    expect(autoRuns(0, one + m + 0.01).runs).toBe(1);
    expect(autoRuns(0, two + m - 0.01).runs).toBe(1);
    expect(autoRuns(0, two + m + 0.01).runs).toBe(2);
    expect(autoRuns(0, three + m + 0.01).runs).toBe(3);
    expect(autoRuns(0, 60).runs).toBe(RUNNING.MAX_RUNS);
    expect(autoRuns(5, 5 + one + m + 0.01).completedT).toEqual([5 + one]);
  });

  it('never risks a run-out: every completed run is made with the margin before the ball is back', () => {
    const rng = rngFromKey('running|margin');
    for (let i = 0; i < 2000; i++) {
      const t0 = 0.4 + rng.float() * 0.6;
      const ret = t0 + rng.float() * 14;
      const r = autoRuns(t0, ret);
      for (const t of r.completedT) expect(ret - t).toBeGreaterThanOrEqual(m - 1e-9);
      const times: number[] = runCompletionS();
      if (r.runs < RUNNING.MAX_RUNS) expect(ret - (t0 + times[r.runs])).toBeLessThan(m);
    }
  });

  it('emits one run event per completed run', () => {
    const r = autoRuns(0.6, 0.6 + two + m + 0.1);
    expect(runEvents(r)).toEqual([
      { t: 0.6 + one, kind: 'run', completed: 1 },
      { t: 0.6 + two, kind: 'run', completed: 2 },
    ]);
  });
});

describe('runs come from placement and speed', () => {
  it('0 straight at a fielder, 1 pushed into a gap, 2 chased in the deep, 3 chased a long way', () => {
    expect(runsFor({ bearingDeg: 21, speedKph: 100, elevationDeg: 2 })).toBe(0);
    expect(runsFor({ bearingDeg: 75, speedKph: 25, elevationDeg: 0, rollDecel: 2.5 })).toBe(1);
    expect(runsFor({ bearingDeg: 42, speedKph: 75, elevationDeg: 1, rollDecel: 2 })).toBe(2);
    expect(runsFor({ bearingDeg: -45, speedKph: 60, elevationDeg: 1, rollDecel: 1.5 }, OFF_SIDE)).toBe(3);
    expect(runsFor({ bearingDeg: 42, speedKph: 110, elevationDeg: 3 })).toBe('boundary');
  });

  it('a harder hit into the same gap earns at least as many runs until it beats the field', () => {
    let last = -1;
    for (const kph of [20, 40, 60, 75, 90]) {
      const r = runsFor({ bearingDeg: -45, speedKph: kph, elevationDeg: 1, rollDecel: 1.5 }, OFF_SIDE);
      const v = r === 'boundary' ? 4 : r === 'caught' ? -1 : r;
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
    expect(last).toBe(4);
  });
});
