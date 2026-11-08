import { describe, expect, it } from 'vitest';
import type { BallSample } from '@/contracts/practice';
import { batPose, batterBody, buildBatTrack, type BatTrack } from '@/physics/bat';
import { bladeContact, bladeFrame, bladeRegion, sweep, sweepRawBat, type BladeContact } from '@/physics/collision';
import { BALL_R, BLADE_HALF_W, BLADE_L, BLADE_T, PITCH_HALF } from '@/physics/constants';
import { strike } from '@/physics/contact';
import { fly, timedSwing } from './physics-helpers';

/** A straight ball at speed (m/s) along +z, sampled every dt seconds. */
function straightPath(speed: number, dt: number, x: number, y: number, z0: number, z1: number): BallSample[] {
  const out: BallSample[] = [];
  for (let i = 0; ; i++) {
    const t = i * dt;
    const z = z0 + speed * t;
    out.push({ t, p: { x, y, z }, v: { x: 0, y: 0, z: speed } });
    if (z > z1) break;
  }
  return out;
}

function movingFacePath(track: BatTrack, from: number, to: number, separationAt: (time: number) => number): BallSample[] {
  const samples: BallSample[] = [];
  const dt = 0.0002;
  for (let time = from; time < to; time += dt) {
    const frame = bladeFrame(batPose(track, time));
    const amount = BLADE_T / 2 + BALL_R + separationAt(time);
    samples.push({
      t: time,
      p: { x: frame.centre.x + frame.n.x * amount, y: frame.centre.y + frame.n.y * amount, z: frame.centre.z + frame.n.z * amount },
      v: { x: 0, y: 0, z: 0 },
    });
  }
  const frame = bladeFrame(batPose(track, to));
  const amount = BLADE_T / 2 + BALL_R + separationAt(to);
  samples.push({
    t: to,
    p: { x: frame.centre.x + frame.n.x * amount, y: frame.centre.y + frame.n.y * amount, z: frame.centre.z + frame.n.z * amount },
    v: { x: 0, y: 0, z: 0 },
  });
  return samples;
}

function facePoint(track: BatTrack, time: number): BallSample['p'] {
  const frame = bladeFrame(batPose(track, time));
  const amount = BLADE_T / 2 + BALL_R - 0.001;
  return { x: frame.centre.x + frame.n.x * amount, y: frame.centre.y + frame.n.y * amount, z: frame.centre.z + frame.n.z * amount };
}

function line(a: BallSample['p'], b: BallSample['p'], amount: number): BallSample['p'] {
  return { x: a.x + (b.x - a.x) * amount, y: a.y + (b.y - a.y) * amount, z: a.z + (b.z - a.z) * amount };
}

describe('continuous collision', () => {
  it('classifies blade corners by the dominant sphere-to-box contact component', () => {
    const local = (lu: number, lw: number, ln: number): BladeContact => ({
      q: { x: 0, y: 0, z: 0 },
      dist: 0,
      lu,
      lw,
      ln,
    });
    const halfLength = BLADE_L / 2;
    const halfThickness = BLADE_T / 2;
    // A near-toe centre whose approach is overwhelmingly face-normal is a face hit, not a numerical toe edge.
    expect(bladeRegion(local(-halfLength - 0.000003, 0, halfThickness + BALL_R))).toBe('face');
    // A genuine longitudinal or lateral approach keeps its physical end/side classification.
    expect(bladeRegion(local(-halfLength - BALL_R, 0, halfThickness + 0.001))).toBe('toe');
    expect(bladeRegion(local(halfLength + BALL_R, 0, halfThickness + 0.001))).toBe('shoulder');
    expect(bladeRegion(local(0, BLADE_HALF_W + BALL_R, halfThickness + 0.001))).toBe('edge');
    // Exact outside-component ties are deterministic: normal, then width, then length.
    expect(bladeRegion(local(-halfLength - 0.01, BLADE_HALF_W + 0.01, halfThickness + 0.01))).toBe('face');
  });

  it('a 160 km/h ball cannot tunnel through a pad that lies wholly between two samples', () => {
    const body = batterBody(null);
    const pad = body.pads[0];
    const speed = 160 / 3.6;
    // 20 ms between samples: the ball jumps 0.89 m per sample, far more than the pad's 15 cm depth.
    const step = speed * 0.02;
    const path = straightPath(speed, 0.02, pad.a.x, 0.3, pad.a.z - 0.45 - 2 * step, PITCH_HALF + 0.5);
    const zs = path.map((s) => s.p.z);
    const padZ = pad.a.z;
    expect(zs.some((z) => Math.abs(z - padZ) < pad.r + BALL_R)).toBe(false); // no sample overlaps the pad
    const r = sweep(path, null, body, 0, path.at(-1)!.t);
    expect(r.hit?.part).toBe('front_pad');
    expect(r.hit!.ball.z).toBeCloseTo(padZ - pad.r - BALL_R, 3);
  });

  it('finds the same bat contact at 160 km/h whether the ball path is sampled every 1 ms or every 8 ms', () => {
    const f = fly({ speedKph: 155, lengthM: 6.5, lineM: 0.05 });
    const swing = timedSwing(f, 10, { power: 1 });
    const fine = strike(f, swing, { assist: 'real' });
    const coarse = strike({ ...f, samples: f.samples.filter((_, i) => i % 8 === 0 || i === f.samples.length - 1) }, swing, { assist: 'real' });
    expect(fine.contact.kind).toBe('middle');
    expect(coarse.contact.kind).toBe('middle');
    expect(Math.abs(coarse.contact.t! - fine.contact.t!)).toBeLessThan(2e-4);
    // A full-power planted punch remains a substantive hit while respecting the visible-skeleton velocity caps.
    expect(fine.contact.batSpeedKph!).toBeGreaterThan(35);
    expect(fine.contact.batSpeedKph!).toBeLessThanOrEqual(108);
  });

  it('reports the closest approach when the ball passes the bat', () => {
    const f = fly({ speedKph: 140, lengthM: 6.5, lineM: 0.05 });
    const r = strike(f, timedSwing(f, 160), { assist: 'real' });
    expect(r.contact.kind).toBe('miss');
    expect(r.miss).not.toBeNull();
    expect(Math.hypot(r.miss!.delta.x, r.miss!.delta.y, r.miss!.delta.z)).toBeGreaterThan(BALL_R);
  });

  it('does not award a bat already penetrating at activation; it must separate and re-enter', () => {
    const flight = fly({ speedKph: 136, lengthM: 6.5, lineM: 0.05 });
    const swing = timedSwing(flight, 0);
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    const start = track.startT;
    const path = movingFacePath(track, start - 0.005, start + 0.05, (time) => {
      const elapsed = time - start;
      if (elapsed <= 0.01) return -0.001;
      if (elapsed <= 0.02) return -0.001 + 8.1 * (elapsed - 0.01);
      if (elapsed <= 0.04) return 0.08 - 4.05 * (elapsed - 0.02);
      return -0.001;
    });
    const result = sweepRawBat(path, track, path[0].t, path.at(-1)!.t);
    expect(['blade', 'handle']).toContain(result.hit?.part);
    expect(result.hit!.t).toBeGreaterThan(start + 0.02);
  });

  it('keeps an always-overlapping activation inactive and never records an infinite closest point', () => {
    const flight = fly({ speedKph: 136, lengthM: 6.5, lineM: 0.05 });
    const swing = timedSwing(flight, 0);
    const track = buildBatTrack(flight, swing, { assist: 'real' });
    const path = movingFacePath(track, track.startT - 0.002, track.startT + 0.02, () => -0.001);
    const result = sweepRawBat(path, track, path[0].t, path.at(-1)!.t);
    expect(result.hit).toBeNull();
    expect(result.closest).toBeNull();
  });

  it('finds the same post-separation re-entry in one coarse segment and a 0.1 ms subdivision', () => {
    const flight = fly({ speedKph: 136, lengthM: 6.5, lineM: 0.05 });
    const track = buildBatTrack(flight, timedSwing(flight, 0), { assist: 'real' });
    const start = track.zoneIn;
    const end = track.zoneOut;
    const a = facePoint(track, start);
    const b = facePoint(track, end);
    const velocity = { x: (b.x - a.x) / (end - start), y: (b.y - a.y) / (end - start), z: (b.z - a.z) / (end - start) };
    const coarse: BallSample[] = [{ t: start, p: a, v: velocity }, { t: end, p: b, v: velocity }];
    const fine: BallSample[] = [];
    for (let time = start; time < end; time += 0.0001) {
      fine.push({ t: time, p: line(a, b, (time - start) / (end - start)), v: velocity });
    }
    fine.push({ t: end, p: b, v: velocity });
    const separatedT = start + (end - start) * 0.25;
    const separatedP = line(a, b, (separatedT - start) / (end - start));
    expect(bladeContact(bladeFrame(batPose(track, separatedT)), separatedP).dist - BALL_R).toBeGreaterThan(0.03);
    const coarseHit = sweepRawBat(coarse, track, start, end).hit;
    const fineHit = sweepRawBat(fine, track, start, end).hit;
    expect(coarseHit?.part).toBe('blade');
    expect(fineHit?.part).toBe('blade');
    expect(Math.abs(coarseHit!.t - fineHit!.t)).toBeLessThan(2e-5);
    expect(coarseHit!.t).toBeGreaterThan(separatedT);
  });
});
