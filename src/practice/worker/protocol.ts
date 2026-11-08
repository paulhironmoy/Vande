/**
 * The Practice work thread's messages (src/practice/worker/practice.worker.ts ⇄ src/practice/ui/flow/offThread.ts).
 *
 * The worker runs the same physics and coach functions the main thread binds in src/practice/ui/ports.ts, on the same
 * inputs, so its answers are the main thread's answers (anti-fake rule 3). Everything crossing is plain data (the
 * structured clone keeps -0, key order and shared objects). Every message is answered or failed: the main thread
 * never waits on a request the worker dropped, and it computes locally whenever the worker cannot answer.
 */
import type {
  AssistanceStage,
  CoachAnalysis,
  CoachOption,
  DeliveryRecord,
  DeliveryResult,
  NormalizedSwing,
} from '@/contracts';
import type { CoachTipLike, FormSampleLike, ResolveArgs } from '@/practice/ui/flow/types';

/** Bumped whenever a message changes shape; both ends must agree or the main thread works alone. */
export const WORK_PROTOCOL = 1;

/** One ball's physics before its swing is known: an innings ball's arguments, or the exact ball of a record. */
export type BallJob =
  { kind: 'resolve'; args: Omit<ResolveArgs, 'swing'> } | { kind: 'repeat'; source: DeliveryRecord };

/** The coach's form evidence context (src/practice/coach FormContext). */
export type FormContextLike = { source: 'innings' } | { source: 'mastery'; stage: AssistanceStage };

/** What a reading should also produce besides the analysis (each one costs the coach a simulation). */
export interface AnalyzeWant {
  /** The card's one sentence (coachTip). */
  tip: boolean;
  /** The ball's form evidence (formSample), or none. */
  sample: FormContextLike | null;
  /** The recommended response on this exact ball (repeatDelivery(record, recommended.swing)): the demonstration. */
  guide: boolean;
}

export interface AnalyzeOutput {
  analysis: CoachAnalysis;
  /** Null when the tip could not be formed (the card then words the insight alone), or was not asked for. */
  tip: CoachTipLike | null;
  sample: FormSampleLike | null;
  /** Null when not asked for or when it could not be simulated (the flow then simulates it when it is needed). */
  guide: { option: CoachOption; result: DeliveryResult } | null;
}

export type ToWorker =
  | { t: 'hello'; build: string; sim: number; protocol: number }
  /** A throwaway resolution of a coming ball, so first-use cost never lands on a real swing. */
  | { t: 'warm'; job: BallJob }
  /** The ball about to be bowled. Until it is resolved or released the worker starts no coach simulation. */
  | { t: 'prepare'; ball: number; job: BallJob }
  | { t: 'resolve'; ball: number; swing: NormalizedSwing | null }
  /** The ball will not be resolved here (abandoned, or resolved on the main thread). */
  | { t: 'release'; ball: number }
  /**
   * A reading. `result` is the record's result as the main thread holds it, or null when `ball` names one this
   * worker resolved and still keeps (the same data, so it is not sent again).
   */
  | {
      t: 'analyze';
      job: number;
      record: DeliveryRecord;
      result: DeliveryResult | null;
      ball: number | null;
      want: AnalyzeWant;
    }
  | { t: 'abort'; job: number };

export type FromWorker =
  | { t: 'hello'; build: string; sim: number; protocol: number }
  | { t: 'warmed'; ms: number }
  | { t: 'prepared'; ball: number; warmMs: number | null }
  | { t: 'resolved'; ball: number; result: DeliveryResult; ms: number }
  | { t: 'analyzed'; job: number; out: AnalyzeOutput; ms: number }
  | { t: 'aborted'; job: number }
  | { t: 'failed'; ball: number | null; job: number | null; error: string };

/** How many resolved results the worker keeps for their readings (the client mirrors the same rule). */
export const KEPT_RESULTS = 4;
