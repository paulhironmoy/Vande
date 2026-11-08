/**
 * Capability boundary for the first Unity slice.
 *
 * Unity contract v6 can present authoritative Learn cues, per-ball Coach
 * assistance and demonstrations in the live Practice world. The training ball
 * close-up remains on the retained Three.js/Classic stage. This facade routes
 * only that unsupported operation; it never emulates Coach presentation and
 * never changes delivery authority.
 */
import type {
  AssistanceStage,
  BallFlight,
  CoachOption,
  DeliveryResult,
  QualityProfileId,
  UnityPracticeResolution,
} from '@/contracts';
import type { BenchmarkRun } from '@/perf';
import type { OneGestureState } from '@/input';
import type {
  PracticeStageLike,
  StageDeliveryContext,
  StageDemonstrationContext,
  StageDeadBallUi,
  StageEvent,
  StageEventPayloads,
  StageGuide,
  StageInputSink,
  StageMountOptions,
  StageRegion,
  StageScene,
  StageStats,
} from '@/practice/ui/flow/types';

/**
 * Cancellation boundary for a Coach-only renderer handoff. A retained renderer
 * can take materially longer to construct than the player's one-tap Skip
 * action. The router must not pause Unity after cancellation has won that race.
 */
export interface RetainedCoachRouteControl {
  cancelled(): boolean;
  /** Atomically claims the point after which restoration must await the handoff. */
  tryBeginSourcePause(): boolean;
}

export type RetainedCoachStageRouter = (
  source: PracticeStageLike,
  control: RetainedCoachRouteControl,
) => Promise<PracticeStageLike | null>;
export type RetainedCoachStageRestorer = (
  source: PracticeStageLike,
  retained: PracticeStageLike,
) => Promise<boolean>;

export interface CoachSafeUnityStage extends PracticeStageLike {
  readonly isCoachSafeUnityFacade: true;
  /** Starts the idempotent retained handoff used by the close-up call. */
  prepareCoachRenderer(): Promise<boolean>;
  /** Returns healthy live/replay presentation to Unity after Coach presentation. */
  restoreUnityRenderer(): Promise<boolean>;
}

export function isCoachSafeUnityStage(value: PracticeStageLike | null): value is CoachSafeUnityStage {
  return Boolean(value && (value as Partial<CoachSafeUnityStage>).isCoachSafeUnityFacade === true);
}

export function createCoachSafeUnityStage(
  source: PracticeStageLike,
  route: RetainedCoachStageRouter,
  restore: RetainedCoachStageRestorer,
): CoachSafeUnityStage {
  if (source.ownsInput !== true) throw new Error('Coach-safe Unity routing requires a native-input stage.');
  return new RoutedCoachStage(source, route, restore);
}

class RoutedCoachStage implements CoachSafeUnityStage {
  readonly isCoachSafeUnityFacade = true as const;

  private retained: PracticeStageLike | null = null;
  private handoff: Promise<PracticeStageLike | null> | null = null;
  private handoffControl: { cancelled: boolean; sourcePauseStarted: boolean } | null = null;
  private restoring: Promise<boolean> | null = null;
  private scene: StageScene | null = null;
  private assistance: { stage: AssistanceStage; guide: StageGuide | null } | null = null;
  private learnCue = false;
  private disposed = false;
  private liveOnRetained = false;

  constructor(
    private readonly source: PracticeStageLike,
    private readonly route: RetainedCoachStageRouter,
    private readonly restore: RetainedCoachStageRestorer,
  ) {}

  get kind(): PracticeStageLike['kind'] {
    return this.retained?.kind ?? this.source.kind;
  }

  get ownsInput(): boolean | undefined {
    if (this.retained) return this.retained.ownsInput === true;
    if (this.liveOnRetained) return false;
    return this.source.ownsInput;
  }

  mount(canvas: HTMLCanvasElement, opts: StageMountOptions): Promise<void> {
    return this.active().mount(canvas, opts);
  }

  setScene(scene: StageScene): void {
    this.scene = scene;
    this.active().setScene(scene);
  }

  async presentReady(visible: boolean): Promise<boolean> {
    if (visible && !(await this.restoreUnityRenderer())) return false;
    return this.source.presentReady?.(visible) ?? true;
  }

  setLanguage(locale: string, readyHint: string): void {
    this.source.setLanguage?.(locale, readyHint);
    this.retained?.setLanguage?.(locale, readyHint);
  }

  presentDeadBallUi(ui: StageDeadBallUi): Promise<boolean> {
    // The retained Coach renderer never owns the live innings result surface.
    return this.source.presentDeadBallUi?.(ui) ?? Promise.resolve(false);
  }

  benchmark(ms: number): Promise<BenchmarkRun> {
    return this.active().benchmark(ms);
  }

  async bowl(flight: BallFlight, context?: StageDeliveryContext): Promise<{ releasePerfMs: number }> {
    if (!(await this.restoreUnityRenderer())) throw new Error('Unity Practice renderer restore failed.');
    return this.source.bowl(flight, context);
  }

  prepareSwing(atPerfMs: number, calibrationMs?: number): void {
    this.active().prepareSwing?.(atPerfMs, calibrationMs);
  }

  cancelSwing(): void {
    this.active().cancelSwing?.();
  }

  previewContact(state: OneGestureState): void {
    this.active().previewContact?.(state);
  }

  beginSwing(atPerfMs: number, calibrationMs?: number): void {
    this.active().beginSwing(atPerfMs, calibrationMs);
  }

  play(result: DeliveryResult): Promise<void> {
    return this.active().play(result);
  }

  async replay(result: DeliveryResult, opts?: { speed?: number; diagnostics?: boolean }): Promise<void> {
    await this.restoreUnityRenderer();
    return this.active().replay(result, opts);
  }

  setProfile(profile: QualityProfileId): void {
    this.active().setProfile(profile);
  }

  stats(): StageStats {
    return this.active().stats();
  }

  on<E extends StageEvent>(event: E, callback: (payload: StageEventPayloads[E]) => void): () => void {
    return this.active().on(event, callback);
  }

  setLearnCue(on: boolean): void {
    this.learnCue = on;
    this.source.setLearnCue(on);
    if (this.retained) this.retained.setLearnCue(on);
  }

  setReducedMotion(on: boolean): void {
    this.active().setReducedMotion(on);
  }

  setAssistance(stage: AssistanceStage | null, guide: StageGuide | null = null): void {
    if (stage === null) {
      this.assistance = null;
      this.source.setAssistance(null, null);
      if (this.retained) {
        try {
          this.retained.setAssistance(null, null);
        } catch {
          /* a simultaneous healthy restore may already have disposed it */
        }
      }
      return;
    }
    this.assistance = { stage, guide };
    this.source.setAssistance(stage, guide);
    if (this.retained) this.retained.setAssistance(stage, guide);
  }

  async demonstrate(
    result: DeliveryResult,
    option: CoachOption,
    context?: StageDemonstrationContext,
  ): Promise<void> {
    // Demonstrations are part of the live Unity Practice presentation. Keeping
    // them on the source preserves the same world, camera, characters, HUD and
    // canvas; only the ball and the recommended response change. The retained
    // surface remains available solely for the still-unsupported ball close-up.
    if (!(await this.restoreUnityRenderer())) {
      throw new Error('Unity Practice renderer restore failed.');
    }
    await this.source.demonstrate(result, option, context);
  }

  async closeUp(flight: BallFlight, options: { durationMs?: number } = {}): Promise<void> {
    const retained = await this.ensureRetained();
    if (retained) await retained.closeUp(flight, options);
  }

  quiet(): boolean {
    return this.active().quiet();
  }

  protectedRegions(): StageRegion[] {
    return this.active().protectedRegions();
  }

  setFocusAid(on: boolean): void {
    this.active().setFocusAid(on);
  }

  setTimeScale(scale: number): void {
    this.active().setTimeScale(scale);
  }

  simToPerf(t: number): number {
    return this.active().simToPerf(t);
  }

  setInputSink(sink: StageInputSink | null): void {
    // Unity is the only input-owning surface. A retained Coach attempt uses
    // the React gesture surface and must not inherit native input callbacks.
    this.source.setInputSink?.(sink);
  }

  supplyResolution(resolution: UnityPracticeResolution): void {
    this.active().supplyResolution?.(resolution);
  }

  pause(reason?: 'player' | 'background' | 'interruption'): Promise<boolean> {
    return this.active().pause?.(reason) ?? Promise.resolve(true);
  }

  resume(reason?: 'player' | 'foreground' | 'recreated'): Promise<boolean> {
    return this.active().resume?.(reason) ?? Promise.resolve(true);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.retained && this.retained !== this.source) this.retained.dispose();
    this.source.dispose();
  }

  async prepareCoachRenderer(): Promise<boolean> {
    return Boolean(await this.ensureRetained());
  }

  restoreUnityRenderer(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.restoring) return this.restoring;
    if (!this.retained && !this.handoff) return Promise.resolve(true);
    // Publish the complete restore operation before it can await an in-flight
    // handoff. Both the phase watcher and the delivery runner may request the
    // same restore while Skip is resolving; without this outer single-flight
    // boundary they can each resume Unity and queue competing scene updates.
    const published = Promise.resolve().then(() => this.restoreUnityRendererOnce()).finally(() => {
      if (this.restoring === published) this.restoring = null;
    });
    this.restoring = published;
    return published;
  }

  private async restoreUnityRendererOnce(): Promise<boolean> {
    // Skip may arrive while the retained stage is still importing or mounting.
    // If Unity has not begun pausing, cancel the handoff and keep the already
    // healthy source live; the abandoned candidate cleans itself up when its
    // current await completes. Once pausing starts, restoration must wait and
    // resume through the normal fail-closed path.
    let sourcePauseStarted = false;
    if (!this.retained && this.handoff && this.handoffControl) {
      this.handoffControl.cancelled = true;
      sourcePauseStarted = this.handoffControl.sourcePauseStarted;
      if (!sourcePauseStarted) return true;
    }
    const retained = this.retained ?? (this.handoff ? await this.handoff : null);
    // A pre-pause cancellation leaves the source healthy and returns above.
    // Once pause was claimed, however, a null handoff means pause/route failed
    // and the source may already have been disposed by the host. Never report
    // that as a successful restore and then bowl on the dead Unity instance.
    if (!retained) return !sourcePauseStarted;
    try {
      const restored = await this.restore(this.source, retained);
      if (!restored || this.disposed) {
        this.liveOnRetained = Boolean(this.retained);
        return false;
      }
      this.liveOnRetained = false;
      this.retained = null;
      this.handoff = null;
      if (this.scene) this.source.setScene(this.scene);
      this.source.setLearnCue(this.learnCue);
      this.source.setAssistance(this.assistance?.stage ?? null, this.assistance?.guide ?? null);
      return true;
    } catch {
      return false;
    }
  }

  private active(): PracticeStageLike {
    return this.retained ?? this.source;
  }

  private ensureRetained(): Promise<PracticeStageLike | null> {
    if (this.disposed) return Promise.resolve(null);
    if (this.retained) return Promise.resolve(this.retained);
    if (this.handoff) return this.handoff;
    // Defer the router by one microtask so `handoff` is assigned before the
    // host publishes stageReady=false. That publication can synchronously
    // notify the Coach-state watcher and ask for this same transition again.
    const control = { cancelled: false, sourcePauseStarted: false };
    this.handoffControl = control;
    this.handoff = Promise.resolve()
      .then(() => this.route(this.source, {
        cancelled: () => control.cancelled,
        tryBeginSourcePause: () => {
          if (control.cancelled) return false;
          control.sourcePauseStarted = true;
          return true;
        },
      }))
      .then((retained) => {
        if (!retained || (control.cancelled && !control.sourcePauseStarted) || this.disposed) {
          if (retained && retained !== this.source) retained.dispose();
          return null;
        }
        this.retained = retained;
        if (this.scene) retained.setScene(this.scene);
        retained.setLearnCue(this.learnCue);
        retained.setAssistance(this.assistance?.stage ?? null, this.assistance?.guide ?? null);
        return retained;
      })
      .catch(() => null)
      .finally(() => {
        if (this.handoffControl === control) this.handoffControl = null;
        if (!this.retained) this.handoff = null;
      });
    return this.handoff;
  }
}
