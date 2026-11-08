/**
 * The first-swing silhouette's geometry, as plain numbers: where the head, shoulders and hands are, how the two arms bend
 * (a two-bone chain with fixed bone lengths, so an arm never stretches or shrinks), and where the hands are at any
 * moment of the loop. The picture is the move the camera reads: both hands rise ("hands up and back"), wait, then swing
 * forward and down, a little to the player's off side. It is drawn from the front, as the player sees themselves.
 *
 * Everything is a pure function, so the unit tests check the real picture: bone lengths stay constant, the loop is
 * continuous, a left-hander's picture is the exact mirror of a right-hander's.
 */
import type { Handedness } from '@/contracts';

export interface Pt {
  x: number;
  y: number;
}

/** The drawing's size (viewBox 0 0 w h). */
export const CUE_BOX = { w: 100, h: 92 } as const;

export const CUE = {
  head: { x: 50, y: 15, r: 7 },
  /** The shoulders, as the player's right and left appear in a mirror: the right hand's shoulder is on the picture's right. */
  shoulder: { left: { x: 40, y: 31 }, right: { x: 60, y: 31 } },
  torso: { x: 38, y: 28, w: 24, h: 46, r: 9 },
  /** The two bones of each arm. */
  bone: { upper: 19, fore: 18 },
  /** The two hands hold the bat together, this far apart. */
  grip: 6,
  /** Where the hands (their middle) wait, rise to, and finish for a right-hander. */
  rest: { x: 50, y: 58 },
  up: { x: 50, y: 30 },
  end: { x: 63, y: 60 },
  /** The swing's curve bends this far out to the off side before it comes down. */
  swingBow: { x: 6, y: -4 },
} as const;

/** The loop, in ms: wait, rise, hold, swing, hold, come back. A rest of about 0.4 s separates one loop from the next. */
export const CUE_TIMELINE = {
  restEnd: 400,
  riseEnd: 1300,
  holdEnd: 2100,
  swingEnd: 2400,
  finishEnd: 3000,
  period: 3600,
} as const;

export type CuePhase = 'rest' | 'rise' | 'hold' | 'swing' | 'finish' | 'return';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const mix = (a: Pt, b: Pt, t: number): Pt => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** The off side is on the picture's right for a right-hander and its left for a left-hander. */
const side = (hand: Handedness): 1 | -1 => (hand === 'left' ? -1 : 1);
const mirrorX = (x: number) => 100 - x;

function ends(hand: Handedness): { rest: Pt; up: Pt; end: Pt; bow: Pt } {
  const m = (p: Pt): Pt => (side(hand) === 1 ? { ...p } : { x: mirrorX(p.x), y: p.y });
  return {
    rest: m(CUE.rest),
    up: m(CUE.up),
    end: m(CUE.end),
    bow: { x: side(hand) * CUE.swingBow.x, y: CUE.swingBow.y },
  };
}

/** The middle of the two hands at `ms` into the loop, and which part of the move that is. */
export function handsAt(ms: number, hand: Handedness = 'right'): { centre: Pt; phase: CuePhase } {
  const t = ((ms % CUE_TIMELINE.period) + CUE_TIMELINE.period) % CUE_TIMELINE.period;
  const e = ends(hand);
  const T = CUE_TIMELINE;
  if (t < T.restEnd) return { centre: e.rest, phase: 'rest' };
  if (t < T.riseEnd)
    return { centre: mix(e.rest, e.up, ease((t - T.restEnd) / (T.riseEnd - T.restEnd))), phase: 'rise' };
  if (t < T.holdEnd) return { centre: e.up, phase: 'hold' };
  if (t < T.swingEnd) {
    // Down and across along a curve that bows out to the off side first: a quadratic Bezier from the top to the finish.
    const u = ease((t - T.holdEnd) / (T.swingEnd - T.holdEnd));
    const control: Pt = { x: lerp(e.up.x, e.end.x, 0.5) + e.bow.x, y: lerp(e.up.y, e.end.y, 0.5) + e.bow.y };
    const a = mix(e.up, control, u);
    const b = mix(control, e.end, u);
    return { centre: mix(a, b, u), phase: 'swing' };
  }
  if (t < T.finishEnd) return { centre: e.end, phase: 'finish' };
  return { centre: mix(e.end, e.rest, ease((t - T.finishEnd) / (T.period - T.finishEnd))), phase: 'return' };
}

export interface ArmPose {
  /** Each arm's shoulder, elbow and hand. */
  left: [Pt, Pt, Pt];
  right: [Pt, Pt, Pt];
}

/**
 * The elbow of a two-bone arm: at `upper` from the shoulder and `fore` from the hand. If the hand is out of reach the
 * arm straightens toward it (never stretches); `bend` (-1 or 1) picks which side of the shoulder-hand line the elbow is on.
 */
export function elbowOf(
  shoulder: Pt,
  hand: Pt,
  bend: 1 | -1,
  upper: number = CUE.bone.upper,
  fore: number = CUE.bone.fore,
): Pt {
  const dx = hand.x - shoulder.x;
  const dy = hand.y - shoulder.y;
  const reach = upper + fore;
  const d = Math.max(Math.abs(upper - fore) + 1e-6, Math.min(Math.hypot(dx, dy), reach * 0.999));
  const base = Math.atan2(dy, dx);
  const cos = (upper * upper + d * d - fore * fore) / (2 * upper * d);
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)));
  const a = base + bend * angle;
  return { x: shoulder.x + Math.cos(a) * upper, y: shoulder.y + Math.sin(a) * upper };
}

/** Both arms for the middle of the hands at `centre`. The elbows hang down and out, as a batter's do. */
export function armsFor(centre: Pt): ArmPose {
  const l: Pt = { x: centre.x - CUE.grip / 2, y: centre.y };
  const r: Pt = { x: centre.x + CUE.grip / 2, y: centre.y };
  return {
    left: [CUE.shoulder.left, elbowOf(CUE.shoulder.left, l, 1), l],
    right: [CUE.shoulder.right, elbowOf(CUE.shoulder.right, r, -1), r],
  };
}

/** The pose at `ms` into the loop. */
export function poseAt(ms: number, hand: Handedness = 'right'): ArmPose & { phase: CuePhase } {
  const { centre, phase } = handsAt(ms, hand);
  return { ...armsFor(centre), phase };
}

/** The two still pictures for Reduced Motion: the top of the backlift, and the finish of the swing. */
export function stillPoses(hand: Handedness = 'right'): { first: ArmPose; second: ArmPose; from: Pt; to: Pt; bow: Pt } {
  const e = ends(hand);
  const control: Pt = { x: lerp(e.up.x, e.end.x, 0.5) + e.bow.x, y: lerp(e.up.y, e.end.y, 0.5) + e.bow.y };
  return { first: armsFor(e.up), second: armsFor(e.end), from: e.up, to: e.end, bow: control };
}

/** The SVG path of one arm (shoulder, elbow, hand), rounded to a tenth of a unit. */
export function armPath(arm: [Pt, Pt, Pt]): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  return `M${f(arm[0].x)} ${f(arm[0].y)} L${f(arm[1].x)} ${f(arm[1].y)} L${f(arm[2].x)} ${f(arm[2].y)}`;
}

/** The two barbs of an arrowhead that ends at `to`, coming from `from`: `len` long, `spreadDeg` either side of the line. */
export function arrowHead(from: Pt, to: Pt, len = 5, spreadDeg = 28): [Pt, Pt] {
  const back = Math.atan2(from.y - to.y, from.x - to.x);
  const spread = (spreadDeg * Math.PI) / 180;
  return [
    { x: to.x + Math.cos(back + spread) * len, y: to.y + Math.sin(back + spread) * len },
    { x: to.x + Math.cos(back - spread) * len, y: to.y + Math.sin(back - spread) * len },
  ];
}
