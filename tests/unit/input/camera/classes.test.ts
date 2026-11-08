/**
 * DoD CAM-02 and CAM-03: at least 30 trials per class with the swing asserted and byte-equal on a second run; at least 100
 * traces with no swing in them that must give 0 swings. SYNTHETIC traces: they say the mapping is stable, not that a person
 * can produce them.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BODY,
  strokePath,
  synthFrames,
  traceCamera,
  type HandPath,
  type StrokeSpec,
  type TraceCameraResult,
} from '@/input/camera/simulate';

const TRIALS = 30;

function trial(
  spec: StrokeSpec,
  i: number,
  extra: { handedness?: 'right' | 'left'; noiseU?: number } = {},
): TraceCameraResult {
  const frames = synthFrames({
    hand: strokePath({ ...spec, startMs: spec.startMs + (i % 11) * 3 }),
    fps: 30,
    t0: 0,
    durationMs: 3400,
    noiseU: extra.noiseU ?? 0,
    seed: 100 + i,
    mirrored: i % 2 === 1,
    body: { ...DEFAULT_BODY, shoulderFrac: [0.1, 0.14, 0.2, 0.27][i % 4] },
  });
  return traceCamera({ frames, armAtMs: 600, handedness: extra.handedness, sourceMirrored: i % 2 === 1 });
}

const BASE: StrokeSpec = { startMs: 1000, rise: 1.0, riseMs: 350, holdMs: 120, descent: 1.3, downMs: 190, lateral: 0 };
const CLASSES: Record<
  string,
  {
    spec: StrokeSpec;
    check: (r: TraceCameraResult) => void;
    kind: 'attack' | 'defend' | 'leave';
    bearing?: (d: number) => boolean;
  }
> = {
  drive: {
    kind: 'attack',
    bearing: (d) => Math.abs(d) < 30,
    spec: { ...BASE, lateral: 0.15 },
    check: (r) => {
      expect(r.swing?.kind).toBe('attack');
      expect(Math.abs(r.swing?.directionDeg ?? 99)).toBeLessThan(25);
      expect(r.swing?.power).toBeGreaterThan(0.5);
    },
  },
  pull: {
    kind: 'attack',
    bearing: (d) => d < -15,
    spec: { ...BASE, rise: 0.9, descent: 1.0, downMs: 170, lateral: -0.8 },
    check: (r) => {
      expect(r.swing?.kind).toBe('attack');
      expect(r.swing?.directionDeg).toBeLessThan(-25);
      expect(r.swing?.power).toBeGreaterThan(0.5);
    },
  },
  loft: {
    kind: 'attack',
    spec: { ...BASE, rise: 1.3, descent: 1.6, downMs: 150, lateral: 0.2 },
    check: (r) => {
      expect(r.swing?.kind).toBe('attack');
      expect(r.swing?.elevation).toBeGreaterThan(0.4);
      expect(r.swing?.power).toBeGreaterThan(0.7);
    },
  },
  defence: {
    kind: 'defend',
    spec: { ...BASE, rise: 0.35, descent: 0.5, downMs: 520 },
    check: (r) => {
      expect(r.swing?.kind).toBe('defend');
      expect(r.swing?.directionDeg).toBe(0);
    },
  },
  leave: {
    kind: 'leave',
    spec: { ...BASE, descent: 1.2, downMs: 1500 },
    check: (r) => {
      expect(r.gestureCount).toBe(0);
      expect(r.states.map((s) => s.phase)).toContain('intentional_leave');
    },
  },
};

describe('camera classes: 30 trials each, right-handed and left-handed, raw and mirrored, near and far', () => {
  for (const [name, c] of Object.entries(CLASSES)) {
    it(`${name}: 30 clean trials give the exact swing of the class, one gesture at most, and a second run is byte-equal`, () => {
      for (let i = 0; i < TRIALS; i++) {
        const a = trial(c.spec, i);
        c.check(a);
        expect(a.gestureCount).toBeLessThanOrEqual(1);
        expect(JSON.stringify(trial(c.spec, i).swing)).toBe(JSON.stringify(a.swing));
      }
    });

    // With landmark noise (0.02 u) the CLASS must hold in at least 90% of trials; power and loft get noisy (docs section 6).
    it(`${name}: with landmark noise at least 27 of 30 trials are still classified as ${c.kind}`, () => {
      let ok = 0;
      for (let i = 0; i < TRIALS; i++) {
        const r = trial(c.spec, i, { noiseU: 0.02 });
        const kind = r.gestureCount === 0 ? 'leave' : r.swing?.kind;
        if (kind === c.kind && (!c.bearing || c.bearing(r.swing?.directionDeg ?? 0))) ok++;
      }
      expect(ok).toBeGreaterThanOrEqual(27);
    });
  }

  it('a left-hander gets the mirrored bearing of the same body movement, exactly', () => {
    for (let i = 0; i < TRIALS; i++) {
      const r = trial({ ...BASE, lateral: 0.6 }, i);
      const l = trial({ ...BASE, lateral: 0.6 }, i, { handedness: 'left' });
      expect(l.swing?.directionDeg).toBeCloseTo(-(r.swing?.directionDeg ?? 0), 6);
      expect(l.swing?.power).toBe(r.swing?.power);
    }
  });
});

describe('camera: no swing without a swing (DoD CAM-03), 160 traces', () => {
  const still: HandPath = () => ({ h: -1.2, x: 0 });
  const classes: Array<[string, (seed: number) => ReturnType<typeof synthFrames>]> = [
    ['standing still with noise', (s) => synthFrames({ hand: still, durationMs: 14000, noiseU: 0.03, seed: s })],
    [
      'waving sideways',
      (s) =>
        synthFrames({
          hand: (t) => ({ h: -1.0, x: 0.5 * Math.sin((t / 1000) * 4 * Math.PI) }),
          durationMs: 14000,
          noiseU: 0.03,
          seed: s,
        }),
    ],
    [
      'waving up and down',
      (s) =>
        synthFrames({
          hand: (t) => ({ h: -1.0 + 0.3 * Math.sin((t / 1000) * 4 * Math.PI), x: 0 }),
          durationMs: 14000,
          noiseU: 0.03,
          seed: s,
        }),
    ],
    [
      'waving big up and down',
      (s) =>
        synthFrames({
          hand: (t) => ({ h: -0.8 + 0.6 * Math.sin((t / 1000) * 3 * Math.PI), x: 0 }),
          durationMs: 14000,
          noiseU: 0.03,
          seed: s,
        }),
    ],
    [
      'walking into and out of the picture',
      (s) =>
        synthFrames({
          hand: still,
          durationMs: 14000,
          noiseU: 0.03,
          seed: s,
          drop: (_i, t) => (t > 4000 && t < 7000) || (t > 10000 && t < 11500),
        }),
    ],
    [
      'a second person steps in',
      (s) => [
        ...synthFrames({ hand: still, durationMs: 6000, noiseU: 0.03, seed: s }),
        ...synthFrames({
          hand: () => ({ h: -0.2, x: 0.3 }),
          t0: 6033,
          durationMs: 8000,
          noiseU: 0.03,
          seed: s + 100,
          body: { centerX: 0.7, shoulderY: 0.4, shoulderFrac: 0.1 },
        }),
      ],
    ],
    [
      'slowly lifting and lowering an arm',
      (s) =>
        synthFrames({
          hand: (t) => ({ h: -1.2 + Math.sin(Math.max(0, Math.min(1, (t - 5000) / 3000)) * Math.PI), x: 0 }),
          durationMs: 14000,
          noiseU: 0.03,
          seed: s,
        }),
    ],
    [
      'hands at the ready with a quiet wobble',
      (s) =>
        synthFrames({
          hand: (t) => ({ h: -1.2 + 0.06 * Math.sin(t / 400), x: 0.04 * Math.sin(t / 650) }),
          durationMs: 14000,
          noiseU: 0.025,
          seed: s,
        }),
    ],
  ];
  it('gives 0 swings in every class (20 traces each)', () => {
    let traces = 0;
    for (const [name, make] of classes) {
      for (let seed = 1; seed <= 20; seed++) {
        const r = traceCamera({ frames: make(seed), armAtMs: 3000 });
        traces++;
        expect(r.gestureCount, `${name} seed ${seed}`).toBe(0);
      }
    }
    expect(traces).toBe(160);
  });

  it('with the camera on and no input for a whole delivery, nothing is swung (100 quiet deliveries)', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const frames = synthFrames({ hand: still, durationMs: 4000, noiseU: 0.03, seed });
      expect(traceCamera({ frames, armAtMs: 500 }).gestureCount).toBe(0);
    }
  });
});
