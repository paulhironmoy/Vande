/**
 * Sealed Six domain contracts — ROOT-OWNED. Every workstream builds against these types.
 * Change them only through the root agent; bump ENGINE_VERSION whenever a rule change can alter an outcome, and
 * EVENT_SCHEMA_VERSION whenever the replay log shape changes. Old replays must stay readable (see GAME_RULES.md).
 *
 * Shape of a match: two one-over innings. Each player seals a six-ball bowling plan (plus a precommitted Super Ball),
 * then bats asynchronously against the opponent's sealed over. Results are computed by the server from the committed
 * plan, validated inputs, player-independent rules, the conditions and a versioned seed; they stay sealed until both
 * innings are done (or a deadline passes) and are then revealed ball by ball.
 */

/** Integer engine version. Recorded in every replay; a replay is always verified with its own engine version. */
export const ENGINE_VERSION = 1 as const;
/** Replay/event-log schema version. */
export const EVENT_SCHEMA_VERSION = 1 as const;

export const BALLS_PER_OVER = 6 as const;
/** Innings end after this many wickets (two batters out = all out in a one-over innings). */
export const WICKETS_PER_INNINGS = 2 as const;
/** Index of the precommitted Super Ball in batting inputs and outcomes. */
export const SUPER_BALL_INDEX = 6 as const;

// ---------------------------------------------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------------------------------------------

/** Green: movement and swing. Hard: pace, bounce, boundaries. Slow: spin, mistiming, placement. */
export type PitchId = 'green' | 'hard' | 'slow';
/** Weather nudges the pitch (humid helps swing, dew makes spin grip less). Small, always shown to both players. */
export type WeatherId = 'clear' | 'humid' | 'dew';

export interface Conditions {
  pitch: PitchId;
  weather: WeatherId;
}

// ---------------------------------------------------------------------------------------------------------------
// Input traces (raw, validated server-side; never trusted as a quality number)
// ---------------------------------------------------------------------------------------------------------------

export type PointerKind = 'touch' | 'mouse' | 'pen' | 'keyboard';

/**
 * Raw pointer samples captured on the gesture surface. `t` is ms since the first sample; `x`/`y` are 0..1 within the
 * surface. At most MAX_TRACE_SAMPLES samples; the engine rejects impossible traces (non-monotonic time, teleporting
 * points, superhuman precision patterns, durations outside human bounds).
 */
export interface InputTrace {
  pointer: PointerKind;
  samples: Array<[t: number, x: number, y: number]>;
}
export const MAX_TRACE_SAMPLES = 120 as const;

// ---------------------------------------------------------------------------------------------------------------
// Bowling plan
// ---------------------------------------------------------------------------------------------------------------

/** What the player picks first; readable names. Each variant belongs to one family and constrains length. */
export type DeliveryVariant = 'yorker' | 'good_length' | 'bouncer' | 'slower' | 'inswing' | 'outswing' | 'offspin' | 'legspin';
export type DeliveryFamily = 'pace' | 'swing' | 'spin';
export type Line = 'wide_off' | 'off' | 'middle' | 'leg';
export type Length = 'full' | 'good' | 'short';
/**
 * Pace or spin modifier. Pace and swing: 1 change-up, 2 stock, 3 express. Spin: 1 flighted, 2 stock, 3 quick and flat.
 * Higher intensity costs more energy.
 */
export type Intensity = 1 | 2 | 3;
/** Attack: hunts wickets, costlier when it goes wrong. Contain: dries up runs. Setup: makes the next ball better. */
export type Intent = 'attack' | 'contain' | 'setup';
/** Over-level field, visible to the batter at the start of the innings (like real cricket). */
export type FieldSetting = 'attacking' | 'balanced' | 'sweeper';

export interface DeliveryPlan {
  variant: DeliveryVariant;
  line: Line;
  length: Length;
  intensity: Intensity;
  intent: Intent;
  /** Execution gesture performed while planning; the server derives execution quality from it. */
  gesture: InputTrace;
}

export interface OverPlan {
  v: 1;
  field: FieldSetting;
  balls: [DeliveryPlan, DeliveryPlan, DeliveryPlan, DeliveryPlan, DeliveryPlan, DeliveryPlan];
  /** Precommitted tie-break delivery; bowled to the opponent only as the Super Ball. */
  superBall: DeliveryPlan;
}

/**
 * What the batter's client receives for one delivery, at the moment it is bowled (never earlier). The gesture and
 * intent stay sealed until the reveal; execution is applied server-side.
 */
export interface RevealedDelivery {
  ball: number;
  variant: DeliveryVariant;
  family: DeliveryFamily;
  line: Line;
  length: Length;
  intensity: Intensity;
  /** Flight timing the client must render and the server validates against (from the engine). */
  timing: DeliveryTiming;
  /** Presentation path for the renderer (deterministic from the delivery and conditions). */
  path: BallPath;
}

export interface DeliveryTiming {
  /** ms from release to the ideal contact moment. */
  releaseToContactMs: number;
  /** Half-widths of the timing grades around the ideal contact, in ms. */
  perfectMs: number;
  goodMs: number;
  /** Taps outside goodMs but within this are early/late; beyond it very early/very late. */
  edgeMs: number;
}

/** Normalised ball path for rendering: pitch coordinates in metres, z along the pitch from the bowler's crease. */
export interface BallPath {
  speedKph: number;
  releaseHeightM: number;
  bounceAtM: number;
  /** Lateral position at the batter (metres from middle stump, + towards off side for a right-hander). */
  lineAtBatM: number;
  /** Swing (in the air) and turn (off the pitch), metres of lateral movement. */
  swingM: number;
  turnM: number;
  /** Height at the batter in metres (bouncers high, yorkers at the toes). */
  heightAtBatM: number;
  spinRpm: number;
  seamUpright: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Batting
// ---------------------------------------------------------------------------------------------------------------

export type ShotType = 'defend' | 'rotate' | 'drive' | 'cut_pull' | 'sweep' | 'loft' | 'leave';
/** Eight fielding zones (right-handed batter view); a swipe angle is quantised to one zone. */
export type FieldZone = 'third_man' | 'point' | 'cover' | 'mid_off' | 'mid_on' | 'midwicket' | 'square_leg' | 'fine_leg';

export interface BattingInput {
  v: 1;
  /** 0–5, or SUPER_BALL_INDEX. */
  ball: number;
  shot: ShotType;
  /** Target zone; null for defend and leave. */
  zone: FieldZone | null;
  /** ms from the rendered release to the tap; null = no tap (leave or missed the window). */
  tapMs: number | null;
  /** Swipe + tap trace for plausibility checks. */
  trace: InputTrace;
  /** Client ms between receiving the delivery and the tap (helps latency accounting; never trusted alone). */
  clientElapsedMs: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------------------------------------------

export type Runs = 0 | 1 | 2 | 3 | 4 | 6;
export type WicketKind = 'bowled' | 'caught' | 'lbw' | 'stumped' | 'run_out';
export type TimingGrade = 'perfect' | 'good' | 'early' | 'late' | 'very_early' | 'very_late' | 'no_shot' | 'interrupted';
export type Contact = 'middle' | 'thick_edge' | 'thin_edge' | 'pad' | 'miss' | 'none';
export type ExecutionGrade = 'perfect' | 'good' | 'loose';

/** Why the ball went the way it did — the tactical explanation shown after the reveal. Each factor is -1..1. */
export interface OutcomeFactors {
  matchup: number;
  timing: number;
  execution: number;
  pitch: number;
  field: number;
  setup: number;
  /** Shot risk 0..1. */
  risk: number;
  /** i18n key of the one-line explanation, e.g. 'explain.yorker_vs_loft'. */
  explainKey: string;
}

export interface BallOutcome {
  ball: number;
  delivery: Omit<DeliveryPlan, 'gesture'>;
  execution: number;
  executionGrade: ExecutionGrade;
  shot: ShotType;
  zone: FieldZone | null;
  timing: TimingGrade;
  contact: Contact;
  runs: Runs;
  wicket: WicketKind | null;
  /** Fielding zone that stopped or caught the ball, if any. */
  fielder: FieldZone | null;
  factors: OutcomeFactors;
  cues: BallCues;
  /**
   * True for a ball bowled after the innings already ended (two wickets). The batter always faces all six balls and
   * the Super Ball so the innings length never leaks a sealed wicket; dead balls score nothing, are excluded from the
   * innings summary and are skipped by the replay.
   */
  dead?: boolean;
}

/** What the batter is told immediately after a shot (runs and wickets stay sealed until the reveal). */
export interface ShotFeedback {
  ball: number;
  timing: TimingGrade;
  contact: Contact;
}

// ---------------------------------------------------------------------------------------------------------------
// Presentation cues (engine-produced, renderer-consumed; part of the replay)
// ---------------------------------------------------------------------------------------------------------------

export type BowlerAction = 'pace_long' | 'pace_short' | 'swing_side_on' | 'spin_off' | 'spin_leg';
export type BatterAnim = 'block' | 'push' | 'drive' | 'cut' | 'pull' | 'sweep' | 'loft' | 'leave' | 'miss' | 'edge';
export type BallFate =
  | { kind: 'dot_block' | 'dot_beaten' | 'dot_fielded'; zone: FieldZone | null }
  | { kind: 'runs'; runs: 1 | 2 | 3; zone: FieldZone }
  | { kind: 'four'; zone: FieldZone; bounces: boolean }
  | { kind: 'six'; zone: FieldZone; distanceM: number }
  | { kind: 'wicket'; wicket: WicketKind; zone: FieldZone | null };

export type CameraShot = 'broadcast_end' | 'bowler_follow' | 'batter_close' | 'side_on' | 'stump_cam' | 'aerial' | 'fielder_follow' | 'crowd' | 'celebration';

export interface CameraCue {
  shot: CameraShot;
  /**
   * ms relative to the ball's start, measured on the engine's ballTimeline anchors (run-up, release, arrival). The
   * renderer may re-time the aftermath (after contact) for presentation; cues before contact keep their timing.
   */
  atMs: number;
  durationMs: number;
}

export interface BallCues {
  bowlerAction: BowlerAction;
  path: BallPath;
  batterAnim: BatterAnim;
  /** Footwork: forward (front foot), back, across, down the track. */
  footwork: 'forward' | 'back' | 'across' | 'charge' | 'still';
  fate: BallFate;
  /** Crowd intensity 0..1 for audio/animation. */
  crowd: number;
  celebration: 'none' | 'boundary' | 'six' | 'wicket' | 'milestone';
  slowMotion: boolean;
  /** Part of the Key Moments cut. */
  key: boolean;
  cameras: CameraCue[];
}

// ---------------------------------------------------------------------------------------------------------------
// Players, commits and the replay log
// ---------------------------------------------------------------------------------------------------------------

/** Deterministic, original avatar and kit, generated from seeds (no uploads, no real people). */
export interface AvatarSpec {
  seed: string;
}
export interface KitSpec {
  /** Cosmetic only; never affects outcomes. */
  id: string;
  primary: string;
  secondary: string;
  pattern: 'plain' | 'stripes' | 'hoops' | 'chevron' | 'sash';
}

export interface PlayerRef {
  /** Public, non-guessable player id (never the auth subject). */
  id: string;
  alias: string;
  avatar: AvatarSpec;
  kit: KitSpec;
  /** Ghost, daily setter, or Auto Over stand-in. */
  kind: 'human' | 'ghost' | 'daily' | 'auto';
}

export interface CommitRecord {
  player: 0 | 1;
  /** SHA-256 hex of the canonical plan JSON + salt. */
  hash: string;
  /** Server signature over `matchId|player|hash|engine` (lowercase hex) and the signing key id. */
  sig: string;
  keyId: string;
  /** Hour-resolution ISO timestamp (exact times are never stored or shown). */
  lockedHour: string;
  /** Revealed with the plan so anyone can verify the hash. */
  salt?: string;
  /** True when the server generated the over (Auto Over) because the player missed the lock deadline. */
  auto?: boolean;
}

export interface InningsSummary {
  /** Index of the batting player. */
  batter: 0 | 1;
  bowler: 0 | 1;
  balls: BallOutcome[];
  runs: number;
  wickets: number;
  /** Balls actually faced (an innings ends early at WICKETS_PER_INNINGS). */
  ballsFaced: number;
}

export interface MatchResult {
  winner: 0 | 1 | null;
  tie: boolean;
  /** How it was decided. */
  decidedBy: 'runs' | 'super_ball' | 'wickets_lost' | 'boundaries' | 'tie' | 'forfeit_none';
  marginRuns: number;
  /** Daily Six replays only (kind 'daily'): the attempt's score per docs/GAME_RULES.md; marginRuns is 0 there. */
  dailyScore?: number;
  playerOfMatch: 0 | 1;
  /** Index into events of the turning point, chosen by the engine. */
  turningPointEvent: number;
}

export type MatchKind = 'duel' | 'cup' | 'daily' | 'ghost' | 'training';

export type MatchEvent =
  | { t: 'innings_start'; innings: 0 | 1; batter: 0 | 1; field: FieldSetting }
  | { t: 'ball'; innings: 0 | 1 | 'super'; ball: number; outcome: BallOutcome; score: { runs: number; wickets: number; ballsLeft: number } }
  | { t: 'commentary'; key: string; params?: Record<string, string | number> }
  | { t: 'innings_end'; innings: 0 | 1; runs: number; wickets: number }
  | { t: 'super_ball_start' }
  | { t: 'result'; result: MatchResult };

export interface MatchEventLog {
  schema: typeof EVENT_SCHEMA_VERSION;
  engine: number;
  matchId: string;
  kind: MatchKind;
  /** 128-bit hex seed, server-generated at match creation and committed before any plan is sealed. */
  seed: string;
  conditions: Conditions;
  players: [PlayerRef, PlayerRef];
  commits: [CommitRecord, CommitRecord];
  /** Revealed plans (present in a revealed log only). */
  plans: [OverPlan, OverPlan];
  /** Validated batting inputs: inputs[0] = player 0 batting against player 1's over. */
  inputs: [BattingInput[], BattingInput[]];
  innings: [InningsSummary, InningsSummary];
  superBall: { used: boolean; outcomes: [BallOutcome, BallOutcome] | null };
  result: MatchResult;
  /** Ordered presentation timeline used by replay, scorecard, explanations, share cards and highlights. */
  events: MatchEvent[];
  meta: {
    tournamentId?: string;
    fixtureId?: string;
    stage?: 'group' | 'final';
    createdHour: string;
    revealedHour: string;
  };
}
