/**
 * The text-free match situation of a chase: one pure function from the chase state to the numbers and closed codes
 * that the HUD ("Need 14 off 7"), the crowd (src/audio/situation.ts), the Unity bridge and the commentary read. It
 * never chooses a word and never touches the simulation: the same ball is bowled and judged whatever the situation.
 */
import { matchPressure, type MatchSituation } from '@/audio/situation';
import {
  CHASE_BALLS_PER_OVER,
  CHASE_MAX_RUNS_PER_BALL,
  CHASE_VERSION,
  type ChaseAsk,
  type ChasePhase,
  type ChaseSituation,
  type ChaseState,
} from './types';

/** Where each `ChaseAsk` ends, in runs per remaining ball (an upper bound, inclusive). */
export const CHASE_ASK_LIMITS = { comfortable: 1, steady: 2, stretching: 3.5, demanding: 6 } as const;

/** How much the target asks for per remaining ball. `done` is for a finished chase; a state with nothing to ask is comfortable. */
export function askOf(runsNeeded: number, ballsLeft: number): ChaseAsk {
  if (runsNeeded <= 0) return 'comfortable';
  if (ballsLeft <= 0) return 'out_of_reach';
  const perBall = runsNeeded / ballsLeft;
  if (perBall <= CHASE_ASK_LIMITS.comfortable) return 'comfortable';
  if (perBall <= CHASE_ASK_LIMITS.steady) return 'steady';
  if (perBall <= CHASE_ASK_LIMITS.stretching) return 'stretching';
  if (perBall <= CHASE_ASK_LIMITS.demanding) return 'demanding';
  return 'out_of_reach';
}

/**
 * The chase as src/audio/situation.ts takes it (`deliveryContext` and `matchPressure` read this): the runs so far, the
 * wickets in hand, the legal balls left and the runs to win. It describes the ball due next.
 */
export function audioSituation(state: ChaseState): MatchSituation {
  return {
    runs: state.runs,
    wicketsInHand: 1 - state.wicketsLost,
    ballsLeft: state.ballsLeft,
    target: state.definition.target,
    batterRuns: state.runs,
  };
}

/** The situation before the next ball (or after the last: `finished`, with every ball field 0). */
export function chaseSituation(state: ChaseState): ChaseSituation {
  const open = state.result === 'in_progress';
  const due = open ? state.ballsFaced + 1 : 0;
  const ballInOver = due ? ((due - 1) % CHASE_BALLS_PER_OVER) + 1 : 0;
  const lastBall = open && state.ballsLeft === 1;
  const phase: ChasePhase = !open
    ? 'finished'
    : lastBall
      ? 'last_ball'
      : due > CHASE_BALLS_PER_OVER
        ? 'last_over'
        : 'first_over';
  return {
    v: CHASE_VERSION,
    result: state.result,
    target: state.definition.target,
    runs: state.runs,
    runsNeeded: state.runsNeeded,
    ballsFaced: state.ballsFaced,
    ballsLeft: state.ballsLeft,
    ballNumber: due,
    overNumber: due ? Math.floor((due - 1) / CHASE_BALLS_PER_OVER) + 1 : 0,
    ballInOver,
    ballsLeftInOver: due ? CHASE_BALLS_PER_OVER - ballInOver + 1 : 0,
    wicketsLeft: (1 - state.wicketsLost) as 0 | 1,
    requiredRateX100: state.requiredRateX100,
    requiredRate: state.requiredRate,
    currentRateX100: state.currentRateX100,
    currentRate: state.currentRate,
    phase,
    ask: open ? askOf(state.runsNeeded, state.ballsLeft) : 'done',
    winnable: open ? state.runsNeeded <= CHASE_MAX_RUNS_PER_BALL * state.ballsLeft : state.result === 'won',
    oneBallFinish: open && state.runsNeeded <= CHASE_MAX_RUNS_PER_BALL,
    lastBall,
    pressure: open ? matchPressure(audioSituation(state)) : 0,
  };
}
