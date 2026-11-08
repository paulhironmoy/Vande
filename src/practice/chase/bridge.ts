/**
 * The chase figures the Unity bridge carries (contract v7; the wire type lives in src/contracts/unityPractice.ts, which
 * this module never imports): six numbers and one closed code, read straight from the chase state so the web HUD and the
 * Unity HUD show the same chase.
 */
import type { ChaseState } from './types';

export interface ChaseBridgeBlock {
  /** definition.target (fixed for the whole chase). */
  target: number;
  /** overs * 6 (12). */
  maxBalls: number;
  /** After the ball: max(0, target - runs); 0 once won. */
  runsNeeded: number;
  /** After the ball: maxBalls - ballsFaced (not zeroed when a wicket ends the chase early). */
  ballsLeft: number;
  outcome: 'in_progress' | 'won' | 'lost_wicket' | 'lost_balls';
  /** floor((runsNeeded * 1200 + ballsLeft) / (2 * ballsLeft)); null unless in progress. */
  requiredRateX100: number | null;
}

/** The bridge block for a chase state, or null for an abandoned chase (there is no scene to carry it to). */
export function chaseBridgeBlock(state: ChaseState): ChaseBridgeBlock | null {
  if (state.result === 'abandoned') return null;
  return {
    target: state.definition.target,
    maxBalls: state.definition.balls,
    runsNeeded: state.runsNeeded,
    ballsLeft: state.ballsLeft,
    outcome: state.result as ChaseBridgeBlock['outcome'],
    requiredRateX100: state.result === 'in_progress' ? state.requiredRateX100 : null,
  };
}
