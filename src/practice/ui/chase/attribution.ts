/**
 * What decided a Chase, as plain data. The win and loss screens turn it into one sentence with the Practice copy; this
 * file only reads what the physics already measured (the closed coaching reason, the swing's own early or late
 * classification, the dismissal) and counts. It never infers a cause the simulation did not report, never blames the
 * player, and gives the same answer for the same balls every time (no randomness, no clock).
 */
import type { CoachingReason, DeliveryOutcome, DeliveryResult, Dismissal } from '@/contracts';

/** One delivery of the chase, reduced to what the sentence may use. */
export interface ChaseBallFacts {
  runs: DeliveryOutcome['runs'];
  boundary: 4 | 6 | null;
  dismissal: Dismissal | null;
  /** The physics' closed reason for the ball (src/practice/game coaching). */
  reason: CoachingReason;
  /** The swing's own early or late classification; null for a leave or a swing the physics did not time. */
  timing: 'early' | 'on_time' | 'late' | null;
  /** Signed (positive is late), as measured against the ideal contact; null for a leave. */
  timingErrorMs: number | null;
  /** The player made a swing (an attack or a defence) at this ball. */
  swung: boolean;
}

export function ballFacts(result: Pick<DeliveryResult, 'outcome' | 'coaching' | 'contact' | 'swing'>): ChaseBallFacts {
  return {
    runs: result.outcome.runs,
    boundary: result.outcome.boundary,
    dismissal: result.outcome.dismissal,
    reason: result.coaching.reason,
    timing: result.coaching.timing,
    timingErrorMs: result.contact.timingErrorMs,
    swung: result.swing !== null,
  };
}

/** The part of the ball that cost the most dot balls: only ever one of the physics' own closed reasons, grouped. */
export type ShortCause = 'timing' | 'bowler' | 'line' | 'defence' | 'field';

/** Which group a reason belongs to for a ball that scored nothing (null: it says nothing about why). */
const CAUSE: Record<CoachingReason, ShortCause | null> = {
  too_early: 'timing',
  too_late: 'timing',
  mistimed_lofted: 'timing',
  beaten_by_swing: 'bowler',
  beaten_by_seam: 'bowler',
  beaten_by_turn: 'bowler',
  beaten_by_pace: 'bowler',
  beaten_by_bounce: 'bowler',
  missed_straight_ball: 'line',
  pad_in_line: 'line',
  solid_defence: 'defence',
  left_well: 'defence',
  hit_to_fielder: 'field',
  caught_in_the_ring: 'field',
  caught_in_the_deep: 'field',
  edged_behind: 'field',
  edged_to_slip: 'field',
  // Said of no group: the sentence for a group must be true of every ball counted in it.
  played_across_the_line: null,
  found_the_gap: null,
  cleared_the_rope: null,
  beat_the_field: null,
  left_and_bowled: null,
  played_on: null,
};

/** Ties are broken by this order, so the sentence never depends on how the balls happened to be listed. */
const ORDER: readonly ShortCause[] = ['timing', 'bowler', 'line', 'field', 'defence'];

/** A cause is named only when it is a pattern: at least two of the dot balls share it. */
export const MIN_PATTERN = 2;

export interface WicketAttribution {
  kind: 'wicket';
  dismissal: Dismissal;
  reason: CoachingReason;
  timing: ChaseBallFacts['timing'];
  timingErrorMs: number | null;
  swung: boolean;
}

export interface ShortAttribution {
  kind: 'short';
  /** Runs still needed when the last ball was bowled (target minus runs scored, at least 1). */
  short: number;
  scored: number;
  balls: number;
  /** Balls that scored nothing and were not a wicket. */
  dots: number;
  /** The group most of the dot balls belong to, when at least MIN_PATTERN of them do; else null. */
  cause: ShortCause | null;
  causeCount: number;
}

export interface WonAttribution {
  kind: 'won';
  ballsLeft: number;
  /** How the winning ball was scored: 4, 6, or null for runs run. */
  finish: 4 | 6 | null;
}

export type ChaseAttribution = WicketAttribution | ShortAttribution | WonAttribution;

/** The ball that took the wicket. */
export function attributeWicket(ball: ChaseBallFacts): WicketAttribution {
  return {
    kind: 'wicket',
    dismissal: ball.dismissal ?? 'bowled',
    reason: ball.reason,
    timing: ball.timing,
    timingErrorMs: ball.timingErrorMs,
    swung: ball.swung,
  };
}

/** The balls ran out: how far short, and the one group of dot balls that was most common (when it is a pattern). */
export function attributeShort(balls: readonly ChaseBallFacts[], target: number): ShortAttribution {
  const scored = balls.reduce((n, b) => n + b.runs, 0);
  const dotsOnly = balls.filter((b) => b.runs === 0 && b.dismissal === null);
  const counts = new Map<ShortCause, number>();
  for (const b of dotsOnly) {
    const c = CAUSE[b.reason];
    if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let cause: ShortCause | null = null;
  let causeCount = 0;
  for (const c of ORDER) {
    const n = counts.get(c) ?? 0;
    if (n > causeCount) {
      cause = c;
      causeCount = n;
    }
  }
  if (causeCount < MIN_PATTERN) {
    cause = null;
    causeCount = 0;
  }
  return {
    kind: 'short',
    short: Math.max(1, target - scored),
    scored,
    balls: balls.length,
    dots: dotsOnly.length,
    cause,
    causeCount,
  };
}

/** The chase was won: with how many balls to spare, and how the last runs came. */
export function attributeWon(last: ChaseBallFacts, ballsLeft: number): WonAttribution {
  return { kind: 'won', ballsLeft: Math.max(0, ballsLeft), finish: last.boundary };
}
