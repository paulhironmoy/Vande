/**
 * The match situation as the crowd feels it: one pure function from the score to the DeliveryContext the stage
 * receives with bowl() (and forwards to the sink), so pressure means the same thing everywhere. It never touches the
 * simulation: the same ball is bowled and judged whatever the pressure.
 *
 *   final over        +0.25, and +0.10 more on the last ball (1 ≤ balls left ≤ 6)
 *   a chase           +0.20 … +0.65 while it can still be won (at most 6 a ball): most with few balls left, less
 *                     when almost won; +0.10 when it is beyond reach
 *   last wicket       +0.10 in a chase (a Practice innings is always one wicket, which is not extra pressure)
 *   milestone near    +0.12 when the striker is 44–49 or 94–99 (and every fifty after)
 */
import { clamp01, type DeliveryContext } from './emotionCore';

export interface MatchSituation {
  /** Innings runs before this ball. */
  runs: number;
  /** Wickets in hand (Practice: 1, so a wicket ends the innings). */
  wicketsInHand: number;
  /** Legal balls left in the innings; null when the session is open-ended. */
  ballsLeft: number | null;
  /** Runs to win, in a chase (null or absent otherwise). */
  target?: number | null;
  /** The striker's runs (default: the innings runs, as in Practice). */
  batterRuns?: number;
}

/** The milestone within a boundary of the striker's score (44–49 → fifty, 94–99 → hundred, and so on). */
export function milestoneInReach(batterRuns: number): 'fifty' | 'hundred' | null {
  if (!Number.isFinite(batterRuns) || batterRuns < 0) return null;
  const next = (Math.floor(batterRuns / 50) + 1) * 50;
  if (next - batterRuns > 6) return null;
  return (next / 50) % 2 === 0 ? 'hundred' : 'fifty';
}

/** 0..1, from the situation alone. */
export function matchPressure(s: MatchSituation): number {
  let p = 0;
  const left = s.ballsLeft;
  if (left !== null && Number.isFinite(left) && left >= 1 && left <= 6) p += left === 1 ? 0.35 : 0.25;
  const target = s.target;
  if (target !== null && target !== undefined && Number.isFinite(target) && left !== null && left >= 1) {
    const need = target - s.runs;
    if (need > 6 * left) p += 0.1; // beyond reach: little to hope for
    else if (need > 0) {
      // The share of the most that can still be scored (6 a ball): anything possible is tense, and almost won less so.
      const share = need / (6 * left);
      const open = share < 0.05 ? share / 0.05 : 1;
      const urgency = clamp01(1 - (left - 1) / 29);
      p += 0.2 + 0.45 * open * (0.35 + 0.65 * urgency);
      if (s.wicketsInHand <= 1) p += 0.1;
    }
  }
  if (milestoneInReach(s.batterRuns ?? s.runs)) p += 0.12;
  return clamp01(Math.round(p * 1000) / 1000);
}

/** What the stage's bowl(flight, context) and the sink's context(ctx) take. */
export function deliveryContext(s: MatchSituation): Required<DeliveryContext> {
  const batter = s.batterRuns ?? s.runs;
  return {
    pressure: matchPressure(s),
    milestone: milestoneInReach(batter),
    wicketEndsInnings: s.wicketsInHand <= 1,
    runs: Number.isFinite(batter) ? batter : 0,
  };
}
