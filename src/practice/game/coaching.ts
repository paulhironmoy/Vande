/**
 * The data behind every Practice coaching card. The physics' scoring (src/physics/scoring.ts) chooses the closed
 * reason; this module gathers the measured facts that explain it, so the UI can show the reason with its evidence
 * (timing error, where the shot was aimed against where it went, how the ball moved, which fielder and how quickly the
 * ball came back) and never has to invent an explanation. It also ranks deliveries for the over summary.
 */
import type { BowlerFamily, CoachingReason, DeliveryRecord, DeliveryResult, DeliveryVariation, Dismissal, FielderRole, LbwDecision, PlayedFootwork, SwingTiming } from '@/contracts/practice';
import { bearingDelta, flightMovement, regionOf, type FlightMovement, type Region } from '@/physics';
import { lengthBand, lineBand, type LengthBand, type LineBand } from './overs';

export const emptyTiming = (): Record<SwingTiming, number> => ({ perfect: 0, solid: 0, mistimed: 0, missed: 0, none: 0 });

export interface CoachingFacts {
  reason: CoachingReason;
  /** early / on_time / late, as on the card (null for a leave). */
  timing: 'early' | 'on_time' | 'late' | null;
  timingBand: SwingTiming;
  /** Signed timing error against the ideal contact (ms, + = late). */
  timingErrorMs: number | null;
  contact: DeliveryResult['contact']['kind'];
  /** The footwork played (forward, back, across, down the track). */
  footwork: PlayedFootwork;
  /** When the ball hit pad or body first: the LBW decision with the impact and the projected point at the stumps. */
  lbw: LbwDecision | null;
  /** Where the player aimed (the flick) and where the ball actually went off the bat, with their regions. */
  intendedBearingDeg: number | null;
  intendedRegion: Region | null;
  exitBearingDeg: number | null;
  exitRegion: Region | null;
  /** exit − intended (deg, + = further towards the off side than aimed). */
  bearingErrorDeg: number | null;
  exitSpeedKph: number | null;
  exitElevationDeg: number | null;
  /** How the delivery moved in the air and off the pitch (null for a full toss), its height at the bat and its line at the stumps. */
  movement: FlightMovement;
  delivery: { variation: DeliveryVariation; speedKph: number; lengthM: number; lineM: number; lengthBand: LengthBand; lineBand: LineBand };
  /** The fielder who caught, fielded or was beaten, and his position. */
  fielder: { id: string; role: FielderRole } | null;
  /** For a fielded ball: seconds from bat to the ball being back at the stumps (what the running was judged against). */
  returnS: number | null;
  runs: DeliveryResult['outcome']['runs'];
  boundary: 4 | 6 | null;
  dismissal: Dismissal | null;
  /** Where the ball finished (or was caught) and its region. */
  endBearingDeg: number | null;
  endDistanceM: number | null;
  endRegion: Region | null;
}

function familyOf(result: DeliveryResult, record?: Pick<DeliveryRecord, 'bowler'>): BowlerFamily {
  if (record) return record.bowler.family;
  return result.flight.release.speedKph >= 100 ? 'pace' : 'spin';
}

/** The evidence for a delivery's coaching card, read off its result (and its record, for the bowler and the field). */
export function coachingFacts(result: DeliveryResult, record?: Pick<DeliveryRecord, 'bowler' | 'field'>): CoachingFacts {
  const c = result.contact;
  const o = result.outcome;
  const plan = result.flight.plan;
  const family = familyOf(result, record);
  const fielderId = o.fielderId;
  const role = fielderId && record ? (record.field.fielders.find((f) => f.id === fielderId)?.role ?? null) : null;
  const contactT = c.t;
  const dead = result.events.find((e) => e.kind === 'dead');
  const fielded = result.events.some((e) => e.kind === 'field');
  return {
    reason: result.coaching.reason,
    timing: result.coaching.timing,
    timingBand: c.timing,
    timingErrorMs: c.timingErrorMs,
    contact: c.kind,
    footwork: result.footwork,
    lbw: result.lbw,
    intendedBearingDeg: c.intendedBearingDeg,
    intendedRegion: c.intendedBearingDeg === null ? null : regionOf(c.intendedBearingDeg),
    exitBearingDeg: c.exitBearingDeg,
    exitRegion: c.exitBearingDeg === null ? null : regionOf(c.exitBearingDeg),
    bearingErrorDeg: c.exitBearingDeg === null || c.intendedBearingDeg === null ? null : Math.round(bearingDelta(c.exitBearingDeg, c.intendedBearingDeg) * 10) / 10,
    exitSpeedKph: c.exitSpeedKph,
    exitElevationDeg: c.exitElevationDeg,
    movement: flightMovement(result.flight),
    delivery: { variation: plan.variation, speedKph: result.flight.release.speedKph, lengthM: plan.lengthM, lineM: plan.lineM, lengthBand: lengthBand(plan.lengthM, family), lineBand: lineBand(plan.lineM) },
    fielder: fielderId && role ? { id: fielderId, role } : null,
    returnS: fielded && dead && contactT !== null && !o.boundary && !o.dismissal ? Math.round((dead.t - contactT) * 100) / 100 : null,
    runs: o.runs,
    boundary: o.boundary,
    dismissal: o.dismissal,
    endBearingDeg: o.endBearingDeg,
    endDistanceM: o.endDistanceM,
    endRegion: o.region,
  };
}

/**
 * How well a delivery was handled, for "weakest delivery" (lower is weaker): out < beaten (miss, pad) < edged <
 * mistimed < solid < perfect, plus the runs it earned. A good leave scores like a solid block.
 */
export function deliveryQuality(result: DeliveryResult): number {
  const o = result.outcome;
  if (o.dismissal) return -100;
  const c = result.contact;
  let q: number;
  switch (c.kind) {
    case 'leave':
      q = 0;
      break;
    case 'miss':
      q = -40;
      break;
    case 'pad':
    case 'body':
      q = result.swing ? -35 : -5;
      break;
    case 'inside_edge':
    case 'outside_edge':
    case 'top_edge':
    case 'leading_edge':
      q = -30;
      break;
    default:
      q = c.timing === 'perfect' ? 20 : c.timing === 'solid' ? 10 : c.timing === 'mistimed' ? -10 : -20;
  }
  return q + o.runs * 3;
}
