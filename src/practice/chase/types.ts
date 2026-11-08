/**
 * Target Chase: the types (contract CHASE-API v1; the plain-words description is docs/PRACTICE_CHASE.md and the
 * scratchpad copy CHASE-API.md). A chase is two six-ball overs, the existing one-wicket Practice innings, and a target:
 * the runs to win. Everything here is plain JSON data (no classes, no functions, no dates) so that the HUD, the audio
 * situation, the Unity bridge, the commentary and the local store can all carry it unchanged.
 *
 * The chase never touches the physics: the 12 balls are Practice overs generated from the seed, every ball is bowled
 * and resolved by the frozen simulation (src/physics, sim v3), and this module only counts what the physics decided.
 * Nothing in a chase is adapted to the player: the same seed and the same swings always give the same chase.
 */
import type {
  AssistLevel,
  DeliveryOutcome,
  Difficulty,
  Dismissal,
  FieldLayout,
  PitchCondition,
  PracticeInningsState,
  PracticeOverPlan,
  PRACTICE_SIM_VERSION,
} from '@/contracts/practice';
import type { NextDelivery } from '@/practice/game';

/** The version of the chase rules and of these shapes. Bump it when a rule or a type changes. */
export const CHASE_VERSION = 1 as const;

export const CHASE_OVERS = 2 as const;
export const CHASE_BALLS_PER_OVER = 6 as const;
/** 12 legal balls: Practice bowls no wides and no no-balls (docs/PRACTICE_RULES.md), so every ball counts. */
export const CHASE_BALLS = 12 as const;
/** The existing one-wicket innings: the first dismissal ends the chase. */
export const CHASE_WICKETS = 1 as const;
/** The most a ball can score (a six): 12 balls cannot make more than 72. */
export const CHASE_MAX_RUNS_PER_BALL = 6 as const;
export const CHASE_MIN_TARGET = 1 as const;
export const CHASE_MAX_TARGET = 72 as const;

/**
 * How demanding the target is, chosen once before the first ball and never changed (CHASE-API: Standard by default).
 * It sets the target only: the 12 balls of a seed are the same at every difficulty.
 */
export type ChaseDifficulty = 'easy' | 'standard' | 'hard';
export const CHASE_DIFFICULTIES: readonly ChaseDifficulty[] = ['easy', 'standard', 'hard'];
export const DEFAULT_CHASE_DIFFICULTY: ChaseDifficulty = 'standard';

/** The runs one ball can score (the physics' own set). */
export type BallRuns = DeliveryOutcome['runs'];

/** Which reference batter and which derivation produced a target (the method is in TARGET-METHOD.md). */
export interface ChasePolicyRef {
  id: string;
  version: number;
}

/**
 * One chase, fixed before the first ball. The seed and the difficulty give the 12 balls (`chaseOvers`) and the target
 * (the target table, derived once from the seed alone by the reference batter; never from anyone's play).
 */
export interface ChaseDefinition {
  v: typeof CHASE_VERSION;
  /** The simulation version the target was derived under; a chase saved under another version is discarded. */
  simVersion: typeof PRACTICE_SIM_VERSION;
  /** The chase seed (a name from the seed pool, e.g. "c042"). */
  seed: string;
  difficulty: ChaseDifficulty;
  /** 2 */
  overs: typeof CHASE_OVERS;
  /** 12 */
  balls: typeof CHASE_BALLS;
  /** 1 */
  wickets: typeof CHASE_WICKETS;
  /** The runs to win: reaching it wins at once; one run fewer when the balls run out loses. There is no tie. */
  target: number;
  /** The bowling quality of both overs (the Random Over's own levels): Club. */
  bowling: Difficulty;
  /** The pitch of both overs: Balanced. */
  conditions: PitchCondition;
  /** The reference batter and the derivation that produced `target`. */
  policy: ChasePolicyRef;
  /**
   * The share of the reference batter's simulated innings that reach `target` (0..1, 3 decimals). An engineering
   * number about a simulated batter, never a claim about a person: it is not shown to the player.
   */
  referenceWinRate: number;
}

/** A chase is in progress until one of these ends it. `abandoned` is the player leaving: it is neither a win nor a loss. */
export type ChaseDecided = 'won' | 'lost_wicket' | 'lost_balls';
export type ChaseResultCode = 'in_progress' | ChaseDecided | 'abandoned';

/** One ball of the chase, as the chase counts it. */
export interface ChaseBall {
  /** 0 or 1: the over of the chase. */
  overIndex: number;
  /** 0..5: the ball in its over. */
  ballIndex: number;
  runs: BallRuns;
  dismissal: Dismissal | null;
}

/** The ball that decided the chase (the win, the wicket or the 12th ball). */
export interface DecidingBall {
  overIndex: number;
  ballIndex: number;
  /** 1..12 */
  ballNumber: number;
  /** "overIndex:ballIndex", the key the innings summary and the result maps use. */
  key: string;
  runs: BallRuns;
  dismissal: Dismissal | null;
}

export interface ChaseState {
  v: typeof CHASE_VERSION;
  definition: ChaseDefinition;
  result: ChaseResultCode;
  runs: number;
  /** Balls bowled to the batter, the one that got him out included. */
  ballsFaced: number;
  /** 12 - ballsFaced, always: the balls to spare after a win, the balls not bowled after a wicket, 0 after the 12th. */
  ballsLeft: number;
  wicketsLost: 0 | 1;
  /** max(0, target - runs); 0 once won. */
  runsNeeded: number;
  /**
   * Runs per over still needed in hundredths, as an integer: round(runsNeeded * 600 / ballsLeft), halves up. The one
   * source of the figure (the web HUD and the Unity HUD both format this). Null unless the chase is in progress.
   */
  requiredRateX100: number | null;
  /** requiredRateX100 / 100 (runs per over, 2 decimals), for convenience. */
  requiredRate: number | null;
  /** Runs per over made so far in hundredths (an integer); null before the first ball. */
  currentRateX100: number | null;
  /** currentRateX100 / 100. */
  currentRate: number | null;
  /** Every ball so far, in order. */
  balls: ChaseBall[];
  decidingBall: DecidingBall | null;
}

export type ChaseAction =
  /** The next ball resolved. `overIndex` and `ballIndex` must be the ball due next (nothing is accepted out of order). */
  | { type: 'ball'; overIndex: number; ballIndex: number; runs: BallRuns; dismissal: Dismissal | null }
  /** The player leaves the chase for good: no win and no loss is recorded. */
  | { type: 'abandon' };

/** Where the chase is on its way, in words a commentary can pick from (text-free). */
export type ChasePhase = 'first_over' | 'last_over' | 'last_ball' | 'finished';

/**
 * How much the target asks for per remaining ball, text-free. `runsNeeded / ballsLeft`:
 * comfortable <= 1, steady <= 2, stretching <= 3.5, demanding <= 6, out_of_reach > 6 (a six off every ball is not
 * enough). `done` once the chase is decided.
 */
export type ChaseAsk = 'comfortable' | 'steady' | 'stretching' | 'demanding' | 'out_of_reach' | 'done';

/**
 * The text-free match situation: everything a HUD ("Need 14 off 7"), the crowd (src/audio/situation.ts), the Unity
 * bridge and the commentary need to know about the state of the chase. JSON-safe and versioned.
 */
export interface ChaseSituation {
  v: typeof CHASE_VERSION;
  result: ChaseResultCode;
  target: number;
  runs: number;
  runsNeeded: number;
  ballsFaced: number;
  ballsLeft: number;
  /** The ball due next, 1..12; 0 when the chase is decided. */
  ballNumber: number;
  /** 1 or 2 (the over of the ball due next); 0 when decided. */
  overNumber: number;
  /** 1..6 (the ball in its over due next); 0 when decided. */
  ballInOver: number;
  /** Balls left in the over of the ball due next, that ball included; 0 when decided. */
  ballsLeftInOver: number;
  wicketsLeft: 0 | 1;
  requiredRateX100: number | null;
  requiredRate: number | null;
  currentRateX100: number | null;
  currentRate: number | null;
  phase: ChasePhase;
  ask: ChaseAsk;
  /** runsNeeded <= 6 * ballsLeft: a win is still possible. */
  winnable: boolean;
  /** The next ball can win it on its own (runsNeeded <= 6). */
  oneBallFinish: boolean;
  /** The next ball is the 12th. */
  lastBall: boolean;
  /** 0..1: the crowd's pressure from this situation (src/audio/situation.ts matchPressure); 0 once decided. */
  pressure: number;
}

/** What may be done with the chase now. Replays never change a chase score, and there are none to take back. */
export interface ChaseAllowed {
  /** Bowl the next ball. */
  bowl: boolean;
  /** "Practice this ball": always off while the chase is in progress; after it ends, the deciding ball only (practice-only). */
  practiceThisBall: boolean;
  /** Watch the deciding ball again after the chase has ended (a replay; it changes nothing). */
  watchDecidingBall: boolean;
  /** "Restart over": never in a chase (it would take runs off). */
  restartOver: boolean;
  /** "Try this chase again": a fresh attempt at the same seed and difficulty, once the chase has ended. */
  tryAgain: boolean;
}

/** What the win and loss screen needs, and what the local store keeps. */
export interface ChaseSummary {
  v: typeof CHASE_VERSION;
  seed: string;
  difficulty: ChaseDifficulty;
  target: number;
  result: ChaseDecided;
  runs: number;
  ballsFaced: number;
  ballsLeft: number;
  /** target - runs for a loss (>= 1), 0 for a win. */
  runsShort: number;
  decidingBall: DecidingBall;
  /** The assistance level the chase was batted on (timing bands only; the player chose it before the first ball). */
  assist: AssistLevel;
}

export interface ChaseHistoryEntry extends ChaseSummary {
  /** When it ended (ms since the epoch, given by the caller; the chase module never reads a clock). */
  finishedAtMs: number;
}

/**
 * The local history: the last finished result for each (seed, difficulty), newest first, at most CHASE_HISTORY_MAX
 * entries (the oldest is dropped). No ranking, no counters, nothing leaves the device.
 */
export interface ChaseHistory {
  v: typeof CHASE_VERSION;
  entries: ChaseHistoryEntry[];
}
export const CHASE_HISTORY_MAX = 32 as const;

/** The chase being batted, saved so a leave or a kill can resume it (the innings carries the in-flight protection). */
export interface SavedChase {
  v: typeof CHASE_VERSION;
  definition: ChaseDefinition;
  innings: PracticeInningsState;
}

/** One over of the chase as the Practice innings takes it (`chooseOver`): the fixed plan and the field set for it. */
export interface ChaseOverSetup {
  /** 0 or 1 */
  overIndex: number;
  plan: PracticeOverPlan;
  field: FieldLayout;
}

/**
 * What the screen should do next, read from the innings and the chase together (`chaseStep`), so the UI does not
 * re-implement the order of events.
 */
export type ChaseStep =
  /** A ball is due: this is the delivery to prepare and bowl. */
  | { kind: 'bowl'; next: NextDelivery }
  /** A delivery is in flight: wait for its result (a resumed in-flight ball is resolved by `resumeChase`). */
  | { kind: 'wait' }
  /** The over just ended and the chase goes on: the over break; then dispatch the innings action `nextOver`. */
  | { kind: 'next_over' }
  /** Dispatch the innings action `chooseOver` with this setup. */
  | { kind: 'choose_over'; setup: ChaseOverSetup }
  /**
   * The chase is decided (or abandoned). When `closeInnings` is true the innings is still open and the screen
   * dispatches the innings action `abandon` once, which only closes it (the chase result is already final).
   */
  | { kind: 'finished'; summary: ChaseSummary | null; closeInnings: boolean };
