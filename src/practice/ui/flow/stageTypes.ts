/**
 * The Practice stage as the flow sees it: src/render3d's PracticeStage (the first-person 3D stage and its Classic 2D
 * implementation share it), bound in ../ports.ts. Delivery Quiet Mode runs from bowl() to the moment play() resolves
 * (dead ball); the stage also says so with its 'quiet' event.
 */
import type {
  AssistanceStage,
  AssistLevel,
  BallCondition,
  BallFlight,
  BowlerProfile,
  CoachOption,
  DeliveryRecord,
  DeliveryResult,
  FieldIntention,
  FieldLayout,
  GestureInput,
  Handedness,
  NormalizedSwing,
  PerfTier,
  PitchCondition,
  QualityProfileId,
  UnityPracticeDeadBallAction,
  UnityPracticeDeadBallUi,
  UnityPracticeResolution,
} from '@/contracts';
import type { BenchmarkRun } from '@/perf';
import type { OneGestureState } from '@/input';

export interface StageMountOptions {
  profile: QualityProfileId;
  handedness: Handedness;
  reducedMotion: boolean;
  learnCue: boolean;
}

export interface StageStats {
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  spikes: number;
  /** Complete renderer-local frame intervals behind this summary, when the stage can report it. */
  sampleCount?: number;
  lastInputToBatMs: number | null;
  renderer: string;
}

export type StageEvent = 'contextlost' | 'contextrestored' | 'fallback' | 'quiet';

/** What each stage event carries (src/render3d PracticeEventPayloads). */
export interface StageEventPayloads {
  contextlost: Record<string, never>;
  contextrestored: Record<string, never>;
  fallback: { reason: 'no_webgl' | 'context_lost' | 'error'; message?: string };
  quiet: { quiet: boolean };
}

export interface StageScene {
  field: FieldLayout;
  /** Native between-ball setup disclosure; required by Unity, optional for retained renderers. */
  fieldIntent?: FieldIntention;
  trainingObjective?: 'reference' | 'built' | 'random';
  bowler: BowlerProfile;
  conditions: PitchCondition;
  handedness: Handedness;
  ball?: BallCondition;
}

/** Match context for the stage's emotion signals only (crowd, reactions); it never touches the simulation. */
export interface StageDeliveryContext {
  pressure?: number;
  milestone?: 'fifty' | 'hundred' | null;
  wicketEndsInnings?: boolean;
  runs?: number;
  /** Stable authority identifiers required by a cross-runtime presentation surface. */
  overIndex?: number;
  ballIndex?: number;
  seed?: string;
}

/** Native stages emit one already-normalized intent; the flow must never normalize it a second time. */
export interface StageInputSink {
  onSwingStart(atPerfMs: number, pointer: GestureInput['pointer']): void;
  onGestureCancel(): void;
  onSwing(swing: NormalizedSwing | null): void;
  /** Native HUD pause. During a live ball the flow settles a leave before pausing, so it cannot be exploited. */
  onPauseRequest?(): void;
  /** A validated native dead-ball choice. TypeScript remains the sole gameplay authority. */
  onDeadBallAction?(action: UnityPracticeDeadBallAction): void;
}

/** Localized native result copy; the stage binds it to the retained authoritative replay digest. */
export type StageDeadBallUi = Omit<UnityPracticeDeadBallUi, 'replayDigest'>;

/** Coach Mode's guide for an attempt: the recommended response on the same flight (repeatDelivery(source, option.swing)). */
export interface StageGuide {
  result: DeliveryResult;
  option: CoachOption;
}

/**
 * Authority carried alongside a presentation-only Coach demonstration.
 * The source record is required by cross-runtime stages to prove that the
 * recommended alternative belongs to the exact ball; abort is presentation
 * cancellation only and can never alter the innings.
 */
export interface StageDemonstrationContext {
  source: DeliveryRecord;
  signal?: AbortSignal;
}

/** A part of the batter's-eye view the interface must never cover (CSS px relative to the canvas). */
export interface StageRegion {
  kind: 'bowler' | 'release' | 'pitch' | 'ball_path' | 'bat' | 'contact';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PracticeStageLike {
  readonly kind: '3d' | '2d';
  /** True only when the stage, rather than React's GestureSurface, owns live batting input. */
  readonly ownsInput?: boolean;
  mount(canvas: HTMLCanvasElement, opts: StageMountOptions): Promise<void>;
  setScene(scene: StageScene): void;
  /**
   * Optional native-surface handoff for the short, pre-delivery teaching cue.
   * It reveals a scene that has already been acknowledged, but must not arm
   * input, enter quiet mode or start a delivery.
   */
  presentReady?(visible: boolean): Promise<boolean>;
  /** Refreshes language-sensitive native presentation without rebuilding the live stage. */
  setLanguage?(locale: string, readyHint: string): void;
  /** Publish or update native dead-ball guidance only while the exact final pose is retained. */
  presentDeadBallUi?(ui: StageDeadBallUi): Promise<boolean>;
  benchmark(ms: number): Promise<BenchmarkRun>;
  bowl(flight: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }>;
  /**
   * Touch-down: the bat's stroke starts at the press (minus calibration, as normalizeGesture times a tap), bounded so
   * it never reaches the ball until a commitment (beginSwing) arrives; never a contact on its own.
   */
  prepareSwing?(atPerfMs: number, calibrationMs?: number): void;
  /** Abort presentation of an uncommitted input; never rewinds a resolved delivery. */
  cancelSwing?(): void;
  /** Follow the canonical contact while it loads, refines and commits; presentation only. */
  previewContact?(state: OneGestureState): void;
  /** Provisional downswing from committed gesture intent (calibrated as normalizeGesture). */
  beginSwing(atPerfMs: number, calibrationMs?: number): void;
  /** Resolves at dead ball (quiet ends); the consequence camera and reactions continue between balls. */
  play(result: DeliveryResult): Promise<void>;
  /**
   * Optional: a throwaway result of the coming over's first ball (resolved only to warm the physics; never shown, stored
   * or sent anywhere), so the stage can run its result path once ahead, in spare slices of frames, and the first real
   * result does not pay for compiling it. Presentation only, best effort; a stage without such a path ignores it.
   */
  warmResult?(result: DeliveryResult, flight: BallFlight, scene: StageScene): void;
  replay(result: DeliveryResult, opts?: { speed?: number; diagnostics?: boolean }): Promise<void>;
  setProfile(profile: QualityProfileId): void;
  stats(): StageStats;
  on<E extends StageEvent>(event: E, cb: (payload: StageEventPayloads[E]) => void): () => void;
  setLearnCue(on: boolean): void;
  setReducedMotion(on: boolean): void;
  /** Coach Mode assistance for the next bowl() (null: an innings ball). */
  setAssistance(stage: AssistanceStage | null, guide?: StageGuide | null): void;
  /** The exact delivery with a ghost batter playing the option; settles quietly when interrupted. */
  demonstrate(result: DeliveryResult, option: CoachOption, context?: StageDemonstrationContext): Promise<void>;
  /** The ball close-up at release (seam, shine, roughness), between deliveries only. */
  closeUp(flight: BallFlight, options?: { durationMs?: number }): Promise<void>;
  /** True from the start of the approach to dead ball. */
  quiet(): boolean;
  /** The view's regions the interface must never cover, at the current size and handedness. */
  protectedRegions(): StageRegion[];
  /** The optional subtle focus aid around the ball (a setting; off by default). */
  setFocusAid(on: boolean): void;
  setTimeScale(k: number): void;
  simToPerf(t: number): number;
  /** Optional native-stage handoff points; absent on the existing Three.js and Classic implementations. */
  setInputSink?(sink: StageInputSink | null): void;
  supplyResolution?(resolution: UnityPracticeResolution): void;
  pause?(reason?: 'player' | 'background' | 'interruption'): Promise<boolean>;
  resume?(reason?: 'player' | 'foreground' | 'recreated'): Promise<boolean>;
  dispose(): void;
}

/** A native admission decision that must route before any retained renderer is constructed. */
interface StageFactoryRoute {
  kind: 'route';
  target: 'classic';
  reason: 'low_memory_device';
}

export type StageFactory = (opts: {
  force2d: boolean;
  assistance?: AssistLevel;
  deviceTier?: PerfTier;
  /** Internal recovery path: bypass an opted-in native renderer and construct the established web renderer. */
  skipUnity?: boolean;
}) => Promise<PracticeStageLike | StageFactoryRoute>;
