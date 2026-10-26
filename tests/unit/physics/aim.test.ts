import { describe, expect, it } from 'vitest';
import { aimShot, defaultElevationDeg } from '@/physics/aim';
import { BOUNDARY_R } from '@/physics/constants';

const from = { t: 0.52, p: { x: 0.05, y: 0.45, z: 8.45 } };
const speedKph = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z) * 3.6;

describe('aimShot: outcome-first post-contact flights through the ball integrator', () => {
  it('carry: reaches a catch at hand height in the air, before the first bounce', () => {
    for (const p of [{ x: 18, y: 1.4, z: -2 }, { x: -38, y: 2, z: -35 }, { x: 1.6, y: 1, z: 22 }, { x: 4, y: 0.3, z: 0 }]) {
      const r = aimShot(from, { p, mode: 'carry' });
      expect(r.feasible).toBe(true);
      expect(r.errorM).toBeLessThan(0.02);
      expect(r.tArrive).toBeGreaterThan(from.t);
      const firstBounce = r.sim.bounces[0]?.t ?? Infinity;
      expect(r.tArrive).toBeLessThan(firstBounce);
    }
  });

  it('ground: rests at the target, or passes it at the requested pickup speed', () => {
    const rest = aimShot(from, { p: { x: 9, y: 0, z: -14 }, mode: 'ground' });
    expect(rest.feasible).toBe(true);
    expect(rest.errorM).toBeLessThan(0.1);
    expect(rest.sim.stopped).not.toBeNull();
    expect(rest.tArrive).toBeCloseTo(rest.sim.stopped!.t, 6);
    const pickup = aimShot(from, { p: { x: 20, y: 0, z: 0 }, mode: 'ground' }, { arriveSpeedKph: 40 });
    expect(pickup.feasible).toBe(true);
    expect(pickup.errorM).toBeLessThan(0.1);
    expect(pickup.arrive.y).toBeLessThan(0.5);
    expect(speedKph(pickup.v)).toBeGreaterThan(40);
  });

  it('bounce_then_rope: lands first, then crosses the rope in the target direction (a four)', () => {
    const r = aimShot(from, { p: { x: 45, y: 0, z: -43 }, mode: 'bounce_then_rope' });
    expect(r.feasible).toBe(true);
    expect(r.sim.boundary).not.toBeNull();
    expect(r.sim.boundary!.onFull).toBe(false);
    expect(Math.hypot(r.arrive.x, r.arrive.z)).toBeCloseTo(BOUNDARY_R, 3);
    expect(r.errorM).toBeLessThan(0.2);
    expect(r.tArrive).toBeCloseTo(r.sim.boundary!.t, 9);
  });

  it('over_rope: crosses the rope on the full at the target height (a six)', () => {
    for (const p of [{ x: -15, y: 9, z: -60 }, { x: 40, y: 15, z: -46 }]) {
      const r = aimShot(from, { p, mode: 'over_rope' });
      expect(r.feasible).toBe(true);
      expect(r.errorM).toBeLessThan(0.05);
      expect(r.sim.boundary?.onFull).toBe(true);
    }
  });

  it('fails soft on infeasible targets: the nearest trajectory, flagged, with the miss distance', () => {
    const far = aimShot(from, { p: { x: 0, y: 2, z: -150 }, mode: 'carry' });
    expect(far.feasible).toBe(false);
    expect(far.errorM).toBeGreaterThan(1);
    expect(speedKph(far.v)).toBeLessThanOrEqual(165 + 1e-6);
    const capped = aimShot(from, { p: { x: 0, y: 10, z: -62 }, mode: 'over_rope' }, { maxSpeedKph: 60 });
    expect(capped.feasible).toBe(false);
    expect(capped.errorM).toBeGreaterThan(10);
    expect(capped.sim.samples.length).toBeGreaterThan(1);
  });

  it('honours an explicit launch elevation and is deterministic (byte-identical)', () => {
    const a = aimShot(from, { p: { x: 10, y: 1.2, z: -20 }, mode: 'carry' }, { elevationDeg: 25 });
    const b = aimShot(from, { p: { x: 10, y: 1.2, z: -20 }, mode: 'carry' }, { elevationDeg: 25 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const elev = (Math.atan2(a.v.y, Math.hypot(a.v.x, a.v.z)) * 180) / Math.PI;
    expect(elev).toBeCloseTo(25, 6);
    expect(defaultElevationDeg('carry', 30)).toBe(23);
    expect(defaultElevationDeg('ground', 30)).toBe(-4);
  });
});
