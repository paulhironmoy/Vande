/**
 * Scores derived from a finished match (engine v1): the Daily Six score and the per-match performance components used
 * by the Daily Top 100 (tactical efficiency, clutch, execution). All values are documented in docs/GAME_RULES.md.
 */
import type { BallOutcome, Conditions, DeliveryVariant, FieldSetting, FieldZone, InningsSummary, MatchEventLog, ShotType, TimingGrade } from '@/contracts';
import { SUPER_BALL_INDEX } from '@/contracts/cricket';
import { energyCost } from './plan';
import { evaluate, type BallContext, type DeliveryCore } from './model';
import { contextFor } from './resolve';
import { ALLOWED_LENGTHS, INTENSITIES, LEGAL_ZONES, LINES, SHOTS, VARIANTS } from './tables';

/** Daily Six score: 10 per run, +4 per four, +8 per six, +12 per wicket still in hand. */
export function dailyScore(summary: InningsSummary): number {
  let fours = 0;
  let sixes = 0;
  for (const b of summary.balls) {
    if (b.runs === 4) fours++;
    else if (b.runs === 6) sixes++;
  }
  return 10 * summary.runs + 4 * fours + 8 * sixes + 12 * Math.max(0, 2 - summary.wickets);
}

const TIMING_SCORE: Record<TimingGrade, number> = {
  perfect: 1,
  good: 0.75,
  early: 0.35,
  late: 0.35,
  very_early: 0.1,
  very_late: 0.1,
  no_shot: 0,
  interrupted: 0,
};

/** Wicket cost in runs for decision quality: losing the last wicket costs the rest of the innings. */
export function wicketCost(ctx: BallContext, wicketsDown: number): number {
  if (ctx.lastBall) return 0;
  const after = 5 - ctx.ball;
  return wicketsDown >= 1 ? 1.9 * after : 0.6 * after;
}

interface Option {
  shot: ShotType;
  zone: FieldZone | null;
}

const OPTIONS: readonly Option[] = SHOTS.flatMap((shot): Option[] =>
  LEGAL_ZONES[shot].length === 0 ? [{ shot, zone: null }] : LEGAL_ZONES[shot].map((zone) => ({ shot, zone })),
);

function optionValue(d: DeliveryCore, grade: BallOutcome['executionGrade'], o: Option, field: FieldSetting, cond: Conditions, ctx: BallContext, lambda: number): number {
  const ev = evaluate({ d, grade, shot: o.shot, zone: o.zone, timing: o.shot === 'leave' ? 'no_shot' : 'good', field, cond, ctx });
  return ev.expectedRuns - lambda * ev.pWicket;
}

/** Best and worst option values for the batter facing `d` (good timing assumed: this measures decisions, not hands). */
export function optionRange(d: DeliveryCore, grade: BallOutcome['executionGrade'], field: FieldSetting, cond: Conditions, ctx: BallContext, lambda: number): { best: number; worst: number } {
  let best = Number.NEGATIVE_INFINITY;
  let worst = Number.POSITIVE_INFINITY;
  for (const o of OPTIONS) {
    const v = optionValue(d, grade, o, field, cond, ctx, lambda);
    if (v > best) best = v;
    if (v < worst) worst = v;
  }
  return { best, worst };
}

const alternativesCache = new Map<string, { min: number; max: number }>();

/**
 * Range of the batter's best-response value over every delivery of the same energy cost and intent (neutral context),
 * among `variants` (default: all of them).
 */
function deliveryRange(cost: number, intent: DeliveryCore['intent'], field: FieldSetting, cond: Conditions, ball: number, lambda: number, variants: readonly DeliveryVariant[] = VARIANTS): { min: number; max: number } {
  const key = `${cost}|${intent}|${field}|${cond.pitch}|${cond.weather}|${ball <= 2 ? 'new' : ball === SUPER_BALL_INDEX ? 'super' : 'old'}|${lambda}|${variants === VARIANTS ? 'all' : variants.join(',')}`;
  const hit = alternativesCache.get(key);
  if (hit) return hit;
  const ctx: BallContext = { ball, superBall: ball === SUPER_BALL_INDEX, lastBall: ball >= 5, newBatter: false, prev: null, repeats: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const variant of variants)
    for (const length of ALLOWED_LENGTHS[variant])
      for (const intensity of INTENSITIES)
        for (const line of LINES) {
          const d: DeliveryCore = { variant, line, length, intensity, intent };
          if (energyCost(d) !== cost) continue;
          const br = optionRange(d, 'good', field, cond, ctx, lambda).best;
          if (br < min) min = br;
          if (br > max) max = br;
        }
  const r = { min, max };
  if (alternativesCache.size > 500) alternativesCache.clear();
  alternativesCache.set(key, r);
  return r;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/**
 * How good a bowling choice a delivery is in its context: 1 when it is the hardest ball to score from among every
 * delivery of the same energy cost and intent (from `variants`), 0 when it is the easiest. The same measure as the
 * bowling half of tactical efficiency (matchPerformance). `best` is the batter's best-response value (lower is better
 * for the bowler); `min` and `max` bound it over those alternatives.
 */
export function bowlingChoice(d: DeliveryCore, field: FieldSetting, cond: Conditions, ctx: BallContext, lambda: number, variants: readonly DeliveryVariant[] = VARIANTS): { score: number; best: number; min: number; max: number } {
  const best = optionRange(d, 'good', field, cond, ctx, lambda).best;
  const range = deliveryRange(energyCost(d), d.intent, field, cond, ctx.ball, lambda, variants);
  return { score: range.max - range.min > 1e-9 ? clamp01((range.max - best) / (range.max - range.min)) : 1, best, min: range.min, max: range.max };
}
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

/**
 * Per-match components for the Top 100 (each 0..1):
 * - tacticalEfficiency: half batting decisions (how close each shot+zone was to the best option for that ball, with
 *   good timing assumed), half bowling choices (how hard each delivery was to score from, against every delivery of
 *   the same energy cost).
 * - clutch: results in the last two balls of each innings and the Super Ball when it counted (batting: runs, bowling:
 *   dots and wickets), +0.15 for winning a close match (≤ 3 runs or decided by a tie-break).
 * - execution: half the bowler's release quality, half the batter's timing on shots played.
 */
export function matchPerformance(log: MatchEventLog, player: 0 | 1): { tacticalEfficiency: number; clutch: number; execution: number } {
  const opp = player === 0 ? 1 : 0;
  const batting = log.innings[player];
  const bowlingInn = log.innings[opp];
  const myField = log.plans[player].field;
  const oppField = log.plans[opp].field;
  const cond = log.conditions;

  const batDecisions: number[] = [];
  const timings: number[] = [];
  let wkts = 0;
  batting.balls.forEach((o, i) => {
    const ctx = contextFor(o.ball, batting.balls.slice(0, i), o.delivery);
    const lambda = wicketCost(ctx, wkts);
    const { best, worst } = optionRange(o.delivery, o.executionGrade, oppField, cond, ctx, lambda);
    const chosen = o.timing === 'interrupted' ? worst : optionValue(o.delivery, o.executionGrade, { shot: o.shot, zone: o.zone }, oppField, cond, ctx, lambda);
    batDecisions.push(best - worst > 1e-9 ? clamp01((chosen - worst) / (best - worst)) : 1);
    if (o.shot !== 'leave' && o.timing !== 'interrupted') timings.push(TIMING_SCORE[o.timing]);
    if (o.wicket) wkts++;
  });

  const bowlChoices: number[] = [];
  const execs: number[] = [];
  wkts = 0;
  bowlingInn.balls.forEach((o, i) => {
    const ctx = contextFor(o.ball, bowlingInn.balls.slice(0, i), o.delivery);
    const lambda = wicketCost(ctx, wkts);
    const br = optionRange(o.delivery, 'good', myField, cond, ctx, lambda).best;
    const range = deliveryRange(energyCost(o.delivery), o.delivery.intent, myField, cond, o.ball, lambda);
    bowlChoices.push(range.max - range.min > 1e-9 ? clamp01((range.max - br) / (range.max - range.min)) : 1);
    execs.push(o.execution);
    if (o.wicket) wkts++;
  });

  const pressure: number[] = [];
  const batValue = (o: BallOutcome) => (o.wicket ? 0 : o.runs === 6 ? 1 : o.runs === 4 ? 0.85 : o.runs === 3 ? 0.65 : o.runs === 2 ? 0.55 : o.runs === 1 ? 0.4 : 0.2);
  const bowlValue = (o: BallOutcome) => (o.wicket ? 1 : o.runs === 0 ? 0.85 : o.runs === 1 ? 0.6 : o.runs === 2 ? 0.4 : o.runs === 3 ? 0.3 : o.runs === 4 ? 0.1 : 0);
  for (const o of batting.balls) if (o.ball >= 4) pressure.push(batValue(o));
  for (const o of bowlingInn.balls) if (o.ball >= 4) pressure.push(bowlValue(o));
  if (log.superBall.used && log.superBall.outcomes) {
    pressure.push(batValue(log.superBall.outcomes[player]));
    pressure.push(bowlValue(log.superBall.outcomes[opp]));
  }
  const close = log.result.winner === player && (log.result.decidedBy !== 'runs' || log.result.marginRuns <= 3);
  const clutch = clamp01(mean(pressure) + (close ? 0.15 : 0));

  const tactical = batDecisions.length && bowlChoices.length ? 0.5 * mean(batDecisions) + 0.5 * mean(bowlChoices) : mean([...batDecisions, ...bowlChoices]);
  const execution = timings.length ? 0.5 * mean(execs) + 0.5 * mean(timings) : mean(execs);
  return { tacticalEfficiency: r3(tactical), clutch: r3(clutch), execution: r3(execution) };
}
