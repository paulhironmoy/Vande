/**
 * The camera input, driven by SYNTHETIC landmark traces (docs/PRACTICE_CAMERA_INPUT.md §11). These are generated hand paths, not
 * recognised human movement: they prove the mapping is deterministic and tracker-faithful, not that a person can control it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BODY,
  gauss,
  rng,
  strokePath,
  synthFrames,
  traceCamera,
  type StrokeSpec,
  type TraceCameraResult,
} from '@/input/camera/simulate';

const BASE: StrokeSpec = { startMs: 1000, rise: 1.0, riseMs: 350, holdMs: 150, descent: 1.3, downMs: 200, lateral: 0 };
const ARM = 600;

function play(
  spec: StrokeSpec,
  o: {
    fps?: number;
    noiseU?: number;
    seed?: number;
    mirrored?: boolean;
    handedness?: 'right' | 'left';
    shoulderFrac?: number;
    drop?: (i: number, t: number) => boolean;
    latencyMs?: number;
    calibrationMs?: number;
    armAtMs?: number;
    durationMs?: number;
  } = {},
): TraceCameraResult {
  const frames = synthFrames({
    hand: strokePath(spec),
    fps: o.fps ?? 30,
    t0: 0,
    durationMs: o.durationMs ?? 3200,
    noiseU: o.noiseU,
    seed: o.seed,
    mirrored: o.mirrored,
    drop: o.drop,
    body: { ...DEFAULT_BODY, shoulderFrac: o.shoulderFrac ?? DEFAULT_BODY.shoulderFrac },
  });
  return traceCamera({
    frames,
    armAtMs: o.armAtMs ?? ARM,
    handedness: o.handedness,
    sourceMirrored: o.mirrored,
    latencyMs: o.latencyMs,
    calibrationMs: o.calibrationMs,
  });
}

describe('camera mapping: strokes the tracker understands', () => {
  it('a drive: hands up, then down fast, is one attack that starts when the hands left the top', () => {
    const r = play(BASE);
    expect(r.gestureCount).toBe(1);
    expect(r.gesture?.pointer).toBe('camera');
    expect(r.swing?.kind).toBe('attack');
    expect(r.swing?.directionDeg).toBe(0);
    expect(r.swing?.power).toBeGreaterThan(0.6);
    // The swing starts within about one 30 fps frame of the hands leaving the top (kinematic start 1500 ms).
    const startMs = (r.swing?.startT ?? 0) * 1000 + ARM;
    expect(Math.abs(startMs - 1500)).toBeLessThan(40);
    // The press is the last still frame before the rise, the tracker's states follow the canonical order.
    const phases = [...new Set(r.states.map((s) => s.phase))];
    expect(phases).toEqual(['ready', 'loading', 'tracking', 'committing', 'released']);
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0].pointer).toBe('camera');
    expect(r.starts[0].atPerfMs).toBeLessThan(1100);
  });

  it('faster hands give more power (on average over the frame phase), and a higher backlift gives more loft', () => {
    // At 30 fps the swing's power moves by about 0.1 with where the onset falls between two frames, so compare phase averages.
    const power = (downMs: number) => {
      const phases = [0, 4, 8, 12, 16, 20, 24, 28];
      return (
        phases.reduce((n, ph) => n + (play({ ...BASE, startMs: 1000 + ph, downMs }).swing?.power ?? 0), 0) /
        phases.length
      );
    };
    const p = [140, 200, 280, 400].map(power);
    for (let i = 1; i < p.length; i++) expect(p[i]).toBeLessThan(p[i - 1] + 0.02);
    expect(p[0]).toBeGreaterThan(0.8);
    expect(p[3]).toBeLessThan(0.6);
    const elev = (rise: number) => play({ ...BASE, rise, descent: rise + 0.3, downMs: 160 }).swing?.elevation ?? 0;
    expect(elev(0.5)).toBeLessThan(elev(1.1));
    expect(elev(1.1)).toBeGreaterThan(0.3);
  });

  it('sideways during the stroke sets the direction; the sign follows the player, and left-handers mirror once', () => {
    const off = play({ ...BASE, lateral: 0.6 });
    const leg = play({ ...BASE, lateral: -0.6 });
    expect(off.swing?.directionDeg).toBeCloseTo(24.8, 0);
    expect(leg.swing?.directionDeg).toBeCloseTo(-24.8, 0);
    // A left-hander swinging toward their own left (negative sideways) is the off side for them: the bearing is mirrored once.
    const lefty = play({ ...BASE, lateral: -0.6 }, { handedness: 'left' });
    expect(lefty.swing?.directionDeg).toBeCloseTo(24.8, 0);
  });

  it('a mirrored feed (labels follow the picture layout) gives exactly the same swing as the raw feed', () => {
    const raw = play({ ...BASE, lateral: 0.5 });
    const mir = play({ ...BASE, lateral: 0.5 }, { mirrored: true });
    expect(mir.swing).toEqual(raw.swing);
  });

  it('near and far players get the same swing (scaled by shoulder width)', () => {
    const ref = play({ ...BASE, lateral: 0.4 }).swing;
    for (const frac of [0.09, 0.22, 0.3])
      expect(play({ ...BASE, lateral: 0.4 }, { shoulderFrac: frac }).swing).toEqual(ref);
  });

  it('a short, gentle push after a small backlift is the defensive straight bat', () => {
    const r = play({ ...BASE, rise: 0.35, descent: 0.5, downMs: 500 });
    expect(r.swing?.kind).toBe('defend');
    expect(r.swing?.directionDeg).toBe(0);
    expect(r.gestureCount).toBe(1);
  });

  it('hands raised high and brought back down slowly are a deliberate leave: no swing, and not a flick', () => {
    const r = play({ ...BASE, descent: 1.2, downMs: 1500 });
    expect(r.gestureCount).toBe(0);
    expect(r.states.map((s) => s.phase)).toContain('intentional_leave');
  });

  it('a small fidget (raise and lower a little) does nothing and leaves the delivery armed', () => {
    const r = play({ ...BASE, rise: 0.3, descent: 0.3, downMs: 1400 });
    expect(r.gestureCount).toBe(0);
    expect(r.states.map((s) => s.phase)).not.toContain('intentional_leave');
  });

  it('hands already up and still when the delivery goes live (loaded during the run-up) can still strike', () => {
    const r = play(
      { startMs: 100, rise: 1.0, riseMs: 200, holdMs: 1700, descent: 1.3, downMs: 200 },
      { armAtMs: 1200, durationMs: 4000 },
    );
    expect(r.swing?.kind).toBe('attack');
    expect(r.starts).toHaveLength(1);
    expect(r.starts[0].atPerfMs).toBe(1200);
  });

  it('only one gesture per arming, and nothing opens before the delivery is armed', () => {
    const early = play(BASE, { armAtMs: 2500 });
    expect(early.starts).toHaveLength(0);
    expect(early.gestureCount).toBe(0);
    expect(play(BASE).gestureCount).toBe(1);
  });
});

describe('camera mapping: determinism and the clock', () => {
  it('the same frames always give the same swing, whatever the delivery delay', () => {
    const a = play({ ...BASE, lateral: 0.3 }, { noiseU: 0.03, seed: 9 });
    const b = play({ ...BASE, lateral: 0.3 }, { noiseU: 0.03, seed: 9 });
    const c = play({ ...BASE, lateral: 0.3 }, { noiseU: 0.03, seed: 9, latencyMs: 90 });
    expect(a.swing).toEqual(b.swing);
    expect(c.swing).toEqual(a.swing);
    expect(c.emittedAtMs).toBeGreaterThan(a.emittedAtMs ?? 0);
  });

  it('the camera offset moves the swing start by exactly that amount', () => {
    const a = play(BASE).swing;
    const b = play(BASE, { calibrationMs: 40 }).swing;
    expect(((a?.startT ?? 0) - (b?.startT ?? 0)) * 1000).toBeCloseTo(40, 0);
    expect(b?.power).toBe(a?.power);
  });

  it('dropped frames and uneven frame times do not change the stroke much and never double it', () => {
    const clean = play({ ...BASE, lateral: 0.4 }).swing;
    const dropped = play({ ...BASE, lateral: 0.4 }, { drop: (i) => i === 31 || i === 32 }).swing;
    expect(dropped?.kind).toBe('attack');
    expect(dropped?.directionDeg).toBeCloseTo(clean?.directionDeg ?? 0, 0);
    expect(Math.abs((dropped?.power ?? 0) - (clean?.power ?? 0))).toBeLessThan(0.15);
    const jitter = synthFrames({ hand: strokePath(BASE), fps: 30, t0: 0, durationMs: 3200, jitterMs: 6, seed: 4 });
    const r = traceCamera({ frames: jitter, armAtMs: ARM });
    expect(r.gestureCount).toBe(1);
  });

  it('at 60 fps the start is closer to the true onset than at 30 fps, and at 15 fps the swing is rougher', () => {
    const err = (fps: number) => {
      const worst = [0, 7, 14, 21, 28].map((phase) => {
        const r = play({ ...BASE, startMs: 1000 + phase }, { fps });
        return Math.abs((r.swing?.startT ?? 0) * 1000 + ARM - (1500 + phase));
      });
      return Math.max(...worst);
    };
    expect(err(60)).toBeLessThan(err(15));
    expect(err(30)).toBeLessThan(40);
  });
});

describe('camera mapping: noise and tracking loss', () => {
  it('steady hands with landmark noise never open a contact or swing (several seeds)', () => {
    for (const sigma of [0.02, 0.035]) {
      for (let seed = 1; seed <= 6; seed++) {
        const frames = synthFrames({
          hand: () => ({ h: -1.2, x: 0 }),
          fps: 30,
          t0: 0,
          durationMs: 15000,
          noiseU: sigma,
          seed,
        });
        const r = traceCamera({ frames, armAtMs: 3000 });
        expect(r.starts).toHaveLength(0);
        expect(r.gestureCount).toBe(0);
      }
    }
  });

  it('a slow wander of the hands (breathing, shifting weight) does not swing', () => {
    const hand = (t: number) => ({ h: -1.2 + 0.1 * Math.sin((t / 1000) * Math.PI), x: 0.05 * Math.sin(t / 700) });
    const frames = synthFrames({ hand, fps: 30, t0: 0, durationMs: 15000, noiseU: 0.03, seed: 5 });
    expect(traceCamera({ frames, armAtMs: 3000 }).gestureCount).toBe(0);
  });

  it('with noise the direction stays within about 10 degrees and the stroke is still one attack', () => {
    const dirs: number[] = [];
    for (let seed = 1; seed <= 24; seed++) {
      const r = play({ ...BASE, lateral: 0.6 }, { noiseU: 0.03, seed });
      expect(r.gestureCount).toBe(1);
      dirs.push(r.swing?.directionDeg ?? 0);
    }
    const mean = dirs.reduce((a, b) => a + b, 0) / dirs.length;
    const sd = Math.sqrt(dirs.reduce((a, b) => a + (b - mean) ** 2, 0) / dirs.length);
    expect(mean).toBeGreaterThan(15);
    expect(mean).toBeLessThan(30);
    expect(sd).toBeLessThan(12);
  });

  it('tracking lost while loaded cancels the contact without consuming the delivery; a later stroke still works', () => {
    const r = play(BASE, { drop: (_i, t) => t > 1250 && t < 2200, durationMs: 4000 });
    expect(r.cancels).toBeGreaterThanOrEqual(1);
    expect(r.gestureCount).toBe(0);
    expect(r.states.map((s) => s.phase)).toContain('cancelled');
    const later = synthFrames({
      hand: strokePath({ ...BASE, startMs: 2600 }),
      fps: 30,
      t0: 0,
      durationMs: 4800,
      drop: (_i, t) => t > 1250 && t < 2200,
    });
    expect(traceCamera({ frames: later, armAtMs: ARM }).gestureCount).toBe(1);
  });

  it('tracking lost after the stroke committed keeps the swing', () => {
    const r = play(BASE, { drop: (_i, t) => t > 1600 });
    expect(r.gestureCount).toBe(1);
    expect(r.swing?.kind).toBe('attack');
  });

  it('reports lost tracking and a recovered pose through the status', () => {
    const r = play(BASE, { drop: (_i, t) => t > 2200 && t < 2800, durationMs: 4000 });
    expect(r.statuses.some((s) => s.lost)).toBe(true);
    expect(r.final?.lost).toBe(false);
  });
});

describe('camera mapping: readiness check', () => {
  const ready = (o: { shoulderFrac?: number; hand?: (t: number) => { h: number; x: number }; durationMs?: number }) => {
    const frames = synthFrames({
      hand: o.hand ?? (() => ({ h: -1.2, x: 0 })),
      fps: 30,
      t0: 0,
      durationMs: o.durationMs ?? 1500,
      body: { ...DEFAULT_BODY, shoulderFrac: o.shoulderFrac ?? DEFAULT_BODY.shoulderFrac, shoulderY: 0.5 },
    });
    return traceCamera({ frames, armAtMs: 10_000 }).final?.readiness;
  };

  it('is ready after a stable pose in the ready zone at a good distance', () => {
    const r = ready({});
    expect(r?.ready).toBe(true);
    expect(r?.distance).toBe('ok');
    expect(r?.inFrame).toBe(true);
  });

  it('says too far, too close, or not ready while the hands move', () => {
    expect(ready({ shoulderFrac: 0.07 })?.distance).toBe('too_far');
    expect(ready({ shoulderFrac: 0.35 })?.distance).toBe('too_close');
    const moving = ready({ hand: (t) => ({ h: -1.2 + 0.4 * Math.sin(t / 150), x: 0 }) });
    expect(moving?.still).toBe(false);
    expect(moving?.ready).toBe(false);
  });
});

describe('the synthetic noise itself', () => {
  it('is seeded: the same seed gives the same numbers', () => {
    const a = rng(3);
    const b = rng(3);
    expect([gauss(a), gauss(a), gauss(a)]).toEqual([gauss(b), gauss(b), gauss(b)]);
  });
});

describe('the defence boundary sits in the gap between a defensive and an attacking backlift', () => {
  // A defensive lift is the hands going from the waist to about the chest (0.3 to 0.5 u); an attacking backlift is 0.8 u and more.
  // The pose model's wrist error (0.035 to 0.09 u RMS) and a 12 to 18% difference between the shoulder width in the picture and
  // the player's real proportions mean a class must hold when the same movement is measured 18% bigger (SYNTH-VIDEO-5).
  const kind = (rise: number, descent: number, downMs: number, scale: number, i: number) => {
    const frames = synthFrames({
      hand: strokePath({
        startMs: 1000 + (i % 10) * 3,
        rise: rise * scale,
        riseMs: 300,
        holdMs: 100,
        descent: descent * scale,
        downMs,
      }),
      fps: 30,
      t0: 0,
      durationMs: 3400,
      noiseU: 0.01,
      seed: 200 + i,
    });
    const r = traceCamera({ frames, armAtMs: 600 });
    return r.gestureCount === 0 ? 'none' : r.swing?.kind;
  };
  const share = (want: string, rise: number, descent: number, downMs: number, scale: number) => {
    let n = 0;
    for (let i = 0; i < 20; i++) if (kind(rise, descent, downMs, scale, i) === want) n++;
    return n / 20;
  };

  it('a gentle push after a defensive backlift is a defence, also when the model measures it 18% bigger', () => {
    for (const rise of [0.3, 0.4, 0.45]) {
      for (const scale of [1, 1.18])
        expect(share('defend', rise, rise + 0.15, 600, scale), `rise ${rise} x ${scale}`).toBeGreaterThanOrEqual(0.9);
    }
    // Right on the old boundary (0.45 u) the class no longer depends on noise.
    expect(share('defend', 0.45, 0.6, 600, 1)).toBe(1);
  });

  it('a stroke after an attacking backlift is an attack', () => {
    for (const rise of [0.8, 1.0, 1.3])
      expect(share('attack', rise, rise + 0.3, 170, 1), `rise ${rise}`).toBeGreaterThanOrEqual(0.9);
  });

  it('a quick short jab (0.4 to 0.55 u, fast) is still an attack, and a tiny one (0.3 u) is nothing', () => {
    for (const rise of [0.4, 0.55])
      expect(share('attack', rise, rise + 0.3, 170, 1), `rise ${rise}`).toBeGreaterThanOrEqual(0.9);
    expect(share('none', 0.3, 0.6, 170, 1)).toBeGreaterThanOrEqual(0.9);
  });
});
