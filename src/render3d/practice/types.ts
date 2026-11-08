/**
 * The Practice stage: the one renderer's first-person batting presentation (docs/PRACTICE_PRESENTATION.md). The 3D
 * stage (Three.js) and the Classic 2D stage (Canvas 2D) implement the same interface and are driven by the same
 * physics data: a BallFlight before the batter acts, then the DeliveryResult. Nothing here decides an outcome.
 */
import type {
  AssistanceStage,
  AssistLevel,
  BallCondition,
  BallFlight,
  BowlerProfile,
  CoachOption,
  ContactKind,
  DeliveryResult,
  FieldLayout,
  Handedness,
  PitchCondition,
  QualityProfileId,
  SwingTiming,
} from '@/contracts/practice';
import type { OneGestureState } from '@/input';
import type { CrowdEmotion } from '@/audio/emotion';
import type { PresentationSink } from '../types';
import type { EmotionState, StageMoment } from './emotion';

export type { EmotionState, StageMoment, StageMomentKind, EmotionPhase, EmotionOutcome } from './emotion';

/** Light and sky of the session. Evening under lights is the default (with the new white ball). */
export interface PracticeEnvironment {
  light: 'day' | 'late_afternoon' | 'evening';
  sky: 'clear' | 'overcast';
}
export const DEFAULT_ENVIRONMENT: Readonly<PracticeEnvironment> = Object.freeze({ light: 'evening', sky: 'clear' });
/** The ball when the scene names none: a new white ball (src/physics DEFAULT_BALL). */
export const DEFAULT_STAGE_BALL: Readonly<BallCondition> = Object.freeze({ colour: 'white', age: 'new' });

export interface PracticeMountOptions {
  profile: QualityProfileId;
  handedness: Handedness;
  reducedMotion: boolean;
  /** Learn assistance: show where the ball will pitch, once it is released. */
  learnCue: boolean;
}

export interface PracticeSceneSetup {
  /** The batter-frame layout from autoField (mirrored for a left-hander, like every physics output). */
  field: FieldLayout;
  bowler: BowlerProfile;
  conditions: PitchCondition;
  handedness: Handedness;
  /** The over's ball (default DEFAULT_STAGE_BALL). The sight screens follow it: dark for white, white for red. */
  ball?: BallCondition;
  /** Light and sky (default DEFAULT_ENVIRONMENT). */
  environment?: PracticeEnvironment;
}

/** Match context of the next delivery, for the emotion signals only (it never touches the simulation). */
export interface DeliveryContext {
  /** 0 relaxed … 1 the most pressure (final over, a close chase, the last ball). */
  pressure?: number;
  /** A milestone this ball could bring up (the batter is within a boundary of it). */
  milestone?: 'fifty' | 'hundred' | null;
  /** In Practice a wicket ends the innings, so every dismissal is a damaging one (default true). */
  wicketEndsInnings?: boolean;
  /** The striker's runs before this ball (a milestone is recognised when a ball takes them past 50 or 100). */
  runs?: number;
}

/**
 * Coach Mode's guide for an exact-ball attempt: the recommended response resolved by the same physics on the same
 * flight (`repeatDelivery(source, option.swing)`), so every marker is a physics output.
 */
export interface AssistanceGuide {
  result: DeliveryResult;
  option: CoachOption;
}

/** A part of the batter's-eye view the HUD must never cover (CSS px relative to the canvas). */
export type ProtectedRegionKind = 'bowler' | 'release' | 'pitch' | 'ball_path' | 'bat' | 'contact';
export interface ProtectedRegion {
  kind: ProtectedRegionKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CloseUpOptions {
  /** Total length (ms, default 3200). */
  durationMs?: number;
}

export type ReplayCamera = 'batter' | 'side' | 'behind' | 'top';

export interface ReplayOptions {
  /** Playback rate through the slow-motion window around the bat (default 0.3); the rest plays at normal speed. */
  speed?: number;
  /** Ball trajectory, bat path, contact point, bat face, timing and intended versus actual direction (default true). */
  diagnostics?: boolean;
  camera?: ReplayCamera;
  /** The delivery's assistance level and tier tolerance: draws the timing window it was judged by (physics activeBands). */
  assist?: AssistLevel;
  tierToleranceMs?: number;
}

/** What `benchmark` returns: raw measurements only (src/perf classifies them). Matches src/perf's BenchmarkRun. */
export interface PracticeBenchmarkRun {
  /** Omitted means the established WebGL renderer. */
  backend?: 'webgl2' | 'unity';
  /** Interval between consecutive rendered frames (ms), in order. */
  frameMs: number[];
  shaderCompileMs: number | null;
  /** Context losses while the run played. */
  contextLosses: number;
  renderer: string;
  webgl2: boolean;
  hardware: boolean;
}

export interface PracticeStageStats {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  /** Frames over 50 ms in the recent window. */
  spikes: number;
  /** Committed gesture intent → first submitted stroke frame (ms). Raw-press ready-grip latency is separate. */
  lastInputToBatMs: number | null;
  renderer: string;
  profile: QualityProfileId;
  drawCalls: number;
  contextLosses: number;
}

/**
 * `quiet`: Delivery Quiet Mode (constitution §4) begins as the bowler starts the approach (bowl()) and ends at dead ball
 * (when play() resolves), or when the delivery is abandoned. While quiet the stage moves no camera but the batter's
 * eye, stops decorative motion and draws nothing that animates the interface.
 */
export type PracticeStageEvent = 'contextlost' | 'contextrestored' | 'fallback' | 'quiet';
export interface PracticeFallbackPayload {
  reason: 'no_webgl' | 'context_lost' | 'error';
  message?: string;
}
export interface PracticeEventPayloads {
  contextlost: Record<string, never>;
  contextrestored: Record<string, never>;
  fallback: PracticeFallbackPayload;
  quiet: { quiet: boolean };
}

/** How a contact feels (one distinct visual, sound and haptic each), keyed to the event's simulation timestamp. */
/** 'block' is a defended middle (a defensive swing): the dead bat's damped thud, never the sweet spot's crack. */
export type ContactFeel = 'sweet' | 'middle' | 'block' | 'edge' | 'pad' | 'miss' | 'bowled' | 'catch' | 'four' | 'six';

/**
 * A presentation sink that can also play the batter's contact feels and follow the delivery's emotion (src/audio
 * implements it for Practice). Every call follows resolved simulation events and context; none influences an outcome.
 */
export interface PracticeSink extends PresentationSink {
  /**
   * `contact` and `timing` (the physics' ContactReport) pick the exact signature; `atPerfMs` is the performance time it
   * belongs to. Call ahead with it for sample-accurate sound.
   */
  feel?(feel: ContactFeel, intensity: number, contact?: ContactKind, timing?: SwingTiming, atPerfMs?: number): void;
  /** A resolved moment of the delivery, called at its own simulation timestamp (see practice/emotion.ts). */
  moment?(m: StageMoment, atPerfMs?: number): void;
  /** The emotion state, once per drawn frame of a live delivery and between balls (see practice/emotion.ts). */
  emotion?(state: EmotionState): void;
  /** Delivery Quiet Mode began or ended (interface sounds stay silent while quiet). */
  quiet?(on: boolean): void;
  /** The coming delivery's match context (bowl()'s context plus the pitch), before its 'approach' moment. */
  context?(ctx: DeliveryContext & { conditions?: PitchCondition }): void;
  /** The crowd's emotion now (src/audio's one machine): the 3D crowd follows it. */
  emotionNow?(atMs?: number): Readonly<CrowdEmotion>;
}

export interface PracticeStage {
  readonly kind: '3d' | '2d';
  mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void>;
  /** Places the field, the bowler and the pitch (between deliveries). */
  setScene(setup: PracticeSceneSetup): void;
  /**
   * Runs the bowler's run-up and action; resolves at the real release moment (performance.now() clock). Enters Delivery
   * Quiet Mode at once. `context` feeds the emotion signals only.
   */
  bowl(flight: BallFlight, context?: DeliveryContext): Promise<{ releasePerfMs: number }>;
  /** The current delivery's scheduled release, known as soon as bowl() is called (null when none). */
  releasePerfMs(): number | null;
  /**
   * Touch-down (owner decision 2026-11-04, CTL1): the bat's stroke starts at the press minus `calibrationMs` (the same
   * instant normalizeGesture gives a tap). Until beginSwing commits it, the stroke is bounded short of the ball, checks
   * back when the press outlives the tap window (TAP_HOLD_MS, or a `waiting` contact state) and yields to the load on
   * a pullback. Presentation only: the physics, the stride and the result are unchanged.
   */
  prepareSwing(atPerfMs: number, calibrationMs?: number): void;
  /**
   * A gesture committed to a swing (intent's own timestamp, which can follow a held press). The provisional stroke
   * follows that intent until the result arrives. `calibrationMs` is the same offset normalizeGesture applies.
   */
  beginSwing(atPerfMs: number, calibrationMs?: number): void;
  /** Cancels only unresolved input presentation, allowing another gesture on this ball. Resolved physics is intact. */
  cancelSwing(): void;
  /** Follows the canonical live contact without interpreting raw samples or changing the simulation. */
  previewContact(state: OneGestureState): void;
  /**
   * Plays the result in the batter's eye to dead ball, where it resolves and quiet ends; then the consequence: the
   * field view of the ball's path, the broken wicket, the players' reactions.
   */
  play(result: DeliveryResult): Promise<void>;
  /** Slow-motion diagnostic replay. Resolves when it ends (or is replaced). */
  replay(result: DeliveryResult, options?: ReplayOptions): Promise<void>;
  /** Between deliveries it applies on the next frame; during a delivery it waits for the delivery to end. */
  setProfile(profile: QualityProfileId): void;
  benchmark(ms: number): Promise<PracticeBenchmarkRun>;
  stats(): PracticeStageStats;
  on<E extends PracticeStageEvent>(event: E, cb: (payload: PracticeEventPayloads[E]) => void): () => void;
  /** A listener that ignores the payload (any event). */
  on(event: PracticeStageEvent, cb: (payload: never) => void): () => void;
  /** Audio and haptics (default: src/audio). null mutes the stage. */
  setSink(sink: PracticeSink | null): void;
  setReducedMotion(on: boolean): void;
  setLearnCue(on: boolean): void;
  /**
   * Coach Mode's assistance for the next exact-ball attempt (applied at the next bowl(); null: an innings ball, where the
   * Learn landing cue applies). 1: the predicted trajectory, the pitch and contact markers and a ghost bat playing the
   * recommended response; 2: the pitch and contact markers; 3: one contact cue at the ideal contact time; 4: nothing.
   * Assistance draws physics outputs only: it never changes a timing window or an outcome.
   */
  setAssistance(stage: AssistanceStage | null, guide?: AssistanceGuide | null): void;
  /**
   * Plays the exact delivery with a translucent ghost batter performing the option: its footwork, the physics bat
   * track, the contact point, the direction and elevation, and the gap it uses. Resolves when done, or quietly when
   * interrupted (bowl, replay, closeUp, another demonstrate, dispose).
   */
  demonstrate(result: DeliveryResult, option: CoachOption): Promise<void>;
  /**
   * The training close-up: the ball in the bowler's hand at release, large, then leaving it in very slow motion about
   * the physics spin axis, showing the seam, the polished and the rough half. Between deliveries only.
   */
  closeUp(flight: BallFlight, options?: CloseUpOptions): Promise<void>;
  /** True from the start of the approach to dead ball (Delivery Quiet Mode). */
  quiet(): boolean;
  /** Screen regions of the batter's-eye view the HUD must never cover, at the current size and handedness. */
  protectedRegions(): ProtectedRegion[];
  /** The optional, subtle focus aid around the ball (a setting, off by default; never a glow). */
  setFocusAid(on: boolean): void;
  /** Simulation seconds per real second. TEST HOOK ONLY (1 in play). */
  setTimeScale(k: number): void;
  /** Simulation time ↔ performance.now() for the current delivery. */
  simToPerf(t: number): number;
  perfToSim(perfMs: number): number;
  dispose(): void;
}
