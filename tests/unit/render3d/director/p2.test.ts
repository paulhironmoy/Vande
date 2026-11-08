// @vitest-environment node
/**
 * P2 additions to the Director core (lead rulings after P1, UNIFIED-SPEC.md): the run's start and the follow-through's
 * end as anchors (the bowler's life channels are off for the whole run-up, the head and gaze overlay stays on), the
 * sliced bake (the same plan, bit for bit, however it is sliced), the 'space' head mode the stage closes the loop on,
 * and the cross-fade of a looping scene's wrap. Reason: the result-arrival frame cannot take a bake, the striker's head
 * must follow the pose he is actually drawn in, and the 60 s idle must not pop at its wrap.
 */
import { describe, expect, it } from 'vitest';
import { CH, CHANNELS, SCALE, prepare, sample, sampleWrapped, startPrepare, type DirectorAnchors } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng, STOCK } from './world';
import { frameOf, record, recordFile, timeOf, traceHash, val } from './gates';

recordFile('p2');

const LIFE = [CH.breath, CH.swayX, CH.swayZ, CH.swayRoll];

describe('the sliced bake', () => {
  it('gives the same plan, bit for bit, however many slices it takes (overlay mode, space mode, a reused trace)', () => {
    const r = rng(7);
    for (let k = 0; k < 12; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: k % 2 ? 'bowler' : 'striker', key: `slice#0.${k}`, series: 'pace' });
      for (const mode of ['overlay', 'space'] as const) {
        const b: DirectorAnchors = { ...a, headMode: mode };
        const whole = prepare(b);
        const job = startPrepare(b);
        let slices = 0;
        while (!job.advance(1)) slices++;
        expect(slices, 'it took more than one slice').toBeGreaterThan(4);
        expect(traceHash(job.plan!)).toBe(traceHash(whole));
        expect(Array.from(job.plan!.trace)).toEqual(Array.from(whole.trace));
        // a job asked for ten slices at a time is the same
        const j2 = startPrepare(b);
        while (!j2.advance(10)) {
          /* sliced */
        }
        expect(traceHash(j2.plan!)).toBe(traceHash(whole));
        // reuse in slices equals reuse at once
        const until = a.release! + 300;
        const reused = prepare(b, { reuse: { plan: whole, untilMs: until } });
        const j3 = startPrepare(b, { reuse: { plan: whole, untilMs: until } });
        while (!j3.advance(3)) {
          /* sliced */
        }
        expect(traceHash(j3.plan!)).toBe(traceHash(reused));
      }
    }
  });

  it('a job is not done before its first slice, has no plan until done, and does nothing once done', () => {
    const d = delivery(STOCK);
    const job = startPrepare(anchorsFor(d, { role: 'striker', key: 'job#0.0' }));
    expect(job.done).toBe(false);
    expect(job.plan).toBeNull();
    while (!job.advance(5)) {
      /* run */
    }
    const plan = job.plan;
    expect(plan).not.toBeNull();
    expect(job.advance(5)).toBe(true);
    expect(job.plan).toBe(plan);
  });
});

describe('space mode: the head channels are the head in space and the stage closes the loop', () => {
  it('never asks for the clip head, and the head channels hold the target the eyes and head share', () => {
    const d = delivery(STOCK);
    for (const role of ['bowler', 'striker'] as const) {
      let asked = 0;
      const a = anchorsFor(d, { role, key: 'space#0.0', series: 'pace' });
      const p = prepare({ ...a, headMode: 'space', clipHead: () => void asked++ });
      expect(asked).toBe(0);
      // the head target is limited softly (so the quantised channel never clips), the gaze is the raw gaze, and from the
      // gather to the release (the bowler) or in the wait (the striker) the eyes and the head are on the same thing
      let maxHead = 0;
      for (let i = 0; i < p.n; i++) maxHead = Math.max(maxHead, Math.abs(val(p, i, CH.headYaw)) / 62, Math.abs(val(p, i, CH.headPitch)) / 40);
      expect(maxHead).toBeLessThanOrEqual(1);
      const gap: number[] = [];
      const from = role === 'bowler' ? d.timeline.gather : 200;
      const to = role === 'bowler' ? d.timeline.release : d.timeline.release - 700;
      for (let i = frameOf(p, from); i < frameOf(p, to); i++) gap.push(Math.hypot(val(p, i, CH.gazeYaw) - val(p, i, CH.headYaw), val(p, i, CH.gazePitch) - val(p, i, CH.headPitch)));
      gap.sort((x, y) => x - y);
      record(`space.${role}.gazeMinusHead`, { p50: gap[Math.floor(0.5 * gap.length)], p95: gap[Math.floor(0.95 * (gap.length - 1))], max: gap[gap.length - 1] });
      expect(gap[Math.floor(0.95 * (gap.length - 1))]).toBeLessThan(10); // the eyes lead the head through a gaze shift (the glance to the batter at the gather, the lock-on to the ball)
    }
  });

  it('is the same plan as the overlay mode for a head whose clip points down the zero axis, except that the overlay is limited and Reduced Motion scales only it', () => {
    const d = delivery(STOCK);
    const a = anchorsFor(d, { role: 'striker', key: 'space#0.1', clip: 'none' });
    const rm = { ...a, reducedMotion: true };
    const o = prepare({ ...rm, headMode: 'overlay', clipHead: (_t, out) => out.fill(0) });
    const s = prepare({ ...rm, headMode: 'space' });
    // Reduced Motion halves the overlay (P1: a gain on the clip-relative turn); in space mode it is the stage's gain
    // on the turn it still has to make, so the target itself is not scaled.
    let ratio = 0;
    let n = 0;
    for (let i = 0; i < o.n; i++) {
      const so = val(o, i, CH.headYaw);
      const ss = val(s, i, CH.headYaw);
      if (Math.abs(ss) > 1) {
        ratio += so / ss;
        n++;
      }
    }
    expect(n).toBeGreaterThan(10);
    expect(ratio / n).toBeGreaterThan(0.4);
    expect(ratio / n).toBeLessThan(0.6);
  });
});

describe('the bowler: life is off for the whole run-up (runStart), eyes go idle after the follow-through (followEnd)', () => {
  const stand = (extra: Partial<DirectorAnchors> = {}) => {
    const d = delivery({ ...STOCK, outcome: 'dot' });
    d.timeline.end = d.timeline.release + 14_000;
    return { d, a: { ...anchorsFor(d, { role: 'bowler', key: 'run#0.0', series: 'pace' }), ...extra } };
  };

  it('breath, sway and roll are exactly zero from the run start to release + 150 ms, alive before it and back after', () => {
    for (let k = 0; k < 30; k++) {
      const { d, a } = stand({ runStart: 900, person: `look-${k}`, key: `run#0.${k}` });
      const p = prepare(a);
      const t = d.timeline;
      let inside = 0;
      let before = 0;
      let after = 0;
      for (let i = 0; i < p.n; i++) {
        const tm = timeOf(p, i);
        const any = LIFE.some((c) => p.trace[i * CHANNELS + c] !== 0);
        if (tm >= 900 && tm <= t.release + 150) {
          expect(any, `ball ${k} t=${tm.toFixed(0)}`).toBe(false);
          inside++;
        } else if (tm > 600 && tm < 850 - 1) before += any ? 1 : 0;
        else if (tm > t.release + 1500) after += any ? 1 : 0;
      }
      expect(inside).toBeGreaterThan(100);
      expect(before, 'alive in the second before the run').toBeGreaterThan(0);
      expect(after, 'alive again after the delivery').toBeGreaterThan(100);
    }
    record('runStart.checked', 30);
  });

  it('without runStart nothing changes (P1: off from the gather), and the head and gaze overlay is on in the run-up either way', () => {
    const { a } = stand();
    const base = prepare(a);
    const same = prepare({ ...a, runStart: undefined, followEnd: undefined, seamMs: undefined, headMode: undefined });
    expect(traceHash(same)).toBe(traceHash(base));
    const early = prepare({ ...a, runStart: 300 });
    // the gaze moves in the run-up (a dwell on the ground now and then), whatever the life channels do
    let moved = 0;
    for (let i = frameOf(early, 400) + 1; i < frameOf(early, a.gather! - 300); i++) if (Math.abs(val(early, i, CH.headPitch) - val(early, i - 1, CH.headPitch)) > 0.01) moved++;
    expect(moved).toBeGreaterThan(50);
  });

  it('draws only change what follows the anchors: the events before the follow-through are bit-equal with and without followEnd', () => {
    const { d, a } = stand();
    const t = d.timeline;
    const without = prepare(a);
    const withEnd = prepare({ ...a, followEnd: t.release + 3500 });
    // everything before followEnd is the same; after it the eyes keep dwelling (more fixations than the single ground look)
    const i1 = frameOf(without, t.release + 3500);
    for (let i = 0; i < i1; i++) for (let c = 0; c < CHANNELS; c++) expect(withEnd.trace[i * CHANNELS + c], `frame ${i} channel ${c}`).toBe(without.trace[i * CHANNELS + c]);
    expect(withEnd.fix.length).toBeGreaterThan(without.fix.length);
    const g0 = val(withEnd, frameOf(withEnd, t.release + 9000), CH.gazePitch);
    expect(Number.isFinite(g0)).toBe(true);
  });
});

describe('a looping scene: the wrap is a cross-fade, and no blink falls across it', () => {
  const SEAM = 600;
  const loop = (key: string, role: 'bowler' | 'striker' = 'striker') => {
    const a = idleAnchors(role, key, 60_000);
    return prepare({ ...a, start: -SEAM, seamMs: SEAM, headMode: 'space' });
  };

  it('every channel arrives at the value the next loop starts from (no step at the wrap beyond a normal frame)', () => {
    const out = new Float32Array(CHANNELS);
    const scratch = new Float32Array(CHANNELS);
    const start = new Float32Array(CHANNELS);
    let worstStep = 0;
    let worstWrap = 0;
    for (let k = 0; k < 40; k++) {
      const p = loop(`wrap#${k}`, k % 2 ? 'bowler' : 'striker');
      sampleWrapped(p, 0, 60_000, SEAM, start, scratch);
      for (const c of [CH.headYaw, CH.headPitch, CH.gazeYaw, CH.gazePitch, CH.breath, CH.swayX, CH.swayZ, CH.swayRoll, CH.blinkL, CH.blinkR]) {
        // one frame before the wrap against the first frame after it, against the same step anywhere else in the loop
        sampleWrapped(p, 60_000 - 1000 / 60, 60_000, SEAM, out, scratch);
        const before = out[c];
        sampleWrapped(p, 60_000, 60_000, SEAM, out, scratch);
        const at = out[c];
        worstWrap = Math.max(worstWrap, Math.abs(at - start[c]));
        const step = Math.abs(at - before);
        worstStep = Math.max(worstStep, c === CH.breath ? step / 0.15 : c === CH.swayX || c === CH.swayZ ? step / 0.5 : c === CH.swayRoll ? step / 0.05 : step / 2);
      }
    }
    record('wrap', { worstValueGap: worstWrap, worstStepOverNormalCap: worstStep });
    // the loop reaches exactly the start's value (the pre-roll sample at 0), and its last frame steps like any other
    expect(worstWrap).toBeLessThan(1e-3);
    expect(worstStep).toBeLessThan(1);
  });

  it('is plain `sample` before the fade, and `sample` of the pre-roll at the end of it', () => {
    const p = loop('wrap#plain');
    const a = new Float32Array(CHANNELS);
    const b = new Float32Array(CHANNELS);
    const s = new Float32Array(CHANNELS);
    sampleWrapped(p, 30_000, 60_000, SEAM, a, s);
    sample(p, 30_000, b);
    expect(Array.from(a)).toEqual(Array.from(b));
    sampleWrapped(p, 60_000, 60_000, SEAM, a, s);
    sample(p, 0, b);
    for (let c = 0; c < CHANNELS; c++) expect(Math.abs(a[c] - b[c])).toBeLessThan(SCALE[c] * 2 + 1e-6);
  });

  it('no blink is closed (or closing) in the last second of the loop or the first 300 ms, in 200 loops', () => {
    for (let k = 0; k < 200; k++) {
      const p = loop(`seam#${k}`, k % 2 ? 'bowler' : 'striker');
      for (let i = 0; i < p.n; i++) {
        const tm = timeOf(p, i);
        if (tm < 300 || tm > 60_000 - 900) {
          expect(val(p, i, CH.blinkL), `loop ${k} t=${tm.toFixed(0)}`).toBe(0);
          expect(val(p, i, CH.blinkR), `loop ${k} t=${tm.toFixed(0)}`).toBe(0);
        }
      }
    }
  });

  it('keeps blinking in the rest of the loop (the seam does not switch them off) at about the same rate', () => {
    let seam = 0;
    let plain = 0;
    for (let k = 0; k < 30; k++) {
      const a = idleAnchors('striker', `rate#${k}`, 60_000);
      const s = prepare({ ...a, start: -SEAM, seamMs: SEAM });
      const n = prepare(a);
      const count = (p: typeof s) => {
        let c = 0;
        for (let i = 1; i < p.n; i++) if (val(p, i - 1, CH.blinkL) < 0.5 && val(p, i, CH.blinkL) >= 0.5) c++;
        return c;
      };
      seam += count(s);
      plain += count(n);
    }
    expect(seam / plain).toBeGreaterThan(0.85);
    expect(seam / plain).toBeLessThan(1.15);
  });
});
