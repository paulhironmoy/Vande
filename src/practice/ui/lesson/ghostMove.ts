/**
 * The ghost: what the first-ball lesson draws and animates, as plain numbers.
 *
 * The drawn move is the real move. `teachingSamples` is the same stroke at the speed a hand makes it, and the unit
 * tests play it through the real GestureTracker and normalizer (tests/unit/practice/ui/lesson/ghost.test.ts): it must
 * read as a firm, grounded drive about 12° to the off side, with the pull-down read as loading and the flick as the
 * commitment. The animation is the same path, slowed so the eye can follow the pull, the hold and the flick; its
 * keyframes are data (Web Animations), so a static frame for Reduced Motion is the same numbers, not a second drawing.
 *
 * Units: the drawing is 100 wide; the reference length of a gesture (docs/PRACTICE_INPUT.md) is 100 units, so the pull-down
 * is 30 and the flick 70, exactly the proportions the stroke has on a phone.
 */
import type { GestureSample, Handedness } from '@/contracts';

/** The drawing's viewBox (x, y, width, height). The stroke starts low and flicks up and a little to the off side. */
export const GHOST_BOX = { x: 0, y: -30, w: 100, h: 92 } as const;

export const GHOST = {
  /** Reference lengths (units): the pull-down, the flick, the flick's angle off straight (degrees, to the off side). */
  pullUnits: 30,
  flickUnits: 70,
  flickDeg: 12,
  /** Where the press lands in the drawing. */
  start: { x: 50, y: 18 },
  /** The hand's move at its real speed (ms): what a person does, and what the unit test plays. */
  real: { pullMs: 700, holdMs: 300, flickMs: 140 },
  /** The animation (ms): slower, so the pull, the hold and the flick can each be seen, then a rest before it repeats. */
  show: { downEnd: 240, pullEnd: 1200, holdEnd: 1800, flickEnd: 2060, fadeStart: 2880, fadeEnd: 3200, periodMs: 3600 },
} as const;

export interface GhostPoints {
  /** Press. */
  s: { x: number; y: number };
  /** Pulled down. */
  b: { x: number; y: number };
  /** Flicked. */
  f: { x: number; y: number };
}

/** The three points of the stroke. A left-hander's off side is on the left of the screen, so the flick leans left. */
export function ghostPoints(handedness: Handedness = 'right'): GhostPoints {
  const sign = handedness === 'left' ? -1 : 1;
  const a = (GHOST.flickDeg * Math.PI) / 180;
  const s = { x: GHOST.start.x, y: GHOST.start.y };
  const b = { x: s.x, y: s.y + GHOST.pullUnits };
  const f = { x: b.x + sign * Math.sin(a) * GHOST.flickUnits, y: b.y - Math.cos(a) * GHOST.flickUnits };
  return { s, b, f };
}

/** The arrowhead of the line from `from` to `to`: its tip at `to`, `size` long and `half` wide either side (viewBox units). */
export function arrowHead(
  from: { x: number; y: number },
  to: { x: number; y: number },
  size = 7.5,
  half = 3.8,
): string {
  const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const ux = (to.x - from.x) / len;
  const uy = (to.y - from.y) / len;
  const bx = to.x - ux * size;
  const by = to.y - uy * size;
  const r = (n: number) => Math.round(n * 100) / 100;
  return `${r(to.x)},${r(to.y)} ${r(bx - uy * half)},${r(by + ux * half)} ${r(bx + uy * half)},${r(by - ux * half)}`;
}

/** Where the numbered step badges sit (1 beside the pull-down, 2 beside the flick), clear of the lines on the near side. */
export function badgePoints(handedness: Handedness = 'right'): {
  pull: { x: number; y: number };
  flick: { x: number; y: number };
} {
  const { s, b, f } = ghostPoints(handedness);
  const side = handedness === 'left' ? 1 : -1;
  return {
    pull: { x: (s.x + b.x) / 2 + side * 9, y: (s.y + b.y) / 2 },
    flick: { x: (b.x + f.x) / 2 + side * 9, y: (b.y + f.y) / 2 },
  };
}

export interface GhostKeyframe {
  offset: number;
  opacity?: number;
  transform?: string;
  strokeDashoffset?: number;
  easing?: string;
}

const at = (ms: number) => ms / GHOST.show.periodMs;
const move = (p: { x: number; y: number }) => `translate(${round(p.x)}px, ${round(p.y)}px)`;
const round = (n: number) => Math.round(n * 100) / 100;

/** The hand/finger/pen sprite: lands, pulls down, waits, flicks, rests, fades. */
export function pointerKeyframes(handedness: Handedness = 'right'): GhostKeyframe[] {
  const { s, b, f } = ghostPoints(handedness);
  const z = GHOST.show;
  return [
    { offset: 0, opacity: 0, transform: move(s) },
    { offset: at(z.downEnd), opacity: 1, transform: move(s), easing: 'ease-in-out' },
    { offset: at(z.pullEnd), opacity: 1, transform: move(b) },
    { offset: at(z.holdEnd), opacity: 1, transform: move(b), easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
    { offset: at(z.flickEnd), opacity: 1, transform: move(f) },
    { offset: at(z.fadeStart), opacity: 1, transform: move(f) },
    { offset: at(z.fadeEnd), opacity: 0, transform: move(f) },
    { offset: 1, opacity: 0, transform: move(s) },
  ];
}

/** The line left behind: drawn as the sprite goes (dash offset from the full length to nothing), gone as it fades. */
export function trailKeyframes(part: 'pull' | 'flick'): GhostKeyframe[] {
  const z = GHOST.show;
  const len = part === 'pull' ? GHOST.pullUnits : GHOST.flickUnits;
  const from = part === 'pull' ? z.downEnd : z.holdEnd;
  const to = part === 'pull' ? z.pullEnd : z.flickEnd;
  return [
    { offset: 0, opacity: 0, strokeDashoffset: len },
    { offset: at(from), opacity: 1, strokeDashoffset: len, easing: part === 'pull' ? 'ease-in-out' : 'ease-out' },
    { offset: at(to), opacity: 1, strokeDashoffset: 0 },
    { offset: at(z.fadeStart), opacity: 1, strokeDashoffset: 0 },
    { offset: at(z.fadeEnd), opacity: 0, strokeDashoffset: 0 },
    { offset: 1, opacity: 0, strokeDashoffset: len },
  ];
}

/** An arrowhead appears when its line has been drawn, and goes with the rest at the end of the loop. */
export function headKeyframes(part: 'pull' | 'flick'): GhostKeyframe[] {
  const z = GHOST.show;
  const from = part === 'pull' ? z.pullEnd : z.flickEnd;
  return [
    { offset: 0, opacity: 0 },
    { offset: at(from - 40), opacity: 0 },
    { offset: at(from), opacity: 1 },
    { offset: at(z.fadeStart), opacity: 1 },
    { offset: at(z.fadeEnd), opacity: 0 },
    { offset: 1, opacity: 0 },
  ];
}

/**
 * The three labels light as the stroke reaches what they name: Lift at the pull-down (how deep), Power through the flick
 * (how fast), Aim at its end (which way). Opacity only; at rest all three stay readable in the text row.
 */
export function wordKeyframes(word: 'lift' | 'power' | 'aim'): GhostKeyframe[] {
  const z = GHOST.show;
  const [from, to] =
    word === 'lift' ? [z.downEnd, z.holdEnd] : word === 'power' ? [z.holdEnd, z.flickEnd] : [z.flickEnd, z.fadeEnd];
  const lit = 1;
  const dim = 0.45;
  return [
    { offset: 0, opacity: dim },
    { offset: at(from), opacity: dim },
    { offset: at(Math.min(from + 160, to)), opacity: lit },
    { offset: at(to), opacity: lit },
    { offset: at(Math.min(to + 360, z.periodMs)), opacity: dim },
    { offset: 1, opacity: dim },
  ];
}

/** The keyboard ghost: four keys pressed one after the other (an arrow, a side arrow, Shift with an arrow, Space). */
export const GHOST_KEYS = ['up', 'right', 'shift', 'space'] as const;
export type GhostKey = (typeof GHOST_KEYS)[number];

/** A key's highlight: lit for most of its quarter of the loop. */
export function keyKeyframes(key: GhostKey): GhostKeyframe[] {
  const i = GHOST_KEYS.indexOf(key);
  const q = 1 / GHOST_KEYS.length;
  const on = i * q + q * 0.08;
  const off = (i + 1) * q - q * 0.12;
  return [
    { offset: 0, opacity: 0 },
    { offset: on, opacity: 0 },
    { offset: on + 0.01, opacity: 1 },
    { offset: off, opacity: 1 },
    { offset: off + 0.01, opacity: 0 },
    { offset: 1, opacity: 0 },
  ];
}

/** The camera ghost: two hands rise and go back, wait, then swing forward and down. Dots only: no limbs, no landmarks. */
export function handKeyframes(side: 'near' | 'far'): GhostKeyframe[] {
  const z = GHOST.show;
  const dx = side === 'near' ? 0 : 7;
  const rest = { x: 44 + dx, y: 26 };
  const back = { x: 36 + dx, y: 0 };
  const through = { x: 52 + dx, y: 40 };
  return [
    { offset: 0, opacity: 0, transform: move(rest) },
    { offset: at(z.downEnd), opacity: 1, transform: move(rest), easing: 'ease-in-out' },
    { offset: at(z.pullEnd), opacity: 1, transform: move(back) },
    { offset: at(z.holdEnd), opacity: 1, transform: move(back), easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)' },
    { offset: at(z.flickEnd), opacity: 1, transform: move(through) },
    { offset: at(z.fadeStart), opacity: 1, transform: move(through) },
    { offset: at(z.fadeEnd), opacity: 0, transform: move(through) },
    { offset: 1, opacity: 0, transform: move(rest) },
  ];
}

/**
 * The same stroke as a hand makes it: digitizer samples (CSS px, the event clock) for a gesture surface of this size.
 * The press is low in the surface so that the flick, 0.7 of a reference length up, ends inside it too.
 */
export function teachingSamples(o: {
  surface: { width: number; height: number };
  handedness?: Handedness;
  t0?: number;
  rateMs?: number;
}): GestureSample[] {
  const { width, height } = o.surface;
  const rl = Math.min(260, Math.max(180, Math.min(width, height)));
  const sign = o.handedness === 'left' ? -1 : 1;
  const a = (GHOST.flickDeg * Math.PI) / 180;
  const pull = (GHOST.pullUnits / 100) * rl;
  const flick = (GHOST.flickUnits / 100) * rl;
  const x0 = width / 2;
  const y0 = Math.max(0, Math.min(height - pull, height * 0.55));
  const { pullMs, holdMs, flickMs } = GHOST.real;
  const rate = o.rateMs ?? 4;
  const t0 = o.t0 ?? 1000;
  const total = pullMs + holdMs + flickMs + 30;
  const out: GestureSample[] = [];
  for (let t = 0; t <= total + 1e-9; t += rate) {
    let x = 0;
    let y = pull;
    if (t <= pullMs) {
      const u = t / pullMs;
      y = pull * u * u * (3 - 2 * u);
    } else if (t > pullMs + holdMs) {
      const u = Math.min(1, (t - pullMs - holdMs) / flickMs);
      const e = 1 - (1 - u) * (1 - u);
      x = sign * Math.sin(a) * flick * e;
      y = pull - Math.cos(a) * flick * e;
    }
    out.push({ t: t0 + t, x: x0 + x, y: y0 + y });
  }
  return out;
}
