import { describe, expect, it } from 'vitest';
import type { BallSample } from '@/contracts/practice';
import { batterBody } from '@/physics/bat';
import { sweep } from '@/physics/collision';
import { BALL_R, PITCH_HALF } from '@/physics/constants';
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

describe('continuous collision', () => {
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
    expect(fine.contact.batSpeedKph!).toBeGreaterThan(100);
  });

  it('reports the closest approach when the ball passes the bat', () => {
    const f = fly({ speedKph: 140, lengthM: 6.5, lineM: 0.05 });
    const r = strike(f, timedSwing(f, 160), { assist: 'real' });
    expect(r.contact.kind).toBe('miss');
    expect(r.miss).not.toBeNull();
    expect(Math.hypot(r.miss!.delta.x, r.miss!.delta.y, r.miss!.delta.z)).toBeGreaterThan(BALL_R);
  });
});
