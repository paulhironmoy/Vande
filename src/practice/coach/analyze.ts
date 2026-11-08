/**
 * analyzeBall: the exact-ball Coach Mode analysis of one delivery (docs/PRACTICE_COACH.md). What the ball did comes
 * from its flight, what the player attempted and read from their swing and its result, and the recommended, safest
 * and higher-scoring responses from real resolveDelivery simulations of alternative swings against the same delivery.
 *
 * Deterministic in the record: the delivery is rebuilt from the record (practiceFlight reads its ball, so a worn ball's
 * smaller swing is what is analysed), the attempt is the record's swing re-simulated, and the alternatives depend only
 * on the delivery, never on the swing, the innings, the player's form or any difficulty setting beyond the assistance
 * the record was played with.
 */
import {
  PRACTICE_SIM_VERSION,
  type CoachAnalysis,
  type CoachOption,
  type DeliveryRecord,
  type DeliveryResult,
  type NormalizedSwing,
} from '@/contracts/practice';
import { practiceFlight } from '@/physics';
import { candidatesFor, idealTimes } from './candidates';
import { analysisBall, ballFacts, type BallFacts } from './facts';
import { coachField, type CoachField } from './field';
import { optionsFrom, pick, toSpread, type Picks } from './options';
import { inferRead, whyOf } from './read';
import { tipOf, type CoachTip } from './tip';
import {
  densify,
  evaluate,
  judgeAttempt,
  resolveCoach,
  type AttemptJudgement,
  type CoachResult,
  type Evaluated,
  type SimContext,
} from './simulate';

interface Delivery {
  facts: BallFacts;
  field: CoachField;
  ctx: SimContext;
  options: CoachOption[] | null;
}

/** Analysed deliveries kept for repeats (the alternatives of an exact ball never change). */
const CACHE_SIZE = 16;
const cache = new Map<string, Delivery>();

/** Everything that defines the delivery and its physics, and nothing about the swing. */
function deliveryKey(r: DeliveryRecord): string {
  return JSON.stringify([
    r.version,
    r.seed,
    r.plan,
    r.bowler,
    r.conditions,
    r.ball ?? null,
    r.field,
    r.handedness,
    r.assist,
    r.tierToleranceMs,
  ]);
}

function deliveryOf(record: DeliveryRecord): Delivery {
  const key = deliveryKey(record);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const flight = practiceFlight(record);
  const facts = ballFacts(flight, record.bowler.family);
  const field = coachField(record);
  const ctx: SimContext = {
    args: {
      flight,
      field: record.field,
      bowler: record.bowler,
      conditions: record.conditions,
      handedness: record.handedness,
      assist: record.assist,
      tierToleranceMs: record.tierToleranceMs,
    },
    ideal: idealTimes(flight),
    facts,
    field,
    candidates: candidatesFor(facts, field),
    results: new Map(),
  };
  const d: Delivery = { facts, field, ctx, options: null };
  cache.set(key, d);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return d;
}

/**
 * The attempt's result is always resolved from the record, never trusted from the caller. The first exact swing is a
 * real simulation; repeats reuse the delivery's compact exact-result memo. The analysis therefore depends on the
 * record alone, and a stale or foreign result can never leak into it.
 */
function attemptOf(d: Delivery, record: DeliveryRecord): CoachResult {
  return resolveCoach(d.ctx, record.swing);
}

/** Plain data copied exactly (options are cached; every analysis gets its own). */
function copy<T>(v: T): T {
  if (Array.isArray(v)) return v.map(copy) as T;
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)])) as T;
  return v;
}

/** One decimal, never negative zero (records and analyses compare byte for byte through JSON). */
const round1 = (v: number) => Math.round(v * 10) / 10 || 0;

function attemptedOf(
  swing: NormalizedSwing | null,
  r: CoachResult,
  judged: AttemptJudgement | null,
): CoachAnalysis['attempted'] {
  return {
    decision: swing === null ? 'leave' : swing.kind,
    footwork: r.footwork,
    directionDeg: swing ? swing.directionDeg : null,
    elevation: swing ? swing.elevation : null,
    power: swing ? swing.power : null,
    timingErrorMs: r.contact.timingErrorMs === null ? null : round1(r.contact.timingErrorMs),
    contact: r.contact.kind,
    timing: r.contact.timing,
    runs: r.outcome.runs,
    dismissal: r.outcome.dismissal,
    spread: toSpread(judged),
  };
}

function assemble(
  d: Delivery,
  record: DeliveryRecord,
  attempt: CoachResult,
  judged: AttemptJudgement | null,
): CoachAnalysis {
  const read = inferRead(d.facts, record.swing, attempt);
  return {
    version: PRACTICE_SIM_VERSION,
    ball: analysisBall(d.facts),
    read,
    attempted: attemptedOf(record.swing, attempt, judged),
    why: whyOf(d.facts, record.swing, attempt, read),
    options: copy(d.options!),
  };
}

/**
 * The picks, certified on the dense spread: pick on the current tallies, densify every option that would be shown
 * (recommended, safest, higher-scoring), and pick again until every shown option's tally is dense. A finalist rejected
 * on its coarse screen fails densely too for robustness (its points are a subset of the dense grid); every displayed
 * risk, expected runs and "works across the spread" is the weighted dense estimate (evaluator finding D-1).
 */
function* certify(ctx: SimContext, all: Evaluated[]): Generator<void, Picks, void> {
  for (;;) {
    const p = pick(all);
    const shown = [p.recommended, p.safest, p.higherScoring].filter(
      (e): e is Evaluated => e !== null && e.tally !== null && !e.dense,
    );
    if (shown.length === 0) return p;
    for (const e of shown) yield* densify(ctx, e);
  }
}

function finish(d: Delivery, picks: Picks): void {
  d.options = optionsFrom(picks);
}

/**
 * The full analysis of a delivery and the player's attempt at it (record.swing; null = left). Synchronous: about
 * 100 ms the first time a delivery is analysed (docs/PRACTICE_COACH.md, "Cost"), about 12 ms for a repeat of it (the
 * attempt itself and its stroke judged over the execution spread; exact swings already seen in the delivery analysis
 * are reused from the compact memo).
 * The attempt's DeliveryResult may be passed for convenience but is never trusted: the record's swing is always
 * re-simulated, so the same record gives the same analysis byte for byte.
 */
/** Run a generator to its end without yielding to the event loop. */
function drain<T>(gen: Generator<void, T, void>): T {
  let step = gen.next();
  while (!step.done) step = gen.next();
  return step.value;
}

export function analyzeBall(record: DeliveryRecord, _result?: DeliveryResult | null): CoachAnalysis {
  const d = deliveryOf(record);
  if (!d.options) finish(d, drain(certify(d.ctx, drain(evaluate(d.ctx)))));
  return assemble(d, record, attemptOf(d, record), drain(judgeAttempt(d.ctx, record.swing)));
}

export interface SliceOptions {
  /** Work for at most about this long before yielding to the event loop (ms, default 8). */
  sliceMs?: number;
  /** Abandons the analysis (the promise rejects with an AbortError). */
  signal?: AbortSignal;
  /** How to yield (default: scheduler.yield where available, else a zero timeout). */
  yieldTo?: () => Promise<void>;
}

function defaultYield(): Promise<void> {
  const s = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (s && typeof s.yield === 'function') return s.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function abortIf(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const e = new Error('coach: analysis aborted');
  e.name = 'AbortError';
  throw e;
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * The same analysis, computed in slices so the dead-ball screen stays responsive: identical (byte for byte) to
 * analyzeBall. Slicing only decides when to yield, never what is simulated.
 */
export async function analyzeBallInSlices(
  record: DeliveryRecord,
  _result?: DeliveryResult | null,
  opts: SliceOptions = {},
): Promise<CoachAnalysis> {
  const sliceMs = opts.sliceMs ?? 8;
  const yieldTo = opts.yieldTo ?? defaultYield;
  abortIf(opts.signal);
  const d = deliveryOf(record);
  let t0 = now();
  /** Run a generator, yielding to the event loop whenever the slice is used up. */
  async function sliced<T>(gen: Generator<void, T, void>): Promise<T> {
    let step = gen.next();
    while (!step.done) {
      if (now() - t0 >= sliceMs) {
        await yieldTo();
        abortIf(opts.signal);
        t0 = now();
      }
      step = gen.next();
    }
    return step.value;
  }
  if (!d.options) {
    const all = await sliced(evaluate(d.ctx));
    const picks = await sliced(certify(d.ctx, all));
    if (!d.options) finish(d, picks);
  }
  const judged = await sliced(judgeAttempt(d.ctx, record.swing));
  abortIf(opts.signal);
  return assemble(d, record, attemptOf(d, record), judged);
}

/**
 * The dead-ball tip for an attempt (tip.ts): the card's one recommendation and the measured fact that explains it, as
 * one sentence. Pass the record's analysis when it is already done (analyzeBall or analyzeBallInSlices; it must be the
 * analysis of this record); the attempt's contact facts (bat face, intended line, where the ball went) come from the
 * coach's own re-simulation of the record's swing, which the analysis has already memoised, so this costs nothing
 * more. Never from a result a caller hands in.
 */
export function coachTip(record: DeliveryRecord, analysis?: CoachAnalysis): CoachTip {
  const an = analysis ?? analyzeBall(record);
  const d = deliveryOf(record);
  return tipOf(an, d.facts, attemptOf(d, record));
}

/** Forget the analysed deliveries (tests and memory pressure). */
export function clearCoachCache(): void {
  cache.clear();
}
