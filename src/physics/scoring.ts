/**
 * The ONE scoring and dismissal pipeline for Practice. Given what physically happened to a delivery (the flight, the
 * contact, the batter's pad or body, the stumps, the fielding and the running), it decides the DeliveryOutcome and
 * the closed coaching reason that explains it. It never draws a random number: every runs value, boundary and
 * dismissal is read off the simulated play.
 *
 * Order of decisions (docs/PRACTICE_RULES.md, "Scoring and dismissals"):
 *   1. Bowled: the delivery hits the stumps without touching bat or batter (including when it was left), or it is
 *      played on: after an edge (usually the inside edge) the struck ball runs or flies into the striker's stumps
 *      (the integrator's swept stumps test, ball.ts `detectStumps`).
 *   2. LBW: the delivery hits pad or body first; the physics' LBW law (lbw.ts) decides out or not out. Not out is a
 *      dead ball (no leg byes in Practice), unless the ball rebounds onto the stumps: bowled (Law 32).
 *   3. Caught: the struck ball is caught before it bounces. By the keeper, or by a slip off an edge, it is
 *      `caught_behind`; by anyone else it is `caught`. A chance that goes down is not out (fielding.ts drop rule).
 *   4. Boundary: the struck ball reaches the rope: 6 if it never touched the ground, otherwise 4.
 *   5. Runs: otherwise the batters run 0–3 against the fielders' return (running.ts).
 *   A missed or left ball that beats everything is taken by the keeper: dead, no byes.
 */
import type {
  BallFlight,
  BowlerProfile,
  Coaching,
  CoachingReason,
  ContactReport,
  DeliveryOutcome,
  Dismissal,
  FieldLayout,
  FielderRole,
  LbwDecision,
  NormalizedSwing,
  Vec3,
} from '@/contracts/practice';
import type { FieldZone } from '@/contracts/cricket';
import { flightMovement } from './delivery';
import { bearingFromStriker, distanceFromStriker } from './field';
import { DEEP_FROM_M, type FieldingResult } from './fielding';
import type { RunningResult } from './running';

// ---------------------------------------------------------------------------------------------------------------
// Regions of the field
// ---------------------------------------------------------------------------------------------------------------

export type Region = FieldZone | 'straight' | 'behind';

/**
 * Field regions by bearing from the striker (degrees, + = off side): straight within 8° of the bowler's stumps,
 * behind within 15° of the keeper, otherwise the eight zones of src/contracts/cricket.ts.
 */
export const REGION_EDGES = { straight: 8, behind: 165, midOff: 40, cover: 80, point: 115 } as const;

export function regionOf(bearingDeg: number): Region {
  const b = Math.abs(bearingDeg);
  const off = bearingDeg >= 0;
  if (b <= REGION_EDGES.straight) return 'straight';
  if (b >= REGION_EDGES.behind) return 'behind';
  if (b <= REGION_EDGES.midOff) return off ? 'mid_off' : 'mid_on';
  if (b <= REGION_EDGES.cover) return off ? 'cover' : 'midwicket';
  if (b <= REGION_EDGES.point) return off ? 'point' : 'square_leg';
  return off ? 'third_man' : 'fine_leg';
}

/** The nearest of the eight zones (straight and behind fold into the zone on their side). */
export function zoneOf(bearingDeg: number): FieldZone {
  const r = regionOf(bearingDeg);
  if (r === 'straight') return bearingDeg >= 0 ? 'mid_off' : 'mid_on';
  if (r === 'behind') return bearingDeg >= 0 ? 'third_man' : 'fine_leg';
  return r;
}

// ---------------------------------------------------------------------------------------------------------------
// What beat the bat (the delivery's own movement, measured by delivery.ts flightMovement)
// ---------------------------------------------------------------------------------------------------------------

/**
 * Thresholds for naming what beat the bat: movement off the pitch and in the air (m), height at the bat (m), a short
 * length (m), pace (km/h), a ball passing this far over the bat (m), the line (m outside middle) beyond which a
 * leg-side swing is across the line, and the share of the movement thresholds that still explains a ball that beat a
 * swing timed right.
 */
export const BEATEN_BY = { pitchM: 0.05, airM: 0.1, spinAirM: 0.08, highAtBatM: 1.0, shortLengthM: 7.5, expressKph: 140, overBatM: 0.03, acrossLineM: 0.06, slightScore: 0.1 } as const;

// ---------------------------------------------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------------------------------------------

/** Everything that physically happened to one delivery. */
export interface PlayFacts {
  flight: BallFlight;
  bowler: BowlerProfile;
  swing: NormalizedSwing | null;
  contact: ContactReport;
  field: FieldLayout;
  /** The delivery hit the batter's pad or body before anything else, with the LBW decision (lbw.ts). */
  impact: { t: number; p: Vec3; part: 'pad' | 'body'; lbw: Pick<LbwDecision, 'out' | 'reason'> } | null;
  /** The delivery hit the stumps without touching bat or batter. */
  bowled: { t: number; p: Vec3 } | null;
  /** The struck ball went on into the striker's stumps (ball.ts `detectStumps`). */
  playedOn: { t: number; p: Vec3 } | null;
  /** The ball came off the pad or body onto the stumps (bowled, whatever the LBW verdict). */
  offThePad?: { t: number; p: Vec3 } | null;
  /** Where the ball passed the bat on a miss (contact.ts: delta = ball − bat at the closest approach). */
  miss?: { delta: Vec3 } | null;
  /** The struck ball in the field (null when the bat never touched it, or it was played on). */
  fielding: FieldingResult | null;
  running: RunningResult | null;
}

export interface Judgement {
  outcome: DeliveryOutcome;
  coaching: Coaching;
}

const EDGES = new Set(['inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);
const isEdge = (k: string) => EDGES.has(k);

function timingOf(c: ContactReport): Coaching['timing'] {
  if (c.timing === 'none' || c.timingErrorMs === null) return null;
  if (c.timing === 'perfect' || c.timing === 'solid') return 'on_time';
  return c.timingErrorMs >= 0 ? 'late' : 'early';
}

const roleOf = (field: FieldLayout, id: string | null): FielderRole | null => (id ? (field.fielders.find((f) => f.id === id)?.role ?? null) : null);

/**
 * Why a swing failed to make good contact (a miss, an edge, a pad, or bowled), from the physical facts: the timing,
 * the line of the swing against the line of the ball, where the ball passed the bat (contact.ts `miss.delta`: over
 * it, or beside it on the off or leg side) and how the delivery moved (delivery.ts `flightMovement`). Movement only
 * counts when it went the way the ball beat the bat.
 */
export function diagnoseBeaten(f: Pick<PlayFacts, 'flight' | 'bowler' | 'swing' | 'contact'> & { miss?: PlayFacts['miss'] }): CoachingReason {
  const { flight, bowler, swing, contact } = f;
  const err = contact.timingErrorMs ?? 0;
  const late = err >= 0;
  const fast = bowler.family === 'pace' && flight.release.speedKph >= BEATEN_BY.expressKph;
  if (contact.timing === 'missed') return late ? (fast ? 'beaten_by_pace' : 'too_late') : 'too_early';
  const m = flightMovement(flight);
  if (swing) {
    const legSideSwing = swing.directionDeg < -25 && m.lineAtStumpsM > BEATEN_BY.acrossLineM;
    const cutAtStraight = swing.directionDeg > 65 && m.lineAtStumpsM < 0.1 && flight.wouldHitStumps;
    if (legSideSwing || cutAtStraight) return 'played_across_the_line';
  }
  const d = f.miss?.delta ?? null;
  // Over the top of the bat: the bounce beat it.
  if (d && d.y > BEATEN_BY.overBatM && d.y >= Math.abs(d.x)) return 'beaten_by_bounce';
  // Which side of the bat it beat (+ = the off side: past the outside edge for this batter).
  const side = d ? Math.sign(d.x) : contact.kind === 'outside_edge' ? 1 : contact.kind === 'inside_edge' ? -1 : 0;
  const agrees = (dev: number) => side === 0 || Math.sign(dev) === side;
  const pitch = m.pitchM ?? 0;
  const pitchScore = agrees(pitch) ? Math.abs(pitch) / BEATEN_BY.pitchM : 0;
  const airScore = agrees(m.airM) ? Math.abs(m.airM) / (bowler.family === 'spin' ? BEATEN_BY.spinAirM : BEATEN_BY.airM) : 0;
  const movement = (): CoachingReason => (bowler.family === 'spin' ? 'beaten_by_turn' : pitchScore >= airScore ? 'beaten_by_seam' : 'beaten_by_swing');
  if (pitchScore >= 1 || airScore >= 1) return movement();
  if (m.heightAtBatM >= BEATEN_BY.highAtBatM || flight.plan.lengthM >= BEATEN_BY.shortLengthM) return 'beaten_by_bounce';
  const batMissed = contact.kind === 'miss' || contact.kind === 'pad' || contact.kind === 'body';
  if (contact.timing === 'perfect' || contact.timing === 'solid') {
    // Timed right and still beaten: the ball's own path did it. Name whatever moved it that way, however little.
    if (pitchScore > BEATEN_BY.slightScore || airScore > BEATEN_BY.slightScore) return movement();
    if (fast) return 'beaten_by_pace';
    if (batMissed && flight.wouldHitStumps) return 'missed_straight_ball';
    return 'played_across_the_line';
  }
  if (fast && late) return 'beaten_by_pace';
  if (batMissed && flight.wouldHitStumps) return 'missed_straight_ball';
  return late ? 'too_late' : 'too_early';
}

/** The whole decision for one delivery. */
export function judge(f: PlayFacts): Judgement {
  const { contact, swing, field } = f;
  const timing = timingOf(contact);
  const none: Omit<DeliveryOutcome, 'runs' | 'dismissal'> = { boundary: null, fielderId: null, endBearingDeg: null, endDistanceM: null, region: null };
  const lbwReason = f.impact ? f.impact.lbw.reason : null;
  const coach = (reason: CoachingReason, extra: Partial<Coaching> = {}): Coaching => ({ reason, timing, zone: null, fielderRole: null, lbw: lbwReason, ...extra });
  const out = (dismissal: Dismissal, reason: CoachingReason, extra: Partial<DeliveryOutcome> = {}, c: Partial<Coaching> = {}): Judgement => ({
    outcome: { ...none, runs: 0, dismissal, ...extra },
    coaching: coach(reason, c),
  });

  // 1. Bowled by the delivery itself (bat and batter never touched it).
  if (f.bowled) {
    if (!swing) return out('bowled', 'left_and_bowled');
    return out('bowled', diagnoseBeaten(f));
  }

  // 2. Pad or body first: bowled if it rebounds onto the stumps, otherwise LBW or a dead ball.
  if (f.impact && f.offThePad) return out('bowled', swing ? diagnoseBeaten(f) : 'left_and_bowled');
  if (f.impact) {
    if (f.impact.lbw.out) return out('lbw', swing && diagnoseBeaten(f) === 'played_across_the_line' ? 'played_across_the_line' : 'pad_in_line');
    return { outcome: { ...none, runs: 0, dismissal: null }, coaching: coach(swing ? diagnoseBeaten(f) : 'left_well') };
  }

  // 3. Played on.
  if (f.playedOn) {
    const p = f.playedOn.p;
    const at = { endBearingDeg: round1(bearingFromStriker(p.x, p.z)), endDistanceM: round2(distanceFromStriker(p.x, p.z)), region: 'behind' as const };
    return out('bowled', diagnoseBeaten(f), at);
  }

  // 4. Never touched the bat: left or missed, the keeper takes it.
  if (!f.fielding) {
    if (!swing) return { outcome: { ...none, runs: 0, dismissal: null }, coaching: coach('left_well') };
    return { outcome: { ...none, runs: 0, dismissal: null }, coaching: coach(diagnoseBeaten(f)) };
  }

  // 5. In the field.
  const play = f.fielding.play;
  const end = (p: Vec3) => {
    const b = bearingFromStriker(p.x, p.z);
    return { endBearingDeg: round1(b), endDistanceM: round2(distanceFromStriker(p.x, p.z)), region: regionOf(b) };
  };
  const edged = isEdge(contact.kind);
  const lofted = (swing?.elevation ?? 0) >= 0.4;

  if (play.kind === 'caught') {
    const role = roleOf(field, play.fielderId);
    const behind = role === 'keeper' || (role === 'slip' && edged);
    const where = end(play.p);
    const z = zoneOf(where.endBearingDeg);
    let reason: CoachingReason;
    if (role === 'keeper') reason = 'edged_behind';
    else if (edged && (role === 'slip' || role === 'gully' || role === 'leg_slip')) reason = 'edged_to_slip';
    else if (contact.kind === 'top_edge') reason = f.flight.plan.lengthM >= BEATEN_BY.shortLengthM ? 'beaten_by_bounce' : 'mistimed_lofted';
    else if (contact.kind === 'leading_edge') reason = 'played_across_the_line';
    else if (lofted && timing !== 'on_time') reason = 'mistimed_lofted';
    else reason = where.endDistanceM >= DEEP_FROM_M ? 'caught_in_the_deep' : 'caught_in_the_ring';
    return out(behind ? 'caught_behind' : 'caught', reason, { fielderId: play.fielderId, ...where }, { zone: z, fielderRole: role });
  }

  if (play.kind === 'boundary') {
    const where = end(play.p);
    const z = zoneOf(where.endBearingDeg);
    const outcome: DeliveryOutcome = { runs: play.runs, boundary: play.runs, dismissal: null, fielderId: f.fielding.nearest?.fielderId ?? null, ...where };
    if (edged) return { outcome, coaching: coach(diagnoseBeaten(f), { zone: z }) };
    if (play.runs === 6) return { outcome, coaching: coach('cleared_the_rope', { zone: z }) };
    const near = f.fielding.nearest;
    if (near && near.shortfallM <= BEAT_THE_FIELD_M) return { outcome, coaching: coach('beat_the_field', { zone: z, fielderRole: roleOf(field, near.fielderId) }) };
    return { outcome, coaching: coach('found_the_gap', { zone: z }) };
  }

  // Fielded: the batters ran what they safely could.
  const runs = f.running?.runs ?? 0;
  const where = end(play.p);
  const z = zoneOf(where.endBearingDeg);
  const role = roleOf(field, play.fielderId);
  const outcome: DeliveryOutcome = { runs, boundary: null, dismissal: null, fielderId: play.fielderId, ...where };
  if (edged) return { outcome, coaching: coach(diagnoseBeaten(f), { zone: z, fielderRole: role }) };
  if (runs > 0) {
    if (play.how === 'dropped') return { outcome, coaching: coach('beat_the_field', { zone: z, fielderRole: role }) };
    return { outcome, coaching: coach('found_the_gap', { zone: z }) };
  }
  if (timing === 'early' || timing === 'late') {
    if (lofted) return { outcome, coaching: coach('mistimed_lofted', { zone: z, fielderRole: role }) };
    return { outcome, coaching: coach(timing === 'late' ? 'too_late' : 'too_early', { zone: z, fielderRole: role }) };
  }
  if (swing?.kind === 'defend') return { outcome, coaching: coach('solid_defence', { zone: z, fielderRole: role }) };
  return { outcome, coaching: coach('hit_to_fielder', { zone: z, fielderRole: role }) };
}

/** A four counts as "beat the field" (not "found the gap") when a fielder got within this of stopping it (m). */
export const BEAT_THE_FIELD_M = 2.5;

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
