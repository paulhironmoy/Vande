/**
 * The chase rules: a pure reducer over what the physics decided, ball by ball. It counts; it never decides a ball.
 *
 *   in_progress ──(runs >= target)──▶ won           the winning run ends it at once
 *   in_progress ──(a wicket)────────▶ lost_wicket   the one wicket of the Practice innings
 *   in_progress ──(the 12th ball, target not reached)──▶ lost_balls
 *   in_progress ──(abandon)─────────▶ abandoned     neither a win nor a loss
 *
 * Rules (decisions are in S/chase/DECISIONS.md and docs/PRACTICE_CHASE.md):
 *  - the target is the runs to win. Reaching it exactly wins; one run fewer when the balls run out loses. There is no tie.
 *  - a wicket on the 12th ball loses as `lost_wicket` (the wicket is what ended it). A wicket scores no runs, so a
 *    wicket can never be the ball that wins.
 *  - there are no extras: Practice bowls no wides and no no-balls (docs/PRACTICE_RULES.md), every ball counts.
 *  - once a chase is decided no ball is accepted. Nothing here can lower a score: there is no undo, no restart and no
 *    replay action. "Practice this ball" and "Restart over" are not part of a chase (`chaseAllowed`).
 *  - the same balls in the same order always give the same state, byte for byte (no clock, no random numbers).
 */
import {
  PRACTICE_SIM_VERSION,
  type AssistLevel,
  type DeliveryRecord,
  type PracticeInningsState,
} from '@/contracts/practice';
import {
  CHASE_BALLS,
  CHASE_BALLS_PER_OVER,
  CHASE_MAX_TARGET,
  CHASE_MIN_TARGET,
  CHASE_OVERS,
  CHASE_VERSION,
  CHASE_WICKETS,
  CHASE_DIFFICULTIES,
  type ChaseAction,
  type ChaseAllowed,
  type ChaseDefinition,
  type ChaseResultCode,
  type ChaseState,
  type ChaseSummary,
  type DecidingBall,
} from './types';

const RUNS: ReadonlySet<number> = new Set([0, 1, 2, 3, 4, 6]);
const DISMISSALS: ReadonlySet<string> = new Set(['bowled', 'caught', 'caught_behind', 'lbw']);

/**
 * Runs per over still needed in hundredths (an integer): round(runsNeeded * 600 / ballsLeft), halves up. Null when
 * nothing is needed or no ball is left. Equal to floor((runsNeeded * 1200 + ballsLeft) / (2 * ballsLeft)).
 */
export function requiredRateX100Of(runsNeeded: number, ballsLeft: number): number | null {
  if (runsNeeded <= 0 || ballsLeft <= 0) return null;
  return Math.floor((runsNeeded * 1200 + ballsLeft) / (2 * ballsLeft));
}

/** Runs per over made so far in hundredths (an integer); null before the first ball. */
export function currentRateX100Of(runs: number, ballsFaced: number): number | null {
  if (ballsFaced <= 0) return null;
  return Math.floor((runs * 1200 + ballsFaced) / (2 * ballsFaced));
}

const per100 = (x: number | null): number | null => (x === null ? null : x / 100);

/** requiredRateX100 / 100, runs per over (2 decimals), or null. */
export const requiredRateOf = (runsNeeded: number, ballsLeft: number): number | null =>
  per100(requiredRateX100Of(runsNeeded, ballsLeft));

/** currentRateX100 / 100, runs per over (2 decimals), or null. */
export const currentRateOf = (runs: number, ballsFaced: number): number | null =>
  per100(currentRateX100Of(runs, ballsFaced));

/** Why a definition cannot be used (a closed code), or null when it is a well-formed chase. */
export function chaseDefinitionError(def: unknown): string | null {
  const d = def as Partial<ChaseDefinition> | null;
  if (!d || typeof d !== 'object') return 'not_an_object';
  if (d.v !== CHASE_VERSION) return 'wrong_version';
  if (d.simVersion !== PRACTICE_SIM_VERSION) return 'wrong_sim_version';
  if (typeof d.seed !== 'string' || d.seed.length === 0 || d.seed.length > 64) return 'bad_seed';
  if (!CHASE_DIFFICULTIES.includes(d.difficulty as never)) return 'bad_difficulty';
  if (d.overs !== CHASE_OVERS || d.balls !== CHASE_BALLS || d.wickets !== CHASE_WICKETS) return 'bad_shape';
  if (!Number.isInteger(d.target) || (d.target as number) < CHASE_MIN_TARGET || (d.target as number) > CHASE_MAX_TARGET)
    return 'bad_target';
  if (d.bowling !== 'beginner' && d.bowling !== 'club' && d.bowling !== 'expert') return 'bad_bowling';
  if (d.conditions !== 'balanced' && d.conditions !== 'green' && d.conditions !== 'hard' && d.conditions !== 'turning')
    return 'bad_conditions';
  const p = d.policy;
  if (!p || typeof p.id !== 'string' || !Number.isInteger(p.version)) return 'bad_policy';
  if (typeof d.referenceWinRate !== 'number' || !(d.referenceWinRate >= 0 && d.referenceWinRate <= 1))
    return 'bad_reference_rate';
  return null;
}

/** A fresh chase: nothing bowled, the whole target to get. */
export function startChase(definition: ChaseDefinition): ChaseState {
  return {
    v: CHASE_VERSION,
    definition,
    result: 'in_progress',
    runs: 0,
    ballsFaced: 0,
    ballsLeft: definition.balls,
    wicketsLost: 0,
    runsNeeded: definition.target,
    requiredRateX100: requiredRateX100Of(definition.target, definition.balls),
    requiredRate: requiredRateOf(definition.target, definition.balls),
    currentRateX100: null,
    currentRate: null,
    balls: [],
    decidingBall: null,
  };
}

/** The (over, ball) due next in a chase that has faced `ballsFaced` balls. */
export function dueBall(ballsFaced: number): { overIndex: number; ballIndex: number } {
  return { overIndex: Math.floor(ballsFaced / CHASE_BALLS_PER_OVER), ballIndex: ballsFaced % CHASE_BALLS_PER_OVER };
}

/** Why an action cannot be applied to this state (a closed code), or null when it can. */
export function chaseError(state: ChaseState, action: ChaseAction): string | null {
  if (state.v !== CHASE_VERSION) return 'wrong_version';
  switch (action.type) {
    case 'ball': {
      if (state.result !== 'in_progress') return 'chase_over';
      const due = dueBall(state.ballsFaced);
      if (action.overIndex !== due.overIndex || action.ballIndex !== due.ballIndex) return 'wrong_ball';
      if (!RUNS.has(action.runs)) return 'bad_runs';
      if (action.dismissal !== null && (!DISMISSALS.has(action.dismissal) || action.runs !== 0)) return 'bad_dismissal';
      return null;
    }
    case 'abandon':
      return state.result === 'in_progress' ? null : 'chase_over';
  }
}

/** Apply an action; one that is not allowed leaves the state exactly as it was (the same object). */
export function chaseReducer(state: ChaseState, action: ChaseAction): ChaseState {
  if (chaseError(state, action) !== null) return state;
  switch (action.type) {
    case 'ball': {
      const def = state.definition;
      const runs = state.runs + action.runs;
      const ballsFaced = state.ballsFaced + 1;
      const wicketsLost: 0 | 1 = action.dismissal ? 1 : state.wicketsLost;
      const ball = {
        overIndex: action.overIndex,
        ballIndex: action.ballIndex,
        runs: action.runs,
        dismissal: action.dismissal,
      };
      let result: ChaseResultCode = 'in_progress';
      if (action.dismissal) result = 'lost_wicket';
      else if (runs >= def.target) result = 'won';
      else if (ballsFaced >= def.balls) result = 'lost_balls';
      const ballsLeft = def.balls - ballsFaced;
      const runsNeeded = Math.max(0, def.target - runs);
      const decidingBall: DecidingBall | null =
        result === 'in_progress'
          ? null
          : { ...ball, ballNumber: ballsFaced, key: `${action.overIndex}:${action.ballIndex}` };
      return {
        ...state,
        result,
        runs,
        ballsFaced,
        ballsLeft,
        wicketsLost,
        runsNeeded,
        // The required rate only exists while there is something left to chase.
        requiredRateX100: result === 'in_progress' ? requiredRateX100Of(runsNeeded, ballsLeft) : null,
        requiredRate: result === 'in_progress' ? requiredRateOf(runsNeeded, ballsLeft) : null,
        currentRateX100: currentRateX100Of(runs, ballsFaced),
        currentRate: currentRateOf(runs, ballsFaced),
        balls: [...state.balls, ball],
        decidingBall,
      };
    }
    case 'abandon':
      return { ...state, result: 'abandoned', requiredRateX100: null, requiredRate: null };
  }
}

/** The chase action for a resolved delivery's record. */
export function ballActionOf(
  record: Pick<DeliveryRecord, 'overIndex' | 'ballIndex' | 'runs' | 'dismissal'>,
): ChaseAction {
  return {
    type: 'ball',
    overIndex: record.overIndex,
    ballIndex: record.ballIndex,
    runs: record.runs,
    dismissal: record.dismissal,
  };
}

/** Every delivery of an innings in the order bowled (the completed overs, then the over being batted). */
export function inningsDeliveries(innings: PracticeInningsState): DeliveryRecord[] {
  return [...innings.overs.flatMap((o) => o.deliveries), ...(innings.current?.deliveries ?? [])];
}

/**
 * The chase as a projection of its Practice innings: the innings stays the one saved truth (with its in-flight
 * protection), and the chase is read from its records. Folding the records through `chaseReducer` is the definition,
 * so the two can never drift apart. An innings that was abandoned while the chase was still open abandons the chase.
 */
export function chaseFromInnings(definition: ChaseDefinition, innings: PracticeInningsState): ChaseState {
  let state = startChase(definition);
  for (const record of inningsDeliveries(innings)) state = chaseReducer(state, ballActionOf(record));
  if (state.result === 'in_progress' && innings.status === 'complete') state = chaseReducer(state, { type: 'abandon' });
  return state;
}

export const isDecided = (state: ChaseState): boolean =>
  state.result === 'won' || state.result === 'lost_wicket' || state.result === 'lost_balls';

/** What may be done now. "Practice this ball" and "Restart over" are never allowed while the chase is in progress. */
export function chaseAllowed(state: ChaseState): ChaseAllowed {
  const decided = isDecided(state);
  return {
    bowl: state.result === 'in_progress',
    practiceThisBall: decided,
    watchDecidingBall: decided,
    restartOver: false,
    tryAgain: state.result !== 'in_progress',
  };
}

/** The win or loss screen's numbers, or null while the chase is in progress or after it was abandoned. */
export function chaseSummary(state: ChaseState, assist: AssistLevel): ChaseSummary | null {
  if (!isDecided(state) || !state.decidingBall) return null;
  return {
    v: CHASE_VERSION,
    seed: state.definition.seed,
    difficulty: state.definition.difficulty,
    target: state.definition.target,
    result: state.result as ChaseSummary['result'],
    runs: state.runs,
    ballsFaced: state.ballsFaced,
    ballsLeft: state.ballsLeft,
    runsShort: state.runsNeeded,
    decidingBall: state.decidingBall,
    assist,
  };
}
