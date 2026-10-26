/**
 * Practice: offline, physics-first batting (ROOT-OWNED contract). The authoritative pipeline is
 *
 *   gesture → NormalizedSwing → virtual bat → swept bat–ball collision → ball trajectory → fielding → runs or wicket
 *
 * and it runs entirely on the device. One implementation per concern (docs/PRACTICE.md, "Architecture"):
 *   src/physics       the deterministic delivery physics, bat kinematics, collision, contact, fielding, running,
 *                     scoring and dismissals, plus the cricket constants and timing windows they use
 *   src/practice/game Practice rules: over generation and validation, the one-wicket innings state machine, replay
 *   src/input         the one normalized input model (touch, mouse, pen, keyboard) for every batting screen
 *   src/render3d      the one renderer and camera director (first-person batting, fielding and replay cameras)
 *   src/perf          the one device benchmark and quality classifier
 *   src/practice/ui   the Practice screens, the launch choice and the flow controller
 *
 * World frame (identical to src/render3d/core/ground.ts): metres, origin at the pitch centre on the ground, +Y up,
 * +Z towards the striker (striker's stumps at z = +10.06, bowler's at z = −10.06), +X = off side of a RIGHT-handed
 * striker. A left-handed striker is simulated in the mirrored frame (x → −x), so physics is always right-handed and
 * only presentation mirrors. Bearings are degrees from straight down the ground (0), positive towards the off side.
 * Simulation time `t` is seconds from the moment the ball leaves the bowler's hand, unless a name says ms.
 */
import type { FieldZone } from './cricket';

/** Bumped when any rule or physics change can alter a replayed outcome; replays record it. */
export const PRACTICE_SIM_VERSION = 1 as const;

export type Vec3 = { x: number; y: number; z: number };

// ---------------------------------------------------------------------------------------------------------------
// Bowling
// ---------------------------------------------------------------------------------------------------------------

export type BowlerFamily = 'pace' | 'spin';
export type PaceVariation = 'stock' | 'outswing' | 'inswing' | 'seam' | 'cutter' | 'slower' | 'bouncer' | 'yorker';
/** `wrong_un` is the googly for a wrist spinner and the carrom ball for a finger spinner. */
export type SpinVariation = 'stock' | 'flighted' | 'quicker' | 'topspinner' | 'arm_ball' | 'wrong_un';
export type DeliveryVariation = PaceVariation | SpinVariation;
/** Release-speed bands (km/h, real numbers): controlled ≈ 120–130, fast ≈ 131–141, express ≈ 142–152. */
export type PaceBand = 'controlled' | 'fast' | 'express';
/** Finger spin turns into a right-hander (off-break); wrist spin turns away (leg-break). */
export type SpinType = 'finger' | 'wrist';
export type PitchCondition = 'balanced' | 'green' | 'hard' | 'turning';

export interface BowlerProfile {
  family: BowlerFamily;
  /** Pace bowlers only. */
  paceBand?: PaceBand;
  /** Spinners only. */
  spinType?: SpinType;
  /**
   * The real bowler's bowling arm. Physics runs in the striker's own (right-handed) frame, so for a left-handed
   * striker it mirrors the bowler (right-arm becomes left-arm in that frame): `flight()` and `autoField()` take the
   * handedness and do it. Turn is by spin type AND arm: an off-break turns into a right-hander from a right-arm finger
   * spinner or a left-arm wrist spinner.
   */
  arm: 'right' | 'left';
  /** Seed of the generated look (no real person is ever depicted). */
  lookSeed: string;
}

/** What the bowler means to bowl. The physics turns it into a release; the speed shown is always the real one. */
export interface PracticeDeliveryPlan {
  variation: DeliveryVariation;
  /** Where the bowler aims to pitch the ball: metres in front of the striker's stumps (≈ 0.5 yorker … 9 bouncer). */
  lengthM: number;
  /** Line at the striker's stumps: metres, + towards THIS striker's off side (batter-relative), 0 = middle stump. */
  lineM: number;
  /** Release speed (km/h). */
  speedKph: number;
}

export interface PracticeOverPlan {
  version: typeof PRACTICE_SIM_VERSION;
  bowler: BowlerProfile;
  /** Exactly six legal deliveries, fixed before the first ball and never changed after. */
  balls: [PracticeDeliveryPlan, PracticeDeliveryPlan, PracticeDeliveryPlan, PracticeDeliveryPlan, PracticeDeliveryPlan, PracticeDeliveryPlan];
  /** Over seed; each ball's seed is derived from it, so the over replays exactly. */
  seed: string;
  source: 'random' | 'built' | 'guided';
  /** Built overs may be shuffled once at lock-in; the stored order is the order bowled. */
  shuffled?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Assistance, handedness, calibration
// ---------------------------------------------------------------------------------------------------------------

export type AssistLevel = 'learn' | 'play' | 'real';
export type Handedness = 'right' | 'left';

/** Timing bands (± ms around ideal contact) per assistance level; the single source is src/physics/constants.ts. */
export interface TimingBands {
  perfectMs: number;
  solidMs: number;
  /** Beyond this the bat misses entirely (unless the ball hits the pad or stumps). */
  edgeMs: number;
}

/** Device/input latency measured by the calibration ("tap when the ball crosses the line"); median of attempts. */
export interface Calibration {
  offsetMs: number;
  attempts: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Input (src/input): raw pointer samples → one NormalizedSwing, whatever the device
// ---------------------------------------------------------------------------------------------------------------

/** One raw sample; `t` is the event's high-resolution timestamp (performance.now() clock). Never stored or sent. */
export interface GestureSample {
  t: number;
  /** Position in CSS px within the gesture surface; +y is down. */
  x: number;
  y: number;
}

export interface GestureInput {
  pointer: 'touch' | 'mouse' | 'pen' | 'keyboard';
  samples: GestureSample[];
  surface: { width: number; height: number };
  /** Optional manual footwork (WASD / arrows, or an on-screen control in Real mode). */
  footwork?: Footwork;
}

export type Footwork = 'auto' | 'forward' | 'back' | 'across' | 'down_track';
/** The footwork actually played: 'auto' resolved by the physics from the delivery. */
export type PlayedFootwork = Exclude<Footwork, 'auto'>;
export type SwingKind = 'defend' | 'attack';

/** The only batting input the physics sees: identical for touch, mouse and keyboard. */
export interface NormalizedSwing {
  kind: SwingKind;
  /** Swing start on the simulation clock (s after release), calibration already applied. */
  startT: number;
  /** Intended scoring direction (bearing, degrees; 0 = straight, + = off side, in the batter's own frame). */
  directionDeg: number;
  /** 0..1 bat speed from the flick's velocity (defend: low and fixed). */
  power: number;
  /** 0 = along the ground … 1 = lofted. */
  elevation: number;
  footwork: Footwork;
}

// ---------------------------------------------------------------------------------------------------------------
// Physics outputs (src/physics): what the renderer, the replay and the coaching consume
// ---------------------------------------------------------------------------------------------------------------

/** Ball state at simulation time t (seconds after release). */
export interface BallSample {
  t: number;
  p: Vec3;
  v: Vec3;
}

/** The ball from release to the batting area: fixed before the batter acts and never changed afterwards. */
export interface BallFlight {
  version: typeof PRACTICE_SIM_VERSION;
  plan: PracticeDeliveryPlan;
  seed: string;
  release: { p: Vec3; v: Vec3; spinRps: number; seamDeg: number; speedKph: number };
  /** Where and when it pitches (null for a full toss). */
  bounce: { t: number; p: Vec3 } | null;
  /** Spin vector (rad/s, striker frame) at release and after the bounce (null for a full toss): contact reads it. */
  spin: { release: Vec3; afterBounce: Vec3 | null };
  /** When the ball reaches the ideal contact point in front of the batter: the timing reference. */
  idealContactT: number;
  /** When it reaches the plane of the striker's stumps, and whether it would hit them unimpeded. */
  stumpsT: number;
  wouldHitStumps: boolean;
  /** Dense samples (fixed step) from release to just past the stumps. */
  samples: BallSample[];
}

/** Bat state: grip (top of the handle) → toe, and the face normal. Samples start at the swing's start. */
export interface BatSample {
  t: number;
  grip: Vec3;
  toe: Vec3;
  face: Vec3;
}

export type ContactKind =
  | 'middle'
  | 'inside_edge'
  | 'outside_edge'
  | 'top_edge'
  | 'leading_edge'
  | 'pad'
  | 'body'
  | 'miss'
  | 'leave';

export type SwingTiming = 'perfect' | 'solid' | 'mistimed' | 'missed' | 'none';

export interface ContactReport {
  kind: ContactKind;
  /** Contact (or closest approach) time; null for a leave. */
  t: number | null;
  /** Signed timing error against the ideal contact (ms; + = late), null for a leave. */
  timingErrorMs: number | null;
  timing: SwingTiming;
  /** Contact point in world space and along the blade (0 = toe … 1 = top of the blade; sweet spot ≈ 0.22). */
  point: Vec3 | null;
  bladeU: number | null;
  /** Face angle at contact: bearing of the face normal (deg), and the bat's speed (km/h). */
  faceBearingDeg: number | null;
  batSpeedKph: number | null;
  /** Ball leaving the bat. */
  exitSpeedKph: number | null;
  exitBearingDeg: number | null;
  exitElevationDeg: number | null;
  /** What the player asked for (bearing of the flick) — compared with exitBearingDeg in coaching. */
  intendedBearingDeg: number | null;
}

export type FielderRole =
  | 'keeper'
  | 'bowler'
  | 'slip'
  | 'gully'
  | 'point'
  | 'backward_point'
  | 'cover'
  | 'extra_cover'
  | 'mid_off'
  | 'mid_on'
  | 'midwicket'
  | 'square_leg'
  | 'fine_leg'
  | 'third_man'
  | 'deep_point'
  | 'deep_cover'
  | 'long_off'
  | 'long_on'
  | 'deep_midwicket'
  | 'deep_square'
  | 'short_leg'
  | 'silly_point'
  | 'leg_slip';

export interface Fielder {
  id: string;
  role: FielderRole;
  /** Ground position (x, z) in the world frame. */
  x: number;
  z: number;
}

export interface FieldLayout {
  id: string;
  /** Exactly eleven fielders: keeper, bowler and nine others. */
  fielders: Fielder[];
}

export type FielderAction = 'set' | 'run' | 'dive' | 'catch' | 'drop' | 'pickup' | 'throw' | 'celebrate' | 'idle';

export interface FielderPath {
  fielderId: string;
  /** Ground positions over time with the action being performed. */
  samples: Array<{ t: number; x: number; z: number; action: FielderAction }>;
}

export type Dismissal = 'bowled' | 'caught' | 'caught_behind' | 'lbw';

/** The LBW verdict when the ball hit the pad or body before the bat (Law 36); 'out' is the only dismissal. */
export type LbwReason = 'pitched_outside_leg' | 'impact_outside_leg' | 'impact_outside_off' | 'missing' | 'high' | 'out';

export interface LbwDecision {
  out: boolean;
  reason: LbwReason;
  impact: Vec3;
  projected: Vec3;
}

/** Discrete events on the simulation clock (presentation, audio and haptics all key off these). */
export type SimEvent =
  | { t: number; kind: 'release' }
  | { t: number; kind: 'bounce'; p: Vec3 }
  | { t: number; kind: 'contact'; contact: ContactKind; p: Vec3 }
  | { t: number; kind: 'pad'; p: Vec3 }
  | { t: number; kind: 'stumps'; p: Vec3 }
  | { t: number; kind: 'keeper_take'; p: Vec3 }
  | { t: number; kind: 'ball_bounce'; p: Vec3 }
  | { t: number; kind: 'catch'; fielderId: string; p: Vec3 }
  | { t: number; kind: 'field'; fielderId: string; p: Vec3 }
  | { t: number; kind: 'throw'; fielderId: string; p: Vec3 }
  | { t: number; kind: 'boundary'; runs: 4 | 6; p: Vec3 }
  | { t: number; kind: 'run'; completed: number }
  | { t: number; kind: 'dead' };

export interface DeliveryOutcome {
  runs: 0 | 1 | 2 | 3 | 4 | 6;
  boundary: 4 | 6 | null;
  dismissal: Dismissal | null;
  /** Fielder who caught, fielded or was beaten (null for a leave or a miss). */
  fielderId: string | null;
  /** Where the ball finished, or was caught: bearing (deg), distance from the striker (m), and its region. */
  endBearingDeg: number | null;
  endDistanceM: number | null;
  region: FieldZone | 'straight' | 'behind' | null;
}

/** Closed reasons the coaching card explains (the UI turns them into words). */
export type CoachingReason =
  | 'found_the_gap'
  | 'hit_to_fielder'
  | 'cleared_the_rope'
  | 'beat_the_field'
  | 'caught_in_the_deep'
  | 'caught_in_the_ring'
  | 'edged_behind'
  | 'edged_to_slip'
  | 'too_early'
  | 'too_late'
  | 'beaten_by_swing'
  | 'beaten_by_seam'
  | 'beaten_by_turn'
  | 'beaten_by_pace'
  | 'beaten_by_bounce'
  | 'played_across_the_line'
  | 'missed_straight_ball'
  | 'left_well'
  | 'left_and_bowled'
  | 'pad_in_line'
  | 'solid_defence'
  | 'mistimed_lofted';

export interface Coaching {
  reason: CoachingReason;
  timing: 'early' | 'on_time' | 'late' | null;
  /** The gap or fielder the coaching names, when there is one. */
  zone: FieldZone | null;
  fielderRole: FielderRole | null;
  /** The LBW verdict when the ball hit the pad or body first (null otherwise), so a not-out can say why. */
  lbw: LbwReason | null;
}

/** Everything needed to show, explain and replay one delivery. Deterministic in (record) → result. */
export interface DeliveryResult {
  version: typeof PRACTICE_SIM_VERSION;
  flight: BallFlight;
  swing: NormalizedSwing | null;
  /** The footwork the batter actually played (the replay draws this stride, the collision used it). */
  footwork: PlayedFootwork;
  contact: ContactReport;
  /** Bat from swing start to the follow-through (empty for a leave). */
  bat: BatSample[];
  /**
   * The LBW decision when the ball hit the pad or body before the bat (null otherwise): where it hit, and where the
   * unimpeded ball would have reached the stumps plane (the diagnostic replay draws the projected path).
   */
  lbw: LbwDecision | null;
  /** Ball from release to dead (pre-contact samples equal flight.samples up to contact). */
  ball: BallSample[];
  fielders: FielderPath[];
  events: SimEvent[];
  outcome: DeliveryOutcome;
  coaching: Coaching;
  /** Simulation time at which the ball is dead (end of play for this delivery). */
  deadT: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Replay and the innings (src/practice/game)
// ---------------------------------------------------------------------------------------------------------------

/** The one Practice replay representation: re-simulating it reproduces the DeliveryResult exactly. */
export interface DeliveryRecord {
  version: typeof PRACTICE_SIM_VERSION;
  overIndex: number;
  ballIndex: number;
  bowler: BowlerProfile;
  plan: PracticeDeliveryPlan;
  seed: string;
  conditions: PitchCondition;
  field: FieldLayout;
  handedness: Handedness;
  assist: AssistLevel;
  /** Extra timing tolerance granted by the Assisted performance tier (ms), recorded so replays stay exact. */
  tierToleranceMs: number;
  swing: NormalizedSwing | null;
  /** Result summary (the full result is re-simulated on demand). */
  runs: DeliveryOutcome['runs'];
  dismissal: Dismissal | null;
}

export type InningsStatus = 'choosing_over' | 'batting' | 'over_complete' | 'out' | 'complete';

export interface PracticeInningsState {
  version: typeof PRACTICE_SIM_VERSION;
  id: string;
  status: InningsStatus;
  conditions: PitchCondition;
  assist: AssistLevel;
  handedness: Handedness;
  runs: number;
  /** Legal balls faced. */
  balls: number;
  /** Completed overs (each with its plan and the six records), at most ten. */
  overs: Array<{ plan: PracticeOverPlan; deliveries: DeliveryRecord[] }>;
  /** The over being batted (status 'batting'). */
  current: { plan: PracticeOverPlan; field: FieldLayout; deliveries: DeliveryRecord[] } | null;
  /** Set the moment a delivery starts; a resumed innings resolves it as a leave (no save-scumming). */
  inFlight: { overIndex: number; ballIndex: number } | null;
  dismissal: { record: DeliveryRecord } | null;
}

export const PRACTICE_MAX_OVERS = 10;

// ---------------------------------------------------------------------------------------------------------------
// Device classification (src/perf)
// ---------------------------------------------------------------------------------------------------------------

export type PerfTier = 'full' | 'assisted' | 'below';
export type QualityProfileId = 'lite' | 'standard' | 'high';

export interface DeviceAssessment {
  webgl2: boolean;
  /** False for software rasterisers (SwiftShader, llvmpipe, lavapipe…). */
  hardware: boolean;
  renderer: string;
  shaderCompileMs: number;
  avgFps: number;
  p95FrameMs: number;
  /** Frames over 50 ms during the benchmark. */
  spikes: number;
  contextLosses: number;
  /** Median pointer-event-to-frame latency observed in the benchmark (ms), when measurable. */
  inputToFrameMs: number | null;
  memoryGb: number | null;
  tier: PerfTier;
  profile: QualityProfileId;
  /** Why the tier was chosen (closed codes, shown in diagnostics). */
  reasons: string[];
  /** Extra timing tolerance granted in the Assisted tier (ms). */
  toleranceMs: number;
}
