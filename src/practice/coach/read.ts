/**
 * What the player read, inferred honestly from what they did against the ball that was bowled, and why the ball went
 * the way it did (docs/PRACTICE_COACH.md, "The read"). Every verdict needs evidence in the attempt itself: footwork the
 * physics chose, a leave's timing or a block's direction are not the player's choices and read 'unclear'.
 */
import type {
  CoachRead,
  CoachingReason,
  ContactKind,
  DeliveryResult,
  NormalizedSwing,
  ReadVerdict,
} from '@/contracts/practice';
import { BALL_R, BEATEN_BY, STUMPS_HALF_W } from '@/physics';
import { acrossTheLine, acrossTheMovement, footworkFightsLength } from './cricket';
import { READ_THRESHOLDS, type BallFacts, type Mover } from './facts';

const BEATEN_BY_MOVEMENT: ReadonlySet<CoachingReason> = new Set<CoachingReason>([
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
]);
/** The physics' technical diagnoses (what beat the bat), which a misread of the length or bounce can explain better. */
const TECHNICAL: ReadonlySet<CoachingReason> = new Set<CoachingReason>([
  'beaten_by_swing',
  'beaten_by_seam',
  'beaten_by_turn',
  'beaten_by_pace',
  'too_early',
  'too_late',
  'missed_straight_ball',
  'played_across_the_line',
]);
const BEATEN: ReadonlySet<ContactKind> = new Set<ContactKind>([
  'miss',
  'pad',
  'body',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);
const IN_LINE_M = STUMPS_HALF_W + BALL_R;
type ReadResult = Pick<DeliveryResult, 'contact' | 'outcome' | 'footwork' | 'coaching'>;

/** Length: the player's own footwork against the length (automatic footwork is the physics' choice: unclear). */
function readLength(f: BallFacts, swing: NormalizedSwing | null, r: ReadResult): ReadVerdict {
  if (!swing || swing.footwork === 'auto') return 'unclear';
  if (r.footwork === f.autoFootwork) return 'right';
  return footworkFightsLength(f, r.footwork) ? 'wrong' : 'unclear';
}

/** Line: left a ball that missed, played one that would hit, never across the line or fishing at a wide one. */
function readLine(f: BallFacts, swing: NormalizedSwing | null): ReadVerdict {
  if (!swing) return f.wouldHitStumps ? 'wrong' : 'right';
  if (swing.kind === 'attack' && acrossTheLine(swing.directionDeg, f)) return 'wrong';
  if (f.wouldHitStumps) return 'right';
  if (swing.kind === 'defend' && f.wideOfStumpsM > READ_THRESHOLDS.defendWideM) return 'wrong';
  return 'right';
}

/** Pace: the swing's timing inside the active solid band, or early or late beyond it. */
function readPace(swing: NormalizedSwing | null, r: ReadResult): ReadVerdict {
  if (!swing) return 'unclear';
  const t = r.contact.timing;
  if (t === 'perfect' || t === 'solid') return 'right';
  return t === 'mistimed' || t === 'missed' ? 'wrong' : 'unclear';
}

/** The movement brought a ball that would have missed onto the stumps. */
function movedOntoStumps(f: BallFacts): boolean {
  return f.wouldHitStumps && Math.abs(f.lineAtStumpsM - f.movementM) >= IN_LINE_M;
}

/**
 * Movement: played with it (or left it when it moved away), not across it, and not beaten by it. Beaten means the bat
 * was beaten (a miss, the pad or body, an edge): a ball met with the middle of the bat beat nothing, so the physics'
 * movement diagnosis of a ball played on off the middle (scoring.ts, played on) is not a misread of the movement.
 */
function readMovement(f: BallFacts, swing: NormalizedSwing | null, r: ReadResult): ReadVerdict {
  if (f.mover === null) return 'unclear';
  if (!swing) {
    if (!f.wouldHitStumps) return 'right';
    return movedOntoStumps(f) ? 'wrong' : 'unclear';
  }
  if (BEATEN_BY_MOVEMENT.has(r.coaching.reason) && BEATEN.has(r.contact.kind)) return 'wrong';
  if (swing.kind === 'attack' && acrossTheMovement(swing.directionDeg, f)) return 'wrong';
  return r.contact.kind === 'middle' ? 'right' : 'unclear';
}

/** Bounce: the response to height. A short ball is left, swayed or played from the back foot, never fended at above the shoulder. */
function readBounce(f: BallFacts, swing: NormalizedSwing | null, r: ReadResult): ReadVerdict {
  const reason = r.coaching.reason;
  if (f.heightAtBatM < READ_THRESHOLDS.highAtBatM) return swing && reason === 'beaten_by_bounce' ? 'wrong' : 'unclear';
  if (!swing) return f.wouldHitStumps || r.contact.kind === 'body' ? 'wrong' : 'right';
  if (swing.footwork !== 'auto' && r.footwork === 'forward' && footworkFightsLength(f, 'forward')) return 'wrong';
  // A block at a ball above the shoulder fends at it: leave it, sway out of it, or play a stroke over it.
  if (swing.kind === 'defend' && f.heightAtBatM >= READ_THRESHOLDS.defendableHeightM) return 'wrong';
  if (reason === 'beaten_by_bounce' || r.contact.kind === 'top_edge' || r.contact.kind === 'body') return 'wrong';
  return r.contact.kind === 'middle' && !r.outcome.dismissal ? 'right' : 'unclear';
}

export function inferRead(f: BallFacts, swing: NormalizedSwing | null, r: ReadResult): CoachRead {
  return {
    length: readLength(f, swing, r),
    line: readLine(f, swing),
    pace: readPace(swing, r),
    movement: readMovement(f, swing, r),
    bounce: readBounce(f, swing, r),
  };
}

/** The reason that names what moved the ball. */
function movementReason(mover: Mover): CoachingReason {
  if (mover === 'swing') return 'beaten_by_swing';
  if (mover === 'seam' || mover === 'cut') return 'beaten_by_seam';
  return 'beaten_by_turn';
}

function paceReason(f: BallFacts, r: ReadResult): CoachingReason {
  const err = r.contact.timingErrorMs ?? 0;
  if (err < 0) return 'too_early';
  return f.family === 'pace' && f.speedKph >= BEATEN_BY.expressKph ? 'beaten_by_pace' : 'too_late';
}

/** Reasons that say how the ball was caught rather than why: a misread that caused it explains it better. */
const CAUGHT: ReadonlySet<CoachingReason> = new Set<CoachingReason>([
  'edged_behind',
  'edged_to_slip',
  'caught_in_the_ring',
  'caught_in_the_deep',
]);

/**
 * Why, most important first. The physics' own reason (src/physics scoring.ts) leads when it names a cause: a technical
 * diagnosis, a decision (left and bowled, padded up), or what a good stroke earned. When the attempt went wrong, the
 * misreads that explain it follow: the bounce, the movement, across the line, the pace. Two exceptions put the misread
 * first: the physics' reason only says how the ball was caught (edged behind, to slip, in the ring or the deep), or
 * the batter fought the bounce of a short ball and the physics gave a technical diagnosis.
 */
export function whyOf(f: BallFacts, swing: NormalizedSwing | null, r: ReadResult, read: CoachRead): CoachingReason[] {
  const primary = r.coaching.reason;
  const bad = r.outcome.dismissal !== null || BEATEN.has(r.contact.kind);
  if (!bad) return [primary];
  const causes: CoachingReason[] = [];
  if (read.bounce === 'wrong' && f.short) causes.push('beaten_by_bounce');
  if (read.movement === 'wrong' && f.mover) causes.push(movementReason(f.mover));
  if (swing?.kind === 'attack' && read.line === 'wrong' && acrossTheLine(swing.directionDeg, f))
    causes.push('played_across_the_line');
  if (read.pace === 'wrong') causes.push(paceReason(f, r));
  const lead =
    causes.length > 0 && (CAUGHT.has(primary) || (causes[0] === 'beaten_by_bounce' && TECHNICAL.has(primary)));
  const out = lead ? [causes[0], primary, ...causes.slice(1)] : [primary, ...causes];
  return out.filter((x, i) => out.indexOf(x) === i);
}
