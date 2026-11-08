// @vitest-environment node
/// <reference types="node" />
/**
 * Noise and the breath wave. Reason: the sway must be smooth (no step the eye can catch), aperiodic (a loop of one
 * sinusoid is the robotic tell it replaces), and of the size the parameter file says; the breath must inhale faster
 * than it exhales.
 */
import { describe, expect, it } from 'vitest';
import P from '@/render3d/core/motion/director/params.json';
import { fractal, quint, skewSin, vnoise } from '@/render3d/core/motion/director/noise';
import { mean, record, recordFile, sd } from './gates';

recordFile('noise');

describe('noise: value noise', () => {
  it('stays in [-1, 1], is zero-mean, and is the same for the same input', () => {
    const xs: number[] = [];
    for (let i = 0; i < 40_000; i++) {
      const v = vnoise(1234, i * 0.37);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
      expect(vnoise(1234, i * 0.37)).toBe(v);
      xs.push(v);
    }
    expect(Math.abs(mean(xs))).toBeLessThan(0.02);
  });

  it('is C2: no jump in value, slope or curvature across a lattice point (quintic ease)', () => {
    const h = 1e-3;
    for (let i = -3; i < 6; i++) {
      const at = (x: number) => vnoise(99, x);
      const second = (x: number) => (at(x + h) - 2 * at(x) + at(x - h)) / (h * h);
      const first = (x: number) => (at(x + h) - at(x - h)) / (2 * h);
      expect(Math.abs(at(i + 1e-9) - at(i - 1e-9))).toBeLessThan(1e-6);
      expect(Math.abs(first(i + 5e-3) - first(i - 5e-3))).toBeLessThan(0.05);
      expect(Math.abs(second(i + 5e-3) - second(i - 5e-3))).toBeLessThan(0.5);
    }
    expect(quint(0)).toBe(0);
    expect(quint(1)).toBe(1);
    expect(quint(0.5)).toBeCloseTo(0.5, 12);
  });

  it('works for negative times and large offsets (lattice indices are integers either way)', () => {
    expect(Number.isFinite(vnoise(7, -123.45))).toBe(true);
    expect(Number.isFinite(vnoise(7, 96.9 + 60 / 1.3))).toBe(true);
  });
});

describe('noise: the sway (fractal) is the size the parameter file says and is not periodic', () => {
  const sp = P.life.sway.spacingS;
  const am = P.life.sway.amp;
  it('has rms 1 / norm within 3% (the norm in params.json is calibrated, not guessed)', () => {
    const v: number[] = [];
    for (let s = 0; s < 400; s++) for (let t = 0; t < 120; t += 0.5) v.push(fractal(1000 + s * 7, t, 3.3, sp, am));
    const rms = sd(v);
    record('noise.swayRms', rms);
    expect(Math.abs(rms * P.life.sway.norm - 1)).toBeLessThan(0.03);
  });

  it('has no dominant period: autocorrelation at lags 1.5 to 10 s stays under 0.85 over a 120 s record', () => {
    for (let s = 0; s < 8; s++) {
      const dt = 1 / 20;
      const x = Array.from({ length: 120 * 20 }, (_, i) => fractal(55 + s, i * dt, 0, sp, am));
      const m = mean(x);
      let den = 0;
      for (const v of x) den += (v - m) ** 2;
      let worst = -1;
      for (let lag = 30; lag <= 200; lag += 2) {
        let num = 0;
        for (let i = 0; i + lag < x.length; i++) num += (x[i] - m) * (x[i + lag] - m);
        worst = Math.max(worst, num / den);
      }
      expect(worst).toBeLessThan(0.85);
    }
  });
});

describe('noise: the breath wave', () => {
  it('is bounded by 1, periodic in cycles, and a plain sine without skew', () => {
    for (let k = 0; k < 200; k++) {
      const c = k / 200;
      expect(Math.abs(skewSin(c, 0.6))).toBeLessThanOrEqual(1 + 1e-12);
      expect(skewSin(c + 3, 0.6)).toBeCloseTo(skewSin(c, 0.6), 9);
      expect(skewSin(c, 0)).toBeCloseTo(Math.sin(2 * Math.PI * c), 12);
    }
  });

  it('inhales faster than it exhales for every skew the person draws (rising half shorter than falling half)', () => {
    for (const skew of [P.life.breath.skew[0], 0.5, P.life.breath.skew[1]]) {
      let rise = 0;
      let fall = 0;
      const n = 10_000;
      let prev = skewSin(0, skew);
      for (let i = 1; i <= n; i++) {
        const v = skewSin(i / n, skew);
        if (v > prev) rise++;
        else fall++;
        prev = v;
      }
      record(`noise.riseShare.skew${skew}`, rise / n);
      expect(rise).toBeLessThan(fall);
    }
  });
});
