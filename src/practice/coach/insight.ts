/**
 * The dead-ball card (constitution §14): one primary reason and one recommendation, and the comparison of a new
 * attempt at the exact ball with the previous one (docs/PRACTICE_COACH.md, "The card"). Closed keys only; the UI
 * words them in one short line with the numbers ("38 ms early", "right footwork this time").
 */
import type {
  AttemptComparison,
  AttemptChangeKind,
  CoachAnalysis,
  CoachOption,
  CoachRecommendation,
  CoachRecommendationKind,
  ContactKind,
  PrimaryInsight,
} from '@/contracts/practice';
import { BALL_R, STUMPS_HALF_W, regionOf } from '@/physics';
import { ORTHODOXY, acrossTheLine, acrossTheMovement } from './cricket';
import { PICK } from './options';
import { EXECUTION_SPREAD } from './simulate';
import { READ_THRESHOLDS } from './facts';

/** Any part of the ball within the line of the stumps (m from middle). */
const IN_LINE_M = STUMPS_HALF_W + BALL_R;

/** Contacts on the bat (the face or an edge); a miss, the pad and the body are not. */
const ON_THE_BAT: ReadonlySet<ContactKind> = new Set<ContactKind>([
  'middle',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);

/** Below this change in timing error (ms) two attempts are timed the same. */
export const TIMING_CHANGE_MS = 5;

const lofted = (elevation: number | null) => (elevation ?? 0) >= ORTHODOXY.loftedFromElevation;

function aimOf(rec: CoachOption): Pick<CoachRecommendation, 'directionDeg' | 'region' | 'lofted'> {
  if (rec.decision !== 'attack' || !rec.swing) return { directionDeg: null, region: null, lofted: null };
  return {
    directionDeg: rec.swing.directionDeg,
    region: rec.region ?? regionOf(rec.swing.directionDeg),
    lofted: lofted(rec.swing.elevation),
  };
}

/**
 * The attempt's stroke went across the line or the movement of the ball (cricket.ts), from the analysis's own record
 * of the ball: its line, whether it would hit, and the larger of its air and pitch movement (as facts.ts plays it).
 */
function playedAcross(an: Pick<CoachAnalysis, 'ball' | 'attempted'>): boolean {
  const dir = an.attempted.directionDeg;
  if (an.attempted.decision !== 'attack' || dir === null) return false;
  const b = an.ball;
  const pitch = b.pitchMovementM ?? 0;
  const playedMoveM = Math.abs(b.airMovementM) >= Math.abs(pitch) ? b.airMovementM : pitch;
  const mover = Math.abs(playedMoveM) >= READ_THRESHOLDS.movementM ? 'swing' : null;
  return acrossTheLine(dir, b) || acrossTheMovement(dir, { mover, playedMoveM });
}

/**
 * Why a ball the coach leaves misses: over the top (short-pitched, or in line with the stumps and still missing them,
 * so it passes over them), down the leg side, or outside off stump.
 */
export function leaveKind(an: Pick<CoachAnalysis, 'ball'>): CoachRecommendationKind {
  const inLine = Math.abs(an.ball.lineAtStumpsM) < IN_LINE_M;
  if (an.ball.heightAtBatM >= READ_THRESHOLDS.highAtBatM || inLine) return 'leave_over_the_top';
  return an.ball.lineAtStumpsM < 0 ? 'leave_down_leg' : 'leave_outside_off';
}

const defendKind = (rec: CoachOption): CoachRecommendationKind =>
  rec.footwork === 'back' || rec.footwork === 'across' ? 'defend_back' : 'defend_forward';

/**
 * Met the recommended response's standard: survived, the recommended decision, the middle of the bat or a correct
 * leave. `measuredClean` is the attempt's contact as measured (CoachTip.cleanContact, quality.ts cleanByMeasure): for a
 * stroke it must also be clean, at no less than half the requested bat speed and inside the sweet zone, so a slow fend
 * is never a success (lead ruling 2026-11-03, WA7). A block is exempt. Without it the contact label decides.
 */
export function metStandard(an: CoachAnalysis, measuredClean?: boolean | null): boolean {
  const a = an.attempted;
  if (a.dismissal || a.decision !== an.options[0].decision) return false;
  if (a.decision === 'leave') return !an.ball.wouldHitStumps;
  if (a.decision === 'attack' && measuredClean === false) return false;
  return a.contact === 'middle';
}

/** Two aims this far apart are different strokes (deg). */
export const AIM_CHANGE_DEG = 10;

/** A response within this many runs of the recommended one's value is worth as much (the picks' tie-break). */
export const WELL_PLAYED_WITHIN_RUNS = PICK.orthodoxyBonusRuns;

/** The value the card compares, from recorded fields only: expected runs less the wicket's cost times the risk. */
export function spreadValue(x: { dismissalRisk: number; expectedRuns: number }): number {
  return x.expectedRuns - PICK.wicketCostRuns * x.dismissalRisk;
}

/** The attempt worked: not out, and off the middle of the bat, with runs for a stroke. */
export function attemptWorked(an: CoachAnalysis): boolean {
  const a = an.attempted;
  if (a.dismissal !== null || a.decision === 'leave' || a.contact !== 'middle') return false;
  return a.decision === 'defend' || a.runs > 0;
}

/** The attempt is the recommended response itself: the same decision, and for a stroke the same aim and lofting. */
function isRecommendedResponse(an: CoachAnalysis): boolean {
  const a = an.attempted;
  const rec = an.options[0];
  if (a.decision !== rec.decision) return false;
  if (rec.decision !== 'attack' || !rec.swing) return true;
  return (
    a.directionDeg !== null &&
    Math.abs(a.directionDeg - rec.swing.directionDeg) < AIM_CHANGE_DEG &&
    lofted(a.elevation) === lofted(rec.swing.elevation)
  );
}

/**
 * 'well_played': a different response from the recommended one that worked, and over the execution spread is worth as
 * much (within WELL_PLAYED_WITHIN_RUNS), keeping the coach's hard rules (no misread in it, no protected aim). Every
 * term is a recorded field: attempted.spread, options[0], the read.
 */
export function wellPlayed(an: CoachAnalysis): boolean {
  const s = an.attempted.spread;
  if (!s || isRecommendedResponse(an) || !attemptWorked(an)) return false;
  if (s.risks.includes('into_protected_region') || Object.values(an.read).includes('wrong')) return false;
  return spreadValue(s) >= spreadValue(an.options[0]) - WELL_PLAYED_WITHIN_RUNS;
}

/**
 * The one change to make, pointing at the recommended response (options[0]). Every kind follows from recorded fields
 * (docs/PRACTICE_COACH.md, "The card"): the decisions, the read, the timing band and error, the aims and the runs.
 */
export function recommendationFor(an: CoachAnalysis): CoachRecommendation {
  const rec = an.options[0];
  const a = an.attempted;
  const aim = aimOf(rec);
  // Every recommendation names the recommended stroke's aim and safe scoring region (null for a block or a leave).
  const make = (kind: CoachRecommendationKind, extra: Partial<CoachRecommendation> = {}): CoachRecommendation => ({
    kind,
    decision: rec.decision,
    footwork: rec.footwork,
    shiftMs: null,
    ...aim,
    ...extra,
  });
  // 0. A different response that worked and is worth as much as the recommended one.
  if (wellPlayed(an)) return make('well_played');
  // 1. The decision: leave, block or attack.
  if (a.decision !== rec.decision) {
    if (rec.decision === 'leave') return make(leaveKind(an));
    if (a.decision === 'leave' && an.ball.wouldHitStumps) return make('play_at_the_stumps');
    if (rec.decision === 'defend') return make(defendKind(rec));
    return make('attack_the_gap');
  }
  if (a.decision === 'leave') return make(an.ball.wouldHitStumps ? 'play_at_the_stumps' : 'repeat_it');
  // 2. Feet that fought the length.
  if (an.read.length === 'wrong')
    return make(rec.footwork === 'back' || rec.footwork === 'across' ? 'get_back' : 'get_forward');
  // 3. The recommended stroke itself (the same decision, aim within AIM_CHANGE_DEG and lofting, on the same played
  // feet), timed outside the solid band, or inside it but off the middle, or inside it and still out (caught, or played
  // on): the timing is then the one recorded difference from the demonstration, which survives at its ideal point.
  // A different stroke is never told only to move its timing: the engine's evidence is for the recommended stroke
  // (the player's own stroke at its ideal can still miss), so it falls to the aim or the decision below.
  const err = a.timingErrorMs ?? 0;
  // Beyond the execution spread (±2σ) the recommendation was never verified, whatever the label: the physics labels a
  // block met on the face at least 'solid' however late it is (2026-11-03 label rules).
  const sameStroke = isRecommendedResponse(an) && a.footwork === rec.footwork && rec.outcome.dismissal === null;
  const beyondSpread = Math.abs(err) > 2 * EXECUTION_SPREAD.timingSigmaMs;
  const offBand =
    a.timing === 'mistimed' ||
    a.timing === 'missed' ||
    (a.timing === 'solid' && a.contact !== 'middle') ||
    beyondSpread;
  const outPlayingIt = a.dismissal !== null && Math.abs(err) >= TIMING_CHANGE_MS;
  // A swing timed inside the band (perfect or solid) that the bat never met (a miss, the pad, the body) is never told
  // to move its timing: the label says the timing was right and the reach failed, so the action is the stroke's own
  // choice below (lead ruling (B), 2026-11-04).
  const unreachedInBand = (a.timing === 'perfect' || a.timing === 'solid') && !ON_THE_BAT.has(a.contact);
  if (sameStroke && (offBand || outPlayingIt) && !unreachedInBand) {
    return make(err > 0 ? 'play_earlier' : 'play_later', { shiftMs: Math.max(1, Math.round(Math.abs(err))) });
  }
  // 4. Across the line or the movement: play straighter, with the line. A stroke the movement merely beat, without
  // being played across it, is not told to play straighter when the recommended stroke aims elsewhere (it may be
  // squarer, with the movement): it falls to the recommended aim below.
  if (an.read.line === 'wrong' || an.read.movement === 'wrong') {
    if (rec.decision !== 'attack' || isRecommendedResponse(an) || playedAcross(an)) return make('play_straighter');
  }
  // A block repeats only on the recommended feet; on the other feet the recommended block is the one action.
  if (a.decision === 'defend')
    return make(metStandard(an) && a.footwork === rec.footwork ? 'repeat_it' : defendKind(rec));
  // 5. A lofted stroke caught or stopped, when the recommended stroke keeps the ball down. Only a ball the bat met
  // was lofted: after a miss, the pad or the body, "keep it along the ground" names nothing that happened, so the
  // action falls to the feet or the aim below (lead ruling (A), 2026-11-04: 49 of the physics evaluator's 627
  // "perfect/solid with no bat contact" results were told to keep it down).
  if (lofted(a.elevation) && !aim.lofted && ON_THE_BAT.has(a.contact) && (a.dismissal !== null || a.runs === 0))
    return make('keep_it_down');
  // 5a. The recommended aim and lofting on the other feet: the feet are the one change (never "repeat it").
  if (isRecommendedResponse(an) && a.footwork !== rec.footwork)
    return make(rec.footwork === 'back' || rec.footwork === 'across' ? 'get_back' : 'get_forward');
  // 6. Done right, timed inside the solid band, and as many runs as the recommended stroke: repeat it. A mistimed
  // stroke that happened to survive off the middle is never told to repeat itself. Otherwise, aim where it aims.
  const sameAim =
    a.directionDeg !== null &&
    aim.directionDeg !== null &&
    Math.abs(a.directionDeg - aim.directionDeg) < AIM_CHANGE_DEG;
  const inBand = a.timing === 'perfect' || a.timing === 'solid';
  if (metStandard(an) && inBand && (sameAim || a.runs >= rec.outcome.runs)) return make('repeat_it');
  return make('aim_for_the_gap');
}

/** The card's one insight: the primary reason (why[0]) and the one recommendation. */
export function primaryInsight(an: CoachAnalysis): PrimaryInsight {
  const err = an.attempted.timingErrorMs;
  return {
    reason: an.why[0],
    timingMs: err === null ? null : Math.round(err) || 0,
    recommendation: recommendationFor(an),
  };
}

interface Standard {
  survived: boolean;
  decision: boolean;
  footwork: boolean | null;
  clean: boolean;
  absErr: number | null;
  runs: number;
}

function standardOf(an: CoachAnalysis, rec: CoachOption, measuredClean?: boolean | null): Standard {
  const a = an.attempted;
  const swung = a.decision !== 'leave';
  return {
    survived: a.dismissal === null,
    decision: a.decision === rec.decision,
    footwork: swung && rec.decision !== 'leave' ? an.read.length !== 'wrong' && a.footwork === rec.footwork : null,
    // The contact's own measurement when the caller has it (CoachTip.cleanContact), never the label alone.
    clean: swung
      ? typeof measuredClean === 'boolean'
        ? measuredClean
        : a.contact === 'middle'
      : a.dismissal === null && !an.ball.wouldHitStumps,
    absErr: a.timingErrorMs === null ? null : Math.abs(a.timingErrorMs),
    runs: a.dismissal ? 0 : a.runs,
  };
}

/** The changes that are improvements (the rest, except 'same_again', are regressions). */
export const IMPROVEMENTS: ReadonlySet<AttemptChangeKind> = new Set<AttemptChangeKind>([
  'survived_now',
  'decision_right_now',
  'footwork_right_now',
  'clean_contact_now',
  'timing_closer',
  'more_runs',
]);

/**
 * What changed between two attempts at the exact ball, most important first (survival, the decision, the footwork, the
 * contact, the timing by TIMING_CHANGE_MS or more, the runs), against the recommended response of the newer analysis
 * (both attempts face the same delivery, so it is the same response). The verdict is the most important change's:
 * 'better' when it is an improvement, 'worse' when it is a regression, 'same' when nothing changed. `clean` passes each
 * attempt's measured clean contact (CoachTip.cleanContact: the face, the sweet zone, the bat speed); without it the
 * contact label decides, which counts a slow fend or a toe contact labelled 'middle' as clean.
 */
export function compareAttempts(
  previous: CoachAnalysis,
  next: CoachAnalysis,
  clean?: { previous?: boolean | null; next?: boolean | null },
): AttemptComparison {
  const rec = next.options[0];
  const p = standardOf(previous, rec, clean?.previous);
  const n = standardOf(next, rec, clean?.next);
  const changes: AttemptChangeKind[] = [];
  const flip = (a: boolean | null, b: boolean | null, up: AttemptChangeKind, down: AttemptChangeKind) => {
    if (a === null || b === null || a === b) return;
    changes.push(b ? up : down);
  };
  flip(p.survived, n.survived, 'survived_now', 'out_now');
  flip(p.decision, n.decision, 'decision_right_now', 'decision_wrong_now');
  flip(p.footwork, n.footwork, 'footwork_right_now', 'footwork_wrong_now');
  flip(p.clean, n.clean, 'clean_contact_now', 'contact_worse');
  const timingMs = p.absErr !== null && n.absErr !== null ? Math.round(p.absErr - n.absErr) || 0 : null;
  if (timingMs !== null && timingMs >= TIMING_CHANGE_MS) changes.push('timing_closer');
  if (timingMs !== null && timingMs <= -TIMING_CHANGE_MS) changes.push('timing_further');
  const runsDelta = n.runs - p.runs;
  if (runsDelta > 0) changes.push('more_runs');
  if (runsDelta < 0) changes.push('fewer_runs');
  if (changes.length === 0) return { changes: ['same_again'], verdict: 'same', timingMs, runsDelta };
  // The most important recorded change decides: survival, then the decision, the feet, the contact, the timing, the runs.
  return { changes, verdict: IMPROVEMENTS.has(changes[0]) ? 'better' : 'worse', timingMs, runsDelta };
}
