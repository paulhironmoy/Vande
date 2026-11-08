/**
 * Shot geometry (docs/PRACTICE_PHYSICS.md, "Shot geometry"): the stroke the player chose, and where its bat path can
 * meet the ball.
 *
 * The player chooses the stroke: kind, direction, elevation, power and footwork (NormalizedSwing). The stroke fixes
 * the bat's path. A drive is a vertical bat swung down the line of its direction from the stride; a cut is a horizontal
 * bat chopping across the line outside off stump from the back foot; a pull is a horizontal bat at chest height,
 * swung to the leg side. So a stroke can put its sweet spot only within its reach (constants.ts SHOT_FORMS): a range of
 * lines and heights at the contact plane. The batter aims the sweet spot where he reads the ball, as far as the
 * stroke reaches: the read is clamped into the reach. A ball outside it meets the bat that much away from the sweet
 * spot (towards an edge, the toe, the shoulder or the gloves) or passes the bat, exactly as the swept collision
 * finds. Nothing here decides an outcome; it only says where the bat goes.
 *
 * - Lofting narrows the heights: the bat has to get under the ball, so not a ball at the toes, and not one rising
 *   past the waist for a vertical bat.
 * - A harder swing narrows the whole reach (SHOT_POWER_SHRINK × power²): it is committed earlier and adjusts less.
 * - A back-foot leg-side stroke is a clip with a vertical bat at a ball below the waist and a pull with a horizontal one
 *   above; a fine one is a glance or a hook. The batter turns from one to the other by the height he reads, over a
 *   short band (SHOT_SWITCH_BAND_M).
 *
 * Deterministic: basic arithmetic only.
 */
import type { NormalizedSwing, PlayedFootwork, SwingKind } from '@/contracts/practice';
import { SHOT_FORMS, SHOT_LOFT_FROM, SHOT_LOFT_FULL, SHOT_POWER_SHRINK, SHOT_SWITCH_BAND_M, SHOT_SWITCH_Y, SWING_ARC_R } from './constants';
import { type Vec3, RAD, clamp, dacos, smooth01, v3 } from './vec';

/** One form of bat for a stroke (a key of SHOT_FORMS). */
export type ShotForm = keyof typeof SHOT_FORMS;

/** The stroke a swing plays, from its kind, direction and footwork (never from the ball). */
export type ShotFamily =
  | 'forward_defence'
  | 'back_defence'
  | 'straight_drive'
  | 'off_drive'
  | 'cover_drive'
  | 'square_drive'
  | 'steer'
  | 'on_drive'
  | 'flick'
  | 'glance'
  | 'back_drive'
  | 'back_punch'
  | 'back_on_punch'
  | 'cut'
  | 'pull'
  | 'hook';

/** The forms of each stroke: one, or a vertical and a horizontal one chosen by the height read (pull, hook). */
export const SHOT_FAMILY_FORMS: Readonly<Record<ShotFamily, { v: ShotForm; h?: ShotForm; switchY?: number }>> = {
  forward_defence: { v: 'forward_defence' },
  back_defence: { v: 'back_defence' },
  straight_drive: { v: 'straight_drive' },
  off_drive: { v: 'off_drive' },
  cover_drive: { v: 'cover_drive' },
  square_drive: { v: 'square_drive' },
  steer: { v: 'steer' },
  on_drive: { v: 'on_drive' },
  flick: { v: 'flick' },
  glance: { v: 'glance' },
  back_drive: { v: 'back_drive' },
  back_punch: { v: 'back_punch' },
  back_on_punch: { v: 'back_on_punch' },
  cut: { v: 'cut' },
  pull: { v: 'clip', h: 'pull', switchY: SHOT_SWITCH_Y.pull },
  hook: { v: 'back_glance', h: 'hook', switchY: SHOT_SWITCH_Y.hook },
};

function wrapDeg(d: number): number {
  let x = d % 360;
  if (x > 180) x -= 360;
  if (x < -180) x += 360;
  return x;
}

const isFront = (footwork: PlayedFootwork) => footwork === 'forward' || footwork === 'down_track';

/**
 * The stroke for a swing: a defence on the front or back foot, or by the direction (bearing, + off side) and the
 * footwork played. Front foot: the straight drive within 15° of straight, the off drive to 35°, the cover drive to
 * 75°, the square drive to 125°, a steer finer; the on drive to −35°, the flick to −125°, a glance finer. Back foot
 * (and across): the back-foot drive within 15° of straight, the punch through the off side to 70°, the cut squarer
 * and finer; the punch through the on side to −45°, the pull (or clip) to −115°, the hook (or glance) finer.
 */
export function shotFamily(kind: SwingKind, directionDeg: number, footwork: PlayedFootwork): ShotFamily {
  const front = isFront(footwork);
  if (kind === 'defend') return front ? 'forward_defence' : 'back_defence';
  const d = wrapDeg(directionDeg);
  if (front) {
    if (d >= -15 && d <= 15) return 'straight_drive';
    if (d > 15) return d <= 35 ? 'off_drive' : d <= 75 ? 'cover_drive' : d <= 125 ? 'square_drive' : 'steer';
    return d >= -35 ? 'on_drive' : d >= -125 ? 'flick' : 'glance';
  }
  if (d >= -15 && d <= 15) return 'back_drive';
  if (d > 15) return d <= 70 ? 'back_punch' : 'cut';
  return d >= -45 ? 'back_on_punch' : d >= -115 ? 'pull' : 'hook';
}

/** Where a swing's bat goes: its stroke, the bat's orientation, the reach and the sweet spot's aim. */
export interface ShotPlan {
  family: ShotFamily;
  /** The form played (for the pull and hook families, the one the height read chose; the nearer when blending). */
  form: ShotForm;
  /** 0 = vertical bat … 1 = horizontal bat. */
  horizontal: number;
  /** The reach at the contact plane after the loft and the power: line (m, + off side) and height (m). */
  x: [number, number];
  y: [number, number];
  /** Where the sweet spot aims: the read clamped into the reach. */
  aim: Vec3;
  /** How far the read lay outside the reach (read − aim; zero inside it). */
  outside: Vec3;
  /**
   * How much the face has opened (deg) because the ball is above the reach of a vertical bat: it is met on the rising
   * part of the swing's arc (SWING_ARC_R). Added to the elevation the face is set for. 0 inside the reach.
   */
  popDeg: number;
}

const lerp2 = (a: readonly [number, number], b: readonly [number, number], f: number): [number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

function shrink(r: [number, number], k: number): [number, number] {
  const h = ((r[1] - r[0]) / 2) * k;
  return [r[0] + h, r[1] - h];
}

/**
 * The shot plan for a swing against the ball as the batter reads it at his contact plane. Pure: depends only on the
 * swing (kind, direction, elevation, power), the footwork played and the read.
 */
export function planShot(swing: Pick<NormalizedSwing, 'kind' | 'directionDeg' | 'elevation' | 'power'>, footwork: PlayedFootwork, read: Vec3): ShotPlan {
  const family = shotFamily(swing.kind, swing.directionDeg, footwork);
  const spec = SHOT_FAMILY_FORMS[family];
  const fv = SHOT_FORMS[spec.v];
  const fh = spec.h ? SHOT_FORMS[spec.h] : fv;
  const w = spec.h && spec.switchY !== undefined ? smooth01((read.y - (spec.switchY - SHOT_SWITCH_BAND_M / 2)) / SHOT_SWITCH_BAND_M) : 0;
  const attack = swing.kind === 'attack';
  const loft = attack ? smooth01((clamp(swing.elevation, 0, 1) - SHOT_LOFT_FROM) / (SHOT_LOFT_FULL - SHOT_LOFT_FROM)) : 0;
  const yv = lerp2(fv.y, fv.loftY, loft);
  const yh = lerp2(fh.y, fh.loftY, loft);
  let x = lerp2(fv.x, fh.x, w);
  let y = lerp2(yv, yh, w);
  if (attack) {
    const p = clamp(swing.power, 0, 1);
    const k = SHOT_POWER_SHRINK * p * p;
    x = shrink(x, k);
    y = shrink(y, k);
  }
  const aim = v3(clamp(read.x, x[0], x[1]), clamp(read.y, y[0], y[1]), read.z);
  const horizontal = fv.horizontal + (fh.horizontal - fv.horizontal) * w;
  const above = read.y - aim.y;
  const popDeg = above > 0 ? (1 - horizontal) * dacos(1 - Math.min(above, SWING_ARC_R) / SWING_ARC_R) * RAD : 0;
  return {
    family,
    form: w < 0.5 ? spec.v : (spec.h ?? spec.v),
    horizontal,
    x,
    y,
    aim,
    outside: v3(read.x - aim.x, read.y - aim.y, 0),
    popDeg,
  };
}
