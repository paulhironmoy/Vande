/**
 * Ratings and the Daily Top 100 — pure, deterministic functions (basic arithmetic only, so every runtime agrees).
 * GAMEPLAY-OWNED. Formulas and constants are documented in docs/GAME_RULES.md (section 14) and justified by
 * scripts/simulate-ranking.mjs. Purchases, adverts and cosmetics are never inputs: the input types below have no field
 * for them and the functions read only the listed fields.
 */
import type { MatchKind, Top100Components, Top100Entry } from '@/contracts';

// ---------------------------------------------------------------------------------------------------------------
// Deterministic maths
// ---------------------------------------------------------------------------------------------------------------

const LN2 = 0.6931471805599453;
const LN10 = 2.302585092994046;

/** e^x with range reduction and a Taylor series: identical on every JavaScript engine (Math.exp is not). */
export function detExp(x: number): number {
  if (x > 60) x = 60;
  if (x < -60) x = -60;
  const k = Math.floor(x / LN2);
  const r = x - k * LN2;
  let term = 1;
  let sum = 1;
  for (let n = 1; n <= 14; n++) {
    term = (term * r) / n;
    sum += term;
  }
  let scale = 1;
  if (k >= 0) for (let i = 0; i < k; i++) scale *= 2;
  else for (let i = 0; i < -k; i++) scale /= 2;
  return sum * scale;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const round2 = (v: number) => Math.round(v * 100) / 100;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------------------------------------------
// Elo-style rating
// ---------------------------------------------------------------------------------------------------------------

/** Every new player starts here. */
export const RATING_START = 1200;
/** Ratings never fall below this. */
export const RATING_FLOOR = 100;

/**
 * K-factor: 40 for a player's first 10 rated matches (find their level fast), 24 up to 30, then 16 (stable).
 */
export function kFactor(ratedMatches: number): number {
  return ratedMatches < 10 ? 40 : ratedMatches < 30 ? 24 : 16;
}

/** Expected score of A against B: 1 / (1 + 10^((Rb − Ra) / 400)), the difference capped at ±800. */
export function expectedScore(ra: number, rb: number): number {
  let d = rb - ra;
  if (d > 800) d = 800;
  if (d < -800) d = -800;
  return 1 / (1 + detExp((d / 400) * LN10));
}

export interface RatingMatch {
  kind: MatchKind;
  /** Either side was played by Auto Over or Auto XI (a missed deadline). */
  auto: boolean;
  /** Late (after a deadline) or unofficial practice play. */
  practice: boolean;
  /** Winner index, or null for a tie. */
  winner: 0 | 1 | null;
}

/** Only real duels and cup matches move ratings: never Auto sides, practice or late play, ghosts, daily or training. */
export function isRated(m: Pick<RatingMatch, 'kind' | 'auto' | 'practice'>): boolean {
  return (m.kind === 'duel' || m.kind === 'cup') && !m.auto && !m.practice;
}

export interface RatedPlayer {
  rating: number;
  /** Rated matches played before this one (selects the K-factor). */
  ratedMatches: number;
}

/** New ratings after a match (unchanged when the match is not rated). Each side uses its own K-factor. */
export function updateRatings(players: [RatedPlayer, RatedPlayer], m: RatingMatch): { ratings: [number, number]; rated: boolean } {
  const [a, b] = players;
  if (!isRated(m)) return { ratings: [a.rating, b.rating], rated: false };
  const ea = expectedScore(a.rating, b.rating);
  const sa = m.winner === null ? 0.5 : m.winner === 0 ? 1 : 0;
  const na = Math.max(RATING_FLOOR, round1(a.rating + kFactor(a.ratedMatches) * (sa - ea)));
  const nb = Math.max(RATING_FLOOR, round1(b.rating + kFactor(b.ratedMatches) * (1 - sa - (1 - ea))));
  return { ratings: [na, nb], rated: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Daily Top 100
// ---------------------------------------------------------------------------------------------------------------

type Perf = Pick<Top100Components, 'tacticalEfficiency' | 'clutch' | 'execution'>;

/** One finished match from one player's point of view (the platform fills it from the revealed log and its records). */
export interface Top100MatchInput {
  matchId: string;
  /** IST day of the match, YYYY-MM-DD. */
  day: string;
  /** Order of this match among the player's matches that day (0 = first finished). No clock times are needed. */
  order: number;
  kind: MatchKind;
  /** Cup stage (cup matches only). */
  stage?: 'group' | 'final';
  opponentId: string;
  result: 'won' | 'lost' | 'tied';
  /** Opponent's rating before the match. */
  opponentRating: number;
  /** This player's rating before the match. */
  rating: number;
  /** engine.matchPerformance(log, me). */
  performance: Perf;
  /** engine.matchPerformance(log, opponent). */
  opponentPerformance: Perf;
  /** Either side played by Auto Over or Auto XI. */
  auto: boolean;
  /** Late (after a deadline) or unofficial practice play. */
  practice: boolean;
  /**
   * Balls not validly answered in time in each innings, [mine, opponent's]: late answers plus expired and invalid
   * settlements (a ball revealed but never answered is a safe dot, so it must not be free in ranked play).
   */
  lateAnswers: [number, number];
  /** timingAudit(...).suspicious for each innings: [mine, opponent's]. */
  timingSuspicious: [boolean, boolean];
}

/** Ranking constants (documented in docs/GAME_RULES.md section 14). */
export const TOP100 = {
  /** Weights of the six components (sum 1; the score is out of 100 per match). */
  weights: { win: 0.25, opponentStrength: 0.15, tacticalEfficiency: 0.2, tournamentImportance: 0.1, clutch: 0.15, execution: 0.15 },
  /** Duel < cup group < cup final. */
  importance: { duel: 0.4, group: 0.7, final: 1 },
  /** Matches that count per day, chosen from the first `window` eligible matches. */
  countBest: 3,
  window: 5,
  /** Matches against the same opponent beyond this many in a day are not eligible (anti-collusion). */
  perOpponentPerDay: 2,
  /** More late, expired or invalid answers than this in either innings makes a match ineligible. */
  maxLateAnswers: 1,
  /** Opponent effort (tactical efficiency) below this: the result earns no win or opponent-strength credit. */
  effortFloor: 0.5,
  /** Opponent effort this far below their own typical effort that day: same (catches softer tanking). */
  effortDrop: 0.2,
  /** Opponent baseline needs at least this many of their other matches that day. */
  baselineMatches: 2,
  /**
   * Skill stretch: the engine's 0..1 components cluster high for everyone, so each is rescaled onto its meaningful
   * range before weighting — value' = clamp((value − from) / (1 − from), 0, 1).
   */
  stretchFrom: { tacticalEfficiency: 0.5, clutch: 0.2, execution: 0.4 },
} as const;

const stretch = (v: number, from: number) => clamp01((clamp01(v) - from) / (1 - from));

export type IneligibleReason = 'kind' | 'auto' | 'practice' | 'late_answers' | 'timing_audit' | 'repeat_opponent' | 'outside_window';

export interface Top100MatchScore {
  matchId: string;
  score: number;
  eligible: boolean;
  /** False when the opponent clearly did not try: no win or opponent-strength credit. */
  competitive: boolean;
  reasons: IneligibleReason[];
  components: Top100Components;
}

/** Hard eligibility rules for a single match (the per-day rules are applied by top100DayScore). */
export function matchEligibility(m: Top100MatchInput): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  if (m.kind !== 'duel' && m.kind !== 'cup') reasons.push('kind');
  if (m.auto) reasons.push('auto');
  if (m.practice) reasons.push('practice');
  if (m.lateAnswers[0] > TOP100.maxLateAnswers || m.lateAnswers[1] > TOP100.maxLateAnswers) reasons.push('late_answers');
  if (m.timingSuspicious[0] || m.timingSuspicious[1]) reasons.push('timing_audit');
  return reasons;
}

/**
 * Score of one match (0–100):
 * 100 × (0.25·win + 0.15·opponent strength + 0.20·tactical′ + 0.10·importance + 0.15·clutch′ + 0.15·execution′)
 * where win is 1 / ½ / 0, opponent strength is the Elo chance the opponent had of beating you (beating a stronger
 * player is worth more; it counts fully on a win and half on a tie), win and opponent strength are zero when the
 * opponent clearly did not try, and ′ marks the stretched skill components. Ineligible matches score 0.
 */
export function top100MatchScore(m: Top100MatchInput, opponentBaselineEffort: number | null = null): Top100MatchScore {
  const reasons = matchEligibility(m);
  const W = TOP100.weights;
  const oppEffort = clamp01(m.opponentPerformance.tacticalEfficiency);
  const competitive = oppEffort >= TOP100.effortFloor && (opponentBaselineEffort === null || oppEffort >= opponentBaselineEffort - TOP100.effortDrop);
  const resultValue = m.result === 'won' ? 1 : m.result === 'tied' ? 0.5 : 0;
  const win = competitive ? resultValue : 0;
  const upset = 1 - expectedScore(m.rating, m.opponentRating);
  const opponentStrength = competitive ? upset * resultValue : 0;
  const importance = m.kind === 'cup' ? (m.stage === 'final' ? TOP100.importance.final : TOP100.importance.group) : TOP100.importance.duel;
  const components: Top100Components = {
    wins: win,
    opponentStrength: round2(opponentStrength),
    tacticalEfficiency: clamp01(m.performance.tacticalEfficiency),
    tournamentImportance: importance,
    clutch: clamp01(m.performance.clutch),
    execution: clamp01(m.performance.execution),
  };
  const S = TOP100.stretchFrom;
  const raw =
    W.win * components.wins +
    W.opponentStrength * opponentStrength +
    W.tacticalEfficiency * stretch(components.tacticalEfficiency, S.tacticalEfficiency) +
    W.tournamentImportance * components.tournamentImportance +
    W.clutch * stretch(components.clutch, S.clutch) +
    W.execution * stretch(components.execution, S.execution);
  const eligible = reasons.length === 0;
  return { matchId: m.matchId, score: eligible ? round2(100 * raw) : 0, eligible, competitive, reasons, components };
}

export interface Top100DayScore {
  playerId: string;
  day: string;
  /** Sum of the counted match scores (0–300). */
  score: number;
  /** Counted matches, best first. */
  counted: Top100MatchScore[];
  /** Every match with its eligibility. */
  all: Top100MatchScore[];
}

/**
 * Day score: the best three of the first five eligible matches of the day (in play order), counting at most two
 * matches against the same opponent. Playing more than five eligible matches cannot change the score.
 */
export function top100DayScore(playerId: string, day: string, matches: readonly Top100MatchInput[], baselines: ReadonlyMap<string, number> = new Map()): Top100DayScore {
  const ordered = matches.filter((m) => m.day === day).slice().sort((a, b) => a.order - b.order || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0));
  const perOpponent = new Map<string, number>();
  const all: Top100MatchScore[] = [];
  let inWindow = 0;
  for (const m of ordered) {
    const s = top100MatchScore(m, baselines.get(m.opponentId) ?? null);
    if (s.eligible) {
      const seen = perOpponent.get(m.opponentId) ?? 0;
      perOpponent.set(m.opponentId, seen + 1);
      if (seen >= TOP100.perOpponentPerDay) {
        s.eligible = false;
        s.reasons.push('repeat_opponent');
        s.score = 0;
      } else if (inWindow >= TOP100.window) {
        s.eligible = false;
        s.reasons.push('outside_window');
        s.score = 0;
      } else inWindow++;
    }
    all.push(s);
  }
  const counted = all
    .filter((s) => s.eligible)
    .sort((a, b) => b.score - a.score || (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0))
    .slice(0, TOP100.countBest);
  return { playerId, day, score: round2(counted.reduce((sum, s) => sum + s.score, 0)), counted, all };
}

export interface Top100PlayerDay {
  playerId: string;
  alias: string;
  day: string;
  matches: readonly Top100MatchInput[];
}

/** Median of a non-empty list. */
function median(xs: number[]): number {
  const a = xs.slice().sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/**
 * The Daily Top 100. Each opponent's typical effort (the platform's long-term median tactical efficiency when given,
 * else the median over their own eligible matches that day when they played at least three) feeds the competitiveness
 * check. Ties break by: best single match, then counted wins, then mean tactical efficiency, then player id (stable;
 * never by time).
 */
export function rankTop100(players: readonly Top100PlayerDay[], limit = 100, longTermEffort: ReadonlyMap<string, number> = new Map()): Top100Entry[] {
  const efforts = new Map<string, number[]>();
  for (const p of players)
    for (const m of p.matches)
      if (matchEligibility(m).length === 0) {
        const list = efforts.get(p.playerId) ?? [];
        list.push(clamp01(m.performance.tacticalEfficiency));
        efforts.set(p.playerId, list);
      }
  const baselines = new Map<string, number>();
  for (const [id, list] of efforts) if (list.length >= TOP100.baselineMatches + 1) baselines.set(id, median(list));
  // A long-term baseline (e.g. the platform's 30-day median) wins: colluders cannot dodge it by playing only tanked matches.
  for (const [id, v] of longTermEffort) baselines.set(id, v);

  const scored = players.map((p) => {
    const day = top100DayScore(p.playerId, p.day, p.matches, baselines);
    const n = day.counted.length || 1;
    const mean = (k: keyof Top100Components) => round2(day.counted.reduce((s, c) => s + c.components[k], 0) / n);
    const components: Top100Components = {
      wins: day.counted.reduce((s, c) => s + c.components.wins, 0),
      opponentStrength: mean('opponentStrength'),
      tacticalEfficiency: mean('tacticalEfficiency'),
      tournamentImportance: mean('tournamentImportance'),
      clutch: mean('clutch'),
      execution: mean('execution'),
    };
    return { p, day, components, best: day.counted[0]?.score ?? 0 };
  });
  const ranked = scored
    .filter((s) => s.day.score > 0)
    .sort(
      (a, b) =>
        b.day.score - a.day.score ||
        b.best - a.best ||
        b.components.wins - a.components.wins ||
        b.components.tacticalEfficiency - a.components.tacticalEfficiency ||
        (a.p.playerId < b.p.playerId ? -1 : a.p.playerId > b.p.playerId ? 1 : 0),
    );
  return ranked.slice(0, limit).map((s, i) => ({
    day: s.p.day,
    rank: i + 1,
    playerId: s.p.playerId,
    alias: s.p.alias,
    score: s.day.score,
    matchIds: s.day.counted.map((c) => c.matchId),
    bestMatchId: s.day.counted[0]?.matchId ?? '',
    components: s.components,
  }));
}
