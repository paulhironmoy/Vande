/**
 * Choosing the three responses the coach shows (docs/PRACTICE_COACH.md, "The picks"), from the simulated candidates,
 * each judged over its execution spread (simulate.ts EXECUTION_SPREAD):
 *
 *   recommended     the response with the highest value (expected runs less the wicket's cost times the risk, less a
 *                   mis-hit's cost, plus a small bonus for orthodox line-and-length cricket that breaks near-ties)
 *                   among those that keep the two hard coaching rules (with the line and the movement, enforced as
 *                   "the coach's own read finds no misread in it", and never into a protected arc), survive their
 *                   ideal point with clean contact, a stroke along its aim (the demonstration; AIMED_WITHIN_DEG) and
 *                   at no less than PRAISE_MIN_SPEED_SHARE of its requested bat speed (never a slow fend),
 *                   and are dismissed in at most PICK.recommendMaxRisk of their spread. First among them, a response
 *                   that works at every point of its execution spread (worksAcrossSpread: never dismissed, always off
 *                   the middle or a clean leave), so the tip holds for a real player's error (COACH2); a robust
 *                   response outranks the protected-arc rule (owner decision 2026-11-03). When nothing qualifies,
 *                   the rules relax in this order: a protected aim (the option then says so in its risks); the read
 *                   (keeping the line); the line; the risk cap; soundness; and last, never a leave of a ball that
 *                   would hit the stumps while any response plays at it
 *   safest          the lowest dismissal risk (a leave before a block before a stroke, then clean contact, then runs)
 *   higher_scoring  the most expected runs within PICK.higherScoringMaxRisk, and more than the recommended, from a
 *                   response the coach's read finds no misread in and that is sound at its ideal point (off the
 *                   middle, along its aim; it may be aimed into a protected arc, and then says so in its risks)
 *
 * options[0] is always the recommended response; the other two appear only when they are a different response.
 */
import type { CoachAnalysis, CoachOption, CoachOptionKind, CoachRisk, ContactKind, ContactReport } from '@/contracts/practice';
import { bearingDelta } from '@/physics';
import { slowFend } from './quality';
import type { AttemptJudgement, Evaluated, Tally } from './simulate';

export const PICK = {
  /** The one wicket of a Practice innings, in runs, when weighing risk against reward. */
  wicketCostRuns: 24,
  /** What a stroke off anything but the middle of the bat costs in the value (runs, per share of the spread). */
  mishitCostRuns: 1,
  /** The recommended response is dismissed in at most this share of its spread, and never at its ideal point. */
  recommendMaxRisk: 0.12,
  /** The higher-scoring alternative is dismissed in at most this share of its spread. */
  higherScoringMaxRisk: 0.25,
  /** Orthodox line-and-length cricket breaks near-ties (runs added to the value). */
  orthodoxyBonusRuns: 0.25,
} as const;

const BAT: ReadonlySet<ContactKind> = new Set<ContactKind>(['middle', 'inside_edge', 'outside_edge', 'top_edge', 'leading_edge']);
const RANK = { leave: 0, defend: 1, attack: 2 } as const;

const risk = (e: Evaluated) => (e.tally ? e.tally.out / e.tally.w : 1);
const meanRuns = (e: Evaluated) => (e.tally ? e.tally.runs / e.tally.w : 0);
const cleanShare = (e: Evaluated) => (e.tally ? e.tally.clean / e.tally.w : 0);
/** The value of a response over the execution spread; correct cricket earns a small bonus that only breaks near-ties. */
const value = (e: Evaluated) =>
  meanRuns(e) - PICK.wicketCostRuns * risk(e) - PICK.mishitCostRuns * (1 - cleanShare(e)) + (e.orthodox ? PICK.orthodoxyBonusRuns : 0);

/**
 * A stroke's ball leaves its ideal point within this of the bearing it was aimed along (deg). Further than this it went
 * backwards relative to its aim: a deflection (off the toe end, past the stumps) that the physics still labels a face
 * contact (`contact.ts` has no toe kind), not the stroke the demonstration and the tip would name. ContactReport
 * records both bearings for exactly this comparison.
 */
export const AIMED_WITHIN_DEG = 90;

/** The ball left the bat along its aim (AIMED_WITHIN_DEG), from the recorded exit and intended bearings. */
export function wentWhereAimed(c: Pick<ContactReport, 'exitBearingDeg' | 'intendedBearingDeg'>): boolean {
  // Unmeasured (null) bearings decide nothing; a comparison is never made with NaN.
  if (!Number.isFinite(c.exitBearingDeg) || !Number.isFinite(c.intendedBearingDeg)) return true;
  return Math.abs(bearingDelta(c.exitBearingDeg!, c.intendedBearingDeg!)) <= AIMED_WITHIN_DEG;
}

/**
 * Survives its ideal point, off the middle of the bat and, for a stroke, along its aim and at no less than
 * PRAISE_MIN_SPEED_SHARE of the bat speed it asks for (quality.ts; lead ruling 2026-11-03: a recommended stroke is never
 * a slow fend, which the coach would not praise); or left cleanly. A block is meant to be slow and is exempt.
 */
export function soundAtCentre(e: Evaluated): boolean {
  if (e.centre.outcome.dismissal) return false;
  if (e.c.kind === null) return e.centre.contact.kind === 'leave';
  if (e.centre.contact.kind !== 'middle') return false;
  if (e.c.decision !== 'attack') return true;
  return wentWhereAimed(e.centre.contact) && !slowFend({ decision: 'attack', power: e.c.power, directionDeg: e.c.directionDeg, footwork: e.played }, e.centre.contact);
}

/**
 * Works across its whole execution spread (COACH2; docs/prompts/VANDE-PRACTICE-WEDGE-PROMPT.md §4 step 5): never
 * dismissed at any point, and every point off the middle of the bat (or a clean leave of a ball that misses).
 */
export function worksAcrossSpread(e: Evaluated): boolean {
  const t = e.tally;
  return t !== null && t.out === 0 && t.clean >= t.w - 1e-9;
}

function best(list: Evaluated[], cmp: (a: Evaluated, b: Evaluated) => number): Evaluated | null {
  let out: Evaluated | null = null;
  for (const e of list) if (!out || cmp(e, out) < 0) out = e;
  return out;
}

/** Ascending order of two measured values; equal within 1e-9. */
const asc = (x: number, y: number) => (Math.abs(x - y) <= 1e-9 ? 0 : x - y);

const byValue = (a: Evaluated, b: Evaluated) => asc(value(b), value(a)) || asc(risk(a), risk(b)) || RANK[a.c.decision] - RANK[b.c.decision] || a.c.index - b.c.index;
const bySafety = (a: Evaluated, b: Evaluated) =>
  Number(!soundAtCentre(a)) - Number(!soundAtCentre(b)) ||
  asc(risk(a), risk(b)) ||
  RANK[a.c.decision] - RANK[b.c.decision] ||
  asc(cleanShare(b), cleanShare(a)) ||
  asc(meanRuns(b), meanRuns(a)) ||
  a.c.index - b.c.index;
const byRuns = (a: Evaluated, b: Evaluated) => asc(meanRuns(b), meanRuns(a)) || asc(risk(a), risk(b)) || a.c.index - b.c.index;

export interface Picks {
  recommended: Evaluated;
  safest: Evaluated | null;
  higherScoring: Evaluated | null;
}

/** The three picks over the evaluated candidates (only those with a spread compete). */
export function pick(all: Evaluated[]): Picks {
  const scored = all.filter((e) => e.tally !== null);
  const cap = PICK.recommendMaxRisk;
  // A recommendation must work across the execution spread, not only at its ideal point (COACH2): among responses with
  // no misread, one that is never dismissed and always meets the ball off the middle (or leaves it cleanly) comes
  // first, clear of the field's protected arcs if it can be. Then the two hard coaching rules as before: play with the
  // line and the movement (enforced through the coach's own read: never a response it would call a misread), and never
  // into a protected arc. They relax in turn only when nothing else is sound, the protected aim then flagged in its
  // risks. When nothing survives even its ideal point, the coach still never recommends leaving a ball that would hit
  // the stumps if any response plays at it.
  const tiers: Array<(e: Evaluated) => boolean> = [
    (e) => soundAtCentre(e) && e.readOk && !e.protectedAim && worksAcrossSpread(e),
    (e) => soundAtCentre(e) && e.readOk && worksAcrossSpread(e),
    (e) => soundAtCentre(e) && e.readOk && !e.protectedAim && risk(e) <= cap,
    (e) => soundAtCentre(e) && e.readOk && risk(e) <= cap,
    (e) => soundAtCentre(e) && e.withLine && risk(e) <= cap,
    (e) => soundAtCentre(e) && risk(e) <= cap,
    (e) => soundAtCentre(e),
    (e) => e.c.kind !== null || e.orthodox,
    () => true,
  ];
  let recommended: Evaluated | null = null;
  for (const t of tiers) {
    recommended = best(scored.filter(t), byValue);
    if (recommended) break;
  }
  if (!recommended) throw new Error('coach: no candidate was simulated');
  const safest0 = best(scored, bySafety);
  const safest = safest0 && safest0 !== recommended ? safest0 : null;
  const hs = best(
    // Sound at its ideal point like the recommended (survives, off the middle and along its aim; lead decision
    // 2026-11-03): the alternative shown is never a deflection off the toe the physics still calls a face contact.
    scored.filter((e) => e.readOk && soundAtCentre(e) && risk(e) <= PICK.higherScoringMaxRisk && meanRuns(e) > meanRuns(recommended) + 1e-9),
    byRuns,
  );
  const higherScoring = hs && hs !== recommended && hs !== safest ? hs : null;
  return { recommended, safest, higherScoring };
}

/** Rounded to 1/scale, never negative zero (no `**`: the repository's determinism rule). */
const round = (v: number, scale: number) => Math.round(v * scale) / scale || 0;

/** Why a response carries risk: its aim, and what happened anywhere in its spread. */
function risksOf(t: Tally, protectedAim: boolean): CoachRisk[] {
  const risks: CoachRisk[] = [];
  if (protectedAim) risks.push('into_protected_region');
  if (t.caught) risks.push('can_be_caught');
  if (t.edges) risks.push('can_edge');
  if (t.bowled) risks.push('can_be_bowled');
  if (t.lbw) risks.push('can_be_lbw');
  return risks;
}

/** The player's own stroke over the spread, as the contract's attempted.spread (null for a leave). */
export function toSpread(j: AttemptJudgement | null): CoachAnalysis['attempted']['spread'] {
  if (!j) return null;
  return { dismissalRisk: round(j.tally.out / j.tally.w, 1000), expectedRuns: round(j.tally.runs / j.tally.w, 100), risks: risksOf(j.tally, j.protectedAim) };
}

/** A pick as the contract's CoachOption (its ideal point is what it shows and demonstrates). */
function toOption(e: Evaluated, kind: CoachOptionKind): CoachOption {
  const t = e.tally!;
  const o = e.centre.outcome;
  const bat = BAT.has(e.centre.contact.kind);
  const risks = risksOf(t, e.protectedAim);
  return {
    kind,
    decision: e.c.decision,
    swing: e.swing,
    footwork: e.played,
    outcome: o,
    contact: e.centre.contact.kind,
    contactPoint: bat ? e.centre.contact.point : null,
    contactT: bat ? e.centre.contact.t : null,
    dismissalRisk: round(t.out / t.w, 1000),
    expectedRuns: round(t.runs / t.w, 100),
    region: !o.dismissal && o.runs > 0 ? o.region : null,
    risks,
  };
}

/** The picks as options: recommended first, then the safest and the higher-scoring when they differ. */
export function optionsFrom(p: Picks): CoachOption[] {
  const out = [toOption(p.recommended, 'recommended')];
  if (p.safest) out.push(toOption(p.safest, 'safest'));
  if (p.higherScoring) out.push(toOption(p.higherScoring, 'higher_scoring'));
  return out;
}

/**
 * The option of a kind. A kind that is not listed was merged: the safest into the recommended, the higher-scoring
 * into whichever listed option scores most (the recommended when nothing within the risk cap scores more).
 */
export function optionOf(analysis: Pick<CoachAnalysis, 'options'>, kind: CoachOptionKind): CoachOption {
  const opts = analysis.options;
  const exact = opts.find((o) => o.kind === kind);
  if (exact) return exact;
  if (kind === 'higher_scoring') return opts.reduce((a, b) => (b.expectedRuns > a.expectedRuns ? b : a), opts[0]);
  return opts[0];
}
