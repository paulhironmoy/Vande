// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FieldLayout } from '@/contracts/practice';
import { BALL_R, BOUNDARY_R, PITCH_HALF } from '@/physics/constants';
import { autoField, distanceFromStriker, pointFromStriker, ropeDistance } from '@/physics/field';
import {
  ATHLETICS,
  PICKUP_S,
  athleticsOf,
  coverable,
  detectBounces,
  dropReason,
  fielderClass,
  firstGroundT,
  keeperTake,
  simulateFielding,
  standingPaths,
  timeToCover,
  type FieldingResult,
} from '@/physics/fielding';
import { stubShot, stubThrough } from '../practice/game/stubTrajectory';

const FIELD = autoField({ family: 'pace', paceBand: 'fast', arm: 'right', lookSeed: 'f' }, 'balanced');
const byId = (f: FieldLayout, id: string) => f.fielders.find((x) => x.id === id)!;
const COVER = byId(FIELD, 'cover');
const BAT = { x: 0, z: 8.3 };
/** A point `lat` metres to the side of cover, square to the line from the bat. */
function besideCover(lat: number) {
  const dx = COVER.x - BAT.x;
  const dz = COVER.z - BAT.z;
  const L = Math.hypot(dx, dz);
  return { x: COVER.x + (-dz / L) * lat, z: COVER.z + (dx / L) * lat, L };
}

function sane(r: FieldingResult, f: FieldLayout = FIELD) {
  expect(r.paths).toHaveLength(f.fielders.length);
  expect(new Set(r.paths.map((p) => p.fielderId))).toEqual(new Set(f.fielders.map((x) => x.id)));
  for (const p of r.paths) {
    for (let i = 1; i < p.samples.length; i++) expect(p.samples[i].t).toBeGreaterThanOrEqual(p.samples[i - 1].t);
    for (const s of p.samples) expect(Math.hypot(s.x, s.z)).toBeLessThan(BOUNDARY_R);
    expect(p.samples[p.samples.length - 1].t).toBeGreaterThanOrEqual(r.deadT - 1e-9);
  }
  for (let i = 1; i < r.ball.length; i++) expect(r.ball[i].t).toBeGreaterThanOrEqual(r.ball[i - 1].t - 1e-9);
  expect(r.ball[r.ball.length - 1].t).toBeCloseTo(r.deadT, 6);
}

describe('fielder kinematics', () => {
  it('runs a distance in the time it takes (reaction, acceleration, top speed)', () => {
    for (const a of Object.values(ATHLETICS)) {
      expect(coverable(a, a.reactionS)).toBe(0);
      for (const d of [0.5, 3, 10, 30]) expect(coverable(a, timeToCover(a, d))).toBeCloseTo(d, 9);
      expect(timeToCover(a, 0)).toBe(0);
    }
    // A ring fielder reacts and covers 10 m in about 2.3 s; a deep fielder 30 m in about 4.8 s.
    expect(timeToCover(ATHLETICS.ring, 10)).toBeCloseTo(0.28 + 7.5 / 5.5 + (10 - (7.5 * 7.5) / 11) / 7.5, 9);
    expect(timeToCover(ATHLETICS.ring, 10)).toBeGreaterThan(2);
    expect(timeToCover(ATHLETICS.ring, 10)).toBeLessThan(2.5);
    expect(timeToCover(ATHLETICS.deep, 30)).toBeGreaterThan(4.5);
    expect(timeToCover(ATHLETICS.deep, 30)).toBeLessThan(5);
  });

  it('classes fielders by role and depth', () => {
    expect(fielderClass(byId(FIELD, 'keeper'))).toBe('keeper');
    expect(fielderClass(byId(FIELD, 'bowler'))).toBe('bowler');
    expect(fielderClass(byId(FIELD, 'slip1'))).toBe('close');
    expect(fielderClass(COVER)).toBe('ring');
    expect(fielderClass(byId(FIELD, 'third_man'))).toBe('deep');
  });
});

describe('ground fielding and interception', () => {
  it('a drive straight at mid-off is stopped by mid-off, who barely moves', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 21, speedKph: 100, elevationDeg: 2 }));
    expect(r.play.kind).toBe('fielded');
    if (r.play.kind !== 'fielded') return;
    expect(r.play.fielderId).toBe('mid_off');
    expect(r.play.how).toBe('stop');
    expect(r.play.movedM).toBeLessThan(3);
    expect(r.events.some((e) => e.kind === 'field' && e.fielderId === 'mid_off')).toBe(true);
    expect(r.events.some((e) => e.kind === 'throw')).toBe(true);
    sane(r);
  });

  it('a ring fielder runs across to cut off a slower ball, diving when he must', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 42, speedKph: 70, elevationDeg: 1, rollDecel: 2 }));
    expect(r.play.kind).toBe('fielded');
    if (r.play.kind !== 'fielded') return;
    expect(['mid_off', 'cover']).toContain(r.play.fielderId);
    expect(r.play.movedM).toBeGreaterThan(3);
    expect(['stop', 'dive_stop']).toContain(r.play.how);
    sane(r);
  });

  it('a hard drive through the extra-cover gap beats everyone to the rope: four', () => {
    const ball = stubShot({ bearingDeg: 42, speedKph: 110, elevationDeg: 3 });
    const r = simulateFielding(FIELD, ball);
    expect(r.play).toMatchObject({ kind: 'boundary', runs: 4 });
    expect(ball.bounces.length).toBeGreaterThan(0);
    expect(r.nearest).not.toBeNull();
    expect(r.events.some((e) => e.kind === 'boundary' && e.runs === 4)).toBe(true);
    expect(r.events.filter((e) => e.kind === 'ball_bounce').length).toBeGreaterThan(0);
    sane(r);
  });

  it('the ball goes back to whichever end it reaches first', () => {
    const straight = simulateFielding(FIELD, stubShot({ bearingDeg: -21, speedKph: 100, elevationDeg: 2 }));
    expect(straight.play.kind === 'fielded' && straight.play.end).toBe('bowler');
    const fine = simulateFielding(FIELD, stubShot({ bearingDeg: -150, speedKph: 70, elevationDeg: 4 }));
    expect(fine.play.kind === 'fielded' && fine.play.end).toBe('striker');
  });

  it('a ball that stops in the deep is collected by whoever gets there first', () => {
    // Off-side field only: a leg-side ball has to be chased down.
    const off: FieldLayout = {
      id: 'test/off-side',
      fielders: [
        byId(FIELD, 'keeper'),
        byId(FIELD, 'bowler'),
        ...[[30, 25], [60, 22], [90, 22], [120, 15], [150, 14], [45, 50], [75, 55], [105, 52], [135, 45]].map(([b, d], i) => ({ id: `o${i}`, role: 'cover' as const, ...pointFromStriker(b, d) })),
      ],
    };
    const r = simulateFielding(off, stubShot({ bearingDeg: -45, speedKph: 55, elevationDeg: 1, rollDecel: 1.5 }));
    expect(r.play.kind).toBe('fielded');
    if (r.play.kind !== 'fielded') return;
    expect(r.play.movedM).toBeGreaterThan(20);
    sane(r, off);
  });

  it('detects bounces in a sampled trajectory', () => {
    const ball = stubShot({ bearingDeg: 30, speedKph: 90, elevationDeg: 10 });
    const found = detectBounces(ball.samples);
    expect(found.length).toBe(ball.bounces.length);
    found.forEach((b, i) => expect(b.t).toBeCloseTo(ball.bounces[i].t, 6));
  });
});

describe('catches', () => {
  it('a skier coming down on cover is caught on his feet', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 63, speedKph: 70, elevationDeg: 55 }));
    expect(r.play).toMatchObject({ kind: 'caught', fielderId: 'cover', dive: false });
    expect(r.events.some((e) => e.kind === 'catch' && e.fielderId === 'cover')).toBe(true);
    expect(r.deadT).toBe(r.play.t);
    expect(r.paths.find((p) => p.fielderId === 'cover')!.samples.some((s) => s.action === 'catch')).toBe(true);
    sane(r);
  });

  it('in reach on his feet, in reach with a dive, a dive at full stretch put down, and out of reach', () => {
    const at = (lat: number) => {
      const p = besideCover(lat);
      return simulateFielding(FIELD, stubThrough(p.x, p.z, 1, 0.9));
    };
    expect(at(1.5).play).toMatchObject({ kind: 'caught', fielderId: 'cover', dive: false });
    expect(at(2.4).play).toMatchObject({ kind: 'caught', fielderId: 'cover', dive: true });
    const stretched = at(3).play;
    expect(stretched).toMatchObject({ kind: 'fielded', fielderId: 'cover', how: 'dropped' });
    expect(stretched.kind === 'fielded' && stretched.drop?.reason).toBe('full_stretch');
    const beyond = at(3.6).play;
    expect(beyond.kind).not.toBe('caught');
    expect(beyond.kind === 'fielded' && beyond.how === 'dropped').toBe(false);
  });

  it('a catch too hot to hold goes down; a sharp one at chest height sticks', () => {
    const c = besideCover(0);
    const hot = simulateFielding(FIELD, stubThrough(c.x, c.z, 1.3, c.L / 38)).play;
    expect(hot.kind === 'fielded' && hot.drop?.reason).toBe('too_fast');
    expect(simulateFielding(FIELD, stubThrough(c.x, c.z, 1.3, c.L / 30)).play).toMatchObject({ kind: 'caught', fielderId: 'cover' });
  });

  it('a fast return catch the bowler has no time to see is put down', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 3, speedKph: 120, elevationDeg: 2 }));
    expect(r.play).toMatchObject({ kind: 'fielded', fielderId: 'bowler', how: 'dropped' });
    expect(r.play.kind === 'fielded' && r.play.drop?.reason).toBe('no_time');
  });

  it('an edge carries to first slip', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 170, speedKph: 95, elevationDeg: 5 }));
    expect(r.play).toMatchObject({ kind: 'caught', fielderId: 'slip1' });
  });

  it('only before the ball bounces (a bump ball is not a catch)', () => {
    // Hit into the ground 3.5 m in front of cover, out of his reach: it bounces up to him and he takes it on the bounce.
    const c = besideCover(0);
    const k = (c.L - 3.5) / c.L;
    const r = simulateFielding(FIELD, stubThrough(BAT.x + (c.x - BAT.x) * k, BAT.z + (c.z - BAT.z) * k, 0.04, 0.6));
    expect(r.play).toMatchObject({ kind: 'fielded', fielderId: 'cover', how: 'stop' });
    expect(r.events.some((e) => e.kind === 'catch')).toBe(false);
  });

  it('a boundary rider takes a skied hit inside the rope', () => {
    const r = simulateFielding(FIELD, stubShot({ bearingDeg: 132, speedKph: 100, elevationDeg: 35 }));
    expect(r.play).toMatchObject({ kind: 'caught', fielderId: 'third_man' });
    if (r.play.kind === 'caught') expect(Math.hypot(r.play.p.x, r.play.p.z)).toBeLessThan(BOUNDARY_R);
  });
});

describe('boundaries', () => {
  it('six when the rope is cleared on the full, four when the ball has bounced', () => {
    const six = stubShot({ bearingDeg: 0, speedKph: 150, elevationDeg: 32 });
    const r6 = simulateFielding(FIELD, six);
    expect(six.boundary?.onFull).toBe(true);
    expect(r6.play).toMatchObject({ kind: 'boundary', runs: 6 });
    // Over third man's head: too high to catch, lands beyond the rope.
    expect(simulateFielding(FIELD, stubShot({ bearingDeg: 132, speedKph: 120, elevationDeg: 30 })).play).toMatchObject({ kind: 'boundary', runs: 6 });
    // A flat hit that bounces just inside the rope and carries over it: four.
    const four = stubShot({ bearingDeg: 42, speedKph: 125, elevationDeg: 14 });
    expect(four.boundary?.onFull).toBe(false);
    expect(simulateFielding(FIELD, four).play).toMatchObject({ kind: 'boundary', runs: 4 });
  });
});

describe('edge cases at ground level and by the rope', () => {
  it('a ball that runs along the ground from the bat to the rope is four, even if it never "bounced"', () => {
    const dir = pointFromStriker(42, 1);
    const ux = dir.x - pointFromStriker(42, 0).x;
    const uz = dir.z - pointFromStriker(42, 0).z;
    const samples = Array.from({ length: 2000 }, (_, i) => ({ t: 0.6 + i / 200, p: { x: ux * (i * 0.15), y: BALL_R, z: 8.4 + uz * (i * 0.15) }, v: { x: ux * 30, y: 0, z: uz * 30 } })).filter((s) => Math.hypot(s.p.x, s.p.z) < BOUNDARY_R);
    const last = samples.at(-1)!;
    const r = simulateFielding(FIELD, { t0: 0.6, samples, bounces: [], boundary: { t: last.t + 0.005, p: last.p, onFull: true } });
    expect(firstGroundT({ t0: 0.6, samples, bounces: [], boundary: null })).toBe(0.6);
    expect(r.play).toMatchObject({ kind: 'boundary', runs: 4 });
  });

  it('a ball that stops just inside the rope is collected, not a boundary', () => {
    const spot = pointFromStriker(42, ropeDistance(42) - 0.15);
    const ball = { t0: 0.6, samples: [{ t: 0.6, p: { x: 0, y: 0.5, z: 8.4 }, v: { x: 10, y: 0, z: -10 } }, { t: 6, p: { x: spot.x, y: BALL_R, z: spot.z }, v: { x: 0, y: 0, z: 0 } }], bounces: [{ t: 1, p: { x: 5, y: BALL_R, z: 3 } }], boundary: null };
    const r = simulateFielding(FIELD, ball);
    expect(r.play).toMatchObject({ kind: 'fielded', how: 'collect' });
  });
});

describe('the keeper', () => {
  it('takes a ball that passes the bat, moving across (or diving) to it', () => {
    const keeper = byId(FIELD, 'keeper');
    const pass = Array.from({ length: 200 }, (_, i) => ({ t: 0.55 + i / 240, p: { x: 0.2 + i * 0.002, y: 0.9, z: PITCH_HALF + i * 0.15 }, v: { x: 0.48, y: 0, z: 36 } }));
    const take = keeperTake(FIELD, pass, 0)!;
    expect(take.p.z).toBeGreaterThanOrEqual(keeper.z - 0.4);
    expect(take.dive).toBe(false);
    expect(take.path.samples.some((s) => s.action === 'catch' && Math.abs(s.t - take.t) < 1e-9)).toBe(true);
    // Reading it only as it passes the bat, he has no time to move across 2.4 m: he dives.
    const wide = pass.map((s) => ({ ...s, p: { ...s.p, x: s.p.x + 2.4 } }));
    expect(keeperTake(FIELD, wide, 0.7)!.dive).toBe(true);
    // Watching it from the release, he moves across in time.
    expect(keeperTake(FIELD, wide, 0)!.dive).toBe(false);
  });

  it('everyone else stays set, and celebrates a wicket', () => {
    const paths = standingPaths(FIELD, 2, new Set(['keeper']), true);
    expect(paths).toHaveLength(10);
    expect(paths.find((p) => p.fielderId === 'bowler')!.samples.at(-1)!.action).toBe('celebrate');
  });
});

describe('determinism and the drop rule', () => {
  it('the same trajectory and field give the same play, paths and ball', () => {
    for (const s of [{ bearingDeg: 42, speedKph: 110, elevationDeg: 3 }, { bearingDeg: 63, speedKph: 70, elevationDeg: 55 }, { bearingDeg: -80, speedKph: 120, elevationDeg: 12 }]) {
      expect(simulateFielding(FIELD, stubShot(s))).toEqual(simulateFielding(FIELD, stubShot(s)));
    }
  });

  it('drop reasons are deterministic thresholds', () => {
    const ring = athleticsOf(COVER);
    const base = { dive: false, speed: 20, stretch: 0, sightS: 0.5, p: { x: 0, y: 1.2, z: 0 } };
    expect(dropReason('ring', ring, base)).toBeNull();
    expect(dropReason('ring', ring, { ...base, speed: ring.holdSpeed + 1 })).toBe('too_fast');
    expect(dropReason('ring', ring, { ...base, dive: true, stretch: ring.holdDiveStretch + 0.05 })).toBe('full_stretch');
    expect(dropReason('ring', ring, { ...base, sightS: 0.05 })).toBe('no_time');
    expect(dropReason('close', ATHLETICS.close, { ...base, sightS: 0.05 })).toBeNull();
    expect(dropReason('ring', ring, { ...base, speed: 25, p: { x: 0, y: 0.2, z: 0 } })).toBe('low_and_fast');
    expect(dropReason('keeper', ATHLETICS.keeper, { ...base, speed: 25, p: { x: 0, y: 0.2, z: 0 } })).toBeNull();
  });

  it('a dropped ball is picked up after the fielder recovers, then thrown', () => {
    const c = besideCover(3);
    const r = simulateFielding(FIELD, stubThrough(c.x, c.z, 1, 0.9));
    expect(r.play.kind).toBe('fielded');
    if (r.play.kind !== 'fielded') return;
    expect(r.play.releaseT).toBeGreaterThanOrEqual(r.play.t + PICKUP_S.dropped_dive - 1e-9);
    expect(r.play.returnT).toBeGreaterThan(r.play.releaseT);
    const cover = r.paths.find((p) => p.fielderId === 'cover')!;
    expect(cover.samples.map((s) => s.action)).toEqual(expect.arrayContaining(['dive', 'drop', 'pickup', 'throw']));
    expect(distanceFromStriker(r.ball.at(-1)!.p.x, r.ball.at(-1)!.p.z)).toBeLessThan(25);
  });
});
