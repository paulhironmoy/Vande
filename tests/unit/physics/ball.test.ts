import { describe, expect, it } from 'vitest';
import { integrateBall, simulate } from '@/physics/ball';
import { BALL_R, BOUNDARY_R, OUTFIELD, PITCHES, PITCH_HALF, SIM_DT } from '@/physics/constants';

const start = (vx: number, vy: number, vz: number, y = 0.8, z = 8.5) => ({ t: 0, p: { x: 0, y, z }, v: { x: vx, y: vy, z: vz } });

describe('ball integrator', () => {
  it('is deterministic: same start, deep-equal result', () => {
    const a = simulate({ ...start(3, 9, -30), spinRps: 18 });
    const b = simulate({ ...start(3, 9, -30), spinRps: 18 });
    expect(a).toEqual(b);
  });

  it('samples on a fixed grid', () => {
    const r = simulate(start(0, 5, -20), { sampleEvery: 1, untilT: 0.5 });
    expect(r.dt).toBe(SIM_DT);
    r.samples.forEach((s, i) => expect(s.t).toBeCloseTo(i * SIM_DT, 12));
  });

  it('bounces with the surface restitution and keeps a vertical velocity ratio of e', () => {
    const r = integrateBall({ t: 0, p: { x: 0, y: 1.5, z: 0 }, v: { x: 0, y: -2, z: 20 }, spin: { x: 0, y: 0, z: 0 } }, { pitch: PITCHES.hard, untilT: 0.8, stopAtBoundary: false });
    const b = r.bounces[0];
    expect(b.surface).toBe('pitch');
    expect(b.p.y).toBeCloseTo(BALL_R, 9);
    // vertical speed just before the bounce, from free fall with drag (approximately)
    const before = r.samples.filter((s) => s.t < b.t).at(-1)!;
    expect(b.v.y / -before.v.y).toBeGreaterThan(PITCHES.hard.restitution * 0.97);
    expect(b.v.y / -before.v.y).toBeLessThan(PITCHES.hard.restitution * 1.03);
    // friction takes pace off the ball
    expect(b.v.z).toBeLessThan(before.v.z);
  });

  it('rolls on the outfield: a 90 km/h ground stroke stops after ≈ 55–70 m', () => {
    const r = simulate({ t: 0, p: { x: 0, y: BALL_R, z: 8.5 }, v: { x: 0, y: 0, z: -25 } });
    expect(r.stopped).not.toBeNull();
    const d = 8.5 - r.stopped!.p.z;
    expect(d).toBeGreaterThan(55);
    expect(d).toBeLessThan(70);
    expect(r.boundary).toBeNull();
  });

  it('detects the rope on the full (six) and after a bounce (four)', () => {
    const six = simulate({ ...start(0, 22, -32, 1), spinRps: 15 });
    expect(six.boundary?.onFull).toBe(true);
    expect(Math.hypot(six.boundary!.p.x, six.boundary!.p.z)).toBeCloseTo(BOUNDARY_R, 6);
    const four = simulate(start(0, -2, -38, 0.6));
    expect(four.bounces.length).toBeGreaterThan(0);
    expect(four.boundary?.onFull).toBe(false);
  });

  it('a ball that starts rolling on the grass is grounded: never "on the full"', () => {
    const r = simulate({ t: 0, p: { x: 0, y: BALL_R, z: 8.5 }, v: { x: 0, y: 0.2, z: -45 } });
    expect(r.rolling).toBe(true);
    expect(r.bounces).toHaveLength(0);
    expect(r.boundary).not.toBeNull();
    expect(r.boundary!.onFull).toBe(false);
  });

  it('detects the striker’s stumps (played on) without passing through them', () => {
    const r = simulate({ t: 0, p: { x: 0.02, y: 0.3, z: PITCH_HALF - 1.2 }, v: { x: 0, y: -0.5, z: 25 } }, { detectStumps: true, sampleEvery: 1 });
    expect(r.stumps).not.toBeNull();
    expect(r.stumps!.p.z).toBeLessThan(PITCH_HALF);
  });

  it('records the first crossing of the stumps plane', () => {
    const r = simulate({ t: 0, p: { x: 0, y: 0.5, z: 8 }, v: { x: 0, y: 0, z: 30 } }, { untilZ: PITCH_HALF + 0.3, sampleEvery: 1 });
    expect(r.plane!.p.z).toBeCloseTo(PITCH_HALF, 9);
    expect(r.plane!.t).toBeGreaterThan(0.06);
    expect(r.plane!.t).toBeLessThan(0.075);
  });

  it('back-spin carries a lofted hit further than top-spin (Magnus)', () => {
    const back = simulate({ ...start(0, 15, -30, 1), spinRps: 20 }, { stopAtBoundary: false });
    const top = simulate({ ...start(0, 15, -30, 1), spinRps: -20 }, { stopAtBoundary: false });
    expect(back.bounces[0].p.z).toBeLessThan(top.bounces[0].p.z - 3);
    expect(OUTFIELD.restitution).toBeLessThan(PITCHES.balanced.restitution);
  });
});
