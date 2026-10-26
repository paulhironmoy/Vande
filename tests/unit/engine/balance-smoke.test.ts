// @vitest-environment node
/**
 * Fast balance guard for CI: 2,000 mixed-population matches through the real engine (the full 100,000-match study is
 * `node scripts/simulate-balance.mjs`). Bounds are wide enough for sampling noise and tight enough to catch a broken
 * rule: scoring, wickets, boundaries, ties, seat fairness, skill and strategy must stay where the tuning put them.
 */
import { describe, expect, it } from 'vitest';
import { battingCell, runMixed } from '@/engine/sim/experiments';

describe('balance smoke simulation', () => {
  it('2,000 mixed matches stay inside the tuned bounds with no impossible outcome', async () => {
    const st = await runMixed('ci-smoke', 0, 2000, 100, { optimiser: false });
    expect(st.anomalyCount, st.anomalies.slice(0, 5).join(' | ')).toBe(0);
    expect(st.verified).toBe(20);
    expect(st.verifyFailures).toEqual([]);

    const runs = st.runsHist.reduce((s, v, i) => s + v * i, 0) / st.innings;
    const wickets = (st.wicketsHist[1] + 2 * st.wicketsHist[2]) / st.innings;
    const boundaries = (st.balls[5] + st.balls[6]) / st.innings;
    expect(runs).toBeGreaterThan(6.5);
    expect(runs).toBeLessThan(10.5);
    expect(wickets).toBeGreaterThan(0.35);
    expect(wickets).toBeLessThan(0.75);
    expect(boundaries).toBeGreaterThan(0.7);
    expect(boundaries).toBeLessThan(1.4);
    expect(st.wicketsHist[2] / st.innings).toBeLessThan(0.2);

    const tied = st.superBallUsed / st.matches;
    expect(tied).toBeGreaterThan(0.02);
    expect(tied).toBeLessThan(0.12);
    const decided = st.seatWins[0] + st.seatWins[1];
    expect(Math.abs(st.seatWins[0] / decided - 0.5)).toBeLessThan(0.04);

    // Strategy and skill both matter.
    const r = (k: string) => st.batStrategy[k].runs / st.batStrategy[k].innings;
    expect(r('oracle')).toBeGreaterThan(r('heuristic'));
    expect(r('heuristic')).toBeGreaterThan(r('random') * 1.5);
    expect(r('fixed:defend')).toBeLessThan(2);
    const sk = (k: string) => st.batSkill[k].runs / st.batSkill[k].innings;
    expect(sk('oracle/skilled')).toBeGreaterThan(sk('oracle/unskilled'));
  }, 120_000);

  it('reading the ball beats lofting everything on every pitch', () => {
    for (const pitch of ['green', 'hard', 'slow'] as const) {
      const oracle = battingCell({ strategy: 'oracle', skill: 'average' }, pitch, `ci-${pitch}`, 0, 400, { optimiser: false });
      const loft = battingCell({ strategy: 'fixed:loft', skill: 'average' }, pitch, `ci-${pitch}`, 0, 400, { optimiser: false });
      expect(oracle.anomalies + loft.anomalies).toBe(0);
      expect(oracle.runs / oracle.innings).toBeGreaterThan((loft.runs / loft.innings) * 1.05);
      expect(loft.wickets / loft.innings).toBeGreaterThan(oracle.wickets / oracle.innings);
    }
  }, 120_000);
});
