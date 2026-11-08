/**
 * Mastery of an exact ball: repeat it with less and less help until the recommended response is repeatable
 * (docs/PRACTICE_COACH.md, "Mastery"). Pure functions over the contract's MasteryState; the UI persists it per ball.
 *
 * Assistance stages: 1 full trajectory and ghost movement, 2 pitch and contact markers, 3 contact cue only, 4 none.
 * One lucky result is never mastery: the stage only advances after consecutive successes, and mastery needs repeated
 * success with no assistance at all.
 */
import type { AssistanceStage, CoachAnalysis, DeliveryRecord, MasteryAttempt, MasteryState } from '@/contracts/practice';
import { metStandard } from './insight';

/** The whole rule, in one place (tested and documented). */
export const MASTERY_RULE = {
  /**
   * A success: no dismissal, the recommended decision, and the middle of the bat (for a stroke, measured clean: at least
   * half the requested bat speed and inside the sweet zone), or a leave of a ball that misses.
   */
  success: { noDismissal: true, recommendedDecision: true, contact: 'middle', strokeMeasuredClean: true, orCorrectLeave: true },
  /** Move to the next (less assisted) stage after this many consecutive successes at the current stage. */
  advanceAfter: 2,
  /** Mastery is judged with no assistance ... */
  masteredStage: 4,
  /** ... on the last `masteredWindow` attempts at that stage, of which at least `masteredSuccesses` must succeed. */
  masteredWindow: 4,
  masteredSuccesses: 3,
} as const;

const FIRST: AssistanceStage = 1;
const LAST: AssistanceStage = 4;

/**
 * The meaning of a recorded success. 2 (2026-11-03): a stroke succeeds only with a measured clean contact (at least half
 * the requested bat speed, inside the sweet zone); 1 counted any face contact labelled 'middle', slow fends included.
 * It is part of the key, so states recorded under the old meaning are never found again: dropped quietly, never
 * reinterpreted (WA7).
 */
export const MASTERY_SUCCESS_VERSION = 2;

/** One key per simulation, exact ball and the settings that change its physics (innings and reference balls alike). */
export function masteryKey(record: Pick<DeliveryRecord, 'version' | 'seed' | 'handedness' | 'assist'>): string {
  return `sim${record.version}|m${MASTERY_SUCCESS_VERSION}|${record.seed}|${record.handedness}|${record.assist}`;
}

export function startMastery(key: string): MasteryState {
  return { key, stage: FIRST, attempts: [], mastered: false };
}

/**
 * The attempt as the mastery history records it, judged against the recommended response's standard. Pass the
 * attempt's tip (coachTip): its measured clean contact decides a stroke's success (metStandard).
 */
export function masteryAttempt(analysis: CoachAnalysis, stage: AssistanceStage, tip?: { cleanContact?: boolean | null } | null): MasteryAttempt {
  const a = analysis.attempted;
  return {
    stage,
    decision: a.decision,
    footwork: a.footwork,
    timingErrorMs: a.timingErrorMs,
    contact: a.contact,
    runs: a.runs,
    out: a.dismissal !== null,
    success: metStandard(analysis, tip?.cleanContact),
  };
}

interface Walk {
  stage: AssistanceStage;
  streak: number;
}

/** Replays the rule over the history: the stage reached, and the run of successes at it. */
function walk(attempts: readonly MasteryAttempt[]): Walk {
  let stage: AssistanceStage = FIRST;
  let streak = 0;
  for (const a of attempts) {
    // A player who chooses less help moves on to that stage; attempts with more help than the stage reached do not count.
    if (a.stage > stage) {
      stage = a.stage;
      streak = 0;
    }
    if (a.stage < stage) continue;
    streak = a.success ? streak + 1 : 0;
    if (streak >= MASTERY_RULE.advanceAfter && stage < LAST) {
      stage = (stage + 1) as AssistanceStage;
      streak = 0;
    }
  }
  return { stage, streak };
}

/** The stage the next attempt is played at. */
export function nextStage(state: MasteryState): AssistanceStage {
  return walk(state.attempts).stage;
}

function lastAtMasteredStage(state: MasteryState): MasteryAttempt[] {
  return state.attempts.filter((a) => a.stage === MASTERY_RULE.masteredStage).slice(-MASTERY_RULE.masteredWindow);
}

/** Mastered: repeated success with no assistance (and, once shown, it stays shown). */
export function isMastered(state: MasteryState): boolean {
  if (state.mastered) return true;
  const recent = lastAtMasteredStage(state);
  return recent.length >= MASTERY_RULE.masteredSuccesses && recent.filter((a) => a.success).length >= MASTERY_RULE.masteredSuccesses;
}

/** Record an attempt at the given stage: the new state (stage advanced and mastery set by the rule). */
export function recordAttempt(state: MasteryState, analysis: CoachAnalysis, stage: AssistanceStage, tip?: { cleanContact?: boolean | null } | null): MasteryState {
  const next: MasteryState = { ...state, attempts: [...state.attempts, masteryAttempt(analysis, stage, tip)] };
  next.stage = nextStage(next);
  next.mastered = isMastered(next);
  return next;
}

export interface MasteryProgress {
  stage: AssistanceStage;
  /** Consecutive successes at the current stage. */
  streak: number;
  /** Successes still needed to move on (0 at the last stage). */
  neededToAdvance: number;
  /** Attempts played at the current stage. */
  stageAttempts: number;
  /** At the last stage: successes among its last attempts (out of recentWindow); null before it. */
  recentSuccesses: number | null;
  recentWindow: number;
  mastered: boolean;
}

export function masteryProgress(state: MasteryState): MasteryProgress {
  const w = walk(state.attempts);
  const atLast = w.stage === LAST;
  return {
    stage: w.stage,
    streak: w.streak,
    neededToAdvance: atLast ? 0 : MASTERY_RULE.advanceAfter - w.streak,
    stageAttempts: state.attempts.filter((a) => a.stage === w.stage).length,
    recentSuccesses: atLast ? lastAtMasteredStage(state).filter((a) => a.success).length : null,
    recentWindow: MASTERY_RULE.masteredWindow,
    mastered: isMastered(state),
  };
}

/** A closed event for audio and haptics when a recorded attempt changes the state (null when it does not). */
export function masteryEvent(prev: MasteryState, next: MasteryState): 'stage_up' | 'mastered' | null {
  if (next.mastered && !prev.mastered) return 'mastered';
  return next.stage > prev.stage ? 'stage_up' : null;
}

const STAGES = new Set([1, 2, 3, 4]);
const DECISIONS = new Set(['leave', 'defend', 'attack']);
const FOOTWORK = new Set(['forward', 'back', 'across', 'down_track']);
const CONTACTS = new Set(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge', 'pad', 'body', 'miss', 'leave']);

function isAttempt(v: unknown): v is MasteryAttempt {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    STAGES.has(a.stage as number) &&
    DECISIONS.has(a.decision as string) &&
    FOOTWORK.has(a.footwork as string) &&
    (a.timingErrorMs === null || Number.isFinite(a.timingErrorMs)) &&
    CONTACTS.has(a.contact as string) &&
    Number.isInteger(a.runs) &&
    typeof a.out === 'boolean' &&
    typeof a.success === 'boolean'
  );
}

/** Structural check for a MasteryState read back from storage (corrupt or foreign data is rejected). */
export function isMasteryState(v: unknown): v is MasteryState {
  if (!v || typeof v !== 'object') return false;
  const s = v as Record<string, unknown>;
  return typeof s.key === 'string' && STAGES.has(s.stage as number) && Array.isArray(s.attempts) && s.attempts.every(isAttempt) && typeof s.mastered === 'boolean';
}
