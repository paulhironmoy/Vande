/**
 * A fake exact-ball coach for the flow tests: deterministic, contract-shaped, and deliberately simple (it is not the
 * coach engine). Success is a clean middle contact without a dismissal; two in a row move the help on a stage; at no
 * help, three of the last four master the ball.
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistanceStage,
  type CoachAnalysis,
  type DeliveryRecord,
  type DeliveryResult,
  type MasteryState,
} from '@/contracts';
import { FORM_SAMPLE_VERSION } from '@/practice/coach/form';
import { praiseEarned, tipWords } from '@/practice/coach/tip';
import type { CoachKit } from '@/practice/ui/flow/types';

function analysis(record: DeliveryRecord, result: DeliveryResult): CoachAnalysis {
  const option = {
    kind: 'recommended' as const,
    decision: 'defend' as const,
    swing: {
      kind: 'defend' as const,
      startT: 0.4,
      directionDeg: 0,
      power: 0.2,
      elevation: 0,
      footwork: 'forward' as const,
    },
    footwork: 'forward' as const,
    outcome: {
      runs: 0 as const,
      boundary: null,
      dismissal: null,
      fielderId: null,
      endBearingDeg: null,
      endDistanceM: null,
      region: null,
    },
    contact: 'middle' as const,
    contactPoint: null,
    contactT: 0.5,
    dismissalRisk: 0.02,
    expectedRuns: 0.4,
    region: null,
    risks: [],
  };
  return {
    version: PRACTICE_SIM_VERSION,
    ball: {
      variation: record.plan.variation,
      speedKph: record.plan.speedKph,
      lengthM: record.plan.lengthM,
      lineAtStumpsM: record.plan.lineM,
      airMovementM: 0.1,
      pitchMovementM: 0.02,
      heightAtBatM: 0.7,
      wouldHitStumps: result.flight.wouldHitStumps,
    },
    read: { length: 'right', line: 'right', pace: 'unclear', movement: 'right', bounce: 'unclear' },
    attempted: {
      decision: result.swing ? (result.swing.kind === 'attack' ? 'attack' : 'defend') : 'leave',
      footwork: result.footwork,
      directionDeg: result.swing?.directionDeg ?? null,
      elevation: result.swing?.elevation ?? null,
      power: result.swing?.power ?? null,
      timingErrorMs: result.contact.timingErrorMs,
      contact: result.contact.kind,
      timing: result.contact.timing,
      runs: result.outcome.runs,
      dismissal: result.outcome.dismissal,
      spread: null,
    },
    why: [result.coaching.reason],
    options: [option],
  };
}

const success = (a: CoachAnalysis) => a.attempted.contact === 'middle' && !a.attempted.dismissal;

export function fakeCoach(): CoachKit & { analysed: number } {
  const kit: CoachKit & { analysed: number } = {
    analysed: 0,
    analyzeBall: (record, result) => {
      kit.analysed++;
      return analysis(record, result);
    },
    analyzeBallInSlices: async (record, result) => {
      kit.analysed++;
      return analysis(record, result);
    },
    optionOf: (a, kind) => a.options.find((o) => o.kind === kind) ?? a.options[0],
    primaryInsight: (a) => ({
      reason: a.why[0],
      timingMs: a.attempted.timingErrorMs,
      recommendation: {
        kind: 'defend_forward',
        decision: 'defend',
        footwork: 'forward',
        shiftMs: null,
        directionDeg: null,
        region: null,
        lofted: null,
      },
    }),
    // The tip's action is the card's recommendation; its fact here is the physics' own reason (the real words render it).
    coachTip: (_record, a) => ({
      mistake: 'other',
      fact: { kind: 'reason', reason: a.why[0], zone: null, fielder: null },
      action: kit.primaryInsight(a).recommendation,
    }),
    tipWords: (t, tip) => tipWords(t, tip),
    praiseEarned: (a, rec, tip) => praiseEarned(a, rec, tip),
    compareAttempts: (prev, next) => ({
      changes: ['same_again'],
      verdict: success(next) && !success(prev) ? 'better' : 'same',
      timingMs: null,
      runsDelta: next.attempted.runs - prev.attempted.runs,
    }),
    masteryKey: (r) => `${r.seed}|${r.handedness}|${r.assist}`,
    startMastery: (key) => ({ key, stage: 1, attempts: [], mastered: false }),
    recordAttempt: (state, a, stage, tip) => {
      const attempts = [
        ...state.attempts,
        {
          stage,
          decision: a.attempted.decision,
          footwork: a.attempted.footwork,
          timingErrorMs: a.attempted.timingErrorMs,
          contact: a.attempted.contact,
          runs: a.attempted.runs,
          out: Boolean(a.attempted.dismissal),
          success: success(a) && tip?.cleanContact !== false,
        },
      ];
      const atStage = attempts.filter((x) => x.stage === state.stage);
      const streak = atStage.length >= 2 && atStage.slice(-2).every((x) => x.success);
      const next = (state.stage < 4 && streak ? state.stage + 1 : state.stage) as AssistanceStage;
      const last4 = attempts.filter((x) => x.stage === 4).slice(-4);
      return {
        ...state,
        attempts,
        stage: next,
        mastered: state.mastered || last4.filter((x) => x.success).length >= 3,
      };
    },
    masteryProgress: (m: MasteryState) => ({
      stage: m.stage,
      streak: 0,
      neededToAdvance: m.stage < 4 ? 2 : 0,
      stageAttempts: m.attempts.filter((a) => a.stage === m.stage).length,
      recentSuccesses: m.stage === 4 ? m.attempts.filter((a) => a.stage === 4 && a.success).length : null,
      recentWindow: 4,
      mastered: m.mastered,
    }),
    masteryEvent: (prev, next) =>
      next.mastered && !prev.mastered ? 'mastered' : next.stage > prev.stage ? 'stage_up' : null,
    formSample: ({ result }, ctx) => ({
      v: FORM_SAMPLE_VERSION,
      simVersion: PRACTICE_SIM_VERSION,
      source: ctx.source,
      stage: ctx.source === 'mastery' ? ctx.stage : 4,
      runs: result.outcome.runs,
    }),
    formFromAttempts: (samples) => {
      const n = samples.filter(
        (x) => typeof x === 'object' && x !== null && (x as { v?: number }).v === FORM_SAMPLE_VERSION,
      ).length;
      const none = { score: null, samples: 0, trend: null };
      return {
        line_length: none,
        pace_timing: none,
        swing_seam: none,
        cut: none,
        spin_reading: none,
        short_ball: none,
        footwork: none,
        timing: n ? { score: 50, samples: n, trend: null } : none,
        bat_face: none,
        off_side_placement: none,
        direction: none,
        field: none,
        running: none,
      };
    },
  };
  return kit;
}
