// @vitest-environment node
/// <reference types="node" />
/**
 * Gate G-replay: the same person, delivery key and anchors give the same plan and trace, bit for bit, whatever was
 * built before, in whatever order the frames are read. Reason: a replay rebuilds the Director from the result alone and
 * must show the frames the live delivery showed; a wall clock or hidden state in the old blink made them differ.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CHANNELS,
  SCALE,
  createOut,
  deliveryTakeKey,
  prepare,
  sample,
  type DirectorPlan,
  type Role,
} from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, OUTCOMES, STOCK, type BallSpec } from './world';
import { maxDiff, record, recordFile, traceHash } from './gates';

recordFile('replay');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const same = (a: Float32Array | Int16Array, b: Float32Array | Int16Array) =>
  a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
const samePlan = (a: DirectorPlan, b: DirectorPlan) =>
  a.key === b.key &&
  a.n === b.n &&
  same(a.trace, b.trace) &&
  same(a.fix, b.fix) &&
  same(a.blink, b.blink) &&
  same(a.micro, b.micro) &&
  same(a.draw, b.draw) &&
  same(a.amp, b.amp);

const build = (role: Role, k: number, outcome: BallSpec['outcome'], extra: { reducedMotion?: boolean } = {}) => {
  const d = delivery({ ...STOCK, outcome, lengthM: 3 + (k % 7), speedKph: 100 + 5 * (k % 9) });
  const key = deliveryTakeKey({ seed: 'replay', overIndex: Math.floor(k / 6), ballIndex: k % 6 });
  return prepare(anchorsFor(d, { role, key, series: 'pace', ...extra }));
};

describe('G-replay: identity', () => {
  it('rebuilding the same delivery gives identical plans and traces (difference exactly 0) for both actors and every outcome', () => {
    let worst = 0;
    let frames = 0;
    OUTCOMES.forEach((outcome, k) => {
      for (const role of ['bowler', 'striker'] as const) {
        const a = build(role, k, outcome);
        const b = build(role, k, outcome);
        expect(samePlan(a, b), `${role} ${outcome}`).toBe(true);
        worst = Math.max(worst, maxDiff(a, b, 0, a.n));
        frames += a.n;
      }
    });
    record('replay.maxChannelDifference', worst);
    record('replay.framesCompared', frames);
    expect(worst).toBe(0);
  });

  it('is not changed by what was built in between (no hidden state)', () => {
    const first = build('striker', 4, 'four');
    build('bowler', 9, 'caught', { reducedMotion: true });
    prepare(idleAnchors('striker', 'idle#9', 20_000));
    const again = build('striker', 4, 'four');
    expect(traceHash(first)).toBe(traceHash(again));
    expect(samePlan(first, again)).toBe(true);
  });

  it('reads the same value at the same time whatever order the frames are read in (scrubbing equals playing)', () => {
    const plan = build('bowler', 2, 'six');
    const times = Array.from({ length: 2000 }, (_, i) => -50 + ((i * 9137) % 9000) + (i % 7) * 0.1371);
    const outA = createOut();
    const outB = createOut();
    const forward = times.map((t) => Array.from(sample(plan, t, outA)));
    const backward = [...times]
      .reverse()
      .map((t) => Array.from(sample(plan, t, outB)))
      .reverse();
    expect(backward).toEqual(forward);
  });

  it('different delivery keys, people and roles give different draws (so no two balls look alike)', () => {
    const base = build('striker', 1, 'four');
    expect(traceHash(build('striker', 2, 'four'))).not.toBe(traceHash(base));
    const d = delivery(STOCK);
    const other = prepare(
      anchorsFor(d, {
        role: 'striker',
        key: deliveryTakeKey({ seed: 'replay', overIndex: 0, ballIndex: 1 }),
        person: 'look-2',
      }),
    );
    const same1 = prepare(
      anchorsFor(d, {
        role: 'striker',
        key: deliveryTakeKey({ seed: 'replay', overIndex: 0, ballIndex: 1 }),
        person: 'look-1',
      }),
    );
    expect(traceHash(other)).not.toBe(traceHash(same1));
    expect(traceHash(prepare(anchorsFor(d, { role: 'bowler', key: 'replay#0.1' })))).not.toBe(
      traceHash(prepare(anchorsFor(d, { role: 'striker', key: 'replay#0.1' }))),
    );
  });
});

describe('G-replay: the trace is the same at any rate it is baked at', () => {
  it('the 60 Hz trace equals the 240 Hz trace at every fourth frame (the rate changes only how often the integrator is written out)', () => {
    for (const role of ['bowler', 'striker'] as const) {
      const d = delivery({ ...STOCK, outcome: 'caught' });
      const a = anchorsFor(d, { role, key: 'rate#0.3', series: 'pace' });
      const lo = prepare(a, { hz: 60 });
      const hi = prepare(a, { hz: 240 });
      let worst = 0;
      for (let i = 0; i < lo.n; i++) {
        for (let c = 0; c < CHANNELS; c++)
          worst = Math.max(worst, Math.abs(lo.trace[i * CHANNELS + c] - hi.trace[4 * i * CHANNELS + c]));
      }
      record(`replay.decimation.${role}`, worst);
      expect(worst).toBe(0);
    }
  });
});

describe('sample: reading the trace', () => {
  const plan = build('striker', 5, 'dot');
  const out = createOut();

  it('returns the stored value exactly on a frame, and a straight line between two frames', () => {
    const k = 100;
    const t = plan.t0 + (k * 1000) / plan.hz;
    sample(plan, t, out);
    for (let c = 0; c < CHANNELS; c++) expect(out[c]).toBe(Math.fround(plan.trace[k * CHANNELS + c] * SCALE[c]));
    const mid = createOut();
    sample(plan, t + 1000 / plan.hz / 2, mid);
    for (let c = 0; c < CHANNELS; c++) {
      const want = ((plan.trace[k * CHANNELS + c] + plan.trace[(k + 1) * CHANNELS + c]) / 2) * SCALE[c];
      expect(Math.abs(mid[c] - want)).toBeLessThan(1e-4 + Math.abs(want) * 1e-6);
    }
  });

  it('holds the first and last frame outside the script (no extrapolation, no NaN)', () => {
    const first = createOut();
    const before = createOut();
    sample(plan, plan.t0, first);
    sample(plan, plan.t0 - 5000, before);
    expect(Array.from(before)).toEqual(Array.from(first));
    const last = createOut();
    const after = createOut();
    sample(plan, plan.t0 + ((plan.n - 1) * 1000) / plan.hz, last);
    sample(plan, plan.t0 + 1e9, after);
    expect(Array.from(after)).toEqual(Array.from(last));
    for (const v of after) expect(Number.isFinite(v)).toBe(true);
  });
});
