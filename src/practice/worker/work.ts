/**
 * The work both threads do, written once. The worker (./host.ts) and the main thread's fallback (src/practice/ui/flow)
 * call these same functions with the same kit bindings (src/practice/ui/ports.ts binds the main thread's, ./kit.ts the
 * worker's, both straight to src/physics, src/practice/game and src/practice/coach), so a result never depends on
 * which thread computed it (anti-fake rule 3).
 */
import type {
  CoachAnalysis,
  CoachOption,
  CoachOptionKind,
  DeliveryRecord,
  DeliveryResult,
  NormalizedSwing,
} from '@/contracts';
import type { CoachTipLike, FormSampleLike, ResolveArgs } from '@/practice/ui/flow/types';
import type { AnalyzeOutput, AnalyzeWant, BallJob, FormContextLike } from './protocol';

/** The physics a ball needs (src/physics resolveDelivery, src/practice/game repeatDelivery). */
export interface BallKit {
  resolveDelivery(args: ResolveArgs): DeliveryResult;
  repeatDelivery(record: DeliveryRecord, swing: NormalizedSwing | null): DeliveryResult;
}

/** The coach a reading needs (src/practice/coach), plus repeatDelivery for the demonstration. */
export interface ReadKit {
  analyzeBallInSlices(
    record: DeliveryRecord,
    result: DeliveryResult,
    opts?: { sliceMs?: number; signal?: AbortSignal; yieldTo?: () => Promise<void> },
  ): Promise<CoachAnalysis>;
  coachTip(record: DeliveryRecord, analysis: CoachAnalysis): CoachTipLike;
  formSample(
    input: { record: DeliveryRecord; result: DeliveryResult; analysis: CoachAnalysis },
    context: FormContextLike,
  ): FormSampleLike;
  optionOf(analysis: CoachAnalysis, kind: CoachOptionKind): CoachOption;
  repeatDelivery(record: DeliveryRecord, swing: NormalizedSwing | null): DeliveryResult;
}

/** The ball's result for this swing: exactly the call src/practice/ui/flow/delivery.ts made in one frame before. */
export function resolveBall(kit: BallKit, job: BallJob, swing: NormalizedSwing | null): DeliveryResult {
  if (job.kind === 'repeat') return kit.repeatDelivery(job.source, swing);
  const a = job.args;
  // The same argument object, key for key, as the flow's own call.
  return kit.resolveDelivery({
    flight: a.flight,
    swing,
    field: a.field,
    bowler: a.bowler,
    conditions: a.conditions,
    handedness: a.handedness,
    assist: a.assist,
    tierToleranceMs: a.tierToleranceMs,
  });
}

/** A swing that exercises the bat, contact and fielding (warming only; its result is thrown away). */
export function warmSwing(job: BallJob): NormalizedSwing {
  const flight = job.kind === 'resolve' ? job.args.flight : null;
  const ideal = flight?.idealContactT ?? 0.6;
  return {
    kind: 'attack',
    startT: Math.max(0, ideal - 0.14),
    directionDeg: 20,
    power: 0.6,
    elevation: 0,
    footwork: 'auto',
  };
}

/** A key for a demonstration: the exact delivery of a record and the response played on it. */
export function guideKey(record: DeliveryRecord, swing: NormalizedSwing | null): string {
  const { swing: _played, runs: _runs, dismissal: _dismissal, ...delivery } = record;
  return JSON.stringify([delivery, swing]);
}

/**
 * The coach's reading of a record: its analysis (in slices: `opts` decides only when to yield, never what is
 * simulated), then what was asked for, in the order the flow has always formed them (sample, tip, guide), each after
 * a yield of its own (a cancelled reading stops there). The tip and
 * the guide never fail a reading (the card words the insight alone; the demonstration is simulated when it is needed);
 * a sample that cannot be formed fails it, as it always has.
 */
export async function readRecord(
  kit: ReadKit,
  record: DeliveryRecord,
  result: DeliveryResult,
  want: AnalyzeWant,
  opts: { sliceMs: number; signal?: AbortSignal; yieldTo?: () => Promise<void> },
): Promise<AnalyzeOutput> {
  const analysis = await kit.analyzeBallInSlices(record, result, opts);
  // Each of the extras below is a simulation of its own: yield before each, as the analysis does between its own.
  const next = async () => {
    if (opts.signal?.aborted) {
      const e = new Error('coach: reading cancelled');
      e.name = 'AbortError';
      throw e;
    }
  };
  const step = async () => {
    await next();
    await opts.yieldTo?.();
    await next();
  };
  await next();
  if (want.sample) await step();
  const sample = want.sample ? kit.formSample({ record, result, analysis }, want.sample) : null;
  let tip: CoachTipLike | null = null;
  if (want.tip) {
    await step();
    try {
      tip = kit.coachTip(record, analysis);
    } catch {
      tip = null;
    }
  }
  let guide: AnalyzeOutput['guide'] = null;
  if (want.guide) {
    await step();
    try {
      const option = kit.optionOf(analysis, 'recommended');
      guide = { option, result: kit.repeatDelivery(record, option.swing) };
    } catch {
      guide = null;
    }
  }
  return { analysis, tip, sample, guide };
}
