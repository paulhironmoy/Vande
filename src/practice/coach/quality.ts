/**
 * How the bat met the ball, measured from the contact itself and never from its label (anti-fake rule 7; owner
 * rulings 2026-11-03): the bat speed against the speed the stroke asked for, and where on the blade it met the ball.
 * One source for the tip's praise gate (tip.ts), the soundness of a recommended stroke (options.ts soundAtCentre) and
 * a mastery success (insight.ts metStandard), so all three agree.
 */
import type { CoachAnalysis, ContactReport } from '@/contracts/practice';
import { shotFamily } from '@/physics';
import { batSpeed } from '@/physics/bat';
import { BACK_FOOT_PUNCH, BLADE_L, SWEET_ALONG_M, SWEET_U } from '@/physics/constants';

/** A stroke that met the ball at less than this share of the bat speed it asked for is a fend, not the stroke. */
export const PRAISE_MIN_SPEED_SHARE = 0.5;

/**
 * The bat speed a stroke asks for (km/h), as the physics plans it (bat.ts batSpeed; a vertical-bat stroke off the back
 * foot is a checked punch, BACK_FOOT_PUNCH). The pull and hook are taken as full horizontal swings. Null for a block or
 * a leave.
 */
export function requestedKph(
  a: Pick<CoachAnalysis['attempted'], 'decision' | 'power' | 'directionDeg' | 'footwork'>,
): number | null {
  if (a.decision !== 'attack' || a.power === null || a.directionDeg === null) return null;
  const family = shotFamily('attack', a.directionDeg, a.footwork);
  const punch =
    (a.footwork === 'back' || a.footwork === 'across') &&
    (family === 'back_drive' || family === 'back_punch' || family === 'back_on_punch')
      ? BACK_FOOT_PUNCH
      : 1;
  return batSpeed('attack', a.power) * punch * 3.6;
}

/** A measured number, or null (unmeasured: null, undefined or not finite). */
export const measured = (v: number | null | undefined): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * The stroke met the ball below PRAISE_MIN_SPEED_SHARE of the speed it asked for: a fend. False for a block or a leave
 * (a block is meant to be slow) and when either speed is unmeasured.
 */
export function slowFend(
  a: Pick<CoachAnalysis['attempted'], 'decision' | 'power' | 'directionDeg' | 'footwork'>,
  contact: Pick<ContactReport, 'batSpeedKph'>,
): boolean {
  const req = requestedKph(a);
  const kph = measured(contact.batSpeedKph);
  return req !== null && kph !== null && kph < PRAISE_MIN_SPEED_SHARE * req;
}

/** How far along the blade from the sweet spot the ball was met (m, signed: + towards the handle); null unmeasured. */
export function offSweetAlongM(contact: Pick<ContactReport, 'bladeU'>): number | null {
  const u = measured(contact.bladeU);
  return u === null ? null : (u - SWEET_U) * BLADE_L;
}

/** Met inside the sweet zone along the blade (SWEET_ALONG_M either side of the sweet spot); true when unmeasured. */
export function inSweetZone(contact: Pick<ContactReport, 'bladeU'>): boolean {
  const d = offSweetAlongM(contact);
  return d === null || Math.abs(d) <= SWEET_ALONG_M;
}

/** Beyond the toe end of the blade (bladeU < 0), which contract v6 still labels 'middle'. */
export const offTheToe = (contact: Pick<ContactReport, 'bladeU'>): boolean => {
  const u = measured(contact.bladeU);
  return u !== null && u < 0;
};

/**
 * A clean contact by measurement: off the face ('middle'), not off the toe, and for a stroke at no less than
 * PRAISE_MIN_SPEED_SHARE of its requested speed and inside the sweet zone. A block is judged by the face alone.
 */
export function cleanByMeasure(
  a: Pick<CoachAnalysis['attempted'], 'decision' | 'power' | 'directionDeg' | 'footwork'>,
  contact: Pick<ContactReport, 'kind' | 'bladeU' | 'batSpeedKph'>,
): boolean {
  if (contact.kind !== 'middle' || offTheToe(contact)) return false;
  if (a.decision !== 'attack') return true;
  return !slowFend(a, contact) && inSweetZone(contact);
}
