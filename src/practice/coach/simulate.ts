/**
 * The candidate responses, each a real resolveDelivery simulation against the exact delivery, and the execution spread
 * around the most promising ones (docs/PRACTICE_COACH.md, "Risk and expected runs"). Nothing is looked up or invented:
 * every outcome counted here is the physics' own result for that swing.
 *
 * The work is a generator that yields after every simulation, so analyzeBall drains it in one go and
 * analyzeBallInSlices spreads it over idle time; both produce the identical, deterministic result.
 */
import type { ContactKind, DeliveryResult, Footwork, NormalizedSwing, PlayedFootwork } from '@/contracts/practice';
import { resolveDelivery, type ResolveArgs } from '@/physics';
import { swingOf, type Candidate } from './candidates';
import { ORTHODOXY, isOrthodox, withTheLine } from './cricket';
import type { BallFacts } from './facts';
import { intoProtected, type CoachField } from './field';
import { inferRead } from './read';

/**
 * The execution spread every finalist is judged over (docs/PRACTICE_COACH.md, "Risk and expected runs"): a player's
 * real timing error, Gaussian with sigma timingSigmaMs (the examiners' human-timing model), whatever the assistance
 * level's label bands (lead ruling 2026-11-03), and an aim error of ±aimDeg. Dense (evaluator finding D-1, lead ruling
 * 2026-11-03): the timing is sampled every 5 ms (a quarter sigma) across ±2σ (−40…+40 ms), so a narrow failure band
 * between the old points (0, ±20, ±40 ms, still a subset) cannot hide behind a "0% risk"; the aim offsets are sampled
 * every half sigma (10 ms) within ±1σ. Each point is a real simulation, weighted by its Gaussian timing weight times
 * its aim weight, so a displayed risk is the weighted estimate over the dense grid.
 */
export const EXECUTION_SPREAD = {
  timingSigmaMs: 20,
  /**
   * Timing offsets in sigmas (every quarter sigma, 5 ms) and their Gaussian weights exp(−k²/2), written out so every
   * engine weighs them bit-identically (normalised over the points used). Mirrored for −k.
   */
  timing: [
    { k: 0, w: 1 },
    { k: 0.25, w: 0.9692332344763441 },
    { k: 0.5, w: 0.8824969025845955 },
    { k: 0.75, w: 0.7548396019890073 },
    { k: 1, w: 0.6065306597126334 },
    { k: 1.25, w: 0.45783336177161427 },
    { k: 1.5, w: 0.32465246735834974 },
    { k: 1.75, w: 0.21626516682988728 },
    { k: 2, w: 0.1353352832366127 },
  ],
  aimDeg: 10,
  /** Aim weights: the intended direction, and each side. */
  aimWeights: { centre: 0.5, side: 0.25 },
  /** Aim offsets are sampled every half sigma (10 ms) within this many sigmas: the corners matter least. */
  aimWithinSigmas: 1,
} as const;

/** How many attacking candidates get the full spread: correct cricket first, then the rest by runs. */
export const FINALISTS = { orthodox: 4, open: 3 } as const;

/** Weighted over the execution spread (weights sum to w), plus counts of what happened anywhere in it. */
export interface Tally {
  /** Total weight. */
  w: number;
  /** Weight dismissed, runs (weighted; a dismissal counts none), weight off the middle of the bat or a clean leave. */
  out: number;
  runs: number;
  clean: number;
  /** Points (not weights) that edged, were caught, bowled or LBW anywhere in the spread. */
  edges: number;
  caught: number;
  bowled: number;
  lbw: number;
}

/**
 * The only authoritative result fields Coach reads. Keeping this projection in the per-delivery memo avoids retaining
 * every simulated ball/fielding trace while still making a repeated exact swing genuinely free.
 */
export type CoachResult = Pick<DeliveryResult, 'contact' | 'outcome' | 'footwork' | 'coaching'>;

export interface Evaluated {
  c: Candidate;
  swing: NormalizedSwing | null;
  /** The ideal (centre) point: what the option shows and demonstrates. */
  centre: CoachResult;
  played: PlayedFootwork;
  orthodox: boolean;
  /** Not across the line or the movement (whatever the length and elevation). */
  withLine: boolean;
  /** The coach's own read of this response at its ideal point finds no misread (line, length, pace, movement, bounce). */
  readOk: boolean;
  protectedAim: boolean;
  /** Over the execution spread, centre included (null for candidates that did not reach the final). */
  tally: Tally | null;
  /**
   * The tally is over the dense spread (densify); otherwise over its coarse subset (0, ±1σ, ±2σ at the intended aim),
   * which only screens: every option shown is densified before it is shown (analyze.ts certify).
   */
  dense?: boolean;
}

export interface SimContext {
  /** Everything resolveDelivery needs except the swing (the record's delivery, field, ball and settings). */
  args: Omit<ResolveArgs, 'swing'>;
  ideal: Record<Footwork, number>;
  facts: BallFacts;
  field: CoachField;
  candidates: Candidate[];
  /** Compact exact results already resolved for this delivery, keyed only by the complete normalized swing. */
  results: Map<string, CoachResult>;
}

/**
 * One cold analysis is about 200–330 exact swings since the dense spread (the grid, the finalists' coarse spreads, the
 * shown options' dense spreads, the attempt's own dense spread); leave headroom for several repeat attempts without
 * unbounded RAM.
 */
export const COACH_RESULT_CACHE_SIZE = 512;

/** Complete, order-independent identity of one normalized input. Exported so the cache contract is unit-tested. */
export const coachResultKey = (swing: NormalizedSwing | null): string =>
  JSON.stringify(
    swing === null
      ? null
      : [swing.kind, swing.startT, swing.directionDeg, swing.power, swing.elevation, swing.footwork],
  );

/** Internal deterministic LRU seam: tests prove hits are exact and eviction causes one honest re-simulation. */
export function memoCoachResult(
  results: Map<string, CoachResult>,
  key: string,
  simulate: () => CoachResult,
): CoachResult {
  const hit = results.get(key);
  if (hit) {
    results.delete(key);
    results.set(key, hit);
    return hit;
  }
  const result = simulate();
  results.set(key, result);
  if (results.size > COACH_RESULT_CACHE_SIZE) results.delete(results.keys().next().value as string);
  return result;
}

/** Resolve an exact swing once for this delivery, retaining only the fields the Coach is allowed to read. */
export function resolveCoach(ctx: SimContext, swing: NormalizedSwing | null): CoachResult {
  const key = coachResultKey(swing);
  return memoCoachResult(ctx.results, key, () => {
    const resolved = resolveDelivery({ ...ctx.args, swing });
    return {
      contact: resolved.contact,
      outcome: resolved.outcome,
      footwork: resolved.footwork,
      coaching: resolved.coaching,
    };
  });
}

const EDGES: ReadonlySet<ContactKind> = new Set<ContactKind>([
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);

function emptyTally(): Tally {
  return { w: 0, out: 0, runs: 0, clean: 0, edges: 0, caught: 0, bowled: 0, lbw: 0 };
}

/** Count one simulated result into a tally with its weight. */
function addResult(t: Tally, r: CoachResult, leave: boolean, weight = 1): void {
  const d = r.outcome.dismissal;
  t.w += weight;
  if (d) t.out += weight;
  else t.runs += weight * r.outcome.runs;
  if (r.contact.kind === 'middle' || (leave && r.contact.kind === 'leave')) t.clean += weight;
  if (EDGES.has(r.contact.kind)) t.edges++;
  if (d === 'caught' || d === 'caught_behind') t.caught++;
  if (d === 'bowled') t.bowled++;
  if (d === 'lbw') t.lbw++;
}

export interface SpreadPoint {
  dtMs: number;
  aimDeg: number;
  weight: number;
}

/**
 * The execution spread of a candidate, centre first (weights unnormalised; the tally normalises): every 5 ms across ±2σ
 * of the human error model, never clipped to a label band, with the aim offsets at every timing within ±1σ. A block is
 * a straight tap (timing only) and the leave has no spread. A stroke has 27 points (17 at its aim, 5 at each aim
 * offset), a block 17.
 */
export function spreadOf(c: Candidate, density: 'dense' | 'coarse' = 'dense'): SpreadPoint[] {
  const sp = EXECUTION_SPREAD;
  const dt = (k: number) => Math.round(k * sp.timingSigmaMs * 10) / 10 || 0;
  if (c.kind === null) return [{ dtMs: 0, aimDeg: 0, weight: 1 }];
  const aims = c.decision === 'attack' ? [0, -sp.aimDeg, sp.aimDeg] : [0];
  // Centre first, then +k and −k outwards (the order only decides which points are simulated first).
  const ks: Array<{ k: number; w: number }> = [];
  for (const t of sp.timing) {
    // The coarse subset (whole sigmas, 0, ±20 and ±40 ms, at the intended aim) only screens the finalists: every option
    // shown is certified on the dense grid (analyze.ts certify), so the screen need not sample the aim error.
    if (density === 'coarse' && !Number.isInteger(t.k)) continue;
    ks.push(t);
    if (t.k !== 0) ks.push({ k: -t.k, w: t.w });
  }
  const out: SpreadPoint[] = [];
  for (const { k, w } of ks) {
    for (const a of aims) {
      // The aim error is sampled every half sigma (10 ms) within ±1σ: the timing band is where a narrow failure hides.
      if (a !== 0 && (density === 'coarse' || Math.abs(k) > sp.aimWithinSigmas || !Number.isInteger(k * 2))) continue;
      const wa = aims.length === 1 ? 1 : a === 0 ? sp.aimWeights.centre : sp.aimWeights.side;
      out.push({ dtMs: dt(k), aimDeg: a, weight: w * wa });
    }
  }
  return out;
}

const centreOk = (e: Evaluated) => !e.centre.outcome.dismissal && e.centre.contact.kind === 'middle';
const byRuns = (a: Evaluated, b: Evaluated) => b.centre.outcome.runs - a.centre.outcome.runs || a.c.index - b.c.index;

/** Which candidates get the spread: the leave and the blocks always; the best attacking strokes (correct cricket, then the highest-scoring strokes that play with the line). */
export function finalists(all: Evaluated[]): Evaluated[] {
  const base = all.filter((e) => e.c.decision !== 'attack');
  const attacks = all.filter((e) => e.c.decision === 'attack' && centreOk(e));
  let correct = attacks
    .filter((e) => e.orthodox && !e.protectedAim)
    .sort(byRuns)
    .slice(0, FINALISTS.orthodox);
  if (correct.length === 0)
    correct = attacks
      .filter((e) => e.orthodox)
      .sort(byRuns)
      .slice(0, 2);
  const chosen = new Set(correct);
  const open = attacks
    .filter((e) => !chosen.has(e) && e.readOk)
    .sort(byRuns)
    .slice(0, FINALISTS.open);
  return [...base, ...correct, ...open];
}

/** The player's own stroke judged like a finalist: re-timed to its ideal, over the same execution spread. */
export interface AttemptJudgement {
  tally: Tally;
  protectedAim: boolean;
}

/**
 * The attempt's stroke (its kind, direction, elevation, power and footwork) as a candidate, re-timed to the ideal for
 * its footwork and judged over the execution spread: the evidence for 'well_played' and for why a good outcome was
 * lucky. Null for a leave. Yields after each simulation.
 */
export function* judgeAttempt(
  ctx: SimContext,
  swing: NormalizedSwing | null,
): Generator<void, AttemptJudgement | null, void> {
  if (!swing) return null;
  const c: Candidate = {
    id: 'attempt',
    index: Number.MAX_SAFE_INTEGER,
    decision: swing.kind,
    kind: swing.kind,
    footwork: swing.footwork,
    directionDeg: swing.directionDeg,
    elevation: swing.elevation,
    power: swing.power,
  };
  const t = emptyTally();
  for (const p of spreadOf(c)) {
    const spreadSwing = swingOf(c, ctx.ideal, p.dtMs, p.aimDeg);
    const cached = ctx.results.has(coachResultKey(spreadSwing));
    addResult(t, resolveCoach(ctx, spreadSwing), false, p.weight);
    if (!cached) yield;
  }
  const lofted = c.elevation >= ORTHODOXY.loftedFromElevation;
  return { tally: t, protectedAim: c.decision === 'attack' && intoProtected(ctx.field, c.directionDeg, lofted) };
}

/** Simulate the whole grid, then the finalists' execution spreads. Yields after each simulation. */
export function* evaluate(ctx: SimContext): Generator<void, Evaluated[], void> {
  const all: Evaluated[] = [];
  for (const c of ctx.candidates) {
    const swing = swingOf(c, ctx.ideal);
    const cached = ctx.results.has(coachResultKey(swing));
    const centre = resolveCoach(ctx, swing);
    const lofted = c.elevation >= ORTHODOXY.loftedFromElevation;
    all.push({
      c,
      swing,
      centre,
      played: centre.footwork,
      orthodox: isOrthodox(
        {
          decision: c.decision,
          footwork: c.footwork,
          played: centre.footwork,
          directionDeg: c.directionDeg,
          elevation: c.elevation,
        },
        ctx.facts,
      ),
      withLine: withTheLine(c, ctx.facts),
      readOk: Object.values(inferRead(ctx.facts, swing, centre)).every((v) => v !== 'wrong'),
      protectedAim: c.decision === 'attack' && intoProtected(ctx.field, c.directionDeg, lofted),
      tally: null,
    });
    if (!cached) yield;
  }
  // The finalists are screened on the coarse subset of the spread; the options shown are densified (densify).
  for (const e of finalists(all)) yield* tallyOver(ctx, e, 'coarse');
  return all;
}

/** A candidate's tally over its spread at a density. Yields after each new simulation. */
function* tallyOver(ctx: SimContext, e: Evaluated, density: 'dense' | 'coarse'): Generator<void, void, void> {
  const t = emptyTally();
  const leave = e.c.kind === null;
  for (const p of spreadOf(e.c, density)) {
    const spreadSwing = swingOf(e.c, ctx.ideal, p.dtMs, p.aimDeg);
    const cached = (p.dtMs === 0 && p.aimDeg === 0) || ctx.results.has(coachResultKey(spreadSwing));
    const r = p.dtMs === 0 && p.aimDeg === 0 ? e.centre : resolveCoach(ctx, spreadSwing);
    addResult(t, r, leave, p.weight);
    if (!cached) yield;
  }
  e.tally = t;
  e.dense = density === 'dense';
}

/**
 * Certify a finalist on the dense spread (every 5 ms across ±2σ; evaluator finding D-1): its tally, its risk and
 * worksAcrossSpread are then the weighted dense estimate. Its coarse points are already in the exact-result memo.
 */
export function* densify(ctx: SimContext, e: Evaluated): Generator<void, void, void> {
  if (e.dense || e.tally === null) return;
  yield* tallyOver(ctx, e, 'dense');
}
