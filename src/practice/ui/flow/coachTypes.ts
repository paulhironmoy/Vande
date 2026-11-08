/**
 * The exact-ball coach (src/practice/coach) as the flow sees it, bound in ../ports.ts: the analysis of a played ball
 * with real alternative responses from the same physics, the one primary insight, the comparison between attempts,
 * the mastery rule (never one lucky result) and the form report (demonstrated skill only).
 */
import type {
  AssistanceStage,
  AttemptComparison,
  CoachAnalysis,
  CoachOption,
  CoachOptionKind,
  CoachRecommendation,
  DeliveryRecord,
  DeliveryResult,
  FormReport,
  MasteryState,
  PrimaryInsight,
} from '@/contracts';
import type { CoachTip, TipTranslator } from '@/practice/coach';

/**
 * The dead-ball tip (src/practice/coach tip.ts): the card's one recommendation (`action`, exactly
 * primaryInsight().recommendation) and the measured fact that explains it, closed data only (words in the UI).
 */
export type CoachTipLike = CoachTip;

/** The tip in words: the whole sentence ("<fact>: <action>."), and its fact and action clauses as they appear in it. */
export interface TipWordsLike {
  sentence: string;
  fact: string;
  action: string;
}

/** src/practice/coach FormSample: compact, versioned JSON (no gestures, no timestamps). */
export interface FormSampleLike {
  readonly v: number;
}

interface MasteryProgressLike {
  stage: AssistanceStage;
  /** Consecutive successes at this stage. */
  streak: number;
  /** Successes in a row still needed to move on (0 when mastered). */
  neededToAdvance: number;
  stageAttempts: number;
  /** At the last stage: successes among its recent attempts (out of recentWindow); null before it. */
  recentSuccesses: number | null;
  recentWindow: number;
  mastered: boolean;
}

export interface CoachKit {
  analyzeBall(record: DeliveryRecord, result: DeliveryResult): CoachAnalysis;
  /** The same analysis, yielding between batches so the main thread stays free (abortable; `yieldTo` decides how it yields). */
  analyzeBallInSlices(
    record: DeliveryRecord,
    result: DeliveryResult,
    opts?: { sliceMs?: number; signal?: AbortSignal; yieldTo?: () => Promise<void> },
  ): Promise<CoachAnalysis>;
  /** options[0] is always the recommended response; a merged kind resolves to the option it duplicates. */
  optionOf(analysis: CoachAnalysis, kind: CoachOptionKind): CoachOption;
  primaryInsight(analysis: CoachAnalysis): PrimaryInsight;
  /** The card's one sentence for an analysed record (pass that record's own analysis): a measured fact and one action. */
  coachTip(record: DeliveryRecord, analysis: CoachAnalysis): CoachTipLike;
  /** The tip in the player's language (the translator is the Practice catalog's). */
  tipWords(t: TipTranslator, tip: CoachTipLike): TipWordsLike;
  /**
   * May the card confirm (praise) this recommendation for this attempt? Not when the stroke carried a risk the
   * recommended response does not (anti-fake rule 7), and, given the attempt's tip, not when the contact itself was a
   * slow fend, the toe or off the sweet zone (measured, never the contact label): then no "well played", no "the same
   * again", no confirming tick or green.
   */
  praiseEarned(
    analysis: CoachAnalysis,
    recommendation: Pick<CoachRecommendation, 'kind'>,
    tip?: Pick<CoachTipLike, 'fact'> | null,
  ): boolean;
  /** `clean`: each attempt's measured clean contact (its tip's cleanContact), so "Clean contact this time" and 'better' follow the measurement. */
  compareAttempts(
    previous: CoachAnalysis,
    next: CoachAnalysis,
    clean?: { previous?: boolean | null; next?: boolean | null },
  ): AttemptComparison;
  masteryKey(record: DeliveryRecord): string;
  startMastery(key: string): MasteryState;
  /** `tip`: the attempt's tip, whose measured clean contact decides a stroke's success (a slow fend never counts). */
  recordAttempt(
    state: MasteryState,
    analysis: CoachAnalysis,
    stage: AssistanceStage,
    tip?: { cleanContact?: boolean | null } | null,
  ): MasteryState;
  masteryProgress(state: MasteryState): MasteryProgressLike;
  masteryEvent(prev: MasteryState, next: MasteryState): 'stage_up' | 'mastered' | null;
  /** Compact evidence of one ball (the record and result carry the bowler, the field and the bat face). */
  formSample(
    input: { record: DeliveryRecord; result: DeliveryResult; analysis: CoachAnalysis },
    context: { source: 'innings' } | { source: 'mastery'; stage: AssistanceStage },
  ): FormSampleLike;
  /** Skips anything that is not a sample of this version, so stored samples can be passed straight in. */
  formFromAttempts(samples: readonly unknown[]): FormReport;
}
