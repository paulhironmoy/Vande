/**
 * The Practice stage: the one renderer's first-person batting presentation (docs/PRACTICE_PRESENTATION.md). The 3D
 * stage (Three.js) and the Classic 2D stage (Canvas 2D) implement the same interface and are driven by the same
 * physics data: a BallFlight before the batter acts, then the DeliveryResult. Nothing here decides an outcome.
 */
import type { AssistLevel, BallFlight, BowlerProfile, DeliveryResult, FieldLayout, Handedness, PitchCondition, QualityProfileId } from '@/contracts/practice';
import type { PresentationSink } from '../types';

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
  /** Interval between consecutive rendered frames (ms), in order. */
  frameMs: number[];
  shaderCompileMs: number;
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
  /** Pointer event → first submitted frame showing the bat moving (ms), for the latest swing. */
  lastInputToBatMs: number | null;
  renderer: string;
  profile: QualityProfileId;
  drawCalls: number;
  contextLosses: number;
}

export type PracticeStageEvent = 'contextlost' | 'contextrestored' | 'fallback';
export interface PracticeFallbackPayload {
  reason: 'no_webgl' | 'context_lost' | 'error';
  message?: string;
}
export interface PracticeEventPayloads {
  contextlost: Record<string, never>;
  contextrestored: Record<string, never>;
  fallback: PracticeFallbackPayload;
}

/** How a contact feels (one distinct visual, sound and haptic each), keyed to the event's simulation timestamp. */
export type ContactFeel = 'sweet' | 'middle' | 'edge' | 'pad' | 'miss' | 'bowled' | 'catch' | 'four' | 'six';

/** A presentation sink that can also play the batter's contact feels (src/audio implements it for Practice). */
export interface PracticeSink extends PresentationSink {
  feel?(feel: ContactFeel, intensity: number): void;
}

export interface PracticeStage {
  readonly kind: '3d' | '2d';
  mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void>;
  /** Places the field, the bowler and the pitch (between deliveries). */
  setScene(setup: PracticeSceneSetup): void;
  /** Runs the bowler's run-up and action; resolves at the real release moment (performance.now() clock). */
  bowl(flight: BallFlight): Promise<{ releasePerfMs: number }>;
  /** The current delivery's scheduled release, known as soon as bowl() is called (null when none). */
  releasePerfMs(): number | null;
  /**
   * The swing began (the raw pointer-down or key timestamp): the bat moves at once, provisionally, until the result
   * arrives. `calibrationMs` is the same offset normalizeGesture applies, so the bat moves on the simulation clock.
   */
  beginSwing(atPerfMs: number, calibrationMs?: number): void;
  /** Plays the result: bat, contact, ball, fielders, then the fielding camera. Resolves at dead ball. */
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
  /** Simulation seconds per real second. TEST HOOK ONLY (1 in play). */
  setTimeScale(k: number): void;
  /** Simulation time ↔ performance.now() for the current delivery. */
  simToPerf(t: number): number;
  perfToSim(perfMs: number): number;
  dispose(): void;
}
