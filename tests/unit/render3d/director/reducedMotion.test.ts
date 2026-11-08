// @vitest-environment node
/**
 * Honesty rule H5 (Reduced Motion): life displacement is zero; the head overlay runs at half gain; no micro-motion or
 * drift; the eyes shift at most 10 degrees (larger shifts are the head's, and slower); blinks are kept exactly.
 * Reason: Reduced Motion must still show a person (blinks avoid a dead stare) without anything that sweeps or sways.
 */
import { describe, expect, it, vi } from 'vitest';
import { CH, deliveryTakeKey, prepare, type DirectorAnchors } from '@/render3d/core/motion/director';
import { anchorsFor, delivery, idleAnchors, randomSpec, rng } from './world';
import { longestFrozenS, maxDiff, mean, record, recordFile, stats, timeOf, traceHash, val } from './gates';

recordFile('reducedMotion');

// Heavy measurement runs: a slow CI runner gets a generous timeout (the config default is 30 s).
vi.setConfig({ testTimeout: 120_000 });

const LIFE = [CH.breath, CH.swayX, CH.swayZ, CH.swayRoll];
const both = (a: DirectorAnchors) => ({ rm: prepare({ ...a, reducedMotion: true }, { hz: 240 }), normal: prepare({ ...a, reducedMotion: false }, { hz: 240 }) });

describe('H5: Reduced Motion', () => {
  it('life displacement is exactly zero in every frame, for both actors, in standing and delivery scripts (and it is not zero in normal motion)', () => {
    const r = rng(101);
    let frames = 0;
    for (let k = 0; k < 30; k++) {
      for (const role of ['bowler', 'striker'] as const) {
        const d = delivery(randomSpec(r));
        const a = anchorsFor(d, { role, key: deliveryTakeKey({ seed: 'rm', overIndex: 0, ballIndex: k }), series: 'pace' });
        const { rm, normal } = both(a);
        let alive = false;
        for (let i = 0; i < rm.n; i++) {
          for (const c of LIFE) {
            expect(rm.trace[i * 24 + c]).toBe(0);
            if (normal.trace[i * 24 + c] !== 0) alive = true;
          }
          frames++;
        }
        expect(alive).toBe(true);
      }
    }
    for (const role of ['bowler', 'striker'] as const) {
      const { rm } = both(idleAnchors(role, 'rm#idle', 20_000));
      for (let i = 0; i < rm.n; i++) for (const c of LIFE) expect(rm.trace[i * 24 + c]).toBe(0);
    }
    record('reducedMotion.lifeFramesAllZero', frames);
  });

  it('blinks are kept exactly: the same lids, bit for bit, as in normal motion', () => {
    const r = rng(103);
    let worst = 0;
    let blinkFrames = 0;
    for (let k = 0; k < 30; k++) {
      for (const role of ['bowler', 'striker'] as const) {
        const d = delivery(randomSpec(r));
        const { rm, normal } = both(anchorsFor(d, { role, key: deliveryTakeKey({ seed: 'rmb', overIndex: 0, ballIndex: k }), series: 'pace' }));
        worst = Math.max(worst, maxDiff(rm, normal, 0, rm.n, [CH.blinkL, CH.blinkR]));
        for (let i = 0; i < rm.n; i++) if (rm.trace[i * 24 + CH.blinkL] !== 0) blinkFrames++;
      }
    }
    record('reducedMotion.blinkDifference', { worst, blinkFramesCompared: blinkFrames });
    expect(blinkFrames).toBeGreaterThan(500);
    expect(worst).toBe(0);
  });

  it('no microsaccades and no drift: between two fixation changes the eyes and head do not move at all, while in normal motion they do', () => {
    const quiet: number[] = [];
    const busy: number[] = [];
    // The striker: his head settles in under a second (the bowler's takes 5 time constants of 255 ms in Reduced Motion).
    for (const role of ['striker'] as const) {
      for (let s = 0; s < 40; s++) {
        const a = idleAnchors(role, `rmq#${s}`, 30_000);
        const { rm, normal } = both(a);
        for (let k = 0; k + 1 < rm.fix.length / 5; k++) {
          const t0 = rm.fix[k * 5] + 1000;
          const t1 = rm.fix[(k + 1) * 5] - 50;
          if (t1 - t0 < 400) continue;
          const range = (p: typeof rm) => {
            let worst = 0;
            for (const c of [CH.eyeYawL, CH.eyePitchL, CH.headYaw, CH.headPitch]) {
              let lo = Infinity;
              let hi = -Infinity;
              for (let i = Math.round(((t0 - p.t0) * p.hz) / 1000); i <= Math.round(((t1 - p.t0) * p.hz) / 1000); i++) {
                lo = Math.min(lo, val(p, i, c));
                hi = Math.max(hi, val(p, i, c));
              }
              worst = Math.max(worst, hi - lo);
            }
            return worst;
          };
          quiet.push(range(rm));
          busy.push(range(normal));
        }
      }
    }
    record('reducedMotion.restingRangeDeg', { reducedMotion: stats(quiet), normal: stats(busy) });
    expect(quiet.length).toBeGreaterThan(20);
    expect(Math.max(...quiet)).toBeLessThanOrEqual(0.05);
    expect(stats(busy).p5).toBeGreaterThan(0.1);
  });

  it('the head overlay runs at half gain (the striker waiting: about half the correction of normal motion)', () => {
    const ratios: number[] = [];
    for (let s = 0; s < 20; s++) {
      const { rm, normal } = both(idleAnchors('striker', `rmg#${s}`, 4000));
      const mine = (p: typeof rm) => mean(Array.from({ length: 480 }, (_, i) => val(p, 240 + i, CH.headYaw)));
      ratios.push(mine(rm) / mine(normal));
    }
    record('reducedMotion.overlayGainRatio', stats(ratios));
    expect(stats(ratios).p5).toBeGreaterThan(0.4);
    expect(stats(ratios).p95).toBeLessThan(0.6);
  });

  it('the eyes never leave the head by more than 10 degrees, and the head moves slower (peak speed 0.6 of normal)', () => {
    const r = rng(107);
    let eyeRm = 0;
    let eyeNormal = 0;
    let peakRm = 0;
    let peakNormal = 0;
    const speed = (p: typeof prepare extends (...a: never[]) => infer R ? R : never, a: DirectorAnchors) => {
      const c0 = new Float64Array(3);
      const c1 = new Float64Array(3);
      let best = 0;
      for (let i = 1; i < p.n; i++) {
        a.clipHead(timeOf(p, i - 1), c0);
        a.clipHead(timeOf(p, i), c1);
        best = Math.max(best, Math.hypot(c1[0] + val(p, i, CH.headYaw) - c0[0] - val(p, i - 1, CH.headYaw), c1[1] + val(p, i, CH.headPitch) - c0[1] - val(p, i - 1, CH.headPitch)) * p.hz);
      }
      return best;
    };
    for (let k = 0; k < 40; k++) {
      const d = delivery(randomSpec(r));
      const a = anchorsFor(d, { role: 'striker', key: deliveryTakeKey({ seed: 'rme', overIndex: 0, ballIndex: k }) });
      const { rm, normal } = both(a);
      for (let i = 0; i < rm.n; i++) {
        eyeRm = Math.max(eyeRm, Math.abs(val(rm, i, CH.eyeYawL)), Math.abs(val(rm, i, CH.eyePitchL)));
        eyeNormal = Math.max(eyeNormal, Math.abs(val(normal, i, CH.eyeYawL)), Math.abs(val(normal, i, CH.eyePitchL)));
      }
      peakRm = Math.max(peakRm, speed(rm, a));
      peakNormal = Math.max(peakNormal, speed(normal, a));
    }
    record('reducedMotion.eyeAndHead', { maxEyeDegRm: eyeRm, maxEyeDegNormal: eyeNormal, peakHeadDegSRm: peakRm, peakHeadDegSNormal: peakNormal });
    expect(eyeRm).toBeLessThanOrEqual(10.2);
    expect(eyeNormal).toBeGreaterThan(15);
    expect(peakRm).toBeLessThanOrEqual(0.6 * 360 + 5);
    expect(peakRm).toBeLessThan(peakNormal);
  });

  it('replays are identical in Reduced Motion too, and Reduced Motion changes the trace (it is not ignored)', () => {
    const d = delivery({ speedKph: 130, lengthM: 6, lineM: 0, variation: 0, outcome: 'four' });
    const a = anchorsFor(d, { role: 'striker', key: 'rm#0.1', reducedMotion: true });
    expect(traceHash(prepare(a))).toBe(traceHash(prepare(a)));
    expect(traceHash(prepare(a))).not.toBe(traceHash(prepare({ ...a, reducedMotion: false })));
  });

  it('is reported, not gated: how long the gaze stays still in Reduced Motion (blinks and fixation changes only)', () => {
    const frozen = [0, 1, 2, 3, 4, 5].map((s) => longestFrozenS(prepare({ ...idleAnchors('striker', `rmf#${s}`, 30_000), reducedMotion: true }, { hz: 60 }), [CH.eyeYawL, CH.eyePitchL, CH.headYaw, CH.headPitch], 0.06));
    record('reducedMotion.longestFrozenS', stats(frozen));
    expect(Math.max(...frozen)).toBeLessThanOrEqual(30);
  });
});
