/**
 * Innings flow (engine v1). Every innings is always six main balls and then the precommitted Super Ball, so the length
 * of an innings never leaks a sealed wicket: after the second wicket the remaining main balls are bowled and answered
 * as usual but resolve as dead balls (no runs, no wicket, excluded from the summary and the replay). The batter's
 * immediate feedback (timing and contact) is computed exactly as for a live ball.
 */
import type { BallOutcome, InningsState, InningsSummary, ResolveArgs, ShotFeedback } from '@/contracts';
import { BALLS_PER_OVER, SUPER_BALL_INDEX, WICKETS_PER_INNINGS } from '@/contracts/cricket';
import { resolveBall } from './resolve';

export function startInnings(innings: 0 | 1): InningsState {
  return { innings, nextBall: 0, runs: 0, wickets: 0, outcomes: [], superBall: null, mainDone: false, done: false };
}

/** A ball bowled after the innings ended: same delivery, timing and contact, but it scores nothing. */
function deadBall(o: BallOutcome): BallOutcome {
  return {
    ...o,
    runs: 0,
    wicket: null,
    fielder: null,
    dead: true,
    factors: { ...o.factors, explainKey: 'explain.dead_ball' },
    cues: {
      ...o.cues,
      fate: { kind: o.contact === 'middle' || o.contact === 'thick_edge' ? 'dot_block' : 'dot_beaten', zone: null },
      crowd: 0.05,
      celebration: 'none',
      slowMotion: false,
      key: false,
      cameras: o.cues.cameras.filter((c) => c.shot === 'bowler_follow' || c.shot === 'broadcast_end'),
    },
  };
}

const feedbackOf = (o: BallOutcome): ShotFeedback => ({ ball: o.ball, timing: o.timing, contact: o.contact });

/**
 * Resolves `state.nextBall` (0–5, then the Super Ball). Never throws: an input addressed to a different ball is
 * ignored (the ball resolves as unanswered), and a finished innings returns its final ball again (idempotent).
 */
export function resolveNextBall(state: InningsState, args: ResolveArgs): { state: InningsState; outcome: BallOutcome; feedback: ShotFeedback } {
  if (state.done || state.nextBall > SUPER_BALL_INDEX) {
    const last = state.superBall ?? state.outcomes[state.outcomes.length - 1];
    if (last) return { state, outcome: last, feedback: feedbackOf(last) };
  }
  const nb = state.nextBall;
  const ball = state.mainDone ? SUPER_BALL_INDEX : Number.isInteger(nb) && nb >= 0 && nb < BALLS_PER_OVER ? nb : Math.min(state.outcomes.length, BALLS_PER_OVER - 1);
  const input = args.input && args.input.ball === ball ? args.input : null;
  const live = state.outcomes.filter((o) => !o.dead);
  const raw = resolveBall({ seed: args.seed, conditions: args.conditions, plan: args.plan, input, innings: state.innings, ball, previous: live });
  if (state.mainDone) {
    return { state: { ...state, outcomes: state.outcomes.slice(), superBall: raw, nextBall: SUPER_BALL_INDEX + 1, done: true }, outcome: raw, feedback: feedbackOf(raw) };
  }
  const outcome = state.wickets >= WICKETS_PER_INNINGS ? deadBall(raw) : raw;
  const runs = state.runs + (outcome.dead ? 0 : outcome.runs);
  const wickets = state.wickets + (outcome.dead || !outcome.wicket ? 0 : 1);
  const outcomes = [...state.outcomes, outcome];
  const mainDone = ball >= BALLS_PER_OVER - 1;
  return {
    state: { ...state, runs, wickets, outcomes, nextBall: mainDone ? SUPER_BALL_INDEX : ball + 1, mainDone, done: false },
    outcome,
    feedback: feedbackOf(outcome),
  };
}

/** Summary of the main innings: live balls only (dead balls after the second wicket are left out). */
export function summarise(state: InningsState, batter: 0 | 1): InningsSummary {
  const balls = state.outcomes.filter((o) => !o.dead);
  return { batter, bowler: batter === 0 ? 1 : 0, balls, runs: state.runs, wickets: state.wickets, ballsFaced: balls.length };
}
