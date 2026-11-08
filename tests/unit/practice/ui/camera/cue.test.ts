/**
 * The first-swing silhouette is the real move: bones keep their length, the loop is continuous, the hands rise, wait,
 * swing down toward the off side and rest, and a left-hander's picture is the exact mirror of a right-hander's.
 */
import { describe, expect, it } from 'vitest';
import {
  CUE,
  CUE_TIMELINE,
  armPath,
  armsFor,
  arrowHead,
  elbowOf,
  handsAt,
  poseAt,
  stillPoses,
  type Pt,
} from '@/practice/ui/camera/cue';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const T = CUE_TIMELINE;

describe('elbowOf: a two-bone arm', () => {
  it('puts the elbow exactly one bone from the shoulder and one from the hand when the hand is in reach', () => {
    const shoulder = { x: 40, y: 31 };
    for (const hand of [
      { x: 47, y: 30 },
      { x: 47, y: 58 },
      { x: 60, y: 60 },
      { x: 30, y: 50 },
    ]) {
      for (const bend of [1, -1] as const) {
        const e = elbowOf(shoulder, hand, bend);
        expect(dist(shoulder, e)).toBeCloseTo(CUE.bone.upper, 6);
        expect(dist(e, hand)).toBeCloseTo(CUE.bone.fore, 6);
      }
    }
  });

  it('bends to opposite sides for opposite bends', () => {
    const shoulder = { x: 40, y: 31 };
    const hand = { x: 47, y: 58 };
    expect(elbowOf(shoulder, hand, 1)).not.toEqual(elbowOf(shoulder, hand, -1));
  });

  it('straightens toward a hand out of reach and never stretches the arm', () => {
    const shoulder = { x: 40, y: 31 };
    const far = { x: 40, y: 200 };
    const e = elbowOf(shoulder, far, 1);
    expect(dist(shoulder, e)).toBeCloseTo(CUE.bone.upper, 6);
    expect(dist(e, shoulder) + dist(e, far)).toBeGreaterThan(CUE.bone.upper);
  });
});

describe('the loop', () => {
  it('rests, rises, holds, swings, finishes and comes back, in that order', () => {
    const phases = [100, 800, 1700, 2200, 2700, 3300].map((ms) => handsAt(ms).phase);
    expect(phases).toEqual(['rest', 'rise', 'hold', 'swing', 'finish', 'return']);
  });

  it('keeps the hands at the top of the backlift while it waits, and at the finish while it holds', () => {
    expect(handsAt(1500).centre).toEqual(CUE.up);
    expect(handsAt(2200 + 0).phase).toBe('swing');
    expect(handsAt(2700).centre).toEqual(CUE.end);
    expect(handsAt(100).centre).toEqual(CUE.rest);
  });

  it('is continuous: no jump at any boundary, and the end of the loop meets its start', () => {
    for (const edge of [T.restEnd, T.riseEnd, T.holdEnd, T.swingEnd, T.finishEnd, T.period]) {
      const before = handsAt(edge - 0.01).centre;
      const after = handsAt(edge + 0.01).centre;
      expect(dist(before, after), `at ${edge}`).toBeLessThan(0.3);
    }
    expect(handsAt(T.period).centre).toEqual(handsAt(0).centre);
    expect(handsAt(T.period * 3 + 700).centre).toEqual(handsAt(700).centre);
    expect(handsAt(-T.period + 700).centre).toEqual(handsAt(700).centre);
  });

  it("rises before it swings, and swings down and across to the right of a right-hander's picture", () => {
    expect(handsAt(T.riseEnd).centre.y).toBeLessThan(handsAt(0).centre.y);
    const end = handsAt(T.swingEnd).centre;
    expect(end.y).toBeGreaterThan(CUE.up.y);
    expect(end.x).toBeGreaterThan(CUE.up.x);
  });

  it('rests for about 0.4 s before it starts again', () => {
    expect(T.restEnd).toBe(400);
    expect(T.period - T.finishEnd + T.restEnd).toBeGreaterThanOrEqual(400);
  });

  it('is the exact mirror for a left-hander', () => {
    for (const ms of [0, 500, 1000, 1500, 2200, 2300, 2700, 3300]) {
      const r = handsAt(ms, 'right').centre;
      const l = handsAt(ms, 'left').centre;
      expect(l.x).toBeCloseTo(100 - r.x, 9);
      expect(l.y).toBeCloseTo(r.y, 9);
    }
  });
});

describe('the arms through the loop', () => {
  it('keep their bone lengths at every moment, for both hands: an arm never stretches or shrinks', () => {
    for (const hand of ['right', 'left'] as const) {
      for (let ms = 0; ms < T.period; ms += 37) {
        const pose = poseAt(ms, hand);
        for (const arm of [pose.left, pose.right]) {
          expect(dist(arm[0], arm[1]), `${hand} ${ms}`).toBeCloseTo(CUE.bone.upper, 6);
          expect(dist(arm[1], arm[2]), `${hand} ${ms}`).toBeCloseTo(CUE.bone.fore, 6);
        }
      }
    }
  });

  it('put the hands where the move says: together, one grip apart, shoulders fixed', () => {
    const pose = armsFor({ x: 50, y: 40 });
    expect(pose.left[0]).toEqual(CUE.shoulder.left);
    expect(pose.right[0]).toEqual(CUE.shoulder.right);
    expect(dist(pose.left[2], pose.right[2])).toBeCloseTo(CUE.grip, 9);
    expect((pose.left[2].x + pose.right[2].x) / 2).toBeCloseTo(50, 9);
  });

  it('let the elbows hang down and out, never above the hands at rest', () => {
    const pose = poseAt(0);
    expect(pose.left[1].y).toBeGreaterThan(pose.left[0].y);
    expect(pose.left[1].x).toBeLessThan(pose.left[0].x);
    expect(pose.right[1].x).toBeGreaterThan(pose.right[0].x);
  });
});

describe('the still pictures for Reduced Motion', () => {
  it('are the top of the backlift and the finish, and mirror for a left-hander', () => {
    const r = stillPoses('right');
    const l = stillPoses('left');
    expect(r.from).toEqual(CUE.up);
    expect(r.to).toEqual(CUE.end);
    expect(l.to.x).toBeCloseTo(100 - CUE.end.x, 9);
    expect(l.bow.x).toBeCloseTo(100 - r.bow.x, 9);
  });
});

describe('small drawing helpers', () => {
  it('draws an arrowhead of the given length on both sides of the line, ending at the tip', () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, 30);
    expect(dist(a, { x: 10, y: 0 })).toBeCloseTo(5, 9);
    expect(dist(b, { x: 10, y: 0 })).toBeCloseTo(5, 9);
    expect(a.x).toBeLessThan(10);
    expect(a.y).toBeCloseTo(-b.y, 9);
  });

  it('writes an arm as a three-point path rounded to a tenth', () => {
    expect(
      armPath([
        { x: 1.04, y: 2 },
        { x: 3, y: 4.26 },
        { x: 5, y: 6 },
      ]),
    ).toBe('M1 2 L3 4.3 L5 6');
  });
});

describe('the drawn backlift is an attacking one (the camera reads a small lift as a defence)', () => {
  it("rises 0.8 shoulder widths or more, to the shoulder line or above, and clear of the core's boundary", async () => {
    const { DEFENCE } = await import('@/input/camera/constants');
    const shoulderWidth = CUE.shoulder.right.x - CUE.shoulder.left.x;
    const riseU = (CUE.rest.y - CUE.up.y) / shoulderWidth;
    // "A backlift under DEFENCE.maxPeakRiseU then a gentle push is a defensive tap; the shoulders or above (0.8 u and more) is an attack."
    expect(riseU).toBeGreaterThanOrEqual(0.8);
    expect(riseU).toBeGreaterThan(DEFENCE.maxPeakRiseU + 0.2);
    expect(CUE.up.y).toBeLessThanOrEqual(CUE.shoulder.left.y + 1);
    // The picture never claims a small lift is an attack: the hands start at the waist, well below where they go.
    expect(CUE.rest.y).toBeGreaterThan(CUE.shoulder.left.y + shoulderWidth);
  });
});
