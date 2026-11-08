/**
 * COACH2 (release/player-experience/ceiling-rubric.md): the recommendation really works. For every reference-over ball
 * and three kinds of failure, the analysis of the failed attempt recommends a response that, executed by script on
 * the same ball through the game's own exact-ball path (repeatDelivery: the recorded assistance and tier tolerance),
 * succeeds in physics. No copies: every outcome here is a fresh simulation.
 */
import { describe, expect, it } from 'vitest';
import type { AssistLevel, CoachAnalysis, DeliveryRecord, NormalizedSwing } from '@/contracts/practice';
import { canPlay } from '@/input/normalize';
import { REFERENCE_BALLS, repeatDelivery } from '@/practice/game';
import { analyzeBall, metStandard, primaryInsight } from '@/practice/coach';
import { referenceRecord, swingFor } from './fixtures';

/** The record of an attempt at the ball, with its result through the game's exact-ball path. */
function attemptAt(base: DeliveryRecord, swing: NormalizedSwing | null): { record: DeliveryRecord; analysis: CoachAnalysis } {
  const result = repeatDelivery(base, swing);
  const record = { ...base, swing, runs: result.outcome.runs, dismissal: result.outcome.dismissal };
  return { record, analysis: analyzeBall(record, result) };
}

const shift = (s: NormalizedSwing, ms: number): NormalizedSwing => ({ ...s, startT: Math.round((s.startT + ms / 1000) * 1e4) / 1e4 });

/**
 * Each case cold-simulates the candidate grid and then judges three failed attempts plus their exact-ball repeats.
 * The frozen sim-v3 work now exceeds Vitest's 30 s repository default for the two heaviest reference deliveries on
 * an otherwise lightly loaded single worker. Keep the complete COACH2 evidence and give this exhaustive gate room to
 * finish instead of weakening its assertions or changing the production recommendation.
 */
const COACH2_CASE_TIMEOUT_MS = 120_000;

/** Three failures: the wrong decision, the right response far too late, and far too early (or with the wrong feet). */
function failures(base: DeliveryRecord): Array<[string, NormalizedSwing | null]> {
  const rec = analyzeBall(base).options[0];
  if (!rec.swing) {
    return [
      ['played at a ball to leave', swingFor(base, { directionDeg: 0 })],
      ['played at it, late', swingFor(base, { directionDeg: 30, errorMs: 90 })],
      ['blocked it, wrong feet', swingFor(base, { kind: 'defend', footwork: base.plan.lengthM > 5 ? 'forward' : 'back' })],
    ];
  }
  return [
    ['left it', null],
    ['the right response, 90 ms late', shift(rec.swing, 90)],
    ['the right response, 90 ms early', shift(rec.swing, -90)],
  ];
}

for (const [assist, tier] of [['play', 0], ['real', 0], ['learn', 0], ['play', 15], ['real', 15]] as Array<[AssistLevel, number]>) {
  describe(`COACH2: the recommendation works on the same ball (${assist}, tier tolerance ${tier} ms)`, () => {
    for (const rb of REFERENCE_BALLS) {
      it(`${rb.id} ${rb.variation}: after each failure, executing the recommendation succeeds`, () => {
        const base = { ...referenceRecord(rb.id, assist), tierToleranceMs: tier };
        for (const [label, swing] of failures(base)) {
          const failed = attemptAt(base, swing);
          const rec = failed.analysis.options[0];
          // A recommendation that works has to be one the player can input.
          for (const o of failed.analysis.options) if (o.swing) expect(canPlay(o.swing), `${rb.id} ${o.kind}`).toBe(true);
          const done = attemptAt(base, rec.swing);
          const r = repeatDelivery(base, rec.swing);
          expect(r.outcome.dismissal, `${rb.id} after "${label}"`).toBeNull();
          if (rec.decision === 'leave') {
            expect(r.contact.kind, `${rb.id} after "${label}"`).toBe('leave');
            expect(failed.analysis.ball.wouldHitStumps).toBe(false);
          } else expect(r.contact.kind, `${rb.id} after "${label}"`).toBe('middle');
          expect(r.outcome).toEqual(rec.outcome);
          expect(metStandard(done.analysis), `${rb.id} after "${label}"`).toBe(true);
          expect(primaryInsight(done.analysis).recommendation.kind).toBe('repeat_it');
          // One reason and one recommendation for the failure itself.
          const insight = primaryInsight(failed.analysis);
          expect(insight.reason).toBe(failed.analysis.why[0]);
          expect(insight.recommendation.decision).toBe(rec.decision);
        }
      }, COACH2_CASE_TIMEOUT_MS);
    }
  });
}
