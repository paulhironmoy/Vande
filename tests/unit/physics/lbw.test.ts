import { describe, expect, it } from 'vitest';
import { BALL_R, STUMPS_HALF_W } from '@/physics/constants';
import { strike } from '@/physics/contact';
import { sampleAt } from '@/physics/delivery';
import { lbw } from '@/physics/lbw';
import { LEGSPIN, OFFSPIN, PACE, fly } from './physics-helpers';

/** The ball's own position at the ideal contact, as an impact (what a pad there would intercept). */
const impactAt = (f: ReturnType<typeof fly>, dx = 0, t = f.idealContactT) => {
  const p = sampleAt(f.samples, t).p;
  return { t, p: { ...p, x: p.x + dx } };
};

describe('LBW (Law 36)', () => {
  it('out: pitched in line, struck in line, would have hit the stumps', () => {
    const f = fly({ lengthM: 4, lineM: 0 });
    const d = lbw(f, impactAt(f), { shotOffered: true });
    expect(d).toMatchObject({ out: true, reason: 'out' });
    expect(Math.abs(d.projected.x)).toBeLessThan(STUMPS_HALF_W + BALL_R);
    expect(d.impact).toEqual(impactAt(f).p);
  });

  it('not out: pitched outside leg (a leg-break pitched outside leg that would hit)', () => {
    const f = fly({ lengthM: 4.5, lineM: -0.06, speedKph: 84 }, LEGSPIN, 'turning');
    expect(f.bounce!.p.x).toBeLessThan(-(STUMPS_HALF_W + BALL_R));
    expect(f.wouldHitStumps).toBe(true);
    expect(lbw(f, impactAt(f), { shotOffered: false })).toMatchObject({ out: false, reason: 'pitched_outside_leg' });
  });

  it('the pitching rule does not apply when the ball strikes the batter on the full', () => {
    const f = fly({ variation: 'yorker', lengthM: 0.6, lineM: 0 });
    const early = f.bounce!.t - 0.02;
    expect(lbw(f, impactAt(f, 0, early), { shotOffered: true }).out).toBe(true);
  });

  it('impact outside off: not out when a shot was offered, out when no shot and it would hit', () => {
    const f = fly({ variation: 'inswing', lengthM: 5, lineM: 0.02 }, PACE, 'green');
    const outside = impactAt(f, 0.2);
    expect(outside.p.x).toBeGreaterThan(STUMPS_HALF_W + BALL_R);
    expect(lbw(f, outside, { shotOffered: true })).toMatchObject({ out: false, reason: 'impact_outside_off' });
    expect(lbw(f, outside, { shotOffered: false })).toMatchObject({ out: true, reason: 'out' });
  });

  it('impact outside leg is never out', () => {
    const f = fly({ lengthM: 4, lineM: 0 });
    expect(lbw(f, impactAt(f, -0.3), { shotOffered: false })).toMatchObject({ out: false, reason: 'impact_outside_leg' });
  });

  it('missing: going past off stump; high: over the top', () => {
    const wide = fly({ lengthM: 5, lineM: 0.32 });
    expect(lbw(wide, impactAt(wide), { shotOffered: false })).toMatchObject({ out: false, reason: 'missing' });
    const bouncer = fly({ variation: 'bouncer', lengthM: 10.5, lineM: 0 });
    expect(lbw(bouncer, impactAt(bouncer), { shotOffered: false })).toMatchObject({ out: false, reason: 'high' });
  });

  it('end to end: a left off-break that comes back onto the pad in line is out', () => {
    const f = fly({ lengthM: 4, lineM: -0.13, speedKph: 84 }, OFFSPIN, 'turning');
    const r = strike(f, null, { assist: 'real' });
    expect(r.impact?.part).toBe('pad');
    expect(lbw(f, r.impact!, { shotOffered: false })).toMatchObject({ out: true, reason: 'out' });
  });
});
