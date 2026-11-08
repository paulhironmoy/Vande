// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BowlerProfile, FieldArc, FieldIntent, FieldLayout, Fielder, FielderRole, Handedness, PitchCondition } from '@/contracts/practice';
import {
  BALL_R,
  DEEP_INSET_M,
  INTENT_STROKE_KPH,
  PITCHES,
  STRIKER_REF,
  autoField,
  dirFromBearing,
  fieldIntent,
  fielderClass,
  pointFromStriker,
  regionOf,
  ropeDistance,
  simulate,
  simulateFielding,
  validateField,
  type FieldingPlay,
} from '@/physics';
import { fieldFeatures } from '@/physics/field';

/** These tests check the Test (red-ball) templates; the white-ball ones are checked separately. */
const RED_BALL = { colour: 'red', age: 'new' } as const;

const CONDITIONS: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];
const HANDS: Handedness[] = ['right', 'left'];
const pace = (paceBand: 'controlled' | 'fast' | 'express', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'pace', paceBand, arm, lookSeed: 'a' });
const spin = (spinType: 'finger' | 'wrist', arm: 'right' | 'left' = 'right'): BowlerProfile => ({ family: 'spin', spinType, arm, lookSeed: 'a' });
const PACERS = [pace('controlled'), pace('fast'), pace('express'), pace('fast', 'left')];
const SPINNERS = [spin('finger'), spin('wrist'), spin('finger', 'left'), spin('wrist', 'left')];

const width = (a: { fromDeg: number; toDeg: number }) => a.toDeg - a.fromDeg;
const inside = (arcs: readonly FieldArc[], b: number) => arcs.some((a) => b >= a.fromDeg && b <= a.toDeg);
const ringOf = (i: FieldIntent) => i.protected.filter((a) => a.depth === 'ring');
const deepOf = (i: FieldIntent) => i.protected.filter((a) => a.depth === 'deep');

/** A well-hit ground stroke along `bearing`, flown and rolled by the one integrator and fielded by the fielding model. */
function fieldStroke(field: FieldLayout, bearing: number): FieldingPlay {
  const v = INTENT_STROKE_KPH / 3.6;
  const d = dirFromBearing(bearing, 0);
  const r = simulate({ t: 0, p: { x: STRIKER_REF.x, y: BALL_R, z: STRIKER_REF.z }, v: { x: d.x * v, y: 0, z: d.z * v }, spin: { x: 0, y: 0, z: 0 } }, { pitch: PITCHES.balanced });
  const samples = r.samples;
  if (samples[samples.length - 1].t < r.end.t - 1e-12) samples.push({ t: r.end.t, p: r.end.p, v: r.end.v });
  return simulateFielding(field, { t0: 0, samples, bounces: r.bounces.map((b) => ({ t: b.t, p: b.p })), boundary: r.boundary }).play;
}
const classOf = (field: FieldLayout, id: string) => fielderClass(field.fielders.find((f) => f.id === id)!);

/** A layout from keeper, bowler and nine spots (bearing and distance from the striker; distance ≥ 45 = a boundary rider, 4 m inside the rope). */
function layout(id: string, spots: Array<[FielderRole, number, number]>): FieldLayout {
  const base = autoField(pace('fast'), 'balanced', 'right', RED_BALL);
  const keep = base.fielders.filter((f) => f.role === 'keeper' || f.role === 'bowler');
  const seen = new Map<string, number>();
  const rest: Fielder[] = spots.map(([role, b, d]) => {
    const n = (seen.get(role) ?? 0) + 1;
    seen.set(role, n);
    const p = pointFromStriker(b, d >= 45 ? ropeDistance(b) - DEEP_INSET_M : d);
    return { id: n > 1 ? `${role}${n}` : role, role, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
  });
  return { id, fielders: [...keep, ...rest] };
}

describe('fieldIntent: the plan behind every automatic field', () => {
  it('reads the intention autoField meant, for every bowler, pitch and handedness', () => {
    const expected = (b: BowlerProfile, c: PitchCondition) =>
      b.family === 'pace' ? (c === 'green' ? 'attack_outside_off' : c === 'hard' ? 'short_ball_trap' : 'save_singles') : c === 'turning' ? 'spin_close_catchers' : 'protect_boundaries';
    for (const b of [...PACERS, ...SPINNERS])
      for (const c of CONDITIONS)
        for (const h of HANDS) expect(fieldIntent(autoField(b, c, h, RED_BALL), b, c, h).intention, `${b.family} ${b.paceBand ?? b.spinType} ${b.arm} ${c} ${h}`).toBe(expected(b, c));
  });

  it('names the catchers (keeper, slips, gully, short leg, silly point) in layout order', () => {
    const ids = (b: BowlerProfile, c: PitchCondition, h: Handedness = 'right') => fieldIntent(autoField(b, c, h, RED_BALL), b, c, h).attacking;
    expect(ids(pace('fast'), 'balanced')).toEqual(['keeper', 'slip1']);
    expect(ids(pace('fast'), 'green')).toEqual(['keeper', 'slip1', 'slip2', 'gully']);
    expect(ids(pace('express'), 'hard')).toEqual(['keeper', 'slip1', 'gully']);
    expect(ids(spin('finger'), 'turning')).toEqual(['keeper', 'slip1', 'short_leg']);
    expect(ids(spin('wrist'), 'turning')).toEqual(['keeper', 'slip1', 'silly_point']);
    // A right-arm off-spinner turns the ball away from a left-hander: he gets the silly point.
    expect(ids(spin('finger'), 'turning', 'left')).toEqual(['keeper', 'slip1', 'silly_point']);
  });

  it('reads the other intentions from hand-set fields, in rule order', () => {
    const p = pace('fast');
    const yorker = layout('death', [['point', 97, 21], ['cover', 63, 23], ['midwicket', -62, 23], ['square_leg', -97, 21], ['third_man', 132, 55], ['fine_leg', -148, 52], ['long_off', 10, 64], ['long_on', -10, 64], ['deep_midwicket', -50, 58]]);
    const stumps = layout('straight', [['slip', 150, 20], ['short_leg', -100, 5], ['point', 97, 21], ['cover', 63, 23], ['mid_off', 21, 25], ['mid_on', -21, 25], ['midwicket', -62, 23], ['square_leg', -97, 21], ['third_man', 132, 55]]);
    const boundaries = layout('ring-and-two', [['slip', 150, 20], ['gully', 122, 14], ['point', 97, 21], ['cover', 63, 23], ['mid_off', 21, 25], ['mid_on', -21, 25], ['long_off', 10, 64], ['long_on', -10, 64], ['fine_leg', -148, 52]]);
    const cordon = layout('cordon-and-hook', [['slip', 150, 20], ['slip', 145, 20], ['slip', 140, 20], ['gully', 122, 14], ['point', 97, 21], ['cover', 63, 23], ['mid_on', -21, 25], ['deep_square', -100, 55], ['fine_leg', -150, 52]]);
    const twoCatchers = layout('slip-gully', [['slip', 150, 20], ['gully', 122, 14], ['point', 97, 21], ['cover', 63, 23], ['mid_off', 21, 25], ['mid_on', -21, 25], ['midwicket', -62, 23], ['square_leg', -97, 21], ['fine_leg', -148, 52]]);
    for (const f of [yorker, stumps, boundaries, cordon, twoCatchers]) expect(validateField(f), f.id).toEqual([]);
    expect(fieldIntent(yorker, p, 'balanced').intention).toBe('yorker_and_boundaries');
    expect(fieldIntent(stumps, p, 'balanced').intention).toBe('attack_the_stumps');
    expect(fieldIntent(boundaries, p, 'balanced').intention).toBe('protect_boundaries');
    expect(fieldIntent(boundaries, spin('finger'), 'balanced').intention).toBe('protect_boundaries');
    expect(fieldIntent(cordon, p, 'hard').intention).toBe('attack_outside_off'); // four catchers outrank the hook trap
    expect(fieldIntent(twoCatchers, p, 'green').intention).toBe('attack_outside_off'); // a slip and a gully on a green pitch
    expect(fieldIntent(twoCatchers, p, 'balanced').intention).toBe('save_singles');
    expect(fieldFeatures(cordon)).toEqual({ offCatchers: 4, legCatchers: 0, sillyPoints: 0, keeperUp: false, deepInFront: 0, deepLegBehindSquare: 2, deep: 2 });
  });
});

describe('fieldIntent: protected arcs and gaps', () => {
  const all = (): Array<{ b: BowlerProfile; c: PitchCondition; h: Handedness }> => [...PACERS, ...SPINNERS].flatMap((b) => CONDITIONS.flatMap((c) => HANDS.map((h) => ({ b, c, h }))));

  it('gives well-formed, sorted arcs, and gaps that are exactly the bearings the ring leaves open', () => {
    for (const { b, c, h } of all()) {
      const i = fieldIntent(autoField(b, c, h, RED_BALL), b, c, h);
      const tag = `${b.family}/${b.paceBand ?? b.spinType}/${c}/${h}`;
      for (const a of [...i.protected, ...i.gaps]) {
        expect(a.fromDeg, tag).toBeGreaterThanOrEqual(-180);
        expect(a.toDeg, tag).toBeLessThanOrEqual(180);
        expect(a.toDeg, tag).toBeGreaterThan(a.fromDeg);
        for (const x of [a.fromDeg, a.toDeg]) expect(Math.round(x * 10) / 10, tag).toBe(x);
      }
      // Protected: ring first, then deep; within a depth sorted and disjoint (merged).
      const depths = i.protected.map((a) => a.depth);
      expect(depths, tag).toEqual([...depths].sort((x, y) => (x === y ? 0 : x === 'ring' ? -1 : 1)));
      for (const list of [ringOf(i), deepOf(i), i.gaps]) for (let k = 1; k < list.length; k++) expect(list[k].fromDeg, tag).toBeGreaterThanOrEqual(list[k - 1].toDeg);
      // The ring's arcs and the gaps tile the circle exactly.
      const total = [...ringOf(i), ...i.gaps].reduce((s, a) => s + width(a), 0);
      expect(total, tag).toBeCloseTo(360, 6);
      for (const g of i.gaps) {
        const mid = (g.fromDeg + g.toDeg) / 2;
        expect(inside(ringOf(i), mid), tag).toBe(false);
        // 'deep': nobody stops it; 'ring': a boundary rider cuts it off.
        expect(inside(deepOf(i), mid), `${tag} ${g.depth} [${g.fromDeg},${g.toDeg}]`).toBe(g.depth === 'ring');
        expect(g.region, tag).toBe(regionOf(mid));
      }
      // Every fielder covers his own bearing.
      expect(i.protected.length, tag).toBeGreaterThan(0);
    }
  });

  it('protects narrow arcs against a hard-hit ball: about ±5–7° for a ring fielder, ±8° for a boundary rider', () => {
    const p = pace('fast');
    const i = fieldIntent(autoField(p, 'balanced', 'right', RED_BALL), p, 'balanced');
    const cover = ringOf(i).find((a) => inside([a], 63))!;
    expect(width(cover)).toBeGreaterThan(9);
    expect(width(cover)).toBeLessThan(14);
    const thirdMan = deepOf(i).find((a) => inside([a], 132))!;
    expect(width(thirdMan)).toBeGreaterThan(12);
    expect(width(thirdMan)).toBeLessThan(20);
    // The classic gaps: the cover drive between mid-off and cover, and midwicket.
    expect(i.gaps.some((g) => g.depth === 'deep' && g.region === 'cover' && inside([g], 45))).toBe(true);
    expect(i.gaps.some((g) => g.depth === 'deep' && g.region === 'midwicket' && inside([g], -42))).toBe(true);
  });

  it('closes a gap when a fielder moves into it', () => {
    const p = pace('fast');
    const field = autoField(p, 'balanced', 'right', RED_BALL);
    const before = fieldIntent(field, p, 'balanced');
    const gap = [...before.gaps].filter((g) => g.depth === 'deep').sort((x, y) => width(y) - width(x))[0];
    const mid = (gap.fromDeg + gap.toDeg) / 2;
    const spot = pointFromStriker(mid, 22);
    const moved: FieldLayout = { ...field, id: 'moved', fielders: field.fielders.map((f) => (f.id === 'cover' ? { ...f, x: spot.x, z: spot.z } : f)) };
    const after = fieldIntent(moved, p, 'balanced');
    expect(inside(ringOf(after), mid)).toBe(true);
    expect(after.gaps.some((g) => mid >= g.fromDeg && mid <= g.toDeg)).toBe(false);
  });

  it('does not depend on the pitch (one outfield) and is deterministic, byte for byte', () => {
    for (const b of [pace('fast'), spin('wrist')]) {
      const field = autoField(b, 'turning', 'right', RED_BALL);
      const a = fieldIntent(field, b, 'turning');
      expect(JSON.stringify(fieldIntent(JSON.parse(JSON.stringify(field)) as FieldLayout, { ...b }, 'turning'))).toBe(JSON.stringify(a));
      for (const c of CONDITIONS) {
        const other = fieldIntent(field, b, c);
        expect(other.protected).toEqual(a.protected);
        expect(other.gaps).toEqual(a.gaps);
      }
    }
  });
});

describe('fieldIntent agrees with the fielding model (simulateFielding on the integrator\'s own roll)', () => {
  it('a well-hit ground stroke through a gap beats the ring; at a protected bearing a fielder stops it; edges agree within 0.3°', () => {
    const cases: Array<[BowlerProfile, PitchCondition]> = [[pace('fast'), 'balanced'], [pace('express'), 'hard'], [pace('controlled'), 'green'], [spin('finger'), 'balanced'], [spin('wrist'), 'turning']];
    let checks = 0;
    for (const [b, c] of cases) {
      const field = autoField(b, c, 'right', RED_BALL);
      const i = fieldIntent(field, b, c);
      for (const g of i.gaps) {
        if (width(g) < 1.5) continue;
        const play = fieldStroke(field, (g.fromDeg + g.toDeg) / 2);
        if (g.depth === 'deep') expect(play.kind, `${field.id} gap [${g.fromDeg},${g.toDeg}]`).toBe('boundary');
        else {
          expect(play.kind, `${field.id} ring gap [${g.fromDeg},${g.toDeg}]`).toBe('fielded');
          if (play.kind === 'fielded') expect(classOf(field, play.fielderId)).toBe('deep');
        }
        checks++;
      }
      const ring = ringOf(i);
      for (const a of i.protected) {
        if (width(a) < 1.5) continue;
        const play = fieldStroke(field, (a.fromDeg + a.toDeg) / 2);
        expect(play.kind === 'fielded' || play.kind === 'caught', `${field.id} ${a.depth} [${a.fromDeg},${a.toDeg}]`).toBe(true);
        if (a.depth === 'ring' && (play.kind === 'fielded' || play.kind === 'caught')) expect(classOf(field, play.fielderId)).not.toBe('deep');
        checks++;
      }
      for (const a of ring) {
        for (const [x, stopped] of [[a.fromDeg + 0.3, true], [a.toDeg - 0.3, true], [a.fromDeg - 0.3, false], [a.toDeg + 0.3, false]] as const) {
          if (x <= -180 || x >= 180 || (!stopped && inside(ring, x))) continue;
          const play = fieldStroke(field, x);
          const byRing = (play.kind === 'fielded' || play.kind === 'caught') && classOf(field, play.fielderId) !== 'deep';
          expect(byRing, `${field.id} edge ${x.toFixed(1)}`).toBe(stopped);
          checks++;
        }
      }
    }
    expect(checks).toBeGreaterThan(150);
  });
});
