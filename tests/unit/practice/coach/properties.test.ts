/**
 * Properties the examiners check (release/player-experience/ceiling-rubric.md):
 *   COACH5  better, worse and same match the recorded deltas, in every case;
 *   FAIR3   every coach statement traces to recorded fields (the record, its re-simulated result, the read);
 *   COACH1  exactly one primary reason and one recommendation.
 * Over real attempts at random-over balls and the reference over: leaves, blocks, the recommended stroke, early, late,
 * across the line.
 */
import { describe, expect, it } from 'vitest';
import type { CoachAnalysis, CoachingReason, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { BALL_R, STUMPS_HALF_W, autoField, flightMovement, practiceFlight } from '@/physics';
import { REFERENCE_BALLS, ballSeed, randomOver, repeatDelivery } from '@/practice/game';
import { IMPROVEMENTS, TIMING_CHANGE_MS, analyzeBall, compareAttempts, metStandard, primaryInsight } from '@/practice/coach';
import { referenceRecord, swingFor } from './fixtures';

interface Attempt {
  record: DeliveryRecord;
  analysis: CoachAnalysis;
}

function attemptAt(base: DeliveryRecord, swing: NormalizedSwing | null): Attempt {
  const result = repeatDelivery(base, swing);
  const record = { ...base, swing, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
  return { record, analysis: analyzeBall(record, result) };
}

const shift = (s: NormalizedSwing, ms: number): NormalizedSwing => ({ ...s, startT: Math.round((s.startT + ms / 1000) * 1e4) / 1e4 });

function attemptsFor(base: DeliveryRecord): Attempt[] {
  const options = analyzeBall(base).options;
  const rec = options[0];
  const swings: Array<NormalizedSwing | null> = [null, swingFor(base, { kind: 'defend' }), swingFor(base, { directionDeg: -70 }), swingFor(base, { directionDeg: 40, errorMs: 45 })];
  if (rec.swing) swings.push(rec.swing, shift(rec.swing, 70), shift(rec.swing, -35));
  // The recommended stroke aimed elsewhere: a different response, sometimes as good (well played), sometimes lucky.
  if (rec.swing && rec.decision === 'attack') for (const d of [-14, 14]) swings.push({ ...rec.swing, directionDeg: rec.swing.directionDeg + d });
  // The coach's own alternatives (safest, higher-scoring), played as attempts: different responses the coach judged
  // over their spread. Added 2026-11-03 for physics freeze 5d, where capped strokes saturate and the ±14° re-aims no
  // longer include a well-played case; on 5d the higher-scoring 45° strokes at Real ref-3 and ref-4 (no risk over
  // their spread, more runs than the recommended block) are genuine well-played attempts. Every assertion is unchanged.
  for (const o of options.slice(1)) if (o.swing) swings.push(o.swing);
  return swings.map((s) => attemptAt(base, s));
}

function sampleBalls(): DeliveryRecord[] {
  const out: DeliveryRecord[] = REFERENCE_BALLS.map((b) => referenceRecord(b.id, 'real'));
  for (const [seed, conditions, assist] of [['prop-1', 'green', 'play'], ['prop-2', 'turning', 'learn']] as const) {
    const over = randomOver({ seed, conditions, assist, beginner: false });
    const field = autoField(over.bowler, conditions, 'right');
    for (let i = 0; i < 6; i += 2) {
      out.push({ ...referenceRecord('ref-1'), bowler: over.bowler, plan: over.balls[i], seed: ballSeed(over, i), conditions, ball: over.ball, field, assist, ballIndex: i });
    }
  }
  return out;
}

const BALLS = sampleBalls();
const ATTEMPTS = BALLS.map(attemptsFor);

const clean = (a: CoachAnalysis) => (a.attempted.decision === 'leave' ? a.attempted.dismissal === null && !a.ball.wouldHitStumps : a.attempted.contact === 'middle');
const runsOf = (a: CoachAnalysis) => (a.attempted.dismissal ? 0 : a.attempted.runs);

describe('COACH5: the comparison matches the recorded deltas', () => {
  it('every change is a recorded delta, and the verdict is the most important change', () => {
    let pairs = 0;
    for (const attempts of ATTEMPTS) {
      for (const p of attempts) {
        for (const n of attempts) {
          const c = compareAttempts(p.analysis, n.analysis);
          const rec = n.analysis.options[0];
          const pa = p.analysis.attempted;
          const na = n.analysis.attempted;
          pairs++;
          const has = (k: (typeof c.changes)[number]) => c.changes.includes(k);
          expect(has('survived_now')).toBe(pa.dismissal !== null && na.dismissal === null);
          expect(has('out_now')).toBe(pa.dismissal === null && na.dismissal !== null);
          expect(has('decision_right_now')).toBe(pa.decision !== rec.decision && na.decision === rec.decision);
          expect(has('decision_wrong_now')).toBe(pa.decision === rec.decision && na.decision !== rec.decision);
          expect(has('clean_contact_now')).toBe(!clean(p.analysis) && clean(n.analysis));
          expect(has('contact_worse')).toBe(clean(p.analysis) && !clean(n.analysis));
          const dt = pa.timingErrorMs !== null && na.timingErrorMs !== null ? Math.round(Math.abs(pa.timingErrorMs) - Math.abs(na.timingErrorMs)) || 0 : null;
          expect(c.timingMs).toBe(dt);
          expect(has('timing_closer')).toBe(dt !== null && dt >= TIMING_CHANGE_MS);
          expect(has('timing_further')).toBe(dt !== null && dt <= -TIMING_CHANGE_MS);
          expect(c.runsDelta).toBe(runsOf(n.analysis) - runsOf(p.analysis));
          expect(has('more_runs')).toBe(c.runsDelta > 0);
          expect(has('fewer_runs')).toBe(c.runsDelta < 0);
          if (c.changes[0] === 'same_again') {
            expect(c.changes).toEqual(['same_again']);
            expect(c.verdict).toBe('same');
          } else expect(c.verdict).toBe(IMPROVEMENTS.has(c.changes[0]) ? 'better' : 'worse');
          // Swapping the attempts swaps the verdict.
          const back = compareAttempts(n.analysis, p.analysis).verdict;
          expect(back).toBe(c.verdict === 'better' ? 'worse' : c.verdict === 'worse' ? 'better' : 'same');
        }
      }
    }
    expect(pairs).toBeGreaterThan(400);
  });
});

/** Why a reason may appear: the physics' own verdict, or a wrong read with the fact that makes it so. */
function traced(r: CoachingReason, a: CoachAnalysis, physics: CoachingReason): boolean {
  if (r === physics) return true;
  const err = a.attempted.timingErrorMs ?? 0;
  switch (r) {
    case 'beaten_by_bounce':
      return a.read.bounce === 'wrong';
    case 'beaten_by_swing':
    case 'beaten_by_seam':
    case 'beaten_by_turn':
      return a.read.movement === 'wrong';
    case 'played_across_the_line':
      return a.read.line === 'wrong' && a.attempted.decision === 'attack';
    case 'too_early':
      return a.read.pace === 'wrong' && err < 0;
    case 'too_late':
    case 'beaten_by_pace':
      return a.read.pace === 'wrong' && err > 0;
    default:
      return false;
  }
}

describe('FAIR3 and COACH1: every statement traces to recorded fields', () => {
  it('the ball, the attempt, the why and the one recommendation', () => {
    let n = 0;
    let wellPlayedCases = 0;
    let lucky = 0;
    for (const attempts of ATTEMPTS) {
      for (const { record, analysis: a } of attempts) {
        n++;
        const result = repeatDelivery(record, record.swing);
        const m = flightMovement(practiceFlight(record));
        // What the ball did: the flight's own numbers.
        expect(a.ball.lineAtStumpsM).toBeCloseTo(m.lineAtStumpsM, 3);
        expect(a.ball.airMovementM).toBeCloseTo(m.airM, 3);
        expect(a.ball.heightAtBatM).toBeCloseTo(m.heightAtBatM, 3);
        // What was attempted: the record's swing and its result.
        expect(a.attempted.decision).toBe(record.swing ? record.swing.kind : 'leave');
        expect(a.attempted.directionDeg).toBe(record.swing ? record.swing.directionDeg : null);
        expect(a.attempted.contact).toBe(result.contact.kind);
        expect(a.attempted.timing).toBe(result.contact.timing);
        expect(a.attempted.runs).toBe(result.outcome.runs);
        expect(a.attempted.dismissal).toBe(result.outcome.dismissal);
        // Why: each reason traced; the physics' own reason is always there.
        expect(a.why).toContain(result.coaching.reason);
        for (const r of a.why) expect(traced(r, a, result.coaching.reason), `${r} in ${a.why.join(',')}`).toBe(true);
        // One reason, one recommendation, each kind justified by the record.
        const p = primaryInsight(a);
        const rec = a.options[0];
        expect(p.reason).toBe(a.why[0]);
        expect(p.timingMs).toBe(a.attempted.timingErrorMs === null ? null : Math.round(a.attempted.timingErrorMs) || 0);
        const k = p.recommendation.kind;
        expect(p.recommendation.decision).toBe(rec.decision);
        expect(p.recommendation.footwork).toBe(rec.footwork);
        const at = a.attempted;
        // attempted.spread: the player's own stroke over the execution spread (null for a leave).
        if (at.decision === 'leave') expect(at.spread).toBeNull();
        else {
          expect(at.spread!.dismissalRisk).toBeGreaterThanOrEqual(0);
          expect(at.spread!.dismissalRisk).toBeLessThanOrEqual(1);
          expect(at.spread!.expectedRuns).toBeGreaterThanOrEqual(0);
          expect(at.spread!.expectedRuns).toBeLessThanOrEqual(6);
        }
        // 'well_played' exactly when the recorded fields say so (and it comes first).
        const worked = at.dismissal === null && at.decision !== 'leave' && at.contact === 'middle' && (at.decision === 'defend' || at.runs > 0);
        const isRec =
          at.decision === rec.decision &&
          (rec.decision !== 'attack' || (at.directionDeg !== null && Math.abs(at.directionDeg - rec.swing!.directionDeg) < 10 && (at.elevation! >= 0.45) === (rec.swing!.elevation >= 0.45)));
        const value = (x: { dismissalRisk: number; expectedRuns: number }) => x.expectedRuns - 24 * x.dismissalRisk;
        const well =
          at.spread !== null &&
          worked &&
          !isRec &&
          !at.spread.risks.includes('into_protected_region') &&
          !Object.values(a.read).includes('wrong') &&
          value(at.spread) >= value(rec) - 0.25;
        expect(k === 'well_played', `well_played for ${JSON.stringify(at)}`).toBe(well);
        if (well) wellPlayedCases++;
        // A stroke that worked but is not called well played is lucky, and the record says why.
        if (worked && !isRec && !well) {
          lucky++;
          const why = at.spread!.risks.includes('into_protected_region') || Object.values(a.read).includes('wrong') || value(at.spread!) < value(rec) - 0.25;
          expect(why).toBe(true);
        }
        // Lead rulings (A) and (B), 2026-11-04 (the physics evaluator's "perfect/solid with no bat contact"): a ball the
        // bat never met is never told to keep it down, and a swing timed inside the band that it never met is never told
        // to move its timing. Before: both predicates held without the bat-contact term (the rule was looser).
        const onBat = ['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge'].includes(at.contact);
        const unreachedInBand = (at.timing === 'perfect' || at.timing === 'solid') && !onBat;
        const ok: Record<typeof k, () => boolean> = {
          repeat_it: () => metStandard(a),
          well_played: () => well,
          leave_outside_off: () => rec.decision === 'leave' && at.decision !== 'leave' && a.ball.lineAtStumpsM >= STUMPS_HALF_W + BALL_R && a.ball.heightAtBatM < 1,
          leave_down_leg: () => rec.decision === 'leave' && at.decision !== 'leave' && a.ball.lineAtStumpsM <= -(STUMPS_HALF_W + BALL_R) && a.ball.heightAtBatM < 1,
          leave_over_the_top: () => rec.decision === 'leave' && at.decision !== 'leave' && (a.ball.heightAtBatM >= 1 || Math.abs(a.ball.lineAtStumpsM) < STUMPS_HALF_W + BALL_R),
          play_at_the_stumps: () => at.decision === 'leave' && a.ball.wouldHitStumps,
          defend_forward: () => rec.decision === 'defend' && rec.footwork !== 'back',
          defend_back: () => rec.decision === 'defend' && rec.footwork === 'back',
          attack_the_gap: () => rec.decision === 'attack' && at.decision !== 'attack',
          // Feet that fought the length; or (2026-11-03, interim 3) the recommended aim and lofting on the other feet,
          // where the feet are the one recorded change and "repeat it" had been said to a mistimed stroke.
          get_forward: () => a.read.length === 'wrong' || (isRec && at.footwork !== rec.footwork && rec.footwork !== 'back' && rec.footwork !== 'across'),
          get_back: () => a.read.length === 'wrong' || (isRec && at.footwork !== rec.footwork && (rec.footwork === 'back' || rec.footwork === 'across')),
          play_earlier: () => !unreachedInBand && (at.timingErrorMs ?? 0) > 0 && p.recommendation.shiftMs === Math.max(1, Math.round(at.timingErrorMs!)),
          play_later: () => !unreachedInBand && (at.timingErrorMs ?? 0) <= 0 && p.recommendation.shiftMs === Math.max(1, Math.round(Math.abs(at.timingErrorMs!))),
          play_straighter: () => a.read.line === 'wrong' || a.read.movement === 'wrong',
          aim_for_the_gap: () => rec.decision === 'attack' && at.decision === 'attack',
          keep_it_down: () => onBat && (at.elevation ?? 0) >= 0.45 && rec.swing!.elevation < 0.45 && (at.dismissal !== null || at.runs === 0),
        };
        expect(ok[k](), `${k} for ${JSON.stringify(at)}`).toBe(true);
        if (rec.decision === 'attack') expect(p.recommendation.directionDeg).toBe(rec.swing!.directionDeg);
        else expect(p.recommendation.region).toBeNull();
      }
    }
    expect(n).toBeGreaterThan(60);
    // Both sides of the rule occur in the sample.
    expect(wellPlayedCases).toBeGreaterThan(0);
    expect(lucky).toBeGreaterThan(0);
  });
});
