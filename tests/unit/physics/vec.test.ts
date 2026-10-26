import { describe, expect, it } from 'vitest';
import { bearingDeg, dacos, datan2, dcos, dexp, dirFromBearing, dsin, dtanh, elevationDeg, rotate } from '@/physics/vec';

describe('deterministic elementary functions', () => {
  it('match Math to within a few ulps over the ranges physics uses', () => {
    for (let i = -4000; i <= 4000; i++) {
      const x = i * 0.0071;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-15);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-15);
      const y = (i % 89) * 0.27 - 12;
      const z = (i % 97) * 0.31 - 15;
      expect(Math.abs(datan2(y, z) - Math.atan2(y, z))).toBeLessThan(1e-14);
      const e = i * 0.004;
      expect(Math.abs(dexp(e) - Math.exp(e)) / Math.exp(e)).toBeLessThan(1e-14);
      expect(Math.abs(dtanh(e / 4) - Math.tanh(e / 4))).toBeLessThan(1e-14);
      expect(Math.abs(dacos(i / 4000) - Math.acos(i / 4000))).toBeLessThan(1e-14);
    }
  });

  it('uses the contract bearing convention: 0 straight down the ground (−z), + off side (+x)', () => {
    expect(bearingDeg(0, -1)).toBeCloseTo(0, 12);
    expect(bearingDeg(1, 0)).toBeCloseTo(90, 12);
    expect(bearingDeg(-1, 0)).toBeCloseTo(-90, 12);
    const d = dirFromBearing(30, 20);
    expect(bearingDeg(d.x, d.z)).toBeCloseTo(30, 10);
    expect(elevationDeg(d)).toBeCloseTo(20, 10);
  });

  it('rotates about an axis (Rodrigues) like a rigid rotation', () => {
    const r = rotate({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, Math.PI / 2);
    expect(r.x).toBeCloseTo(0, 12);
    expect(r.z).toBeCloseTo(-1, 12);
  });
});
