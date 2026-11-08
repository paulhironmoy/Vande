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
export const PRACTICE_SIM_VERSION = 3 as const;

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

/**
 * The ball for the whole over: the setup shows it and the physics uses it. A new ball swings and seams most; a worn
 * one (rough, scuffed, about 40+ overs) less. Red for day sessions, white under lights.
 */
export type BallColour = 'red' | 'white';
export type BallAge = 'new' | 'worn';
export interface BallCondition {
  colour: BallColour;
  age: BallAge;
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
  /** The ball, fixed for the over (part of exact-ball replay). */
  ball: BallCondition;
  /** Exactly six legal deliveries, fixed before the first ball and never changed after. */
  balls: [
    PracticeDeliveryPlan,
    PracticeDeliveryPlan,
    PracticeDeliveryPlan,
    PracticeDeliveryPlan,
    PracticeDeliveryPlan,
    PracticeDeliveryPlan,
  ];
  /** Over seed; each ball's seed is derived from it, so the over replays exactly. */
  seed: string;
  /** 'reference' is the benchmark over (docs/PRACTICE.md, "Reference over"): the same six balls every time. */
  source: 'random' | 'built' | 'guided' | 'reference';
  /** Built overs may be shuffled once at lock-in; the stored order is the order bowled. */
  shuffled?: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Assistance, handedness, calibration
// ---------------------------------------------------------------------------------------------------------------

export type AssistLevel = 'learn' | 'play' | 'real';
/** Random Over difficulty: better bowling, never hidden randomness (the same seed and difficulty give the same over). */
export type Difficulty = 'beginner' | 'club' | 'expert';
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

/**
 * One raw sample; `t` is the event's high-resolution timestamp (performance.now() clock). Never persisted, logged,
 * analysed or sent over a network. An optional Unity surface may pass it ephemerally across the in-process bridge;
 * the host discards it immediately after normalization and authoritative resolution.
 */
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
  /** Optional manual footwork (W / S / the side letters, where the press landed, or an on-screen control). */
  footwork?: Footwork;
  /**
   * Keyboard only: the stroke the keys asked for (an arrow attacks in its screen direction, Shift lofts); absent for
   * Space / Enter, a defence. The samples then hold only the key's timestamp.
   */
  key?: { kind: SwingKind; screenBearingDeg: number; loft: boolean };
}

/** A kind of batting input; timing calibration is kept per modality (CTL9). */
export type InputModality = GestureInput['pointer'];
/** Calibrations by modality (src/input/calibration.ts computes them; src/practice/store/calibration.ts stores them). */
export type CalibrationSet = Partial<Record<InputModality, Calibration>>;

export type Footwork = 'auto' | 'forward' | 'back' | 'across' | 'down_track';
/** The footwork actually played: 'auto' resolved by the physics from the delivery. */
export type PlayedFootwork = Exclude<Footwork, 'auto'>;
/** One static, feet-planted whole-batter posture chosen before collision for the complete visible stroke. */
export interface BatterPosture {
  /** Metres the articulated torso/head/shoulder chain is lowered through knee/hip flexion; feet remain planted. */
  crouchM: number;
}
/** Authoritative body-motion phase timing for the immutable visible bat trace. */
export interface BatterMotionTiming {
  startT: number;
  /** Authored peak-velocity stroke anchor; only a blade/handle contact is a physical impulse. */
  contactT: number;
  /** The motion-complete knot; any later bat knots are an identical held finish. */
  endT: number;
}

/**
 * Final physics-owned body anchors for one planted stroke, in the canonical right-handed pitch frame. Presentation
 * mirrors x exactly once and must align the visible athlete to these anchors before coupling the hands to the bat.
 */
export interface BatterBodyFrame {
  /** Centre of the two grounded supports after the static root solve. */
  stance: { x: number; z: number };
  /** Torso-top reference used by the authoritative ordered shoulder-to-hand reach solve. */
  torsoTop: Vec3;
  /** Head/helmet centre used by the authoritative bat-clearance solve. */
  headCentre: Vec3;
}
export type SwingKind = 'defend' | 'attack';

/** The only batting input the physics sees: identical for touch, mouse and keyboard. */
export interface NormalizedSwing {
  kind: SwingKind;
  /** Swing start on the simulation clock (s after release), calibration already applied. */
  startT: number;
  /** Intended scoring direction (bearing, degrees; 0 = straight, + = off side, in the batter's own frame). */
  directionDeg: number;
  /** 0..1 bat speed from the swipe's speed (defend: low and fixed; keys: fixed). */
  power: number;
  /** 0 = along the ground (every ordinary swipe) … 1 = lofted (a long, quick swipe, or Shift with a key). */
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
  /**
   * The ball as it leaves the hand, for the batter's legitimate cues (unit vectors, striker frame): the seam plane's
   * normal (the spin axis for a seam-up ball), the direction of the polished half (conventional swing goes towards
   * the rough side, away from the shine), and how much the seam wobbles (0 upright … 1 scrambled, as for cutters and
   * slower balls). The renderer draws exactly this; the physics' swing and seam movement come from the same values.
   */
  seam: { axis: Vec3; shine: Vec3; wobble: number };
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
  'middle' | 'inside_edge' | 'outside_edge' | 'top_edge' | 'leading_edge' | 'pad' | 'body' | 'miss' | 'leave';

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
export type LbwReason =
  'pitched_outside_leg' | 'impact_outside_leg' | 'impact_outside_off' | 'missing' | 'high' | 'out';

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
  /**
   * `shortM` (added 2026-11-04, lead ruling; additive and optional, contract v6 unchanged) is present only when the ball
   * passed beyond the keeper's reach, by that many metres (`keeperTake.shortM` > 0). Practice has no byes, so the ball is
   * still dead there, but presentation must not draw it in his gloves. It is absent for a clean take.
   */
  | { t: number; kind: 'keeper_take'; p: Vec3; shortM?: number }
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
  /** Bowled off the bat's middle: the batter played the ball onto the stumps (never a "beaten" reason). */
  | 'played_on'
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

// ---------------------------------------------------------------------------------------------------------------
// Field intelligence (src/physics field.ts): what the field is set to do, shown before the over and on the radar
// ---------------------------------------------------------------------------------------------------------------

/** Closed vocabulary for the captain's plan behind a field (the UI words it). */
export type FieldIntention =
  | 'attack_outside_off'
  | 'attack_the_stumps'
  | 'short_ball_trap'
  | 'yorker_and_boundaries'
  | 'spin_close_catchers'
  | 'save_singles'
  | 'protect_boundaries';

export interface FieldArc {
  /** Bearings from the striker (deg, + = off side, batter frame), from < to, and whether it is the ring or the deep. */
  fromDeg: number;
  toDeg: number;
  depth: 'ring' | 'deep';
}

export interface FieldIntent {
  intention: FieldIntention;
  /** Fielders in catching positions (keeper, slips, gully, short leg, silly point, leg slip). */
  attacking: string[];
  /** Arcs a fielder covers (a ball there is likely stopped or caught). */
  protected: FieldArc[];
  /** Arcs no fielder covers in time for a well-hit ground stroke: the scoring gaps. */
  gaps: Array<FieldArc & { region: FieldZone | 'straight' | 'behind' }>;
}

// ---------------------------------------------------------------------------------------------------------------
// Exact-ball Coach Mode (src/practice/coach): real alternative responses, simulated with the same physics
// ---------------------------------------------------------------------------------------------------------------

export type Decision = 'leave' | 'defend' | 'attack';
export type CoachOptionKind = 'recommended' | 'safest' | 'higher_scoring';

/** Why a response carries risk, from fieldIntent() and the simulated neighbourhood. */
export type CoachRisk = 'into_protected_region' | 'can_be_caught' | 'can_edge' | 'can_be_bowled' | 'can_be_lbw';

/** One response to the exact same delivery, resolved by resolveDelivery like a real ball. */
export interface CoachOption {
  kind: CoachOptionKind;
  decision: Decision;
  /** The swing (null for a leave). Timing is the ideal for its footwork. */
  swing: NormalizedSwing | null;
  footwork: PlayedFootwork;
  outcome: DeliveryOutcome;
  contact: ContactKind;
  /** Where and when the bat meets the ball for the demonstration (null for a leave or a miss). */
  contactPoint: Vec3 | null;
  contactT: number | null;
  /** Over a neighbourhood of timings and aims around this response: share dismissed, and mean runs. */
  dismissalRisk: number;
  expectedRuns: number;
  /** The gap it uses, when it scores. */
  region: FieldZone | 'straight' | 'behind' | null;
  /** Why this response carries risk (empty when none). The recommended response never aims into a protected arc. */
  risks: CoachRisk[];
}

export type ReadVerdict = 'right' | 'wrong' | 'unclear';

/** What the player read, inferred from what they did (footwork, decision, timing, direction) against the ball. */
export interface CoachRead {
  length: ReadVerdict;
  line: ReadVerdict;
  pace: ReadVerdict;
  movement: ReadVerdict;
  bounce: ReadVerdict;
}

export interface CoachAnalysis {
  version: typeof PRACTICE_SIM_VERSION;
  /** What the ball did (from the flight). */
  ball: {
    variation: DeliveryVariation;
    speedKph: number;
    lengthM: number | null;
    lineAtStumpsM: number;
    airMovementM: number;
    pitchMovementM: number | null;
    heightAtBatM: number;
    wouldHitStumps: boolean;
  };
  read: CoachRead;
  /** What the player attempted (null swing: a leave), and what it produced. */
  attempted: {
    decision: Decision;
    footwork: PlayedFootwork;
    directionDeg: number | null;
    elevation: number | null;
    power: number | null;
    timingErrorMs: number | null;
    contact: ContactKind;
    timing: SwingTiming;
    runs: DeliveryOutcome['runs'];
    dismissal: Dismissal | null;
    /**
     * The player's own stroke re-timed to its ideal and judged over the same execution spread as the options (null for a
     * leave). 'well_played' and "why it was lucky" are derived from it, so both trace to recorded facts.
     */
    spread: { dismissalRisk: number; expectedRuns: number; risks: CoachRisk[] } | null;
  };
  /** Why it succeeded or failed: closed reasons, most important first. */
  why: CoachingReason[];
  /** Recommended, safest and higher-scoring responses (an option may be both; duplicates are merged). */
  options: CoachOption[];
}

/** The one change the dead-ball card recommends (constitution §14), worded by the UI. */
export type CoachRecommendationKind =
  | 'repeat_it'
  /** The attempt worked, and over the execution spread it is worth as much as the recommended response (within 0.25 runs). */
  | 'well_played'
  | 'leave_outside_off'
  | 'leave_down_leg'
  | 'leave_over_the_top'
  | 'play_at_the_stumps'
  | 'defend_forward'
  | 'defend_back'
  | 'attack_the_gap'
  | 'get_forward'
  | 'get_back'
  | 'play_later'
  | 'play_earlier'
  | 'play_straighter'
  | 'aim_for_the_gap'
  | 'keep_it_down';

export interface CoachRecommendation {
  kind: CoachRecommendationKind;
  /** The response it points to (the recommended option), for the demonstration. */
  decision: Decision;
  footwork: PlayedFootwork;
  /** play_later / play_earlier: the change in ms (a positive integer). */
  shiftMs: number | null;
  /** attack_the_gap / aim_for_the_gap: where to aim (bearing, batter frame), its region, and whether it is lofted. */
  directionDeg: number | null;
  region: FieldZone | 'straight' | 'behind' | null;
  lofted: boolean | null;
}

/** The dead-ball card's one insight: the primary reason and the one recommendation. */
export interface PrimaryInsight {
  /** analysis.why[0] */
  reason: CoachingReason;
  /** The attempt's signed timing error (ms, + = late, rounded), null for a leave: for copy like "38 ms early". */
  timingMs: number | null;
  recommendation: CoachRecommendation;
}

/** What changed between two attempts at the exact ball (compareAttempts), most important first. */
export type AttemptChangeKind =
  | 'timing_closer'
  | 'timing_further'
  | 'footwork_right_now'
  | 'footwork_wrong_now'
  | 'decision_right_now'
  | 'decision_wrong_now'
  | 'clean_contact_now'
  | 'contact_worse'
  | 'survived_now'
  | 'out_now'
  | 'more_runs'
  | 'fewer_runs'
  | 'same_again';

export interface AttemptComparison {
  /** What changed, most important first (['same_again'] when nothing did). */
  changes: AttemptChangeKind[];
  /** Against the recommended response's standard. */
  verdict: 'better' | 'worse' | 'same';
  /** |previous error| − |next error| (ms, + = closer), null unless both attempts swung. */
  timingMs: number | null;
  runsDelta: number;
}

// ---------------------------------------------------------------------------------------------------------------
// Mastery (repeat the exact ball with less and less help) and Form (a report of demonstrated skill, never a buff)
// ---------------------------------------------------------------------------------------------------------------

/** 1 full trajectory and ghost movement, 2 pitch and contact markers, 3 contact cue only, 4 no assistance. */
export type AssistanceStage = 1 | 2 | 3 | 4;

export interface MasteryAttempt {
  stage: AssistanceStage;
  decision: Decision;
  footwork: PlayedFootwork;
  timingErrorMs: number | null;
  contact: ContactKind;
  runs: number;
  out: boolean;
  /** The attempt met the recommended response's standard (no dismissal, right decision, a clean contact). */
  success: boolean;
}

export interface MasteryState {
  /** The exact ball: record key (over seed, ball index) or the reference ball id. */
  key: string;
  stage: AssistanceStage;
  attempts: MasteryAttempt[];
  /** Repeatable, not lucky: see src/practice/coach mastery rule. */
  mastered: boolean;
}

/**
 * Demonstrated skills (a report only, never a buff). Mastery attempts at assistance stage 1 or 2 never count as
 * recognition, since the trajectory or markers showed the answer; innings balls count fully.
 */
export type FormSkill =
  | 'line_length'
  | 'pace_timing'
  | 'swing_seam'
  | 'cut'
  | 'spin_reading'
  | 'short_ball'
  | 'footwork'
  | 'timing'
  | 'bat_face'
  | 'off_side_placement'
  | 'direction'
  | 'field'
  | 'running';

export interface FormSkillReport {
  /** 0–100 from demonstrated evidence; null when there is none yet (or the skill is not under the player's control). */
  score: number | null;
  samples: number;
  /** Change over the recent window (points), null without enough evidence. */
  trend: number | null;
}

export type FormReport = Record<FormSkill, FormSkillReport>;

/** Everything needed to show, explain and replay one delivery. Deterministic in (record) → result. */
export interface DeliveryResult {
  version: typeof PRACTICE_SIM_VERSION;
  flight: BallFlight;
  swing: NormalizedSwing | null;
  /**
   * One authoritative planted-batter translation in the canonical right-handed physics frame. Presentation mirrors
   * x exactly once for a left-hander, leaves z unchanged, and applies this root to the batter for the whole trace.
   * Bat and ball samples are already world-space and must never be translated again.
   */
  batterRootOffset: { x: number; z: number };
  /** Physics-owned planted support, torso and head anchors; presentation must not infer them from footwork alone. */
  batterBodyFrame: BatterBodyFrame;
  /** Authoritative articulated posture for the complete trace; presentation must not infer one from the result. */
  batterPosture: BatterPosture;
  /** Null exactly when the visible bat trace is empty. Unity must use these times instead of inferring a phase. */
  batterMotion: BatterMotionTiming | null;
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
  /** The over's ball (its age changes swing and seam), so the exact ball replays. */
  ball: BallCondition;
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
  /** The renderer that produced these measurements. Omitted on legacy WebGL cache entries. */
  backend?: 'webgl2' | 'unity';
  webgl2: boolean;
  /** False for software rasterisers (SwiftShader, llvmpipe, lavapipe…). */
  hardware: boolean;
  renderer: string;
  /** Null when the active renderer cannot isolate shader warm-up truthfully. */
  shaderCompileMs: number | null;
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
