// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  BAT_ANGULAR_ACCEL_LIMIT_RADPS2,
  BAT_ANGULAR_SPEED_LIMIT_RADPS,
  BAT_GRIP_ACCEL_LIMIT_MPS2,
  BAT_GRIP_SPEED_LIMIT_MPS,
  BAT_POINT_ACCEL_LIMIT_MPS2,
  BAT_POINT_SPEED_LIMIT_MPS,
  batSpeed,
  batTrackAnalyticEnvelope,
} from '@/physics/bat';
import { SHOT_FORMS, SWEET_U } from '@/physics/constants';
import { swingArm } from '@/physics/contact';
import { planShot, shotFamily } from '@/physics/shot';
import { v3 } from '@/physics/vec';
import { fly, play } from './physics-helpers';

// Characteristic balls (right-arm fast, 136–140 km/h, balanced pitch).
const BOUNCER = { variation: 'bouncer', lengthM: 10.7, lineM: 0.04, speedKph: 140 } as const;
const YORKER = { variation: 'yorker', lengthM: 0.9, lineM: 0.02, speedKph: 140 } as const;
const FULL_OFF = { variation: 'stock', lengthM: 3.5, lineM: 0.1, speedKph: 136 } as const;
const FULL_PADS = { variation: 'stock', lengthM: 3.5, lineM: -0.12, speedKph: 136 } as const;
const SHORT_WIDE = { variation: 'stock', lengthM: 8, lineM: 0.45, speedKph: 136 } as const;
const HARD_LENGTH = { variation: 'stock', lengthM: 7.9, lineM: 0.05, speedKph: 138 } as const;
const GOOD_OFF = { variation: 'stock', lengthM: 6, lineM: 0.12, speedKph: 136 } as const;

const DRIVE = { directionDeg: 0, elevation: 0.05, power: 0.6 };
const COVER = { directionDeg: 50, elevation: 0.05, power: 0.6 };
const LOFT = { directionDeg: 0, elevation: 0.9, power: 0.8 };
const PULL = { directionDeg: -75, elevation: 0.1, power: 0.7 };
const HOOK = { directionDeg: -135, elevation: 0.4, power: 0.7 };
const CUT = { directionDeg: 100, elevation: 0.05, power: 0.7 };
const FLICK = { directionDeg: -70, elevation: 0.05, power: 0.5 };

describe('shot geometry: the stroke is the player\'s, its reach is the bat\'s', () => {
  it('names the stroke from the kind, the direction and the footwork, never from the ball', () => {
    expect(shotFamily('defend', 40, 'forward')).toBe('forward_defence');
    expect(shotFamily('defend', -90, 'back')).toBe('back_defence');
    expect(shotFamily('attack', 0, 'forward')).toBe('straight_drive');
    expect(shotFamily('attack', 25, 'down_track')).toBe('off_drive');
    expect(shotFamily('attack', 50, 'forward')).toBe('cover_drive');
    expect(shotFamily('attack', 100, 'forward')).toBe('square_drive');
    expect(shotFamily('attack', 150, 'forward')).toBe('steer');
    expect(shotFamily('attack', -25, 'forward')).toBe('on_drive');
    expect(shotFamily('attack', -80, 'forward')).toBe('flick');
    expect(shotFamily('attack', -160, 'forward')).toBe('glance');
    expect(shotFamily('attack', 10, 'back')).toBe('back_drive');
    expect(shotFamily('attack', 45, 'back')).toBe('back_punch');
    expect(shotFamily('attack', 100, 'across')).toBe('cut');
    expect(shotFamily('attack', -30, 'back')).toBe('back_on_punch');
    expect(shotFamily('attack', -80, 'back')).toBe('pull');
    expect(shotFamily('attack', -150, 'back')).toBe('hook');
    expect(shotFamily('attack', 385, 'forward')).toBe('off_drive');
  });

  it('aims at the read inside the reach, and at the edge of the reach outside it', () => {
    const swing = { kind: 'attack', directionDeg: 0, elevation: 0, power: 0 } as const;
    const inside = planShot(swing, 'forward', v3(0.05, 0.25, 8.26));
    expect(inside.aim).toEqual(v3(0.05, 0.25, 8.26));
    expect(inside.outside).toEqual(v3(0, 0, 0));
    expect(inside.popDeg).toBe(0);
    const high = planShot(swing, 'forward', v3(0.05, 0.6, 8.26));
    expect(high.aim.y).toBeCloseTo(SHOT_FORMS.straight_drive.y[1], 12);
    expect(high.outside.y).toBeCloseTo(0.6 - SHOT_FORMS.straight_drive.y[1], 12);
    // A ball above a vertical bat's reach is met on the rising part of the arc: the face opens.
    expect(high.popDeg).toBeGreaterThan(5);
    const wide = planShot(swing, 'forward', v3(0.6, 0.25, 8.26));
    expect(wide.aim.x).toBeCloseTo(SHOT_FORMS.straight_drive.x[1], 12);
    expect(wide.popDeg).toBe(0);
  });

  it('narrows the heights for a loft and the whole reach for a harder swing', () => {
    const read = v3(0.05, 0.3, 8.26);
    const ground = planShot({ kind: 'attack', directionDeg: 0, elevation: 0, power: 0 }, 'forward', read);
    const lofted = planShot({ kind: 'attack', directionDeg: 0, elevation: 1, power: 0 }, 'forward', read);
    const hard = planShot({ kind: 'attack', directionDeg: 0, elevation: 0, power: 1 }, 'forward', read);
    expect(lofted.y[0]).toBeGreaterThan(ground.y[0]);
    expect(lofted.y[1]).toBeLessThan(ground.y[1]);
    expect(hard.x[1] - hard.x[0]).toBeLessThan(ground.x[1] - ground.x[0]);
    expect(hard.y[1] - hard.y[0]).toBeLessThan(ground.y[1] - ground.y[0]);
    // A defence is played with soft hands: neither loft nor power narrows it.
    const block = planShot({ kind: 'defend', directionDeg: 0, elevation: 1, power: 1 }, 'back', read);
    expect(block.y).toEqual([...SHOT_FORMS.back_defence.y]);
  });

  it('turns a back-foot leg-side stroke from a clip into a pull by the height read', () => {
    const swing = { kind: 'attack', directionDeg: -80, elevation: 0.1, power: 0.5 } as const;
    expect(planShot(swing, 'back', v3(-0.1, 0.5, 9)).horizontal).toBe(0);
    expect(planShot(swing, 'back', v3(-0.1, 1.2, 9)).horizontal).toBe(1);
    expect(planShot(swing, 'back', v3(-0.1, 0.5, 9)).form).toBe('clip');
    expect(planShot(swing, 'back', v3(-0.1, 1.2, 9)).form).toBe('pull');
  });

  it('meets a ball up the blade with a slower, heavier part of the swinging bat (the arc about the hands)', () => {
    expect(swingArm(SWEET_U)).toEqual({ speed: 1, mass: 1 });
    const up = swingArm(0.6);
    const toe = swingArm(0.05);
    expect(up.speed).toBeLessThan(0.8);
    expect(up.mass).toBeGreaterThan(1.3);
    expect(toe.speed).toBeGreaterThan(1);
    expect(toe.mass).toBeLessThan(1);
  });
});

describe('shot geometry at perfect timing: the right stroke for the ball, and the wrong one', () => {
  it('cannot drive a bouncer (top edge or miss), but hooks it', () => {
    const b = fly(BOUNCER);
    for (const s of [DRIVE, COVER, LOFT]) expect(play(b, 0, s).contact.kind).not.toBe('middle');
    expect(play(b, 0, HOOK, 'real', 'back').contact.kind).toBe('middle');
  });

  it('meets a yorker with a straight bat, but cannot cut or loft it', () => {
    const y = fly(YORKER);
    // The cut never meets a yorker. Before: 'miss' past a parked fail-closed whiff. After (PHYS phase 2, as for the cut at
    // a full ball below): it is swung at its limit and the ball goes on into the pad. Either way: no bat contact.
    expect(['miss', 'pad']).toContain(play(y, 0, CUT, 'real', 'back').contact.kind);
    // Before: automatic footwork dug the yorker out from the back plane, low on the blade (bladeU < 0.15), and a loft
    // never met it on the middle. After (PHYS phase 4, 2026-11-03): no straight bat could be certified at the back
    // plane (the bat passed 11-13 cm over the ball), so automatic footwork smothers the yorker on the forward stride
    // and meets it 0.19 m off the ground, in the air. A straight bat now middles it at speed. The loft cannot be played:
    // reaching under a ball at the batter's feet, the planner certifies it at about half the straight drive's speed
    // (32 against 63 km/h at the contact), a smothered prod rather than a lofted stroke.
    // Updated for PHYS2 5d (2026-11-03): the capped loft now solves its face for the speed it plays (before, the face
    // was set for the requested 27 m/s), and that geometry is certified a little faster: 41 against 63.5 km/h, 0.64 of
    // the straight drive (was 0.50). It is still a capped prod well below the drive, so the bound is 0.7 (was 0.6).
    const lofted = play(y, 0, LOFT);
    const dug = play(y, 0, { ...DRIVE, power: 0.4 });
    expect(dug.contact.kind).toBe('middle');
    expect(dug.contact.batSpeedKph!).toBeGreaterThan(50);
    expect(lofted.contact.kind !== 'middle' || lofted.contact.batSpeedKph! < 0.7 * dug.contact.batSpeedKph!).toBe(true);
  });

  it('pulls or flicks a full ball on off stump across the line and edges or misses it; drives it cleanly', () => {
    const f = fly(FULL_OFF);
    expect(play(f, 0, PULL, 'real', 'back').contact.kind).not.toBe('middle');
    expect(play(f, 0, FLICK).contact.kind).not.toBe('middle');
    // The cut never meets this ball. It used to 'miss' past a parked fail-closed whiff; it is now swung at its limit and
    // the ball goes on into the pad (PHYS phase 2). Either way: no bat contact.
    expect(['miss', 'pad']).toContain(play(f, 0, CUT, 'real', 'back').contact.kind);
    expect(play(f, 0, DRIVE).contact.kind).toBe('middle');
    expect(play(f, 0, COVER).contact.kind).toBe('middle');
  });

  it('flicks a full ball on the pads, while the wrong-line cover drive meets the pad first', () => {
    const p = fly(FULL_PADS);
    expect(play(p, 0, FLICK).contact.kind).toBe('middle');
    // Before: the wrong-line cover drive reached the pad first at 0 ms and clipped the inside edge from +1 ms. After
    // (PHYS2 phase 5): its requested 21.0 m/s fails the dense reach scan by millimetres, so the same geometry is played
    // at its certified ceiling (20.95 m/s, contact 0.205 of the blade instead of 0.240), and the pad/inside-edge
    // boundary moved by 1 ms: at 0 ms it now clips the inside edge (0.088 m across, region edge) on its way to the pad.
    // Either way the wrong line never meets the ball with the middle.
    expect(['pad', 'inside_edge']).toContain(play(p, 0, COVER).contact.kind);
  });

  it('cuts the short wide ball; fishing at it with a straight bat, a pull or a flick misses', () => {
    const w = fly(SHORT_WIDE);
    expect(play(w, 0, CUT, 'real', 'back').contact.kind).toBe('middle');
    for (const s of [DRIVE, PULL, FLICK]) expect(play(w, 0, s).contact.kind).toBe('miss');
  });

  it('cannot loft a hard-length ball cleanly off the back foot; it punches it', () => {
    const h = fly(HARD_LENGTH);
    const lofted = play(h, 0, LOFT);
    expect(lofted.contact.kind === 'middle' && lofted.quality!.sweet).toBe(false);
    expect(play(h, 0, DRIVE).contact.kind).toBe('middle');
  });

  it('pops a drive on the up into the air: forward to a good length, the face opens with the arc', () => {
    const g = fly(GOOD_OFF);
    const onTheUp = play(g, 0, COVER, 'real', 'forward');
    expect(onTheUp.track!.shot.popDeg).toBeGreaterThan(3);
    expect(onTheUp.contact.exitElevationDeg!).toBeGreaterThan(play(fly(FULL_OFF), 0, COVER).contact.exitElevationDeg! + 3);
  });

  it('authors a 0.75 back-foot punch, then keeps independently capped high-power tracks ordered and physical', () => {
    const g = fly(GOOD_OFF);
    const lowBack = play(g, 0, { ...DRIVE, power: 0.1 }, 'real', 'back').track!;
    const lowForward = play(g, 0, { ...DRIVE, power: 0.1 }, 'real', 'forward').track!;
    expect(lowBack.speed).toBeCloseTo(batSpeed('attack', 0.1) * 0.75, 12);
    expect(lowForward.speed).toBeCloseTo(batSpeed('attack', 0.1), 12);
    expect(lowBack.speed).toBeCloseTo(0.75 * lowForward.speed, 12);
    // A cut is a full horizontal swing even though it is played from the back foot.
    expect(play(fly(SHORT_WIDE), 0, { ...CUT, power: 0.1 }, 'real', 'back').track!.speed).toBeCloseTo(lowForward.speed, 12);

    const highBack = play(g, 0, { ...DRIVE, power: 0.8 }, 'real', 'back').track!;
    const highForward = play(g, 0, { ...DRIVE, power: 0.8 }, 'real', 'forward').track!;
    expect(highBack.speed).toBeGreaterThan(lowBack.speed);
    expect(highForward.speed).toBeGreaterThan(lowForward.speed);
    expect(highBack.speed).toBeLessThan(highForward.speed);
    expect(highBack.speed).toBeLessThanOrEqual(batSpeed('attack', 0.8) * 0.75);
    expect(highForward.speed).toBeLessThanOrEqual(batSpeed('attack', 0.8));
    for (const track of [highBack, highForward]) {
      const envelope = batTrackAnalyticEnvelope(track);
      expect(envelope.gripSpeed).toBeLessThanOrEqual(BAT_GRIP_SPEED_LIMIT_MPS);
      expect(envelope.pointSpeed).toBeLessThanOrEqual(BAT_POINT_SPEED_LIMIT_MPS);
      expect(envelope.gripAcceleration).toBeLessThanOrEqual(BAT_GRIP_ACCEL_LIMIT_MPS2);
      expect(envelope.pointAcceleration).toBeLessThanOrEqual(BAT_POINT_ACCEL_LIMIT_MPS2);
      expect(envelope.angularSpeed).toBeLessThanOrEqual(BAT_ANGULAR_SPEED_LIMIT_RADPS);
      expect(envelope.angularAcceleration).toBeLessThanOrEqual(BAT_ANGULAR_ACCEL_LIMIT_RADPS2);
    }
  });

  it('is deterministic', () => {
    const b = fly(FULL_OFF);
    expect(JSON.stringify(play(b, 7, PULL, 'real', 'back'))).toBe(JSON.stringify(play(b, 7, PULL, 'real', 'back')));
  });
});
