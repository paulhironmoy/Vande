/**
 * Public API of the Sealed Six engine — ROOT-OWNED contract, implemented by the gameplay workstream in
 * src/engine/index.ts. Pure and deterministic: no DOM, no Node APIs, no wall clock, no Math.random. The Worker
 * (authoritative results), the app (Training, Ghosts, presentation) and the render service all call the same code.
 */
import type {
  BattingInput,
  BallOutcome,
  Conditions,
  DeliveryPlan,
  DeliveryVariant,
  ExecutionGrade,
  InningsSummary,
  InputTrace,
  MatchEventLog,
  MatchKind,
  OverPlan,
  PlayerRef,
  RevealedDelivery,
  ShotFeedback,
  CommitRecord,
  FieldSetting,
} from './cricket';
import type { Top100Components } from './highlights';

export type Ok<T> = { ok: true } & T;
export type Fail = { ok: false; errors: string[] };

/** Running state of one batting innings (serializable; the MatchDO persists it between balls). */
export interface InningsState {
  innings: 0 | 1;
  /** Next ball index to be bowled: 0–5, then 6 (SUPER_BALL_INDEX), then done. */
  nextBall: number;
  runs: number;
  wickets: number;
  outcomes: BallOutcome[];
  /** The Super Ball outcome once played. */
  superBall: BallOutcome | null;
  mainDone: boolean;
  done: boolean;
}

export interface ResolveArgs {
  seed: string;
  conditions: Conditions;
  /** The bowler's sealed plan. */
  plan: OverPlan;
  /** A validated input (or null when the ball was revealed but never answered: resolves as a leave). */
  input: BattingInput | null;
}

export interface GhostProfile {
  id: string;
  /** i18n key for the ghost's name and style line. */
  nameKey: string;
  styleKey: string;
  difficulty: 1 | 2 | 3;
}

export interface SealedSixEngineApi {
  readonly ENGINE_VERSION: number;
  readonly OVER_ENERGY_BUDGET: number;

  /** Energy cost of one delivery (variant + intensity). */
  energyCost(d: Omit<DeliveryPlan, 'gesture'>): number;
  /** Delivery variants available at the start (others unlock through achievements). */
  readonly STARTER_VARIANTS: readonly DeliveryVariant[];
  /** Full plan validation: shape, allowed combinations, energy budget, unlocks, gesture plausibility. */
  validatePlan(plan: OverPlan, unlocked: readonly DeliveryVariant[]): Ok<{ plan: OverPlan }> | Fail;
  /** Server-side execution quality from the raw gesture trace; rejects impossible traces. */
  executionQuality(trace: InputTrace): Ok<{ quality: number; grade: ExecutionGrade }> | Fail;

  /** Canonical JSON used for hashing (stable key order, no whitespace). */
  canonicalPlan(plan: OverPlan): string;
  /** SHA-256 hex of canonical plan + salt (WebCrypto; async). */
  commitHash(plan: OverPlan, salt: string): Promise<string>;

  /** What the batter sees for ball `ball` (0–5 or SUPER_BALL_INDEX), at the moment it is bowled. */
  revealDelivery(plan: OverPlan, ball: number, conditions: Conditions): RevealedDelivery;
  /** Validates a batting input against the revealed delivery (timing bounds, trace plausibility, shot/zone rules). */
  validateBattingInput(input: BattingInput, delivery: RevealedDelivery): Ok<{ input: BattingInput }> | Fail;

  startInnings(innings: 0 | 1): InningsState;
  /**
   * Resolves the next ball of the innings: balls 0–5 (balls after the second wicket resolve as dead balls), then the
   * Super Ball. Returns `outcome.ball === state.nextBall` of the input state. Never throws on validated inputs.
   */
  resolveNextBall(state: InningsState, args: ResolveArgs): { state: InningsState; outcome: BallOutcome; feedback: ShotFeedback };
  /** Summarises a finished innings. */
  summarise(state: InningsState, batter: 0 | 1): InningsSummary;

  /** Builds the full, revealed replay log from both finished innings. */
  buildMatchLog(args: {
    matchId: string;
    kind: MatchKind;
    seed: string;
    conditions: Conditions;
    players: [PlayerRef, PlayerRef];
    commits: [CommitRecord, CommitRecord];
    plans: [OverPlan, OverPlan];
    /**
     * Inputs in play order: exactly one entry per resolved ball of each innings (balls 0–5 including dead balls, then
     * the Super Ball), null where the ball resolved as a leave because it was never answered.
     */
    inputs: [Array<BattingInput | null>, Array<BattingInput | null>];
    innings: [InningsState, InningsState];
    meta: MatchEventLog['meta'];
  }): MatchEventLog;
  /** Re-runs a revealed log with its own engine version and checks hashes and every outcome. */
  verifyMatchLog(log: MatchEventLog): Promise<{ ok: true } | Fail>;

  /** Auto Over: a balanced, legal over generated for a player who missed the lock deadline. */
  autoOver(seed: string, conditions: Conditions): OverPlan;
  /** Auto XI: a cautious batting policy for a player who missed the batting deadline (aims at gaps when `field` is given). */
  autoBat(seed: string, delivery: RevealedDelivery, field?: FieldSetting): BattingInput;

  readonly GHOSTS: readonly GhostProfile[];
  ghostPlan(ghostId: string, seed: string, conditions: Conditions): OverPlan;
  ghostBat(ghostId: string, seed: string, delivery: RevealedDelivery, field?: FieldSetting): BattingInput;

  /**
   * Daily Six: conditions and the three sealed daily overs (attempts 1–3), identical for everyone on `day`. The server
   * passes a secret `serverSalt` so the overs cannot be computed in advance from the client bundle.
   */
  dailyChallenge(day: string, serverSalt?: string): { conditions: Conditions; overs: [OverPlan, OverPlan, OverPlan] };
  /**
   * Daily Six solo replay: a revealed log of kind 'daily' (players[1] is the Daily Six setter, the setter's over is
   * the only plan, innings[1] is empty, the result is the player's score). verifyMatchLog must accept it.
   */
  buildDailyLog(args: {
    attemptId: string;
    day: string;
    attempt: 1 | 2 | 3;
    seed: string;
    serverSalt: string;
    player: PlayerRef;
    setter: PlayerRef;
    inputs: Array<BattingInput | null>;
    innings: InningsState;
    meta: MatchEventLog['meta'];
  }): MatchEventLog;
  /** Daily Six score for a finished innings (runs-led, with documented bonuses). */
  dailyScore(summary: InningsSummary): number;

  /** Per-match performance used by the Top 100 ranking (the platform adds wins, opponent strength, importance). */
  matchPerformance(log: MatchEventLog, player: 0 | 1): Pick<Top100Components, 'tacticalEfficiency' | 'clutch' | 'execution'>;
}
