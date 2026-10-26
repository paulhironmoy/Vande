import { describe, expect, it } from 'vitest';
import { backspinVector, integrateBall, simulate } from '@/physics/ball';
import { PITCHES, SIM_DT } from '@/physics/constants';
import { timeAtZ } from '@/physics/delivery';
import { PROBE_DT, probe, trace } from '@/physics/probe';
import { dexp, dlog } from '@/physics/vec';

const pitch = { ...PITCHES.green, turnGrip: 0.4 };
const delivery = { t: 0, p: { x: 0.32, y: 2.15, z: -8.69 }, v: { x: -0.9, y: -4.6, z: 39.5 }, spin: { x: -80, y: 3, z: 20 } };
const probeIn = (dt: number) => ({
  t0: 0,
  p: delivery.p,
  v: delivery.v,
  spin: delivery.spin,
  swingCs: 0.08,
  seamDev: 0.012,
  pitch,
  dt,
  untilT: 3,
  untilZ: 10.4,
  planeZ: 8.59,
  stopAtFirstBounce: false,
  along: null,
  roll: false,
  rope: false,
});

describe('probe runs and traces (the match solvers’ fast path)', () => {
  it('a 1 ms probe is integrateBall bit for bit; the 4 ms probe is within a millimetre', () => {
    const ib = integrateBall(delivery, { swingCs: 0.08, seamDev: 0.012, pitch, untilZ: 10.4, untilT: 3, stopAtBoundary: false, stopAtRest: false });
    const exact = probe(probeIn(SIM_DT));
    expect(exact.bZ).toBe(ib.bounces[0].p.z);
    expect(exact.bT).toBe(ib.bounces[0].t);
    expect(exact.pT).toBe(timeAtZ(ib.samples, 8.59));
    const fast = probe(probeIn(PROBE_DT));
    expect(Math.abs(fast.bZ - ib.bounces[0].p.z)).toBeLessThan(1e-3);
    expect(Math.abs(fast.pT - timeAtZ(ib.samples, 8.59)!)).toBeLessThan(1e-5);
  });

  it('the closed-form roll matches the stepped roll (rest and rope)', () => {
    for (const v of [{ x: 0, y: 0, z: -25 }, { x: 8, y: 2, z: -30 }]) {
      const s = simulate({ t: 0, p: { x: 0, y: 0.5, z: 8.4 }, v, spinRps: 0 }, { sampleEvery: 1 });
      const o = probe({ t0: 0, p: { x: 0, y: 0.5, z: 8.4 }, v, spin: { x: 0, y: 0, z: 0 }, swingCs: 0, seamDev: 0, pitch: PITCHES.balanced, dt: PROBE_DT, untilT: 30, untilZ: Infinity, planeZ: NaN, stopAtFirstBounce: false, along: null, roll: true, rope: true });
      if (s.stopped) {
        expect(o.rest).toBe(true);
        expect(Math.hypot(o.sX - s.stopped.p.x, o.sZ - s.stopped.p.z)).toBeLessThan(1e-3);
        expect(Math.abs(o.sT - s.stopped.t)).toBeLessThanOrEqual(SIM_DT + 1e-9);
      } else {
        expect(o.ropeHit).toBe(true);
        expect(Math.hypot(o.rX - s.boundary!.p.x, o.rZ - s.boundary!.p.z)).toBeLessThan(1e-3);
      }
    }
  });

  it('a trace at 1 ms is simulate() in the air, and close at the 5 ms output spacing', () => {
    const v = { x: -12, y: 9, z: -35 };
    const spin = backspinVector(v, 15);
    const s = simulate({ t: 0.5, p: { x: 0, y: 0.6, z: 8.5 }, v, spin }, { sampleEvery: 1 });
    const t1 = trace({ t0: 0.5, p: { x: 0, y: 0.6, z: 8.5 }, v, spin, pitch: PITCHES.balanced, dt: SIM_DT, untilT: 14.5, stopAtBoundary: true, stopAtRest: true });
    expect(t1.bounces[0].p.z).toBe(s.bounces[0].p.z);
    expect(t1.samples[100]).toEqual(s.samples[100]);
    const t5 = trace({ t0: 0.5, p: { x: 0, y: 0.6, z: 8.5 }, v, spin, pitch: PITCHES.balanced, dt: 0.005, untilT: 14.5, stopAtBoundary: true, stopAtRest: true });
    expect(t5.dt).toBe(0.005);
    expect(Math.abs(t5.bounces[0].p.z - s.bounces[0].p.z)).toBeLessThan(5e-3);
    expect(Math.hypot(t5.boundary!.p.x - s.boundary!.p.x, t5.boundary!.p.z - s.boundary!.p.z)).toBeLessThan(5e-3);
    expect(t5).toEqual(trace({ t0: 0.5, p: { x: 0, y: 0.6, z: 8.5 }, v, spin, pitch: PITCHES.balanced, dt: 0.005, untilT: 14.5, stopAtBoundary: true, stopAtRest: true }));
  });

  it('dlog is deterministic and matches Math.log to an ulp', () => {
    for (let i = 1; i < 20000; i++) {
      const x = i * 0.0037 + 1e-6;
      expect(Math.abs(dlog(x) - Math.log(x)) / Math.max(1, Math.abs(Math.log(x)))).toBeLessThan(5e-16);
    }
    expect(dlog(dexp(3.7))).toBe(3.7);
  });
});
