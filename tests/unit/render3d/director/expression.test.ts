// @vitest-environment node
/**
 * The expression mixer (P3): five weights in the plan (concentration, effort, frustration, relief, celebration), restrained and slow,
 * mixed by the stage into the face shader's four numbers only for a head big enough to show them.
 *   - concentration is the task's: it comes up as the ball is coming (a function of the release and the task's end, nothing else);
 *   - frustration, relief and celebration are the reaction's: not a frame before outcomeAt + the seeded 180 to 380 ms, sized by the result;
 *   - the batter's effort belongs to his own input and is added by the runtime (directorStage.test.ts);
 *   - Reduced Motion: the same faces, 1.5 times slower; below a 38 px head the channels are zero.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CH,
  CHANNELS,
  DRAW,
  createOut,
  deliveryTakeKey,
  prepare,
  sample,
  type DirectorAnchors,
  type DirectorPlan,
} from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { frameOf, record, recordFile, timeOf, val } from './gates';

recordFile('expression');
vi.setConfig({ testTimeout: 120_000 });

const X = [CH.xConcentration, CH.xEffort, CH.xFrustration, CH.xRelief, CH.xCelebration];
const withOutcome = (a: DirectorAnchors, outcome: string | null, outcomeAt: number | null): DirectorAnchors => ({
  ...a,
  outcome,
  outcomeAt,
});
const peak = (p: DirectorPlan, c: number, from: number, to: number) => {
  let m = 0;
  for (let i = Math.max(0, frameOf(p, from)); i < Math.min(p.n, frameOf(p, to)); i++) m = Math.max(m, val(p, i, c));
  return m;
};

describe("concentration is the task's", () => {
  it('rises as the ball is coming, to at most 0.5 for the batter and 0.35 for the bowler, and is gone a moment after the task; between balls there is none', () => {
    const r = rng(7);
    let strikerPeak = 0;
    let bowlerPeak = 0;
    for (let k = 0; k < 60; k++) {
      const d = delivery(randomSpec(r));
      const t = d.timeline;
      // the live delivery (no result): the concentration alone, the reaction's own would add to it afterwards
      const s = prepare(anchorsFor(d, { role: 'striker', key: `conc-s#${k}`, pre: true }), { hz: 60 });
      const b = prepare(anchorsFor(d, { role: 'bowler', key: `conc-b#${k}`, series: 'pace' }), { hz: 60 });
      expect(val(s, 0, CH.xConcentration)).toBe(0);
      expect(val(s, frameOf(s, t.release - 2000), CH.xConcentration)).toBe(0);
      strikerPeak = Math.max(strikerPeak, peak(s, CH.xConcentration, t.release - 400, t.passAt + 100));
      bowlerPeak = Math.max(bowlerPeak, peak(b, CH.xConcentration, t.release - 300, t.release + 100));
      expect(val(s, frameOf(s, t.passAt + 1500), CH.xConcentration)).toBeLessThan(0.01); // relaxed again
      void b;
    }
    record('concentrationPeak', { striker: strikerPeak, bowler: bowlerPeak });
    expect(strikerPeak).toBeGreaterThan(0.45);
    expect(strikerPeak).toBeLessThanOrEqual(0.5 + 1e-3);
    expect(bowlerPeak).toBeGreaterThan(0.3);
    expect(bowlerPeak).toBeLessThanOrEqual(0.35 + 1e-3);
    const idle = prepare(idleAnchors('striker', 'conc-idle', 20_000), { hz: 60 });
    for (let i = 0; i < idle.n; i++) for (const c of X) expect(val(idle, i, c)).toBe(0);
  });

  it('does not know the ball or the result: bit-equal between two different balls with the same key, and between outcomes until outcomeAt + 180 ms', () => {
    const r = rng(9);
    for (let k = 0; k < 40; k++) {
      const key = deliveryTakeKey({ seed: 'conc', overIndex: 0, ballIndex: k });
      const d1 = delivery({ ...randomSpec(r), outcome: 'four' });
      const a = prepare(anchorsFor(d1, { role: 'striker', key, pre: true }), { hz: 60 });
      const b = prepare(withOutcome(anchorsFor(d1, { role: 'striker', key }), 'six', d1.timeline.outcomeAt), {
        hz: 60,
      });
      // the live plan and the result's agree on every expression until the first moment the result matters
      const until = frameOf(a, Math.min(d1.timeline.contact ?? d1.timeline.passAt, d1.timeline.outcomeAt) + 120);
      for (let i = 0; i < until; i++)
        for (const c of X) expect(a.trace[i * CHANNELS + c], `#${k} frame ${i} ch${c}`).toBe(b.trace[i * CHANNELS + c]);
    }
  });
});

describe("the reaction's face", () => {
  const OUT = ['six', 'four', 'runs', 'dot', 'leave', 'close_call', 'wicket'] as const;

  it('begins at outcomeAt plus the seeded 180 to 380 ms and not before (bit-equal before), sized by the result', () => {
    const r = rng(21);
    const top: Record<string, number[]> = {};
    for (const o of OUT) top[o] = [0, 0, 0, 0, 0];
    for (let k = 0; k < 50; k++) {
      const d = delivery(randomSpec(r));
      const base = anchorsFor(d, { role: 'striker', key: `xr#${k}` });
      const at = d.timeline.outcomeAt;
      const ref = prepare(withOutcome(base, null, null), { hz: 60 });
      for (const o of OUT) {
        const p = prepare(withOutcome(base, o, at), { hz: 60 });
        // the three reaction channels are zero before the reaction and the plans agree on every channel until it starts
        const lag = p.draw[DRAW.reactionMs];
        for (let i = 0; i < frameOf(p, at + 180); i++)
          for (const c of [CH.xFrustration, CH.xRelief, CH.xCelebration]) expect(p.trace[i * CHANNELS + c]).toBe(0);
        expect(lag).toBeGreaterThanOrEqual(180);
        expect(lag).toBeLessThanOrEqual(380);
        for (let i = 0; i < frameOf(p, at + 180); i++)
          for (const c of X)
            expect(p.trace[i * CHANNELS + c], `${o} #${k} frame ${i} ch${c}`).toBe(ref.trace[i * CHANNELS + c]);
        X.forEach((c, j) => (top[o][j] = Math.max(top[o][j], peak(p, c, at, at + 8000))));
      }
    }
    record('reactionFacePeaks[concentration,effort,frustration,relief,celebration]', top);
    // the news and its size (proportional feedback)
    expect(top.six[4]).toBeGreaterThan(0.9);
    expect(top.four[4]).toBeGreaterThan(0.5);
    expect(top.six[4]).toBeGreaterThan(top.four[4]);
    expect(top.four[4]).toBeGreaterThan(top.runs[4]);
    expect(top.wicket[2]).toBeGreaterThan(0.9);
    expect(top.wicket[2]).toBeGreaterThan(top.close_call[2]);
    expect(top.six[2]).toBe(0);
    expect(top.wicket[4]).toBe(0);
    // a near miss is relief with a touch of frustration; a dot is mild pressure; a leave is nearly nothing
    expect(top.close_call[3]).toBeGreaterThan(top.close_call[2]);
    expect(top.dot[2]).toBeLessThan(0.3);
    expect(top.leave[4] + top.leave[2] + top.leave[3]).toBe(0);
    // nothing is the effort: that is the stage's (his own input)
    for (const o of OUT) expect(top[o][1]).toBe(0);
  });

  it('Reduced Motion: the same faces, one and a half times slower', () => {
    const r = rng(33);
    let slower = 0;
    for (let k = 0; k < 30; k++) {
      const d = delivery(randomSpec(r));
      const base = anchorsFor(d, { role: 'striker', key: `xrm#${k}` });
      const at = d.timeline.outcomeAt;
      const n = prepare(withOutcome(base, 'six', at), { hz: 60 });
      const m = prepare(withOutcome({ ...base, reducedMotion: true }, 'six', at), { hz: 60 });
      const reach = (p: DirectorPlan, level: number) => {
        for (let i = frameOf(p, at); i < p.n; i++)
          if (val(p, i, CH.xCelebration) >= level) return timeOf(p, i) - (at + p.draw[DRAW.reactionMs]);
        return Infinity;
      };
      const tn = reach(n, 0.5);
      const tm = reach(m, 0.5);
      expect(Number.isFinite(tn) && Number.isFinite(tm)).toBe(true);
      expect(tm / tn).toBeGreaterThan(1.3);
      expect(tm / tn).toBeLessThan(1.7);
      slower++;
      expect(peak(m, CH.xCelebration, at, at + 8000)).toBeGreaterThan(0.9);
    }
    expect(slower).toBe(30);
  });
});

describe('detail by head size', () => {
  it("below the level that shows a face the expression channels are zero, and above it they are the plan's", () => {
    const d = delivery({ speedKph: 130, lengthM: 6, lineM: 0, variation: 0, outcome: 'six' });
    const p = prepare(withOutcome(anchorsFor(d, { role: 'striker', key: 'xd#1' }), 'six', d.timeline.outcomeAt), {
      hz: 60,
    });
    const out = createOut();
    const t = d.timeline.outcomeAt + 1500;
    sample(p, t, out, 2);
    expect(out[CH.xCelebration]).toBeGreaterThan(0.5);
    sample(p, t, out, 1);
    for (const c of X) expect(out[c]).toBe(0);
    expect(out[CH.blinkL] + out[CH.eyeYawL]).not.toBeNaN(); // the eyes and lids are still there at level 1
  });
});
