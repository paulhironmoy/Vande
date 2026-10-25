/**
 * Lite points: every number a player can see, and the pure helpers that compute them.
 *
 * The scoring code in the Lite screen and the "How points work" card both read from this module, so the rules and
 * their explanation can never drift apart. Nothing here touches the store, the DOM or storage, so the same helpers
 * also run in tests, in the toughness generator and (later) on the verified-dares server.
 */
import { reduce } from '@/engine';
import { DIMENSIONS, type DecisionOption, type GameState, type Scenario, type ScenarioDecision, type Scores } from '@/engine/types';

/** Move, clue, fair-play, mission and star points. */
export const LITE_POINTS = {
  /** Every move starts here. */
  moveBase: 100,
  /** Added per point a city bar rises, taken away per point it falls. */
  movePerBarPoint: 8,
  /** A move never scores less than this. */
  moveMin: 10,
  /** Multiplier when every clue the move relies on was scanned. */
  clueMultiplier: 2,
  /** Streak multiplier added per fair move in a row after the first. */
  streakStep: 0.25,
  /** Steps counted at most: ×(1 + 4 × 0.25) = ×2. */
  streakMaxSteps: 4,
  /** Checking a clue that turns out real. */
  clueVerified: 50,
  /** Catching a fake clue ("bug squashed"). */
  clueFakeCaught: 200,
  /** The fair answer to a fair-play question. */
  fairPlayCorrect: 100,
  /** Each mission completed by the end. */
  missionBonus: 50,
  /** Each star at the end. Stars come from how the city ends up. */
  starBonus: 100,
} as const;

/** Toughness tiers for Insight points. */
export type InsightTier = 'tricky' | 'tough' | 'boss';

/** Insight points: a fixed bonus for finding the best move, bigger on tougher questions. Never negative. */
export const INSIGHT = {
  /** Display name. The owner first called these "magic points"; renaming is this one line. */
  name: 'Insight points',
  short: 'Insight',
  base: 50,
  /** A close second earns this share of the full bonus. */
  closeSecondShare: 0.5,
  tiers: {
    tricky: { label: 'Tricky', multiplier: 1 },
    tough: { label: 'Tough', multiplier: 2 },
    boss: { label: 'Boss', multiplier: 3 },
  },
} as const satisfies {
  name: string;
  short: string;
  base: number;
  closeSecondShare: number;
  tiers: Record<InsightTier, { label: string; multiplier: number }>;
};

/** Helper points (you sent the dare) and Challenger points (you answered it). Same amounts, same caps for everyone. */
export const FRIEND_POINTS = {
  helperName: 'Helper points',
  challengerName: 'Challenger points',
  /** A friend answered (helper), or you answered and sent your result back (challenger). */
  answer: 40,
  /** Added when the friend found the best move on the dare and also got the twist right. */
  understood: 100,
  /** Rewarded replies per dare. */
  perDareCap: 3,
  /** Rewarded replies (and, separately, challenger awards) per local day. */
  perDayCap: 10,
} as const;

/** Tags that make a move harsh: it resets the streak and is flagged in the reveal. */
export const HARSH_TAGS: ReadonlySet<string> = new Set(['disproportionate', 'suppressive', 'censorship']);

export interface MoveEval {
  option: DecisionOption;
  /** Index of the option in the decision. */
  index: number;
  delta: Partial<Scores>;
  /** Points the move scores right now, including the clue bonus. */
  pts: number;
  harsh: boolean;
  consequence: string;
}

/** A clue counts as checked once scanned to a settled state. */
export function isChecked(state: GameState, id: string): boolean {
  const es = state.evidence[id];
  return Boolean(es && (es.state === 'verified' || es.state === 'corroborated' || es.state === 'manipulated'));
}

/** Rounded per-bar change between two score sets, with the total rise (pos) and total fall (neg). */
export function scoreDelta(before: Scores, after: Scores): { delta: Partial<Scores>; pos: number; neg: number } {
  const delta: Partial<Scores> = {};
  let pos = 0;
  let neg = 0;
  for (const k of DIMENSIONS) {
    const dv = Math.round(after[k] - before[k]);
    if (dv !== 0) delta[k] = dv;
    if (dv > 0) pos += dv;
    else neg -= dv;
  }
  return { delta, pos, neg };
}

/** Base points for a move from how much the bars rose (pos) and fell (neg). */
export function movePoints(pos: number, neg: number): number {
  return Math.max(LITE_POINTS.moveMin, LITE_POINTS.moveBase + pos * LITE_POINTS.movePerBarPoint - neg * LITE_POINTS.movePerBarPoint);
}

/** Streak multiplier for the streak length after this move: ×1 below 2, then +0.25 per move, up to ×2. */
export function streakMultiplier(streak: number): number {
  if (!(streak >= 2)) return 1;
  return 1 + LITE_POINTS.streakStep * Math.min(streak - 1, LITE_POINTS.streakMaxSteps);
}

/** What a move would do right now: city change, move value and what happens. Pure (the engine is pure). */
export function evaluateMove(state: GameState, scenario: Scenario, d: ScenarioDecision, o: DecisionOption, index: number): MoveEval {
  let after = state;
  try {
    after = reduce(state, { type: 'decide', tick: state.tick, decisionId: d.id, optionId: o.id }, scenario);
  } catch {
    /* fall back to no change */
  }
  const { delta, pos, neg } = scoreDelta(state.scores, after.scores);
  const fb = after.lastFeedback;
  const harsh = o.tags.some((t) => HARSH_TAGS.has(t)) || fb?.warning === 'disproportionate' || fb?.warning === 'false-accusation';
  let pts = movePoints(pos, neg);
  const relied = (o.requiresEvidence ?? []).filter((id) => state.evidence[id]?.visible);
  if (relied.length && relied.every((id) => isChecked(state, id))) pts *= LITE_POINTS.clueMultiplier;
  const consequence = d.simple?.options[o.id]?.consequence ?? fb?.text ?? o.consequence;
  return { option: o, index, delta, pts, harsh, consequence };
}

/** Every option of a decision evaluated from the same state, in option order. */
export function evaluateAll(state: GameState, scenario: Scenario, d: ScenarioDecision): MoveEval[] {
  return d.options.map((o, i) => evaluateMove(state, scenario, d, o, i));
}

/** The best move: highest points, earliest option on ties (the reveal's "Best" marker). */
export function bestOf(evals: readonly MoveEval[]): MoveEval {
  return evals.reduce((a, b) => (b.pts > a.pts ? b : a), evals[0]);
}

/**
 * Rank of a move in the reveal: 1 + the number of moves that score strictly more. Ties share a rank, so every move
 * tied for the top is rank 1 ("ties count as best"). `behindBest` is how many points it trails the best move by.
 */
export function rankOf(evals: readonly MoveEval[], optionId: string): { rank: number; behindBest: number } {
  const mine = evals.find((e) => e.option.id === optionId);
  if (!mine) return { rank: evals.length + 1, behindBest: Infinity };
  const top = bestOf(evals).pts;
  return { rank: 1 + evals.filter((e) => e.pts > mine.pts).length, behindBest: top - mine.pts };
}

/** Insight points for one answer. Best (rank 1): base × tier. Close second: half. Anything else: 0. Never negative. */
export function insightFor(tier: InsightTier, rank: number, behindBest: number, closeCallMargin: number): number {
  const full = INSIGHT.base * INSIGHT.tiers[tier].multiplier;
  if (rank === 1) return full;
  if (rank === 2 && behindBest <= closeCallMargin) return Math.round(full * INSIGHT.closeSecondShare);
  return 0;
}

const times = (n: number) => `×${String(Math.round(n * 100) / 100)}`;

export interface PointsRule {
  id: string;
  title: string;
  text: string;
}

/** The "How points work" card, generated from the numbers above. Short sentences for young players. */
export function pointsRules(): PointsRule[] {
  const p = LITE_POINTS;
  const f = FRIEND_POINTS;
  const t = INSIGHT.tiers;
  const streakSteps = [2, 3, 4, 5].map((n) => times(streakMultiplier(n)));
  const insight = (k: InsightTier) => INSIGHT.base * t[k].multiplier;
  return [
    {
      id: 'move',
      title: 'Every move',
      text: `${p.moveBase} points. Plus ${p.movePerBarPoint} for each step a city bar goes up, minus ${p.movePerBarPoint} for each step down. Never less than ${p.moveMin}.`,
    },
    { id: 'clue-bonus', title: 'Clue bonus', text: `Scanned the clue a move needs? That move scores ${times(p.clueMultiplier)}.` },
    {
      id: 'streak',
      title: 'Streak',
      text: `Fair moves in a row: ${streakSteps.slice(0, -1).join(', ')}, up to ${streakSteps[streakSteps.length - 1]}. A harsh move resets it.`,
    },
    { id: 'clues', title: 'Clues', text: `+${p.clueVerified} for checking a real clue. +${p.clueFakeCaught} for catching a fake.` },
    { id: 'fair-play', title: 'Fair-play questions', text: `+${p.fairPlayCorrect} for the fair answer.` },
    {
      id: 'end',
      title: 'At the end',
      text: `+${p.missionBonus} for each mission and +${p.starBonus} for each star. Stars come from how the city ends up.`,
    },
    {
      id: 'insight',
      title: INSIGHT.name,
      text: `Find the best move: ${insight('tricky')} on a ${t.tricky.label} question, ${insight('tough')} on ${t.tough.label}, ${insight('boss')} on ${t.boss.label}. A close second gets half.`,
    },
    { id: 'no-loss', title: 'No take-backs', text: 'Points you have earned are never taken away, but the city still feels every move.' },
    {
      id: 'helper',
      title: f.helperName,
      text: `+${f.answer} when a friend answers your dare. +${f.understood} more when they find the best move and crack the twist. Up to ${f.perDareCap} friends per dare and ${f.perDayCap} a day.`,
    },
    { id: 'challenger', title: f.challengerName, text: `Answer a friend's dare and send your result back to earn the same. Up to ${f.perDayCap} a day.` },
    { id: 'sharing', title: 'Sharing', text: 'Sharing never changes your score, stars or medals.' },
  ];
}
