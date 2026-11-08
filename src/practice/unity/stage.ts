/**
 * Explicit opt-in PracticeStageLike adapter for Unity-as-a-Library.
 *
 * React/TypeScript still owns delivery choice, input normalization, physics, scoring, innings, replay identity and
 * Coach. Unity receives only authoritative flights/results and owns the native input surface while it is visible.
 * Nothing in the default Practice factory imports or enables this adapter.
 */
import {
  canonicalUnityPracticeJson,
  isUnchangedUnityPracticeResolution,
  makeUnityPracticeResolution,
  type AssistLevel,
  type AssistanceStage,
  type BallFlight,
  type CoachOption,
  type DeliveryResult,
  type DeliveryRecord,
  type GestureInput,
  type NormalizedSwing,
  type PerfTier,
  type QualityProfileId,
  type UnityPracticeResolution,
  type UnityPracticeStats,
  type UnityPracticeDeliveryPresentation,
  type UnityPracticeDeadBallAction,
  type UnityPracticeDeadBallUi,
  type UnityPracticePayloadByType,
} from '@/contracts';
import type { BenchmarkRun } from '@/perf';
import type { UnityPracticeBridge } from '@/platform/unityPractice';
import type {
  PracticeStageLike,
  StageDeliveryContext,
  StageEvent,
  StageEventPayloads,
  StageGuide,
  StageDeadBallUi,
  StageMountOptions,
  StageRegion,
  StageScene,
  StageStats,
} from '@/practice/ui/flow/types';
import {
  UnityPracticeSessionCoordinator,
  type UnityPracticeCoordinatorEvent,
  type UnityPracticeTimers,
} from './coordinator';

/**
 * Coach options intentionally publish an exact contact point/time only for bat
 * contact. Pad, body and miss options keep those fields null even though the
 * authoritative physics result retains its impact/closest-approach coordinates.
 * Compare the complete published identity without treating that deliberate
 * omission as a different shot.
 */
const COACH_BAT_CONTACTS: ReadonlySet<DeliveryResult['contact']['kind']> = new Set([
  'middle',
  'inside_edge',
  'outside_edge',
  'top_edge',
  'leading_edge',
]);

function coachDemonstrationMatchesResult(option: CoachOption, result: DeliveryResult): boolean {
  const expectedDecision = option.swing?.kind ?? 'leave';
  const batContact = COACH_BAT_CONTACTS.has(result.contact.kind);
  return (
    option.decision === expectedDecision &&
    canonicalUnityPracticeJson(option.swing) === canonicalUnityPracticeJson(result.swing) &&
    option.footwork === result.footwork &&
    option.contact === result.contact.kind &&
    canonicalUnityPracticeJson(option.outcome) === canonicalUnityPracticeJson(result.outcome) &&
    (batContact
      ? option.contactT !== null &&
        canonicalUnityPracticeJson(option.contactT) === canonicalUnityPracticeJson(result.contact.t)
      : option.contactT === null) &&
    (batContact
      ? option.contactPoint !== null &&
        canonicalUnityPracticeJson(option.contactPoint) === canonicalUnityPracticeJson(result.contact.point)
      : option.contactPoint === null)
  );
}

export interface UnityPracticeInputSink {
  onSwingStart(atPerfMs: number, pointer: GestureInput['pointer']): void;
  onGestureCancel(): void;
  /**
   * Already normalized once by the authoritative TypeScript input module; never normalize it again. False means the
   * flow did not take it as the ball's swing (it began after the leave deadline, or the ball is already settled).
   */
  onSwing(swing: NormalizedSwing | null): boolean | void;
  onPauseRequest?(): void;
  onDeadBallAction?(action: UnityPracticeDeadBallAction): void;
}

export interface UnityPracticeStageOptions {
  /** Required literal opt-in. The default Practice stage factory never supplies it. */
  enableUnityPractice: true;
  bridge: UnityPracticeBridge;
  buildId: string;
  sessionId: string;
  deviceTier: PerfTier;
  assistance: AssistLevel;
  locale?: string;
  pixelsPerDp: number;
  textScale: number;
  highContrast: boolean;
  /** Localized one-gesture cue shown by the native host while Unity covers React. */
  readyHint?: string;
  captions?: boolean;
  audio?: boolean;
  haptics?: boolean;
  calibrationMs?: number;
  /** Read at mount and before every delivery; lets the existing local calibration store remain authoritative. */
  calibrations?: () => Partial<Record<GestureInput['pointer'], number>>;
  ackTimeoutMs?: number;
  launchTimeoutMs?: number;
  releaseTimeoutMs?: number;
  deadTimeoutMs?: number;
  now?: () => number;
  timers?: UnityPracticeTimers;
  messageId?: (purpose: string, ordinal: number) => string;
  /** Native-specific benchmark port. Without it benchmark() fails closed instead of fabricating frame samples. */
  benchmark?: (durationMs: number) => Promise<BenchmarkRun>;
}

export type UnityPracticeStageDiagnosticCode =
  | 'launch_failed'
  | 'visibility_failed'
  | 'scene_failed'
  | 'locale_failed'
  | 'delivery_context_mismatch'
  | 'delivery_failed'
  | 'release_timeout'
  | 'resolution_missing'
  | 'resolution_mismatch'
  | 'result_failed'
  | 'dead_timeout'
  | 'replay_unavailable'
  | 'coach_presentation_unavailable'
  | 'demonstration_failed'
  | 'benchmark_unavailable'
  | 'unsupported_time_scale'
  | 'dispose_deferred'
  | 'coordinator_fallback';

export interface UnityPracticeStageDiagnostic {
  code: UnityPracticeStageDiagnosticCode;
  detail: string;
  inFlightDeliveryId: string | null;
}

export interface UnityPracticeStageSnapshot {
  mounted: boolean;
  disposed: boolean;
  visible: boolean;
  /** True only while the retained canvas is showing the authoritative dead-ball frame. */
  retainingFinalPose: boolean;
  /** Runtime input is accepted only during the coordinator's live delivery state. */
  inputActive: boolean;
  quiet: boolean;
  ownsInput: true;
  inputSinkBound: boolean;
  activeDeliveryId: string | null;
  coordinatorStatus: ReturnType<UnityPracticeSessionCoordinator['snapshot']>['status'] | null;
  diagnostics: readonly UnityPracticeStageDiagnostic[];
}

interface UnityDeliveryContext extends StageDeliveryContext {
  overIndex?: number;
  ballIndex?: number;
  seed?: string;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
  settled(): boolean;
}

interface ActiveDelivery {
  id: string;
  flight: BallFlight;
  overIndex: number;
  ballIndex: number;
  release: Deferred<number>;
  dead: Deferred<void>;
  resolution: UnityPracticeResolution | null;
  releasePerfMs: number | null;
}

interface ReplayWaiter {
  deliveryId: string;
  done: Deferred<void>;
}

interface DemonstrationWaiter {
  deliveryId: string;
  done: Deferred<void>;
  signal: AbortSignal | null;
  onAbort: (() => void) | null;
  cancelled: boolean;
}

interface CanvasViewportScope {
  clientHeight: number;
  clientWidth: number;
  cssHeight: number;
  cssWidth: number;
}

interface ProtectedRegionSnapshot {
  deliveryId: string;
  payload: UnityPracticePayloadByType['unity.protected_regions'];
  scope: CanvasViewportScope;
}

const DEFAULT_RELEASE_TIMEOUT_MS = 12_000;
const DEFAULT_DEAD_TIMEOUT_MS = 30_000;
const DEFAULT_BALL = { colour: 'white', age: 'new' } as const;

function demonstrationAbortError(): Error {
  const error = new Error('Unity Practice demonstration cancelled.');
  error.name = 'AbortError';
  return error;
}

function deferred<T>(): Deferred<T> {
  let done = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  void promise.catch(() => undefined);
  return {
    promise,
    resolve(value) {
      if (done) return;
      done = true;
      resolvePromise(value);
    },
    reject(error) {
      if (done) return;
      done = true;
      rejectPromise(error);
    },
    settled: () => done,
  };
}

/** Whether `supplied` is the authoritative result of the resolution. */
function sameResult(resolution: UnityPracticeResolution, supplied: DeliveryResult): boolean {
  // The very result a made resolution was made from, unchanged since, is its own canonical form: nothing to canonicalize.
  if (resolution.result === supplied && isUnchangedUnityPracticeResolution(resolution)) return true;
  return canonicalUnityPracticeJson(resolution.result) === canonicalUnityPracticeJson(supplied);
}

function sameCanvasScope(expected: CanvasViewportScope, current: CanvasViewportScope): boolean {
  const close = (left: number, right: number) => Math.abs(left - right) <= 0.25;
  return (
    expected.clientWidth === current.clientWidth &&
    expected.clientHeight === current.clientHeight &&
    close(expected.cssWidth, current.cssWidth) &&
    close(expected.cssHeight, current.cssHeight)
  );
}

/** Creates an adapter only after the caller has made an explicit product/runtime opt-in decision. */
export function createUnityPracticeStage(options: UnityPracticeStageOptions): UnityPracticeStage {
  if (options.enableUnityPractice !== true) throw new Error('Unity Practice requires explicit opt-in.');
  return new UnityPracticeStage(options);
}

export class UnityPracticeStage implements PracticeStageLike {
  readonly kind = '3d' as const;
  readonly ownsInput = true as const;

  private coordinator: UnityPracticeSessionCoordinator | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private readonly canvasBacked: boolean;
  private mounted = false;
  private disposed = false;
  private visible = false;
  private quietValue = false;
  private inputSink: UnityPracticeInputSink | null = null;
  private readonly handlers = new Map<StageEvent, Set<(payload: unknown) => void>>();
  private readonly diagnosticHistory: UnityPracticeStageDiagnostic[] = [];
  private readonly calibrationOffsets: Partial<Record<GestureInput['pointer'], number>> = {};
  private scene: StageScene | null = null;
  private sceneTask: Promise<boolean> = Promise.resolve(false);
  private active: ActiveDelivery | null = null;
  private last: { deliveryId: string; resolution: UnityPracticeResolution } | null = null;
  private replayWaiter: ReplayWaiter | null = null;
  private demonstrationWaiter: DemonstrationWaiter | null = null;
  /** Complete demo/cancel boundary that a following live ball must never overtake. */
  private demonstrationTask: Promise<void> | null = null;
  private demonstrationOrdinal = 0;
  private deliveryOrdinal = 0;
  private releasePerf: number | null = null;
  private profile: QualityProfileId = 'standard';
  private profileTask: Promise<void> = Promise.resolve();
  private pendingProfile: QualityProfileId | null = null;
  private timeScale = 1;
  private renderer = 'Unity';
  private latestStats: UnityPracticeStats | null = null;
  private learnCue = false;
  private assistance: { stage: AssistanceStage; guide: StageGuide | null } | null = null;
  private fallbackEmitted = false;
  private fallbackTask: Promise<void> | null = null;
  private disposeTask: Promise<void> | null = null;
  private locale: string;
  private readyHint: string;
  private retainingFinalPose = false;
  private deadBallUi: { deliveryId: string; payload: UnityPracticeDeadBallUi } | null = null;
  private deadBallActionConsumed = false;
  private paused = false;
  private protectedRegionSnapshot: ProtectedRegionSnapshot | null = null;

  constructor(private readonly options: UnityPracticeStageOptions) {
    this.canvasBacked = typeof options.bridge.attachCanvas === 'function';
    this.locale = options.locale ?? 'en-IN';
    this.readyHint = options.readyHint ?? 'Pull back · Watch · Flick forward · Do nothing to leave';
  }

  async mount(canvas: HTMLCanvasElement, mount: StageMountOptions): Promise<void> {
    if (this.mounted || this.disposed) throw new Error('Unity Practice stage cannot be mounted twice.');
    this.canvas = canvas;
    this.setCanvasGameplayInput(false);
    this.options.bridge.attachCanvas?.(canvas);
    this.profile = mount.profile;
    this.learnCue = mount.learnCue;
    this.refreshCalibrations();
    this.coordinator = new UnityPracticeSessionCoordinator({
      bridge: this.options.bridge,
      buildId: this.options.buildId,
      sessionId: this.options.sessionId,
      initialize: {
        locale: this.locale,
        pixelsPerDp: this.options.pixelsPerDp,
        quality: mount.profile,
        deviceTier: this.options.deviceTier,
        handedness: mount.handedness,
        assistance: this.options.assistance,
        reducedMotion: mount.reducedMotion,
        textScale: this.options.textScale,
        highContrast: this.options.highContrast,
        captions: this.options.captions ?? true,
        audio: this.options.audio ?? true,
        haptics: this.options.haptics ?? true,
        coordinateSystem: 'vande-striker-frame-v1',
        handednessPolicy: 'physics-right-handed-presentation-mirrors-once',
      },
      calibrationMs: this.options.calibrationMs ?? 0,
      calibrations: this.calibrationOffsets,
      ackTimeoutMs: this.options.ackTimeoutMs,
      launchTimeoutMs: this.options.launchTimeoutMs,
      now: this.options.now,
      timers: this.options.timers,
      messageId: this.options.messageId,
      onEvent: (event) => this.onCoordinatorEvent(event),
    });
    if (!(await this.coordinator.launch())) {
      this.note('launch_failed', 'Unity did not complete its validated launch and clock handshake.');
      throw new Error('Unity Practice launch failed.');
    }
    // Android attaches the operation-scoped overlay INVISIBLE. Verify that invariant before React setup continues.
    if (!(await this.setVisible(false))) {
      this.note('visibility_failed', 'Unity could not confirm its hidden setup state.');
      await this.coordinator.forceDispose('fallback');
      throw new Error('Unity Practice could not remain hidden.');
    }
    this.mounted = true;
    if (this.scene) this.queueScene(this.scene);
  }

  setScene(scene: StageScene): void {
    this.clearProtectedRegions();
    const prior = this.scene;
    this.scene = {
      ...scene,
      ...(scene.fieldIntent === undefined && prior?.field.id === scene.field.id && prior.fieldIntent
        ? { fieldIntent: prior.fieldIntent }
        : {}),
      ...(scene.trainingObjective === undefined && prior?.field.id === scene.field.id && prior.trainingObjective
        ? { trainingObjective: prior.trainingObjective }
        : {}),
    };
    if (!this.coordinator || !this.mounted || this.disposed) return;
    this.queueScene(this.scene);
  }

  async presentReady(visible: boolean): Promise<boolean> {
    if (!this.mounted || this.disposed || this.active || this.replayWaiter || this.demonstrationWaiter) return false;
    if (!visible) return this.setReadyVisible(false);
    if (
      !this.scene ||
      !(await this.sceneTask) ||
      this.disposed ||
      this.active ||
      this.replayWaiter ||
      this.demonstrationWaiter
    )
      return false;
    this.retainingFinalPose = false;
    this.clearDeadBallUi();
    this.setCanvasGameplayInput(false);
    return this.setReadyVisible(true);
  }

  async presentDeadBallUi(ui: StageDeadBallUi): Promise<boolean> {
    const coordinator = this.coordinator;
    const last = this.last;
    if (
      !coordinator ||
      !last ||
      this.disposed ||
      this.paused ||
      !this.retainingFinalPose ||
      this.active !== null ||
      this.replayWaiter !== null ||
      this.demonstrationWaiter !== null ||
      this.deadBallActionConsumed
    )
      return false;
    const payload: UnityPracticeDeadBallUi = {
      ...ui,
      replayDigest: last.resolution.replayDigest,
    };
    this.deadBallUi = { deliveryId: last.deliveryId, payload };
    // WebGL keeps the React result hierarchy over the frozen Unity canvas. The
    // native overlay needs the same localized hierarchy inside Unity itself.
    if (this.canvasBacked) return true;
    return coordinator.sendDeadBallUi(last.deliveryId, payload);
  }

  setLanguage(locale: string, readyHint: string): void {
    const localeChanged = locale !== this.locale;
    this.locale = locale;
    this.readyHint = readyHint;
    const coordinator = this.coordinator;
    if (!localeChanged || !coordinator || !this.mounted || this.disposed) return;
    void coordinator.setLocale(locale).then((accepted) => {
      if (!accepted && !this.disposed)
        this.note('locale_failed', 'Unity did not acknowledge the presentation language.');
    });
  }

  async benchmark(durationMs: number): Promise<BenchmarkRun> {
    if (this.options.benchmark) return this.options.benchmark(durationMs);
    const coordinator = this.requireCoordinator();
    await this.profileTask;
    const boundedDurationMs = Math.min(10_000, Math.max(1_000, durationMs));
    const result = await coordinator.benchmark(this.profile, boundedDurationMs);
    if (!result) {
      this.note('benchmark_unavailable', 'Unity did not provide bounded native frame samples.');
      throw new Error('Unity Practice native benchmark unavailable.');
    }
    if (result.graphics.contextLosses === null) {
      this.note('benchmark_unavailable', 'Unity could not truthfully observe native graphics-context losses.');
      throw new Error('Unity Practice native context-loss evidence unavailable.');
    }
    const renderer = `${result.graphics.api} ${result.graphics.device}`.trim();
    this.renderer = `Unity ${renderer}`;
    return {
      backend: 'unity',
      frameMs: [...result.frameIntervalsMs],
      shaderCompileMs: result.warmup.shaderWarmupMs,
      contextLosses: result.graphics.contextLosses,
      renderer,
      // This is truthful native graphics evidence. It must never pretend the UnityPlayer is WebGL.
      webgl2: false,
      hardware: !/(swiftshader|llvmpipe|lavapipe|software|microsoft basic|null device)/i.test(renderer),
    };
  }

  async bowl(flight: BallFlight, context: StageDeliveryContext = {}): Promise<{ releasePerfMs: number }> {
    // First-run Skip may return to the flow before the cancellation ACK has
    // crossed runtimes. The first real ball must not overtake that reset.
    const demonstrationBoundary = this.demonstrationTask;
    if (demonstrationBoundary) await demonstrationBoundary.catch(() => undefined);
    const coordinator = this.requireCoordinator();
    if (!this.scene || !(await this.sceneTask)) throw new Error('Unity Practice scene is not ready.');
    if (this.active || this.replayWaiter || this.demonstrationWaiter)
      throw new Error('Unity Practice already has a presentation in flight.');
    const nativeContext = context as UnityDeliveryContext;
    if (nativeContext.seed !== undefined && nativeContext.seed !== flight.seed) {
      this.note('delivery_context_mismatch', 'The flow delivery seed did not match the authoritative flight.');
      throw new Error('Unity Practice delivery context mismatch.');
    }
    this.refreshCalibrations();
    const ordinal = this.deliveryOrdinal;
    this.deliveryOrdinal += 1;
    const overIndex = nativeContext.overIndex ?? Math.floor(ordinal / 6);
    const ballIndex = nativeContext.ballIndex ?? ordinal % 6;
    const presentation = this.deliveryPresentation(flight);
    const id = `${this.options.sessionId}:delivery:${ordinal + 1}`;
    const active: ActiveDelivery = {
      id,
      flight,
      overIndex,
      ballIndex,
      release: deferred<number>(),
      dead: deferred<void>(),
      resolution: null,
      releasePerfMs: null,
    };
    this.clearProtectedRegions();
    this.active = active;
    this.retainingFinalPose = false;
    this.clearDeadBallUi();
    this.releasePerf = null;
    this.setQuiet(true);
    if (!(await this.setVisible(true))) {
      await this.fail('visibility_failed', 'Unity could not reveal the live delivery surface.');
      throw new Error('Unity Practice visibility failed.');
    }
    const started = await coordinator.startDelivery(id, {
      overIndex,
      ballIndex,
      plan: flight.plan,
      seed: flight.seed,
      flight,
      presentation,
    });
    if (!started) {
      await this.fail('delivery_failed', 'Unity did not acknowledge the authoritative delivery.');
      throw new Error('Unity Practice delivery failed.');
    }
    this.setCanvasGameplayInput(true);
    try {
      const releasePerfMs = await this.bounded(
        active.release.promise,
        this.options.releaseTimeoutMs ?? DEFAULT_RELEASE_TIMEOUT_MS,
      );
      return { releasePerfMs };
    } catch {
      await this.fail('release_timeout', 'Unity did not report release within the bounded run-up window.');
      throw new Error('Unity Practice release timed out.');
    }
  }

  prepareSwing(_atPerfMs: number, _calibrationMs = 0): void {
    // Native Unity owns the live input surface; React input must be disabled while this adapter is selected. The
    // touch-down rule (owner decision 2026-11-04, CTL1: the bat starts moving at touch-down, the shot commits on lift)
    // is the native side's to draw from its own touch-down; nothing is sent from here.
  }

  cancelSwing(): void {
    // Cancellation originates from unity.pointer and is forwarded through the native input sink.
  }

  beginSwing(_atPerfMs: number, _calibrationMs = 0): void {
    // The coordinator sends the already-normalized provisional swing from the Unity gesture callback.
  }

  /** The flow calls this after it has committed the TypeScript-owned record, result, score and digest. */
  supplyResolution(resolution: UnityPracticeResolution): void {
    const active = this.active;
    if (!active) {
      this.note('resolution_missing', 'A resolution was supplied without an active Unity delivery.');
      return;
    }
    if (
      resolution.record.seed !== active.flight.seed ||
      resolution.result.flight.seed !== active.flight.seed ||
      canonicalUnityPracticeJson(resolution.record.plan) !== canonicalUnityPracticeJson(active.flight.plan) ||
      canonicalUnityPracticeJson(resolution.result.flight) !== canonicalUnityPracticeJson(active.flight) ||
      resolution.record.overIndex !== active.overIndex ||
      resolution.record.ballIndex !== active.ballIndex
    ) {
      this.note('resolution_mismatch', 'The authoritative resolution did not match the active Unity delivery.');
      return;
    }
    active.resolution = resolution;
  }

  async play(result: DeliveryResult): Promise<void> {
    const coordinator = this.requireCoordinator();
    const active = this.active;
    const resolution = active?.resolution;
    if (!active || !resolution) {
      await this.fail('resolution_missing', 'Unity presentation requires the committed authoritative resolution.');
      throw new Error('Unity Practice authoritative resolution missing.');
    }
    if (!sameResult(resolution, result)) {
      await this.fail('resolution_mismatch', 'play() did not receive the supplied authoritative result.');
      throw new Error('Unity Practice authoritative result mismatch.');
    }
    if (!(await coordinator.sendResult(active.id, resolution))) {
      await this.fail('result_failed', 'Unity did not acknowledge the authoritative result.');
      throw new Error('Unity Practice result failed.');
    }
    try {
      await this.bounded(active.dead.promise, this.options.deadTimeoutMs ?? DEFAULT_DEAD_TIMEOUT_MS);
    } catch {
      await this.fail('dead_timeout', 'Unity did not reach dead ball within the bounded presentation window.');
      throw new Error('Unity Practice dead-ball timeout.');
    }
  }

  async replay(result: DeliveryResult, opts: { speed?: number; diagnostics?: boolean } = {}): Promise<void> {
    const demonstrationBoundary = this.demonstrationTask;
    if (demonstrationBoundary) await demonstrationBoundary.catch(() => undefined);
    const coordinator = this.requireCoordinator();
    const last = this.last;
    if (!last || !sameResult(last.resolution, result)) {
      this.note('replay_unavailable', 'Only the last contract-bound Unity delivery can be replayed.');
      throw new Error('Unity Practice replay is unavailable for this result.');
    }
    if (!(await this.setVisible(true))) {
      await this.fail('visibility_failed', 'Unity could not reveal the replay surface.');
      throw new Error('Unity Practice replay visibility failed.');
    }
    // Replays are presentation, never a second opportunity to submit input.
    this.clearProtectedRegions();
    this.setCanvasGameplayInput(false);
    this.retainingFinalPose = false;
    this.setQuiet(true);
    const waiter: ReplayWaiter = { deliveryId: last.deliveryId, done: deferred<void>() };
    this.replayWaiter = waiter;
    const accepted = await coordinator.replay(last.deliveryId, {
      resolution: last.resolution,
      speed: opts.speed ?? 0.3,
      diagnostics: opts.diagnostics ?? true,
    });
    if (!accepted) {
      this.replayWaiter = null;
      await this.fail('replay_unavailable', 'Unity did not acknowledge the replay.');
      throw new Error('Unity Practice replay failed.');
    }
    try {
      await this.bounded(waiter.done.promise, this.options.deadTimeoutMs ?? DEFAULT_DEAD_TIMEOUT_MS);
    } catch {
      await this.fail('dead_timeout', 'Unity replay did not reach dead ball within the bounded presentation window.');
      throw new Error('Unity Practice replay dead-ball timeout.');
    }
  }

  setProfile(profile: QualityProfileId): void {
    if (this.active || this.replayWaiter || this.demonstrationWaiter) {
      this.pendingProfile = profile;
      return;
    }
    this.profileTask = this.profileTask.then(
      () => this.applyProfile(profile),
      () => this.applyProfile(profile),
    );
  }

  stats(): StageStats {
    const stats = this.latestStats;
    return {
      fps: stats?.fps ?? 0,
      avgFrameMs: stats?.avgFrameMs ?? 0,
      p95FrameMs: stats?.p95FrameMs ?? 0,
      spikes: stats?.spikes ?? 0,
      ...(stats ? { sampleCount: stats.sampleCount } : {}),
      lastInputToBatMs: stats?.inputToVisibleBatMs ?? null,
      renderer: this.renderer,
    };
  }

  on<E extends StageEvent>(event: E, callback: (payload: StageEventPayloads[E]) => void): () => void;
  on(event: StageEvent, callback: (payload: never) => void): () => void;
  on(event: StageEvent, callback: (payload: never) => void): () => void {
    let listeners = this.handlers.get(event);
    if (!listeners) {
      listeners = new Set();
      this.handlers.set(event, listeners);
    }
    const listener = callback as (payload: unknown) => void;
    listeners.add(listener);
    return () => listeners?.delete(listener);
  }

  setLearnCue(on: boolean): void {
    this.learnCue = on;
  }

  setReducedMotion(_on: boolean): void {
    // Reduced motion is fixed in host.initialize for the lifetime of this Unity session.
  }

  setAssistance(stage: AssistanceStage | null, guide: StageGuide | null = null): void {
    if (stage === null) {
      this.assistance = null;
      return;
    }
    if (![1, 2, 3, 4].includes(stage)) throw new TypeError('Unity Practice Coach stage is invalid.');
    this.assistance = { stage, guide };
  }

  demonstrate(
    result: DeliveryResult,
    option: CoachOption,
    context?: { source: DeliveryRecord; signal?: AbortSignal },
  ): Promise<void> {
    if (this.demonstrationTask) return this.demonstrationTask;
    const task = this.runDemonstration(result, option, context).finally(() => {
      if (this.demonstrationTask === task) this.demonstrationTask = null;
    });
    this.demonstrationTask = task;
    return task;
  }

  async closeUp(_flight: BallFlight, _options: { durationMs?: number } = {}): Promise<void> {
    this.note('coach_presentation_unavailable', 'The Unity contract does not yet carry the training ball close-up.');
    throw new Error('Unity Practice close-up unavailable.');
  }

  private async runDemonstration(
    result: DeliveryResult,
    option: CoachOption,
    context?: { source: DeliveryRecord; signal?: AbortSignal },
  ): Promise<void> {
    const coordinator = this.requireCoordinator();
    const source = context?.source;
    const signal = context?.signal ?? null;
    if (!source) {
      this.note('demonstration_failed', 'Unity Practice demonstration requires its authoritative source record.');
      throw new Error('Unity Practice demonstration source is missing.');
    }
    if (signal?.aborted) throw demonstrationAbortError();
    if (this.active || this.replayWaiter || this.demonstrationWaiter || this.paused) {
      throw new Error('Unity Practice cannot overlap a demonstration with another presentation.');
    }
    if (!this.scene || !(await this.sceneTask) || this.disposed) {
      this.note('demonstration_failed', 'Unity Practice scene is not ready for demonstration.');
      throw new Error('Unity Practice demonstration scene is unavailable.');
    }
    if (
      source.seed !== result.flight.seed ||
      canonicalUnityPracticeJson(source.plan) !== canonicalUnityPracticeJson(result.flight.plan) ||
      !coachDemonstrationMatchesResult(option, result)
    ) {
      this.note('demonstration_failed', 'Coach demonstration did not match its authoritative source and response.');
      throw new Error('Unity Practice demonstration identity mismatch.');
    }

    const record: DeliveryRecord = {
      ...source,
      swing: option.swing,
      runs: result.outcome.runs,
      dismissal: result.outcome.dismissal,
    };
    const wickets: 0 | 1 = result.outcome.dismissal === null ? 0 : 1;
    // Canonicalized and digested once here: the identity check and the packet that follow reuse that.
    const resolution = await makeUnityPracticeResolution(record, result, {
      // Demonstrations are score-inert. This internally coherent one-ball
      // snapshot exists only because the canonical resolution validator also
      // protects the trace consumed by Unity.
      runs: result.outcome.runs,
      wickets,
      balls: 1,
      maxOvers: 10,
    });
    if (signal?.aborted) throw demonstrationAbortError();
    const delivery: UnityPracticePayloadByType['host.delivery'] = {
      overIndex: record.overIndex,
      ballIndex: record.ballIndex,
      plan: record.plan,
      seed: record.seed,
      flight: result.flight,
      presentation: {
        learnCue: false,
        coach: {
          stage: 1,
          contactT: option.contactT,
          contactPoint: option.contactPoint ? { ...option.contactPoint } : null,
        },
      },
    };

    this.demonstrationOrdinal += 1;
    const deliveryId = `${this.options.sessionId}:demonstration:${this.demonstrationOrdinal}`;
    const waiter: DemonstrationWaiter = {
      deliveryId,
      done: deferred<void>(),
      signal,
      onAbort: null,
      cancelled: false,
    };
    waiter.onAbort = () => {
      waiter.cancelled = true;
      void coordinator.cancelDemonstration(deliveryId).then((accepted) => {
        if (!accepted && this.demonstrationWaiter === waiter && !waiter.done.settled()) {
          // A matching completion may have won the race. Its event settles the
          // waiter; otherwise a failed cancel is fail-closed by the coordinator.
          const status = coordinator.snapshot().status;
          if (status !== 'scene_ready' && status !== 'dead_ball') {
            waiter.done.reject(new Error('Unity Practice demonstration cancellation failed.'));
          }
        }
      });
    };
    signal?.addEventListener('abort', waiter.onAbort, { once: true });
    this.demonstrationWaiter = waiter;
    this.clearProtectedRegions();
    this.retainingFinalPose = false;
    this.setCanvasGameplayInput(false);
    this.setQuiet(true);
    if (!(await this.setVisible(true))) {
      this.cleanupDemonstrationWaiter(waiter);
      this.setQuiet(false);
      this.note('visibility_failed', 'Unity could not reveal the Coach demonstration.');
      await this.fail('visibility_failed', 'Unity could not reveal the Coach demonstration.');
      throw new Error('Unity Practice demonstration visibility failed.');
    }
    this.setCanvasGameplayInput(false);

    try {
      const accepted = await coordinator.demonstrate(deliveryId, { delivery, resolution, speed: 1 });
      if (!accepted) throw new Error('Unity Practice did not acknowledge the Coach demonstration.');
      if (signal?.aborted && !waiter.cancelled) waiter.onAbort?.();
      await this.bounded(waiter.done.promise, this.options.deadTimeoutMs ?? DEFAULT_DEAD_TIMEOUT_MS);
    } catch (error) {
      if (waiter.cancelled || (error instanceof Error && error.name === 'AbortError')) throw demonstrationAbortError();
      if (this.demonstrationWaiter === waiter && !waiter.done.settled()) waiter.done.reject(error as Error);
      this.cleanupDemonstrationWaiter(waiter);
      this.note(
        'demonstration_failed',
        error instanceof Error ? error.message : 'Unity Practice demonstration failed.',
      );
      if (coordinator.snapshot().status !== 'fallback') {
        await this.fail('demonstration_failed', 'Unity Practice demonstration did not complete safely.');
      }
      throw error;
    } finally {
      signal?.removeEventListener('abort', waiter.onAbort!);
    }
  }

  quiet(): boolean {
    return this.quietValue;
  }

  protectedRegions(): StageRegion[] {
    const snapshot = this.protectedRegionSnapshot;
    const currentDeliveryId = this.active?.id ?? (this.retainingFinalPose ? (this.last?.deliveryId ?? null) : null);
    const scope = this.canvasViewportScope();
    if (!snapshot || !scope || snapshot.deliveryId !== currentDeliveryId || !sameCanvasScope(snapshot.scope, scope)) {
      if (snapshot) this.clearProtectedRegions();
      return [];
    }
    const xScale = scope.cssWidth / snapshot.payload.viewportWidth;
    const yScale = scope.cssHeight / snapshot.payload.viewportHeight;
    return snapshot.payload.regions.map((region) => ({
      kind: region.kind,
      x: region.x * xScale,
      y: region.y * yScale,
      width: region.width * xScale,
      height: region.height * yScale,
    }));
  }

  setFocusAid(_on: boolean): void {
    // The current Unity slice has no focus-aid message; it remains off unless supplied at a future launch boundary.
  }

  private deliveryPresentation(flight: BallFlight): UnityPracticeDeliveryPresentation {
    const assistance = this.assistance;
    if (!assistance) return { learnCue: this.learnCue, coach: null };

    // Stage four is deliberately empty. It is the mastery attempt whose evidence
    // must not be helped by markers, even when the flow still supplies a guide.
    if (assistance.stage === 4) {
      return { learnCue: false, coach: { stage: 4, contactT: null, contactPoint: null } };
    }

    const guide = assistance.guide;
    if (!guide) {
      return {
        learnCue: false,
        coach: { stage: assistance.stage, contactT: null, contactPoint: null },
      };
    }
    if (canonicalUnityPracticeJson(guide.result.flight) !== canonicalUnityPracticeJson(flight)) {
      this.note('delivery_context_mismatch', 'The Coach guide did not describe the authoritative exact ball.');
      throw new Error('Unity Practice Coach guide delivery mismatch.');
    }
    if (canonicalUnityPracticeJson(guide.option.swing) !== canonicalUnityPracticeJson(guide.result.swing)) {
      this.note('delivery_context_mismatch', 'The Coach guide response did not match its authoritative result.');
      throw new Error('Unity Practice Coach guide response mismatch.');
    }
    const contactT = guide.option.contactT;
    const contactPoint = guide.option.contactPoint;
    if ((contactT === null) !== (contactPoint === null)) {
      this.note('delivery_context_mismatch', 'The Coach guide carried an incomplete contact marker.');
      throw new Error('Unity Practice Coach guide contact mismatch.');
    }
    if (
      canonicalUnityPracticeJson(contactT) !== canonicalUnityPracticeJson(guide.result.contact.t) ||
      canonicalUnityPracticeJson(contactPoint) !== canonicalUnityPracticeJson(guide.result.contact.point)
    ) {
      this.note('delivery_context_mismatch', 'The Coach marker did not match the authoritative response contact.');
      throw new Error('Unity Practice Coach guide contact mismatch.');
    }
    return {
      learnCue: false,
      coach: {
        stage: assistance.stage,
        contactT,
        contactPoint: contactPoint ? { ...contactPoint } : null,
      },
    };
  }

  setTimeScale(scale: number): void {
    if (scale === 1) {
      this.timeScale = 1;
      return;
    }
    this.note(
      'unsupported_time_scale',
      'Unity Practice supports real-time play only; non-1 scales remain a test hook.',
    );
  }

  simToPerf(t: number): number {
    return this.releasePerf === null || !Number.isFinite(t)
      ? Number.NaN
      : this.releasePerf + (t * 1000) / this.timeScale;
  }

  setInputSink(sink: UnityPracticeInputSink | null): void {
    this.inputSink = sink;
  }

  async pause(reason: 'player' | 'background' | 'interruption' = 'background'): Promise<boolean> {
    const coordinator = this.coordinator;
    if (!coordinator) return false;
    this.paused = true;
    // Calling coordinator.pause closes its action gate synchronously before
    // either the native surface visibility ACK or the pause ACK can race a tap.
    const pause = coordinator.pause(reason);
    const hidden = await this.setVisible(false);
    const accepted = await pause;
    return hidden && accepted;
  }

  async resume(reason: 'player' | 'foreground' | 'recreated' = 'foreground'): Promise<boolean> {
    const coordinator = this.coordinator;
    if (!coordinator || !(await coordinator.resume(reason))) return false;
    // Foregrounding resumes the runtime/protocol only. The flow deliberately
    // keeps its PausePanel until the player explicitly resumes; revealing the
    // native overlay here would cover that authority with dead-ball controls.
    if (reason === 'foreground') return true;
    this.paused = false;
    if (!this.active && !this.replayWaiter && !this.demonstrationWaiter && !this.retainingFinalPose) return true;
    if (!(await this.setVisible(true))) return false;
    this.setCanvasGameplayInput(this.inputIsActive());
    if (!this.canvasBacked && this.retainingFinalPose && this.deadBallUi && !this.deadBallActionConsumed) {
      await coordinator.sendDeadBallUi(this.deadBallUi.deliveryId, this.deadBallUi.payload);
    }
    return true;
  }

  snapshot(): UnityPracticeStageSnapshot {
    return {
      mounted: this.mounted,
      disposed: this.disposed,
      visible: this.visible,
      retainingFinalPose: this.retainingFinalPose,
      inputActive: this.inputIsActive(),
      quiet: this.quietValue,
      ownsInput: true,
      inputSinkBound: this.inputSink !== null,
      activeDeliveryId: this.active?.id ?? null,
      coordinatorStatus: this.coordinator?.snapshot().status ?? null,
      diagnostics: this.diagnosticHistory.map((diagnostic) => ({ ...diagnostic })),
    };
  }

  dispose(): void {
    if (this.disposeTask) return;
    this.disposed = true;
    this.inputSink = null;
    this.clearDeadBallUi();
    this.clearProtectedRegions();
    this.active?.release.reject(new Error('Unity Practice disposed.'));
    this.active?.dead.reject(new Error('Unity Practice disposed.'));
    this.replayWaiter?.done.reject(new Error('Unity Practice disposed.'));
    this.demonstrationWaiter?.done.reject(new Error('Unity Practice disposed.'));
    this.disposeTask = this.disposeAsync();
  }

  async whenDisposed(): Promise<void> {
    await this.disposeTask;
  }

  private queueScene(scene: StageScene): void {
    const before = this.sceneTask;
    this.sceneTask = before.then(
      () => this.sendScene(scene),
      () => this.sendScene(scene),
    );
  }

  private async sendScene(scene: StageScene): Promise<boolean> {
    const coordinator = this.coordinator;
    if (!coordinator || this.disposed) return false;
    if (!scene.fieldIntent || !scene.trainingObjective) {
      this.note('scene_failed', 'Unity scene lacked the authoritative field intent or training objective.');
      return false;
    }
    const accepted = await coordinator.setScene({
      conditions: scene.conditions,
      field: scene.field,
      fieldIntent: scene.fieldIntent,
      trainingObjective: scene.trainingObjective,
      bowler: scene.bowler,
      ball: scene.ball ?? DEFAULT_BALL,
      handedness: scene.handedness,
      batterPosition: { lateralM: 0, creaseOffsetM: 0, guard: 'middle' },
      // Bridge contract v7: the Target Chase situation, only while a chase is on (the key is omitted, never undefined).
      ...(scene.chase === undefined ? {} : { chase: scene.chase }),
    });
    if (!accepted) this.note('scene_failed', 'Unity did not acknowledge the authoritative scene.');
    return accepted;
  }

  private onCoordinatorEvent(event: UnityPracticeCoordinatorEvent): void {
    switch (event.type) {
      case 'ready':
        this.renderer = `Unity ${event.renderer}`;
        return;
      case 'release': {
        const active = this.active;
        if (!active || event.deliveryId !== active.id) return;
        active.releasePerfMs = event.releasePerfMs;
        this.releasePerf = event.releasePerfMs;
        active.release.resolve(event.releasePerfMs);
        return;
      }
      case 'pointer':
        if (!this.active || event.deliveryId !== this.active.id || !this.inputIsActive()) return;
        if (event.phase === 'down') this.inputSink?.onSwingStart(event.atPerfMs, event.pointer);
        else this.inputSink?.onGestureCancel();
        return;
      case 'gesture': {
        const active = this.active;
        if (!active || active.id !== event.deliveryId) return;
        // A provisional swing promises Unity the ball's swing: the contract (and Unity) refuse a result whose record
        // carries any other, which fails the whole runtime closed. Only the flow knows whether a swing counts (one that
        // began after the leave deadline is a leave), so it answers first and a swing it did not take is never promised.
        const taken = this.inputSink?.onSwing(event.swing);
        if (event.swing && taken !== false) {
          void this.coordinator?.sendProvisionalSwing(event.deliveryId, {
            atPerfMs: this.simToPerf(event.swing.startT),
            calibrationMs: 0,
            swing: event.swing,
          });
        }
        return;
      }
      case 'protected_regions':
        this.acceptProtectedRegions(event.deliveryId, event.payload);
        return;
      case 'dead':
        void this.finishDelivery(event.deliveryId);
        return;
      case 'replay_complete':
        void this.finishReplay(event.deliveryId);
        return;
      case 'demonstration_complete':
        void this.finishDemonstration(event.deliveryId);
        return;
      case 'demonstration_cancelled':
        this.finishDemonstrationCancellation(event.deliveryId);
        return;
      case 'dead_ball_action': {
        const shown = this.deadBallUi;
        if (
          this.paused ||
          this.deadBallActionConsumed ||
          !this.retainingFinalPose ||
          !shown ||
          shown.deliveryId !== event.deliveryId ||
          shown.payload.replayDigest !== event.replayDigest ||
          this.last?.deliveryId !== event.deliveryId
        )
          return;
        this.deadBallActionConsumed = true;
        this.inputSink?.onDeadBallAction?.(event.action);
        return;
      }
      case 'stats':
        this.latestStats = event.stats;
        return;
      case 'pause_requested':
        if (
          this.inputIsActive() ||
          (!this.paused &&
            this.retainingFinalPose &&
            this.replayWaiter === null &&
            this.coordinator?.snapshot().status === 'dead_ball')
        )
          this.inputSink?.onPauseRequest?.();
        return;
      case 'quiet':
        this.setQuiet(event.quiet);
        return;
      case 'fallback':
        this.note('coordinator_fallback', event.reason, event.inFlightDeliveryId);
        this.rejectPending(`Unity Practice fell back: ${event.reason}`);
        this.emitFallback(event.reason);
        void this.setVisible(false);
        return;
      case 'unload_deferred':
        this.note(
          'dispose_deferred',
          'Unity unload was deferred at an unsafe delivery boundary.',
          event.inFlightDeliveryId,
        );
        return;
      case 'runtime_error':
        this.rejectPending(`Unity Practice runtime error: ${event.error.detail}`);
        this.emitFallback('Unity runtime error');
        return;
      default:
        return;
    }
  }

  private async finishDelivery(deliveryId: string): Promise<void> {
    const active = this.active;
    if (!active || active.id !== deliveryId || active.dead.settled()) return;
    if (!(await this.settleDeadBallPresentation())) {
      active.dead.reject(new Error('Unity Practice could not settle its dead-ball presentation.'));
      await this.fail('visibility_failed', 'Unity could not settle after dead ball.');
      return;
    }
    if (active.resolution) this.last = { deliveryId, resolution: active.resolution };
    this.active = null;
    this.setQuiet(false);
    active.dead.resolve(undefined);
    await this.applyPendingProfile();
  }

  private async finishReplay(deliveryId: string): Promise<void> {
    const waiter = this.replayWaiter;
    if (!waiter || waiter.deliveryId !== deliveryId || waiter.done.settled()) return;
    if (!(await this.settleDeadBallPresentation())) {
      waiter.done.reject(new Error('Unity Practice could not settle its replay presentation.'));
      await this.fail('visibility_failed', 'Unity could not settle after replay.');
      return;
    }
    this.replayWaiter = null;
    this.setQuiet(false);
    waiter.done.resolve(undefined);
    if (!this.canvasBacked && this.deadBallUi && !this.deadBallActionConsumed) {
      await this.coordinator?.sendDeadBallUi(this.deadBallUi.deliveryId, this.deadBallUi.payload);
    }
    await this.applyPendingProfile();
  }

  private async finishDemonstration(deliveryId: string): Promise<void> {
    const waiter = this.demonstrationWaiter;
    if (!waiter || waiter.deliveryId !== deliveryId || waiter.done.settled()) return;
    if (!(await this.settleDeadBallPresentation())) {
      waiter.done.reject(new Error('Unity Practice could not settle its demonstration presentation.'));
      this.cleanupDemonstrationWaiter(waiter);
      await this.fail('visibility_failed', 'Unity could not settle after demonstration.');
      return;
    }
    this.cleanupDemonstrationWaiter(waiter);
    this.setQuiet(false);
    waiter.done.resolve(undefined);
    if (!this.canvasBacked && this.deadBallUi && !this.deadBallActionConsumed) {
      await this.coordinator?.sendDeadBallUi(this.deadBallUi.deliveryId, this.deadBallUi.payload);
    }
    await this.applyPendingProfile();
  }

  private finishDemonstrationCancellation(deliveryId: string): void {
    const waiter = this.demonstrationWaiter;
    if (!waiter || waiter.deliveryId !== deliveryId || waiter.done.settled()) return;
    this.cleanupDemonstrationWaiter(waiter);
    // A first-run demonstration has no retained real ball. A dead-ball Coach
    // demonstration keeps the real delivery identity and may immediately
    // restore its UI over the reset Unity world.
    this.retainingFinalPose = this.last !== null;
    this.setCanvasGameplayInput(false);
    this.setQuiet(false);
    waiter.done.reject(demonstrationAbortError());
    if (!this.canvasBacked && this.deadBallUi && !this.deadBallActionConsumed) {
      void this.coordinator?.sendDeadBallUi(this.deadBallUi.deliveryId, this.deadBallUi.payload);
    }
  }

  private cleanupDemonstrationWaiter(waiter: DemonstrationWaiter): void {
    if (waiter.signal && waiter.onAbort) waiter.signal.removeEventListener('abort', waiter.onAbort);
    if (this.demonstrationWaiter === waiter) this.demonstrationWaiter = null;
  }

  private async applyProfile(profile: QualityProfileId): Promise<void> {
    const coordinator = this.coordinator;
    if (!coordinator || this.disposed || profile === this.profile) return;
    if (await coordinator.setProfile(profile)) this.profile = profile;
  }

  private async applyPendingProfile(): Promise<void> {
    const profile = this.pendingProfile;
    this.pendingProfile = null;
    if (profile) await this.applyProfile(profile);
  }

  private refreshCalibrations(): void {
    for (const key of Object.keys(this.calibrationOffsets) as Array<GestureInput['pointer']>)
      delete this.calibrationOffsets[key];
    Object.assign(this.calibrationOffsets, this.options.calibrations?.() ?? {});
  }

  private async setVisible(visible: boolean): Promise<boolean> {
    const applied = await this.options.bridge.setVisible(visible).catch(() => false);
    if (applied) {
      this.visible = visible;
      if (!visible) this.setCanvasGameplayInput(false);
    }
    return applied;
  }

  private async setReadyVisible(visible: boolean): Promise<boolean> {
    const applied = await (
      this.options.bridge.setReadyVisible?.(visible, this.readyHint) ?? this.options.bridge.setVisible(visible)
    ).catch(() => false);
    if (applied) {
      this.visible = visible;
      this.setCanvasGameplayInput(false);
    }
    return applied;
  }

  /** Keep the authoritative final Unity pose on both platforms; all gameplay input is inert. */
  private async settleDeadBallPresentation(): Promise<boolean> {
    this.setCanvasGameplayInput(false);
    this.retainingFinalPose = true;
    // A background/interruption may have hidden the surface before the
    // authoritative result reached dead ball. Resume reveals the retained
    // frame; hidden is not a failure in that lifecycle race.
    if (this.paused) return true;
    return this.visible || this.setVisible(true);
  }

  private clearDeadBallUi(): void {
    this.deadBallUi = null;
    this.deadBallActionConsumed = false;
  }

  private acceptProtectedRegions(
    deliveryId: string,
    payload: UnityPracticePayloadByType['unity.protected_regions'],
  ): void {
    if (!this.active || this.active.id !== deliveryId || this.replayWaiter || this.disposed) return;
    const scope = this.canvasViewportScope();
    if (!scope) {
      this.clearProtectedRegions();
      return;
    }
    this.protectedRegionSnapshot = {
      deliveryId,
      payload: {
        regions: payload.regions.map((region) => ({ ...region })),
        viewportHeight: payload.viewportHeight,
        viewportWidth: payload.viewportWidth,
      },
      scope,
    };
  }

  private canvasViewportScope(): CanvasViewportScope | null {
    const canvas = this.canvas;
    if (!canvas?.isConnected) return null;
    const rect = canvas.getBoundingClientRect();
    const clientWidth = canvas.clientWidth;
    const clientHeight = canvas.clientHeight;
    if (
      !Number.isFinite(rect.width) ||
      rect.width <= 0 ||
      !Number.isFinite(rect.height) ||
      rect.height <= 0 ||
      !Number.isFinite(clientWidth) ||
      clientWidth <= 0 ||
      !Number.isFinite(clientHeight) ||
      clientHeight <= 0
    )
      return null;
    return { clientHeight, clientWidth, cssHeight: rect.height, cssWidth: rect.width };
  }

  private clearProtectedRegions(): void {
    this.protectedRegionSnapshot = null;
  }

  private inputIsActive(): boolean {
    return !this.paused && this.visible && this.active !== null && this.coordinator?.snapshot().status === 'delivery';
  }

  private setCanvasGameplayInput(enabled: boolean): void {
    if (!this.canvasBacked || !this.canvas) return;
    this.canvas.style.pointerEvents = enabled ? 'auto' : 'none';
    this.canvas.dataset.gameplayInput = enabled ? 'active' : 'blocked';
  }

  private setQuiet(quiet: boolean): void {
    if (this.quietValue === quiet) return;
    this.quietValue = quiet;
    this.emit('quiet', { quiet });
  }

  private async bounded<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timers = this.options.timers ?? {
      set: (callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs),
      clear: (handle: unknown) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
    return new Promise<T>((resolve, reject) => {
      const handle = timers.set(() => reject(new Error('Unity Practice operation timed out.')), timeoutMs);
      promise.then(
        (value) => {
          timers.clear(handle);
          resolve(value);
        },
        (error: unknown) => {
          timers.clear(handle);
          reject(error);
        },
      );
    });
  }

  private requireCoordinator(): UnityPracticeSessionCoordinator {
    if (!this.coordinator || !this.mounted || this.disposed) throw new Error('Unity Practice stage is not mounted.');
    return this.coordinator;
  }

  private note(
    code: UnityPracticeStageDiagnosticCode,
    detail: string,
    inFlightDeliveryId = this.active?.id ?? null,
  ): void {
    this.diagnosticHistory.push({ code, detail, inFlightDeliveryId });
    if (this.diagnosticHistory.length > 32) this.diagnosticHistory.shift();
  }

  private emit<E extends StageEvent>(event: E, payload: StageEventPayloads[E]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch {
        // A React listener cannot corrupt native lifecycle state.
      }
    }
  }

  private emitFallback(message: string): void {
    if (this.fallbackEmitted) return;
    this.fallbackEmitted = true;
    this.emit('fallback', { reason: 'error', message });
  }

  private fail(code: UnityPracticeStageDiagnosticCode, detail: string): Promise<void> {
    if (this.fallbackTask) return this.fallbackTask;
    this.note(code, detail);
    this.rejectPending(detail);
    this.emitFallback(detail);
    this.fallbackTask = (async () => {
      await this.setVisible(false);
      await this.coordinator?.forceDispose('fallback');
    })();
    return this.fallbackTask;
  }

  private rejectPending(detail: string): void {
    const error = new Error(detail);
    this.active?.release.reject(error);
    this.active?.dead.reject(error);
    this.replayWaiter?.done.reject(error);
    this.demonstrationWaiter?.done.reject(error);
    this.active = null;
    this.replayWaiter = null;
    if (this.demonstrationWaiter) this.cleanupDemonstrationWaiter(this.demonstrationWaiter);
    this.retainingFinalPose = false;
    this.clearDeadBallUi();
    this.clearProtectedRegions();
    this.setCanvasGameplayInput(false);
    this.setQuiet(false);
  }

  private async disposeAsync(): Promise<void> {
    this.retainingFinalPose = false;
    await this.setVisible(false);
    const coordinator = this.coordinator;
    if (coordinator) {
      const demoWaiter = this.demonstrationWaiter;
      const demoId = demoWaiter?.deliveryId;
      if (demoId) await coordinator.cancelDemonstration(demoId).catch(() => false);
      if (demoWaiter) this.cleanupDemonstrationWaiter(demoWaiter);
      const clean = await coordinator.dispose('cancelled');
      if (!clean) await coordinator.forceDispose('cancelled');
    }
    this.visible = false;
    this.mounted = false;
    this.canvas = null;
  }
}
