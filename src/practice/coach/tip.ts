/**
 * The dead-ball tip: one plain sentence with the measured facts and exactly one next action (RK4, COACH1;
 * docs/prompts/VANDE-PRACTICE-WEDGE-PROMPT.md §4 step 4 and §7.1). For example "68 ms late, with the bat face 32° off
 * your line: start 68 ms earlier." Nothing here is written for a ball: the action is the card's one recommendation
 * (`recommendationFor`, a CoachRecommendationKind and its numbers) and the fact clause is chosen by that action's kind
 * and filled from recorded fields only:
 *
 *   timing action (play_earlier, play_later)          the measured timing error: how early and where the ball went,
 *                                                     or how late and the bat face's angle to the intended line
 *   length action (get_back, get_forward)             where the ball pitched against the footwork played
 *   line action (play_straighter)                     the movement or line the stroke went across
 *   a different decision (leave, block, play at it,   why the attempt failed, led by the physics' own named reason
 *   attack the gap)                                   (failureFact): the timing when it names the timing, the
 *                                                     movement, the line or the bounce when it names them; else
 *                                                     the wrong ball (length, line), then for a stroke that worked
 *                                                     its risk or how the bat met it, else the physics' reason
 *   aim_for_the_gap                                   as a different decision (the recommended stroke aims elsewhere)
 *   any other action                                  a risk of the stroke that worked, or how the bat met it, else
 *                                                     the physics' own reason (scoring.ts)
 *
 * The physics' own reason is used only when the recorded contact does not contradict it: a ball played on off the
 * middle of the bat beat nothing, so it is said as its timing and "you played it onto the stumps".
 *
 * The four cover-drive mistakes of the wedge (too early, too late, wrong ball, beaten by late movement) are the fact
 * kinds early, late, a length or line fact, and moved. The facts come from the analysis (the ball off its flight, the
 * attempt re-simulated from the record) and the attempt's own contact report: its timing error, bat face and intended
 * bearing, outcome and region. Pure and deterministic; words live in src/i18n/practice/<locale>/coach.ts
 * (`practice.tip.*`).
 */
import type {
  CoachAnalysis,
  CoachRecommendation,
  CoachRecommendationKind,
  CoachRisk,
  CoachingReason,
  ContactReport,
  DeliveryOutcome,
  DeliveryResult,
  FielderRole,
} from '@/contracts/practice';
import type { FieldZone } from '@/contracts/cricket';
import { bearingDelta } from '@/physics';
import type { BallFacts, Mover } from './facts';
import { cleanByMeasure, inSweetZone, offSweetAlongM, offTheToe, requestedKph, slowFend } from './quality';
import { acrossTheLine, acrossTheMovement } from './cricket';
import { attemptWorked, leaveKind, recommendationFor } from './insight';

/** The wedge's four cover-drive mistakes, and every other failure (§7.1). Null for a confirmation. */
export type TipMistake = 'too_early' | 'too_late' | 'wrong_ball' | 'late_movement' | 'other';

/** Where the attempt's ball went, from its recorded outcome and contact (a dismissal first). */
export type TipWhere =
  | 'zone'
  | 'middle'
  | 'inside_edge'
  | 'outside_edge'
  | 'top_edge'
  | 'leading_edge'
  | 'pad'
  | 'body'
  | 'miss'
  | 'bowled'
  /** Bowled after the bat met the ball (off the middle or an edge): played on. */
  | 'played_on'
  /** A face contact beyond the toe end of the blade (bladeU < 0): contract v6 still labels it 'middle'. */
  | 'toe'
  | 'caught'
  | 'lbw';

type Zone = FieldZone | 'straight' | 'behind';

/** One measured fact clause (closed kinds; every number is a recorded one, rounded for the copy). */
export type TipFact =
  | { kind: 'early'; ms: number; where: TipWhere; zone: Zone | null }
  | { kind: 'late'; ms: number; faceDeg: number; where: TipWhere; zone: Zone | null }
  | { kind: 'late_where'; ms: number; where: TipWhere; zone: Zone | null }
  | { kind: 'moved'; mover: Mover; towards: 'away' | 'in'; cm: number; where: TipWhere; zone: Zone | null }
  | { kind: 'too_short_to_drive' | 'at_the_toes' | 'too_short_forward' | 'full_back'; lengthM: number }
  | { kind: 'across_movement'; towards: 'away' | 'in'; cm: number }
  | { kind: 'across_line'; side: 'off' | 'stumps' | 'leg'; cm: number }
  | { kind: 'reason'; reason: CoachingReason; zone: Zone | null; fielder: FielderRole | null }
  /**
   * A stroke that worked but carried a risk the recommended response does not (no praise: anti-fake rule 7; and the
   * reason a coach still changes a stroke that scored). `instead` is how the recommended response itself is said as
   * the one action (its aim, its block, or its leave); for an action that is not a confirmation it is that action.
   */
  | { kind: 'unwarned'; risk: CoachRisk; instead: CoachRecommendationKind }
  /**
   * How the bat met the ball, measured from the contact itself and never from the timing label (anti-fake rule 7):
   * at less than PRAISE_MIN_SPEED_SHARE of the bat speed the stroke asked for (a fend), off the toe end (bladeU < 0),
   * or off the face outside the sweet zone along the blade. `instead` as for 'unwarned'.
   */
  | { kind: 'slow'; kph: number; requestedKph: number; instead: CoachRecommendationKind }
  | { kind: 'toe'; instead: CoachRecommendationKind }
  | { kind: 'off_sweet'; cm: number; towards: 'toe' | 'handle'; instead: CoachRecommendationKind }
  /**
   * A swing timed inside the band (labelled perfect or solid) that the bat never met (a miss, the pad or the body):
   * said plainly, with the measured reason it did not reach the ball. The timing label stays an honest timing fact
   * elsewhere (Why?), never this sentence's fact (lead ruling (B), 2026-11-04).
   */
  | { kind: 'no_reach'; why: NoReachWhy; cm: number | null; lengthM: number | null };

/**
 * Why the bat never reached the ball, measured: the line it was on (off, stumps, leg) or the movement it was played
 * across (moved away or in), a stroke across the line, the length the stroke fought, or (none of those) the stroke.
 */
type NoReachWhy =
  | 'off'
  | 'stumps'
  | 'leg'
  | 'moved_away'
  | 'moved_in'
  | 'across'
  | 'too_short_to_drive'
  | 'at_the_toes'
  | 'too_short_forward'
  | 'full_back'
  | 'stroke';

export interface CoachTip {
  /**
   * Which mistake the fact shows (null when the action confirms the attempt, repeat_it or well_played, or would but
   * for a risk the recommended response avoids: then the fact is 'unwarned' and the words praise nothing).
   */
  mistake: TipMistake | null;
  fact: TipFact;
  /** The one action: exactly the card's recommendation (recommendationFor). */
  action: CoachRecommendation;
  /**
   * The attempt met the ball cleanly by the contact itself: off the face, inside the sweet zone along the blade and,
   * for a stroke, at no less than PRAISE_MIN_SPEED_SHARE of the bat speed it asked for (null for a leave). For
   * compareAttempts' clean-contact change, so "Clean contact this time" is never said from the label alone.
   */
  cleanContact?: boolean | null;
}

/** The attempt's result fields a tip reads (the coach's own re-simulation of the record's swing). */
export type TipAttempt = Pick<DeliveryResult, 'contact' | 'outcome' | 'coaching'>;

const BEATEN_BY_MOVEMENT: ReadonlySet<CoachingReason> = new Set<CoachingReason>(['beaten_by_swing', 'beaten_by_seam', 'beaten_by_turn']);
/**
 * The physics' "what beat the bat" diagnoses (scoring.ts diagnoseBeaten) that a contact off the middle of the bat
 * contradicts: the bat met the ball, so nothing beat it. The physics also runs that diagnosis for a ball played on
 * off the middle, where the contract has no reason of its own (docs/PRACTICE_COACH.md, "Played on").
 */
const BEATEN_BAT: ReadonlySet<CoachingReason> = new Set<CoachingReason>([
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
  'beaten_by_pace',
  'beaten_by_bounce',
  'missed_straight_ball',
]);
const LATE_REASONS: ReadonlySet<CoachingReason> = new Set<CoachingReason>(['too_late', 'beaten_by_pace']);
/** Contacts on the bat: bowled after one of these is played on. */
const ON_THE_BAT: ReadonlySet<ContactReport['kind']> = new Set<ContactReport['kind']>(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);
const CONFIRM: ReadonlySet<CoachRecommendationKind> = new Set<CoachRecommendationKind>(['repeat_it', 'well_played']);
const TIMING: ReadonlySet<CoachRecommendationKind> = new Set<CoachRecommendationKind>(['play_earlier', 'play_later']);
const LENGTH: ReadonlySet<CoachRecommendationKind> = new Set<CoachRecommendationKind>(['get_back', 'get_forward']);
const DECISION: ReadonlySet<CoachRecommendationKind> = new Set<CoachRecommendationKind>([
  'leave_outside_off',
  'leave_down_leg',
  'leave_over_the_top',
  'play_at_the_stumps',
  'defend_forward',
  'defend_back',
  'attack_the_gap',
]);

const rnd = (v: number) => Math.round(v) || 0;
const r1 = (v: number) => Math.round(v * 10) / 10 || 0;

/** Risks in order of how they end an innings: a miss on the stumps or the pad, a catch, an edge, a set fielder. */
const RISK_ORDER: readonly CoachRisk[] = ['can_be_bowled', 'can_be_lbw', 'can_be_caught', 'can_edge', 'into_protected_region'];

/**
 * The risks the attempt's own stroke carries over its execution spread (attempted.spread, recorded) that the
 * recommended response (options[0]) does not: the risks a confirmation would leave unwarned. Most serious first.
 */
export function unwarnedRisks(an: Pick<CoachAnalysis, 'attempted' | 'options'>): CoachRisk[] {
  const own = an.attempted.spread?.risks ?? [];
  const recommended = new Set(an.options[0]?.risks ?? []);
  return RISK_ORDER.filter((r) => own.includes(r) && !recommended.has(r));
}

/**
 * Praise is earned (anti-fake rule 7, COACH5's spirit): a confirmation (repeat_it, well_played) only for a stroke that
 * carried no risk the recommended response does not. The recommendation itself never changes; only its words do.
 */
export function praiseEarned(an: Pick<CoachAnalysis, 'attempted' | 'options'>, rec: Pick<CoachRecommendation, 'kind'>, tip?: Pick<CoachTip, 'fact'> | null): boolean {
  if (!CONFIRM.has(rec.kind)) return true;
  // With the tip (tipOf), the contact itself decides too: a slow fend, the toe or off the sweet zone earn no praise.
  return unwarnedRisks(an).length === 0 && !(tip && NO_PRAISE.has(tip.fact.kind));
}

/** Facts that withhold praise: the measured reason a confirmation is not said. */
const NO_PRAISE: ReadonlySet<TipFact['kind']> = new Set<TipFact['kind']>(['unwarned', 'slow', 'toe', 'off_sweet']);

/**
 * How the attempt met the ball, from the contact itself (never the timing label): a slow fend (a stroke), the toe
 * (bladeU < 0), or off the face outside the sweet zone along the blade (a stroke). Null for a clean contact, for a
 * leave, and for an edge or a miss (their own kinds say so).
 */
function contactFact(an: CoachAnalysis, at: TipAttempt, instead: CoachRecommendationKind): TipFact | null {
  const a = an.attempted;
  const c = at.contact;
  if (a.decision === 'leave' || c.kind !== 'middle') return null;
  if (slowFend(a, c)) return { kind: 'slow', kph: rnd(c.batSpeedKph as number), requestedKph: rnd(requestedKph(a) as number), instead };
  if (offTheToe(c)) return { kind: 'toe', instead };
  if (a.decision === 'attack' && !inSweetZone(c)) {
    const d = offSweetAlongM(c) as number;
    return { kind: 'off_sweet', cm: rnd(Math.abs(d) * 100), towards: d < 0 ? 'toe' : 'handle', instead };
  }
  return null;
}

/** The attempt met the ball cleanly by the contact itself (null for a leave). */
function cleanContactOf(an: CoachAnalysis, at: TipAttempt): boolean | null {
  if (an.attempted.decision === 'leave') return null;
  return cleanByMeasure(an.attempted, at.contact);
}

/**
 * How the recommended response itself (what the demonstration plays) is said as an action, when praise is not earned:
 * its aim for a stroke, its block for a block, and why to leave for a leave. Never "the same again" or "as good as the
 * coach's choice".
 */
function insteadOf(an: CoachAnalysis, rec: CoachRecommendation): CoachRecommendationKind {
  if (rec.decision === 'attack') return 'aim_for_the_gap';
  if (rec.decision === 'defend') return rec.footwork === 'back' || rec.footwork === 'across' ? 'defend_back' : 'defend_forward';
  return leaveKind(an);
}

/** The action as said: the recommendation, or (praise not earned) the recommended response itself. */
export function spokenAction(tip: Pick<CoachTip, 'fact' | 'action'>): CoachRecommendation {
  const rec = tip.action;
  return 'instead' in tip.fact && CONFIRM.has(rec.kind) ? { ...rec, kind: tip.fact.instead } : rec;
}

/** Where the ball went: a dismissal, then the contact, then the region it was hit to. */
export function whereOf(contact: Pick<ContactReport, 'kind'> & { bladeU?: number | null }, outcome: Pick<DeliveryOutcome, 'dismissal' | 'region'>): { where: TipWhere; zone: Zone | null } {
  const d = outcome.dismissal;
  if (d === 'bowled') return { where: ON_THE_BAT.has(contact.kind) ? 'played_on' : 'bowled', zone: null };
  if (d === 'caught' || d === 'caught_behind') return { where: 'caught', zone: null };
  if (d === 'lbw') return { where: 'lbw', zone: null };
  switch (contact.kind) {
    case 'inside_edge':
    case 'outside_edge':
    case 'top_edge':
    case 'leading_edge':
    case 'pad':
    case 'body':
    case 'miss':
      return { where: contact.kind, zone: null };
    default:
      // Off the toe end is said from the contact point (contract v6 labels it 'middle'), before where it went.
      if (contact.bladeU != null && contact.bladeU < 0) return { where: 'toe', zone: null };
      return outcome.region ? { where: 'zone', zone: outcome.region } : { where: 'middle', zone: null };
  }
}

/** The bat face's angle to the intended line at contact (or the closest approach), unsigned (deg); null when unmeasured. */
export function faceOffLineDeg(c: Pick<ContactReport, 'faceBearingDeg' | 'intendedBearingDeg'>): number | null {
  if (!Number.isFinite(c.faceBearingDeg) || !Number.isFinite(c.intendedBearingDeg)) return null;
  return rnd(Math.abs(bearingDelta(c.faceBearingDeg as number, c.intendedBearingDeg as number)));
}

function timingFact(an: CoachAnalysis, at: TipAttempt): TipFact | null {
  const err = an.attempted.timingErrorMs;
  if (err === null) return null;
  const ms = Math.max(1, rnd(Math.abs(err)));
  const w = whereOf(at.contact, at.outcome);
  if (err < 0) return { kind: 'early', ms, ...w };
  const face = faceOffLineDeg(at.contact);
  return face === null ? { kind: 'late_where', ms, ...w } : { kind: 'late', ms, faceDeg: face, ...w };
}

function movedFact(f: BallFacts, at: TipAttempt): TipFact | null {
  if (!f.mover) return null;
  return { kind: 'moved', mover: f.mover, towards: f.playedMoveM > 0 ? 'away' : 'in', cm: rnd(Math.abs(f.playedMoveM) * 100), ...whereOf(at.contact, at.outcome) };
}

const lengthOf = (f: BallFacts) => r1(f.lengthM ?? 0);

/**
 * The length the stroke fought: a front-foot stroke at a ball short of a driving length (or a drive at a yorker), a
 * forward block to a short ball, back to a full one. Null when the length was not the problem.
 */
function lengthFact(an: CoachAnalysis, f: BallFacts): TipFact | null {
  const a = an.attempted;
  if (a.decision === 'leave' || f.lengthM === null) return null;
  const front = a.footwork === 'forward' || a.footwork === 'down_track';
  const fought = an.read.length === 'wrong' || an.read.bounce === 'wrong';
  if (front && a.decision === 'attack' && f.lengthBand === 'yorker') return { kind: 'at_the_toes', lengthM: lengthOf(f) };
  if (front && a.decision === 'attack' && !f.full) return { kind: 'too_short_to_drive', lengthM: lengthOf(f) };
  if (!fought) return null;
  if (front) return { kind: 'too_short_forward', lengthM: lengthOf(f) };
  if (f.full) return { kind: 'full_back', lengthM: lengthOf(f) };
  return null;
}

/** The movement or line the stroke went across (the coach's read said so). */
function acrossFact(an: CoachAnalysis, f: BallFacts): TipFact | null {
  const a = an.attempted;
  if (a.decision !== 'attack' || a.directionDeg === null) return null;
  if (an.read.movement === 'wrong' && acrossTheMovement(a.directionDeg, f)) {
    return { kind: 'across_movement', towards: f.playedMoveM > 0 ? 'away' : 'in', cm: rnd(Math.abs(f.playedMoveM) * 100) };
  }
  if (an.read.line === 'wrong' && acrossTheLine(a.directionDeg, f)) {
    const side = f.wideOfStumpsM <= 0 ? 'stumps' : f.lineAtStumpsM > 0 ? 'off' : 'leg';
    return { kind: 'across_line', side, cm: rnd(Math.max(0, f.wideOfStumpsM) * 100) };
  }
  return null;
}

/** Played on off the middle of the bat: bowled although the bat met the ball squarely. */
const playedOnOffTheMiddle = (at: TipAttempt) => at.outcome.dismissal === 'bowled' && at.contact.kind === 'middle';

/**
 * The physics' own reason, unless the recorded contact contradicts it: for a ball played on off the middle of the bat
 * the physics names what "beat" the bat, which nothing did, so the fact is the measured timing and that it was played
 * on ("24 ms early, and you played it onto the stumps").
 */
function reasonFact(an: CoachAnalysis, at: TipAttempt): TipFact {
  // The contract's own `played_on` (2026-11-03) gets the same measured fact; a "beaten" name for it is kept as defence
  // in depth, for records resolved before the physics emits `played_on`.
  if (playedOnOffTheMiddle(at) && (an.why[0] === 'played_on' || BEATEN_BAT.has(an.why[0]))) {
    const t = timingFact(an, at);
    if (t) return t;
  }
  return { kind: 'reason', reason: an.why[0], zone: at.coaching.zone ?? at.outcome.region ?? null, fielder: at.coaching.fielderRole ?? null };
}

/**
 * A stroke that worked (not out, off the middle, runs for a stroke) and still carried a risk over its execution
 * spread that the recommended response does not: that risk is why the coach changes it (never "found the gap: leave
 * it" with nothing to say why). Null when there is no such risk.
 */
function riskFact(an: CoachAnalysis, instead: CoachRecommendationKind): TipFact | null {
  if (!attemptWorked(an)) return null;
  const risk = unwarnedRisks(an)[0];
  return risk ? { kind: 'unwarned', risk, instead } : null;
}

/**
 * Why a swing went wrong, for an action that changes the decision. The physics' own named reason leads (lead ruling
 * O-3, 2026-11-03):
 *   - it names the timing (its timing label is mistimed or missed, or its reason is too early, too late or beaten for
 *     pace): the measured timing error;
 *   - it names the movement that beat the bat (a miss, the pad or body, an edge; never off the middle): the movement;
 *   - it names a stroke across the line: the line it went across;
 *   - it names the bounce: the length the stroke fought.
 * When it names no cause of its own (a gap, a fielder, a catch, a solid stroke), the wrong ball explains a change of
 * decision: the length or line it fought; then, for a stroke that worked, the risk the coach changes it for, or how the
 * bat met the ball; else the physics' own reason.
 */
function failureFact(an: CoachAnalysis, f: BallFacts, at: TipAttempt, k: CoachRecommendationKind): TipFact {
  if (an.attempted.decision === 'leave') return reasonFact(an, at);
  return namedFact(an, f, at) ?? lengthFact(an, f) ?? acrossFact(an, f) ?? riskFact(an, k) ?? contactFact(an, at, k) ?? reasonFact(an, at);
}

/**
 * The fact for the physics' own named reason, when it names a cause the tip can measure (lead ruling O-3, 2026-11-03):
 * the timing when it names the timing (its label mistimed or missed, or too early, too late, beaten for pace); the
 * movement that beat the bat (a miss, the pad or body, an edge; never off the middle); the line it was played across;
 * the length the stroke fought when it names the bounce. Null otherwise, and for a leave.
 */
function namedFact(an: CoachAnalysis, f: BallFacts, at: TipAttempt): TipFact | null {
  const a = an.attempted;
  if (a.decision === 'leave') return null;
  const named: CoachingReason = at.coaching?.reason ?? an.why[0];
  const timed = a.timing === 'mistimed' || a.timing === 'missed' || named === 'too_early' || LATE_REASONS.has(named);
  if (timed) {
    const t = timingFact(an, at);
    if (t) return t;
  }
  if (BEATEN_BY_MOVEMENT.has(named) && at.contact.kind !== 'middle') {
    const m = movedFact(f, at);
    if (m) return m;
  }
  if (named === 'played_across_the_line') {
    const x = acrossFact(an, f);
    if (x) return x;
  }
  if (named === 'beaten_by_bounce') {
    const l = lengthFact(an, f);
    if (l) return l;
  }
  return null;
}

/** The physics' reasons that already say the bat did not meet the ball ("Beaten by the swing", "Struck on the pad"). */
const SAYS_UNMET: ReadonlySet<CoachingReason> = new Set<CoachingReason>([
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
  'beaten_by_bounce',
  'missed_straight_ball',
  'pad_in_line',
]);

/** A swing timed inside the band (perfect or solid) that the bat never met: a miss, the pad or the body. */
function unreached(an: CoachAnalysis, at: TipAttempt): boolean {
  const a = an.attempted;
  if (a.decision === 'leave' || !(a.timing === 'perfect' || a.timing === 'solid')) return false;
  return at.contact.kind === 'miss' || at.contact.kind === 'pad' || at.contact.kind === 'body';
}

/** A line, movement, or length fact as the reason the bat never reached the ball (null for any other fact). */
function noReachOf(fact: TipFact | null): TipFact | null {
  if (!fact) return null;
  switch (fact.kind) {
    case 'across_line':
      return { kind: 'no_reach', why: fact.side, cm: fact.side === 'stumps' ? null : fact.cm, lengthM: null };
    case 'across_movement':
      return { kind: 'no_reach', why: fact.towards === 'away' ? 'moved_away' : 'moved_in', cm: fact.cm, lengthM: null };
    case 'too_short_to_drive':
    case 'at_the_toes':
    case 'too_short_forward':
    case 'full_back':
      return { kind: 'no_reach', why: fact.kind, cm: null, lengthM: fact.lengthM };
    default:
      return null;
  }
}

/**
 * The fact for a swing timed inside the band that the bat never met (lead ruling (B), 2026-11-04). A label of perfect
 * or solid beside a ball the bat never touched must not read as a good shot, nor as a timing fault: the sentence says
 * plainly that the bat never reached the ball, and why (the line or the movement it was played across, the length the
 * stroke fought, or else the stroke). A fact that already says so stays: the movement that beat the bat ("…, and it
 * beat the bat"), or the physics' own "beaten by …", "missed a straight ball", "struck on the pad". A timing fact never
 * stays: "6 ms late" beside a perfect label is a contradiction, and the physics already says the bat never met it.
 */
function reachedFact(an: CoachAnalysis, f: BallFacts, fact: TipFact): TipFact {
  if (fact.kind === 'moved') return fact;
  if (fact.kind === 'reason' && SAYS_UNMET.has(fact.reason)) return fact;
  const across: TipFact = { kind: 'no_reach', why: 'across', cm: null, lengthM: null };
  if (fact.kind === 'reason' && fact.reason === 'played_across_the_line') return noReachOf(acrossFact(an, f)) ?? across;
  return noReachOf(fact) ?? noReachOf(acrossFact(an, f)) ?? noReachOf(lengthFact(an, f)) ?? { kind: 'no_reach', why: 'stroke', cm: null, lengthM: null };
}

function mistakeOf(fact: TipFact): TipMistake {
  switch (fact.kind) {
    case 'no_reach':
      return fact.why === 'stroke' ? 'other' : 'wrong_ball';
    case 'early':
      return 'too_early';
    case 'late':
    case 'late_where':
      return 'too_late';
    case 'moved':
      return 'late_movement';
    case 'too_short_to_drive':
    case 'at_the_toes':
    case 'too_short_forward':
    case 'full_back':
    case 'across_movement':
    case 'across_line':
      return 'wrong_ball';
    default:
      return 'other';
  }
}

/**
 * The tip for an analysed attempt: the card's one recommendation and the fact that explains it. `facts` is the coach's
 * description of the ball (facts.ts) and `attempt` the coach's re-simulation of the record's swing (never a result
 * handed in by a caller), so the tip is a function of the record alone.
 */
export function tipOf(an: CoachAnalysis, f: BallFacts, attempt: TipAttempt): CoachTip {
  const action = recommendationFor(an);
  const k = action.kind;
  if (CONFIRM.has(k)) {
    // A confirmation praises the stroke; a risk the recommended response avoids is said instead (anti-fake rule 7).
    // ... and so is a contact the measurement does not support (a slow fend, the toe, off the sweet zone).
    const risk = unwarnedRisks(an)[0];
    const instead = insteadOf(an, action);
    const fact: TipFact = risk ? { kind: 'unwarned', risk, instead } : (contactFact(an, attempt, instead) ?? reasonFact(an, attempt));
    return { mistake: null, fact, action, cleanContact: cleanContactOf(an, attempt) };
  }
  let fact: TipFact;
  // Every action leads with the physics' own named reason when it names one (lead ruling O-3); a timing action always
  // states the timing.
  if (TIMING.has(k)) fact = timingFact(an, attempt) ?? reasonFact(an, attempt);
  else if (LENGTH.has(k)) fact = namedFact(an, f, attempt) ?? lengthFact(an, f) ?? reasonFact(an, attempt);
  else if (k === 'play_straighter') fact = namedFact(an, f, attempt) ?? acrossFact(an, f) ?? reasonFact(an, attempt);
  // A different aim says why the attempt failed, like a different decision.
  else if (DECISION.has(k) || k === 'aim_for_the_gap') fact = failureFact(an, f, attempt, k);
  else fact = namedFact(an, f, attempt) ?? riskFact(an, k) ?? contactFact(an, attempt, k) ?? reasonFact(an, attempt);
  // Timed inside the band and never met by the bat: say so, and why (lead ruling (B); recommendationFor never gives it
  // a timing action).
  if (unreached(an, attempt)) fact = reachedFact(an, f, fact);
  return { mistake: mistakeOf(fact), fact, action, cleanContact: cleanContactOf(an, attempt) };
}

// ---------------------------------------------------------------------------------------------------------------
// Words: one sentence, rendered from the closed tip through the Practice catalogs (practice.tip.*)
// ---------------------------------------------------------------------------------------------------------------

/** The part of the Practice translator a tip needs (src/i18n/practice PracticeT satisfies it). */
export interface TipTranslator {
  tk(key: string, params?: Record<string, string | number | null | undefined>): string;
}

/**
 * A region as each role in a sentence needs it (practice.zone.<role>.<region>, 'any' when none is named): `to` and
 * `towards` for where the ball goes ("to cover", "straight down the ground", "behind the wicket", "into the gap"), and
 * `gap` for the gap itself ("the cover gap", "the gap behind the wicket", "the gap"). One closed phrase per region and
 * role, so no line ever reads "the the gap gap" or "the behind the wicket gap", in any language.
 */
export function zonePhrases(t: TipTranslator, region: Zone | null | undefined): { to: string; towards: string; gap: string } {
  const r = region ?? 'any';
  return { to: t.tk(`practice.zone.to.${r}`), towards: t.tk(`practice.zone.towards.${r}`), gap: t.tk(`practice.zone.gap.${r}`) };
}

function whereWords(t: TipTranslator, where: TipWhere, zone: Zone | null): string {
  if (where === 'zone' && zone) return t.tk('practice.tip.where.zone', zonePhrases(t, zone));
  return t.tk(`practice.tip.where.${where === 'zone' ? 'middle' : where}`);
}

const MOVER_KEY: Record<Mover, string> = { swing: 'swing', seam: 'seam', cut: 'cut', turn: 'turn', drift: 'drift' };

/** The fact clause in words. */
export function tipFactWords(t: TipTranslator, fact: TipFact): string {
  switch (fact.kind) {
    case 'early':
      return t.tk('practice.tip.fact.early', { ms: fact.ms, where: whereWords(t, fact.where, fact.zone) });
    case 'late':
      return t.tk('practice.tip.fact.late', { ms: fact.ms, deg: fact.faceDeg });
    case 'late_where':
      return t.tk('practice.tip.fact.late_where', { ms: fact.ms, where: whereWords(t, fact.where, fact.zone) });
    case 'moved':
      return t.tk(`practice.tip.fact.${MOVER_KEY[fact.mover]}_${fact.towards}`, { cm: fact.cm, where: whereWords(t, fact.where, fact.zone) });
    case 'too_short_to_drive':
    case 'at_the_toes':
    case 'too_short_forward':
    case 'full_back':
      return t.tk(`practice.tip.fact.${fact.kind}`, { m: fact.lengthM });
    case 'across_movement':
      return t.tk(`practice.tip.fact.across_movement_${fact.towards}`, { cm: fact.cm });
    case 'across_line':
      return t.tk(`practice.tip.fact.across_line_${fact.side}`, { cm: fact.cm });
    case 'unwarned':
      return t.tk(`practice.tip.fact.unwarned.${fact.risk}`);
    case 'slow':
      return t.tk('practice.tip.fact.slow', { kph: fact.kph, req: fact.requestedKph });
    case 'toe':
      return t.tk('practice.tip.fact.toe');
    case 'off_sweet':
      return t.tk(`practice.tip.fact.off_sweet_${fact.towards}`, { cm: fact.cm });
    case 'no_reach':
      return t.tk(`practice.tip.fact.no_reach.${fact.why}`, { cm: fact.cm, m: fact.lengthM });
    case 'reason': {
      const r = fact.reason;
      if (r === 'found_the_gap' || r === 'cleared_the_rope' || r === 'beat_the_field') {
        return fact.zone ? t.tk(`practice.coach.${r}`, zonePhrases(t, fact.zone)) : t.tk(`practice.coach.${r}_any`);
      }
      if (r === 'hit_to_fielder' || r === 'caught_in_the_deep' || r === 'caught_in_the_ring') {
        return fact.fielder ? t.tk(`practice.coach.${r}`, { fielder: t.tk(`practice.fielder.${fact.fielder}`) }) : t.tk(`practice.coach.${r}_any`);
      }
      return t.tk(`practice.coach.${r}`);
    }
  }
}

/** The one action in words (lower case, no full stop: it ends the sentence). */
export function tipActionWords(t: TipTranslator, rec: CoachRecommendation): string {
  switch (rec.kind) {
    case 'play_later':
    case 'play_earlier':
      return t.tk(`practice.tip.do.${rec.kind}`, { ms: rec.shiftMs ?? 0 });
    case 'attack_the_gap':
    case 'aim_for_the_gap':
      return t.tk(`practice.tip.do.${rec.kind}${rec.lofted ? '_lofted' : ''}`, zonePhrases(t, rec.region));
    default:
      return t.tk(`practice.tip.do.${rec.kind}`);
  }
}

/** The whole tip: one sentence, "<measured fact>: <one action>." */
export function tipSentence(t: TipTranslator, tip: CoachTip): string {
  return t.tk('practice.tip.sentence', { fact: tipFactWords(t, tip.fact), action: tipActionWords(t, spokenAction(tip)) });
}

/** The tip in words: the sentence, and its fact and action clauses exactly as they appear in it. */
export function tipWords(t: TipTranslator, tip: CoachTip): { sentence: string; fact: string; action: string } {
  return { sentence: tipSentence(t, tip), fact: tipFactWords(t, tip.fact), action: tipActionWords(t, spokenAction(tip)) };
}
