// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, FielderRole, Handedness, PitchCondition } from '@/contracts/practice';
import { BOUNDARY_R, PITCH_HALF } from '@/physics/constants';
import {
  DEEP_INSET_M,
  autoField,
  bearingFromStriker,
  distanceFromStriker,
  physicsBowler,
  pointFromStriker,
  ropeDistance,
  turnsAway,
  validateField,
} from '@/physics/field';

const CONDITIONS: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const HANDS: Handedness[] = ['right', 'left'];
const pace = (paceBand: 'controlled' | 'fast' | 'express', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'pace', paceBand, arm, lookSeed: 'a' });
const spin = (spinType: 'finger' | 'wrist', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'spin', spinType, arm, lookSeed: 'a' });
const ALL_BOWLERS: BowlerProfile[] = [pace('controlled'), pace('fast'), pace('express'), pace('fast', 'left'), spin('finger'), spin('wrist'), spin('finger', 'left'), spin('wrist', 'left')];
const roles = (b: BowlerProfile, c: PitchCondition, h: Handedness = 'right') => autoField(b, c, h).fielders.map((f) => f.role);
const count = (rs: FielderRole[], r: FielderRole) => rs.filter((x) => x === r).length;

describe('ground geometry', () => {
  it('measures bearings and distances from the striker (0 = straight, + = off side, ±180 = behind)', () => {
    for (const [b, d] of [[0, 20], [45, 30], [90, 15], [-120, 40], [170, 12]] as const) {
      const p = pointFromStriker(b, d);
      expect(bearingFromStriker(p.x, p.z)).toBeCloseTo(b, 9);
      expect(distanceFromStriker(p.x, p.z)).toBeCloseTo(d, 9);
    }
    expect(pointFromStriker(0, 10).z).toBeLessThan(pointFromStriker(0, 1).z); // straight = towards the bowler (−z)
    expect(pointFromStriker(90, 10).x).toBeGreaterThan(0); // off side = +x
  });

  it('knows the rope is further away straight than square or behind (the ground is centred on the pitch)', () => {
    const straight = ropeDistance(0);
    const square = ropeDistance(90);
    const behind = ropeDistance(180);
    expect(straight).toBeGreaterThan(square);
    expect(square).toBeGreaterThan(behind);
    for (const b of [0, 37, 90, 133, 180, -60, -150]) {
      const p = pointFromStriker(b, ropeDistance(b));
      expect(Math.hypot(p.x, p.z)).toBeCloseTo(BOUNDARY_R, 6);
    }
  });
});

describe('autoField', () => {
  it('is a legal field for every bowler, pitch and handedness: keeper, bowler and nine more, inside the rope', () => {
    for (const b of ALL_BOWLERS)
      for (const c of CONDITIONS)
        for (const h of HANDS) {
          const f = autoField(b, c, h);
          expect(validateField(f), `${f.id} ${h}`).toEqual([]);
          expect(f.fielders).toHaveLength(11);
          for (const x of f.fielders) expect(Math.hypot(x.x, x.z)).toBeLessThan(BOUNDARY_R);
        }
  });

  it('is deterministic', () => {
    for (const b of ALL_BOWLERS) for (const c of CONDITIONS) expect(autoField(b, c)).toEqual(autoField({ ...b }, c));
  });

  it('keeps the keeper back for pace (further for quicker bowlers and bouncy pitches) and up to the stumps for spin', () => {
    const keeperZ = (b: BowlerProfile, c: PitchCondition = 'balanced') => autoField(b, c).fielders.find((f) => f.role === 'keeper')!.z - PITCH_HALF;
    expect(keeperZ(spin('finger'))).toBeLessThan(1.5);
    expect(keeperZ(pace('controlled'))).toBeGreaterThan(8);
    expect(keeperZ(pace('fast'))).toBeGreaterThan(keeperZ(pace('controlled')));
    expect(keeperZ(pace('express'))).toBeGreaterThan(keeperZ(pace('fast')));
    expect(keeperZ(pace('fast'), 'hard')).toBeGreaterThan(keeperZ(pace('fast'), 'balanced'));
  });

  it('attacks with slips and a gully for pace on a green pitch, and guards the hook on a hard one', () => {
    const green = roles(pace('fast'), 'green');
    expect(count(green, 'slip')).toBe(2);
    expect(green).toContain('gully');
    const balanced = roles(pace('fast'), 'balanced');
    expect(count(balanced, 'slip')).toBe(1);
    expect(balanced).toEqual(expect.arrayContaining(['third_man', 'fine_leg']));
    const hard = roles(pace('fast'), 'hard');
    expect(hard).toEqual(expect.arrayContaining(['gully', 'deep_square', 'fine_leg']));
  });

  it('puts close catchers in for spin on a turning pitch, where the spin takes the ball', () => {
    // Right-arm off-spinner turns into a right-hander: bat-pad at short leg, deep midwicket.
    expect(roles(spin('finger'), 'turning')).toEqual(expect.arrayContaining(['short_leg', 'deep_midwicket']));
    // Right-arm leg-spinner turns away: silly point, deep cover.
    expect(roles(spin('wrist'), 'turning')).toEqual(expect.arrayContaining(['silly_point', 'deep_cover']));
    // Balanced pitch: no close catcher beyond the slip.
    for (const b of [spin('finger'), spin('wrist')]) {
      const r = roles(b, 'balanced');
      expect(r).not.toContain('short_leg');
      expect(r).not.toContain('silly_point');
      expect(count(r, 'slip')).toBe(1);
    }
  });

  it('turns by arm and spin type, and mirrors the bowler for a left-handed striker', () => {
    expect(turnsAway(spin('finger'))).toBe(false); // off-break
    expect(turnsAway(spin('wrist'))).toBe(true); // leg-break
    expect(turnsAway(spin('finger', 'left'))).toBe(true); // left-arm orthodox
    expect(turnsAway(spin('wrist', 'left'))).toBe(false); // left-arm wrist spin turns in
    expect(physicsBowler(spin('finger'), 'left').arm).toBe('left');
    expect(physicsBowler(spin('finger'), 'right').arm).toBe('right');
    // A right-arm off-spinner turns away from a left-hander: he gets the "away" field.
    expect(roles(spin('finger'), 'turning', 'left')).toEqual(expect.arrayContaining(['silly_point', 'deep_cover']));
    expect(autoField(spin('finger'), 'balanced', 'left')).toEqual(autoField(spin('finger', 'left'), 'balanced', 'right'));
  });

  it('places a readable ring and boundary riders', () => {
    for (const b of ALL_BOWLERS)
      for (const c of CONDITIONS) {
        const f = autoField(b, c);
        const deep = f.fielders.filter((x) => distanceFromStriker(x.x, x.z) > 38);
        expect(deep.length).toBeGreaterThanOrEqual(1);
        expect(deep.length).toBeLessThanOrEqual(3);
        for (const x of deep) expect(Math.abs(Math.hypot(x.x, x.z) - (BOUNDARY_R - DEEP_INSET_M))).toBeLessThan(0.3);
        const ring = f.fielders.filter((x) => ['point', 'cover', 'mid_off', 'mid_on', 'midwicket', 'square_leg'].includes(x.role));
        for (const x of ring) {
          const d = distanceFromStriker(x.x, x.z);
          expect(d).toBeGreaterThanOrEqual(17);
          expect(d).toBeLessThanOrEqual(27);
        }
      }
  });

  it('validateField rejects broken layouts', () => {
    const good = autoField(pace('fast'), 'balanced');
    expect(validateField({ ...good, fielders: good.fielders.slice(0, 10) })).toContain('need_eleven_fielders');
    expect(validateField({ ...good, fielders: good.fielders.map((f) => (f.role === 'cover' ? { ...f, x: 70 } : f)) })).toContain('outside_rope:cover');
    expect(validateField({ ...good, fielders: good.fielders.map((f) => (f.role === 'keeper' ? { ...f, role: 'slip' as const } : f)) })).toContain('need_one_keeper');
    expect(validateField({ ...good, fielders: good.fielders.map((f) => (f.role === 'cover' ? { ...f, id: 'point' } : f)) })).toContain('duplicate_id:point');
    expect(validateField({ ...good, fielders: good.fielders.map((f) => (f.role === 'cover' ? { ...f, x: 0.5, z: 0 } : f)) })).toContain('on_the_pitch:cover');
  });
});
