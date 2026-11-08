/**
 * The stage's life: one stage per visit (first-person 3D when the device check allows it, Classic 2D otherwise), the
 * discreet device check (once per app version, run while the setup screen is open), and quality changes, which are
 * applied only between balls (a step down from the session monitor, a settings change, or a renderer fallback).
 * The player sees product words only: a notice when the presentation's name changes (Premium → Balanced → Classic).
 * While Camera is the control in force the stage is a web renderer, never Unity (R-43, see `needsWeb`).
 */
import type { AssistLevel, DeviceAssessment, Handedness, QualityProfileId } from '@/contracts';
import {
  SessionMonitor,
  createFrameSampler,
  effectiveQuality,
  loadCachedAssessment,
  runDeviceBenchmark,
  saveCachedAssessment,
  tierChanged,
  tierForQuality,
  toleranceFor,
  type FrameSampler,
} from '@/perf';
import { addTier, bump, fpsBucket } from '@/practice/store';
import {
  activateUnityPracticeEngineeringPreviewMarker,
  canRetainUnityPracticeEngineeringPreview,
  unityPracticeEngineeringPreviewEnabled,
  type UnityPracticeEngineeringPreviewReason,
} from '@/practice/unity/engineeringPreview';
import {
  createCoachSafeUnityStage,
  isCoachSafeUnityStage,
  type RetainedCoachRouteControl,
} from '@/practice/unity/coachSafeStage';
import type { FlowCore } from './core';
import type { FlowNotice, QualityState } from './state';
import type { PracticeStageLike, StageInputSink } from './types';

const PRACTICE_RENDERER_EVIDENCE_ATTRIBUTE = 'data-vande-practice-renderer';
type PracticeRendererEvidence = 'unity-native' | 'unity-webgl' | 'three-webgl' | 'classic';

/** Never let one renderer's cached measurements select or profile another renderer. */
export function assessmentForRenderer(
  cached: DeviceAssessment | null,
  renderer: 'webgl2' | 'unity',
): DeviceAssessment | null {
  if (!cached) return null;
  if (renderer === 'unity') return nativeAssessmentEligible(cached) ? cached : null;
  return cached.backend === 'unity' ? null : cached;
}

/** Native is opt-in only after its own benchmark proves both playability and input responsiveness. */
export function nativeAssessmentEligible(assessment: DeviceAssessment): boolean {
  return (
    assessment.backend === 'unity' &&
    assessment.tier !== 'below' &&
    assessment.inputToFrameMs !== null &&
    Number.isFinite(assessment.inputToFrameMs)
  );
}

export class StageHost {
  stage: PracticeStageLike | null = null;
  private off: Array<() => void> = [];
  /** Stable live surface. An active Unity runtime is permanently bound to this node. */
  private canvas: HTMLCanvasElement | null = null;
  /** Separate retained-renderer surface for the training close-up only. */
  private coachCanvas: HTMLCanvasElement | null = null;
  private used = new WeakSet<HTMLCanvasElement>();
  private waiters: Record<'live' | 'coach', Array<(c: HTMLCanvasElement) => void>> = {
    live: [],
    coach: [],
  };
  private preparing: Promise<PracticeStageLike | null> | null = null;
  /** Bumped only when the flow goes away: a preparation from an earlier epoch stops and keeps nothing. */
  private epoch = 0;
  /** "Choose again for this device": the check runs again when the stage is next prepared (never during an over). */
  private recheck = false;
  monitor: SessionMonitor | null = null;
  readonly sampler: FrameSampler;
  private pending: { q: QualityState; why: 'monitor' | 'settings' | 'fallback' | 'camera' } | null = null;
  private fallbackRequested: string | null = null;
  private tierReported = false;
  /** Listeners for the stage's own quiet signal (a guard: the flow's phases already follow bowl and play). */
  onQuiet: ((quiet: boolean) => void) | null = null;
  private inputSink: StageInputSink | null = null;
  /** Latest app language, replayed onto candidates that were already being created or mounted when it changed. */
  private language: { locale: string; readyHint: string } | null = null;
  private clearEngineeringPreviewMarker: (() => void) | null = null;
  private stopCoachStateWatch: (() => void) | null = null;
  /** Unity listeners retained while a Coach-only web surface owns presentation. */
  private coachSourceOff: Array<() => void> | null = null;
  private preCoachQuality: QualityState | null = null;
  private preCoachNotice: FlowNotice = null;
  /** Native low-memory admission is a route, not a fabricated performance assessment. */
  private forcedClassicReason: 'low_memory_device' | null = null;
  /** R-43: set the first time Camera is the control in force; every stage built after that is a web renderer. */
  private webOnly = false;

  private markRenderer(stage: PracticeStageLike | null): void {
    if (typeof document === 'undefined') return;
    if (!stage) {
      document.documentElement.removeAttribute(PRACTICE_RENDERER_EVIDENCE_ATTRIBUTE);
      return;
    }
    const renderer: PracticeRendererEvidence =
      stage.ownsInput === true
        ? __UNITY_PRACTICE_WEB_ENABLED__
          ? 'unity-webgl'
          : 'unity-native'
        : stage.kind === '2d'
          ? 'classic'
          : 'three-webgl';
    document.documentElement.setAttribute(PRACTICE_RENDERER_EVIDENCE_ATTRIBUTE, renderer);
  }

  constructor(private readonly core: FlowCore) {
    this.sampler = (core.deps.frameSampler ?? createFrameSampler)((ms) => this.monitor?.sample(ms));
    this.stopCoachStateWatch = core.subscribe(() => this.prepareCoachSurfaceForState());
  }

  /** The cached device check (or the test hooks' fixed one). */
  initialAssessment(): DeviceAssessment | null {
    const hooked = this.core.deps.hooks?.assessment;
    if (hooked) return hooked;
    const cached = loadCachedAssessment(this.core.deps.appVersion, this.core.store);
    // The optional native path must only be selected from measurements made by that renderer. A WebGL assessment
    // from the same app version is useful to its own path, but is not evidence about Unity.
    return assessmentForRenderer(cached, __UNITY_PRACTICE_ENABLED__ ? 'unity' : 'webgl2');
  }

  qualityFor(a: DeviceAssessment | null): QualityState {
    if (this.forcedClassicReason) return { stage: '2d', profile: 'lite', tier: 'full', toleranceMs: 0 };
    const choice = this.core.settings.quality;
    if (choice === 'classic')
      return { stage: '2d', profile: 'lite', tier: a?.tier ?? 'full', toleranceMs: toleranceFor(a?.tier ?? 'full') };
    if (!a) return { stage: '3d', profile: 'standard', tier: 'full', toleranceMs: 0 };
    const eff = effectiveQuality(a, choice);
    return { stage: eff.stage, profile: eff.profile, tier: a.tier, toleranceMs: toleranceFor(a.tier) };
  }

  attachCanvas = (el: HTMLCanvasElement | null): void => {
    this.canvas = el;
    if (el && !this.used.has(el)) {
      const w = this.waiters.live.shift();
      if (w) {
        this.used.add(el);
        w(el);
      }
    }
  };

  attachCoachCanvas = (el: HTMLCanvasElement | null): void => {
    this.coachCanvas = el;
    if (el && !this.used.has(el)) {
      const w = this.waiters.coach.shift();
      if (w) {
        this.used.add(el);
        w(el);
      }
    }
  };

  private freshCanvas(surface: 'live' | 'coach' = 'live'): Promise<HTMLCanvasElement> {
    const c = surface === 'live' ? this.canvas : this.coachCanvas;
    if (c && !this.used.has(c)) {
      this.used.add(c);
      return Promise.resolve(c);
    }
    return new Promise((resolve) => {
      this.waiters[surface].push(resolve);
      const state = this.core.getState();
      if (surface === 'live') this.core.set({ canvasKey: state.canvasKey + 1 });
      else this.core.set({ coachCanvasKey: state.coachCanvasKey + 1 });
    });
  }

  private showCoachCanvas(visible: boolean): void {
    const canvas = this.coachCanvas;
    if (!canvas) return;
    canvas.style.opacity = visible ? '1' : '0';
    canvas.style.pointerEvents = 'none';
    if (visible) canvas.removeAttribute('aria-hidden');
    else canvas.setAttribute('aria-hidden', 'true');
  }

  private async create(
    force2d: boolean,
    assist: AssistLevel,
    handedness: Handedness,
    profile: QualityProfileId,
    deviceTier: QualityState['tier'],
    epoch: number,
    skipUnity = false,
    surface: 'live' | 'coach' = 'live',
  ): Promise<PracticeStageLike> {
    // With Camera in force (now, or earlier in this visit) the factory is never asked for Unity.
    const skip = skipUnity || this.needsWeb();
    const candidate = await this.core.deps.createStage({ force2d, assistance: assist, deviceTier, skipUnity: skip });
    if (epoch !== this.epoch) {
      if (candidate.kind !== 'route') candidate.dispose();
      throw new Error('flow disposed');
    }
    if (candidate.kind === 'route') {
      if (force2d || surface !== 'live' || candidate.target !== 'classic') {
        throw new Error('invalid renderer route');
      }
      this.forcedClassicReason = candidate.reason;
      return this.create(true, assist, handedness, 'lite', 'full', epoch, true, surface);
    }
    const stage = candidate;
    this.applyLanguage(stage);
    const canvas = await this.freshCanvas(surface);
    if (epoch !== this.epoch) {
      stage.dispose();
      throw new Error('flow disposed');
    }
    if (!force2d && stage.kind !== '3d') {
      // No WebGL 2: the factory chose the 2D stage itself. Treat it as the 3D stage failing.
      stage.dispose();
      throw new Error('no first-person stage');
    }
    stage.setInputSink?.(this.inputSink);
    let fellBack = false;
    const off = stage.on('fallback', (payload) => {
      fellBack = true;
      this.fallbackRequested = payload?.reason ?? 'error';
    });
    const learnCue = assist === 'learn' && this.core.settings.learnCue;
    try {
      await stage.mount(canvas, {
        profile,
        handedness,
        reducedMotion: this.core.deps.reducedMotion?.() ?? false,
        learnCue,
      });
    } catch (e) {
      off();
      stage.dispose();
      throw e;
    }
    this.applyLanguage(stage);
    if ((fellBack && !force2d) || epoch !== this.epoch) {
      off();
      stage.dispose();
      throw new Error(fellBack ? 'fallback during mount' : 'flow disposed');
    }
    stage.setTimeScale(this.core.clock.scale);
    this.off = [
      off,
      stage.on('contextlost', () => this.monitor?.noteContextLoss()),
      stage.on('quiet', (p) => this.onQuiet?.(Boolean(p?.quiet))),
    ];
    const selected =
      stage.ownsInput === true && !skip
        ? createCoachSafeUnityStage(
            stage,
            (source, control) =>
              this.routeCoachToRetained(source, assist, handedness, profile, deviceTier, epoch, control),
            (source, retained) => this.restoreUnityAfterCoach(source, retained, epoch),
          )
        : stage;
    this.applyLanguage(selected);
    this.stage = selected;
    this.markRenderer(selected);
    return selected;
  }

  /** Disposes the current stage (to rebuild it, or after it failed). A preparation in progress carries on. */
  private release(): void {
    this.clearEngineeringPreviewMarker?.();
    this.clearEngineeringPreviewMarker = null;
    for (const off of this.off) off();
    this.off = [];
    for (const off of this.coachSourceOff ?? []) off();
    this.coachSourceOff = null;
    this.preCoachQuality = null;
    this.preCoachNotice = null;
    try {
      this.stage?.setInputSink?.(null);
      this.stage?.dispose();
    } catch {
      /* already gone */
    }
    this.stage = null;
    this.markRenderer(null);
    this.showCoachCanvas(false);
    this.sampler.stop();
    this.core.set({ stageReady: false });
  }

  /** One sink follows whichever stage is current; native input never survives a stage replacement. */
  setInputSink(sink: StageInputSink | null): void {
    this.inputSink = sink;
    this.stage?.setInputSink?.(sink);
  }

  setLanguage(locale: string, readyHint: string): void {
    this.language = { locale, readyHint };
    this.applyLanguage(this.stage);
  }

  private applyLanguage(stage: PracticeStageLike | null): void {
    if (!stage || !this.language) return;
    stage.setLanguage?.(this.language.locale, this.language.readyHint);
  }

  ownsInput(): boolean {
    return this.stage?.ownsInput === true;
  }

  /**
   * R-43: the camera never runs on the Unity stage, which owns the batting input and hides the camera's screens (consent,
   * readiness, lost tracking). True from the first time Camera is the control in force and for the rest of the visit: no
   * swap back when the control moves away, and the next visit builds a new host and starts normally. The question goes to
   * the gate the app gives the flow; the choice decides which renderer shows the ball, never a delivery or a result.
   */
  private needsWeb(): boolean {
    if (!this.webOnly && this.core.deps.camera?.wanted()) this.webOnly = true;
    return this.webOnly;
  }

  /** Begin measuring the renderer that actually owns this delivery. */
  startDeliverySampling(): void {
    if (!this.ownsInput()) this.sampler.start();
  }

  /** Close the matching renderer-local window; native play must never be judged from the hidden WebView's rAF. */
  stopDeliverySampling(): void {
    if (!this.ownsInput()) {
      this.sampler.stop();
      return;
    }
    const stats = this.stage?.stats();
    if (stats?.sampleCount !== undefined) this.monitor?.sampleDeliverySummary(stats.avgFrameMs, stats.sampleCount);
  }

  /** The flow is going away: the stage is disposed and a preparation in progress stops, keeping nothing. */
  dispose(): void {
    this.epoch++;
    this.preparing = null;
    this.waiters = { live: [], coach: [] };
    this.release();
    this.inputSink = null;
    this.stopCoachStateWatch?.();
    this.stopCoachStateWatch = null;
  }

  /**
   * Unity contract v6 carries live Learn/Coach guides and authoritative
   * demonstrations. Only the training ball close-up still uses the retained
   * renderer; every demonstration stays in the live Unity world.
   */
  private prepareCoachSurfaceForState(): void {
    const state = this.core.getState();
    const needsCoach = state.phase === 'closeup';
    if (!isCoachSafeUnityStage(this.stage)) return;
    if (needsCoach) void this.stage.prepareCoachRenderer();
    else void this.stage.restoreUnityRenderer();
  }

  private async routeCoachToRetained(
    source: PracticeStageLike,
    assist: AssistLevel,
    handedness: Handedness,
    profile: QualityProfileId,
    deviceTier: QualityState['tier'],
    epoch: number,
    control: RetainedCoachRouteControl,
  ): Promise<PracticeStageLike | null> {
    const facade = isCoachSafeUnityStage(this.stage) ? this.stage : null;
    if (!facade || epoch !== this.epoch) return null;

    // Build the optional Coach surface before touching the healthy live Unity
    // runtime. This gives the one-tap Skip action a real cancellation boundary:
    // if it wins while imports/mounting are pending, no pause or fallback can
    // steal the first live delivery.
    let candidate: { stage: PracticeStageLike; off: Array<() => void> } | null = null;
    try {
      candidate = await this.createCoachCandidate(false, assist, handedness, profile, deviceTier, epoch, control);
    } catch {
      if (epoch !== this.epoch || control.cancelled()) return null;
      try {
        candidate = await this.createCoachCandidate(true, assist, handedness, 'lite', deviceTier, epoch, control);
      } catch {
        if (epoch !== this.epoch || control.cancelled()) return null;
      }
    }

    if (!candidate || epoch !== this.epoch || !control.tryBeginSourcePause()) {
      if (candidate) this.disposeCoachCandidate(candidate);
      if (epoch !== this.epoch || control.cancelled()) return null;
      // Cancel any exact-ball runner that captured the facade before both
      // retained renderers failed. No simulated attempt is recorded without a
      // renderer.
      this.failCoachHandoff(source);
      return null;
    }

    try {
      source.setInputSink?.(null);
      if (source.pause && !(await source.pause('interruption')))
        throw new Error('Unity Practice could not pause for Coach.');
    } catch {
      this.disposeCoachCandidate(candidate);
      this.failCoachHandoff(source);
      return null;
    }
    if (epoch !== this.epoch) {
      this.disposeCoachCandidate(candidate);
      return null;
    }

    this.preCoachQuality = this.core.getState().quality;
    this.preCoachNotice = this.core.getState().notice;
    this.coachSourceOff = this.off;
    this.off = candidate.off;
    this.sampler.stop();
    this.stage = facade;
    this.markRenderer(candidate.stage);

    if (candidate.stage.kind === '2d') {
      const current = this.core.getState().quality;
      const quality: QualityState = { ...current, stage: '2d', profile: 'lite' };
      this.core.set({ stageReady: true, quality, notice: 'classic' });
      this.monitor?.reset({ tier: quality.tier, profile: quality.profile, stage: quality.stage });
    } else {
      this.core.set({ stageReady: true });
      this.monitor?.reset({ tier: deviceTier, profile, stage: '3d' });
    }
    this.showCoachCanvas(true);
    return candidate.stage;
  }

  /** Mount a Coach-only retained stage without publishing it over live Unity. */
  private async createCoachCandidate(
    force2d: boolean,
    assist: AssistLevel,
    handedness: Handedness,
    profile: QualityProfileId,
    deviceTier: QualityState['tier'],
    epoch: number,
    control: RetainedCoachRouteControl,
  ): Promise<{ stage: PracticeStageLike; off: Array<() => void> } | null> {
    const candidate = await this.core.deps.createStage({ force2d, assistance: assist, deviceTier, skipUnity: true });
    if (candidate.kind === 'route') throw new Error('invalid retained renderer route');
    const stage = candidate;
    this.applyLanguage(stage);
    if (epoch !== this.epoch || control.cancelled()) {
      stage.dispose();
      return null;
    }
    if (!force2d && stage.kind !== '3d') {
      stage.dispose();
      throw new Error('no retained first-person stage');
    }
    const canvas = await this.freshCanvas('coach');
    if (epoch !== this.epoch || control.cancelled()) {
      stage.dispose();
      return null;
    }
    stage.setInputSink?.(null);
    let mounting = true;
    let fellBack = false;
    // Candidate failure is local to the optional Coach surface. It must never
    // poison the host-wide fallback flag and demote healthy live Unity on the
    // next ball.
    const fallbackOff = stage.on('fallback', () => {
      if (mounting) fellBack = true;
    });
    try {
      await stage.mount(canvas, {
        profile,
        handedness,
        reducedMotion: this.core.deps.reducedMotion?.() ?? false,
        learnCue: assist === 'learn' && this.core.settings.learnCue,
      });
    } catch (error) {
      fallbackOff();
      stage.dispose();
      throw error;
    }
    this.applyLanguage(stage);
    mounting = false;
    if (fellBack || epoch !== this.epoch || control.cancelled()) {
      fallbackOff();
      stage.dispose();
      if (epoch !== this.epoch || control.cancelled()) return null;
      throw new Error('fallback during retained Coach mount');
    }
    stage.setTimeScale(this.core.clock.scale);
    return {
      stage,
      off: [
        fallbackOff,
        stage.on('contextlost', () => this.monitor?.noteContextLoss()),
        stage.on('quiet', (payload) => this.onQuiet?.(Boolean(payload?.quiet))),
      ],
    };
  }

  private disposeCoachCandidate(candidate: { stage: PracticeStageLike; off: Array<() => void> }): void {
    for (const off of candidate.off) off();
    try {
      candidate.stage.setInputSink?.(null);
      candidate.stage.dispose();
    } catch {
      /* already gone */
    }
    this.showCoachCanvas(false);
  }

  private failCoachHandoff(source: PracticeStageLike): void {
    for (const off of [...this.off, ...(this.coachSourceOff ?? [])]) off();
    this.off = [];
    this.coachSourceOff = null;
    this.preCoachQuality = null;
    this.preCoachNotice = null;
    source.dispose();
    this.core.gen++;
    this.stage = null;
    this.markRenderer(null);
    this.showCoachCanvas(false);
    this.core.set({ stageReady: false, screen: 'error', phase: 'idle', error: 'stage' });
  }

  /** Restore the retained, still-qualified Unity surface after a transient Coach presentation. */
  private async restoreUnityAfterCoach(
    source: PracticeStageLike,
    retained: PracticeStageLike,
    epoch: number,
  ): Promise<boolean> {
    if (epoch !== this.epoch || !isCoachSafeUnityStage(this.stage)) return false;
    try {
      if (source.resume && !(await source.resume('recreated')))
        throw new Error('Unity Practice could not resume after Coach.');
    } catch {
      try {
        retained.setInputSink?.(null);
        retained.dispose();
      } catch {
        /* already gone */
      }
      this.failCoachHandoff(source);
      return false;
    }
    if (epoch !== this.epoch) return false;

    for (const off of this.off) off();
    this.off = this.coachSourceOff ?? [];
    this.coachSourceOff = null;
    try {
      retained.setInputSink?.(null);
      retained.dispose();
    } catch {
      /* already gone */
    }
    this.showCoachCanvas(false);
    source.setInputSink?.(this.inputSink);
    this.markRenderer(source);
    const quality = this.preCoachQuality;
    const notice = this.preCoachNotice;
    this.preCoachQuality = null;
    this.preCoachNotice = null;
    if (quality) {
      this.monitor?.reset({ tier: quality.tier, profile: quality.profile, stage: quality.stage });
      this.core.set({ stageReady: true, quality, notice });
    } else {
      this.core.set({ stageReady: true });
    }
    return true;
  }

  private async benchmark(stage: PracticeStageLike | null): Promise<DeviceAssessment> {
    const run = this.core.deps.benchmark ?? ((s, o) => runDeviceBenchmark(s, o));
    return run(
      stage,
      stage
        ? {
            durationMs: this.core.deps.hooks?.benchmarkMs,
            allowProbeFallback: stage.ownsInput !== true,
            // Browser event-to-frame timing says nothing about a native Unity surface. Until the Unity benchmark reports
            // a genuine touch-to-presented-frame value, preserve the field as unknown instead of mixing runtimes.
            ...(stage.ownsInput === true ? { measureInput: async () => null } : {}),
          }
        : {},
    );
  }

  /**
   * The stage for the coming over, prepared once and shared by every caller: the first-person stage when the device
   * check allows it, Classic otherwise (with a calm notice when the check has just decided so). Null when not even
   * Classic could start (the flow shows its calm error).
   */
  prepare(assist: AssistLevel, handedness: Handedness): Promise<PracticeStageLike | null> {
    // While a stage is being built and measured, every caller (Play tapped at once, say) waits for the same result: a
    // stage still under the device check is never handed out. Leaving or a new innings does not stop a preparation;
    // only the flow going away does.
    if (this.preparing) return this.preparing;
    if (this.stage && !this.recheck) return Promise.resolve(this.stage);
    const recheck = this.recheck;
    this.recheck = false;
    if (recheck) this.release();
    const run: Promise<PracticeStageLike | null> = this.run(assist, handedness, this.epoch, recheck).finally(() => {
      if (this.preparing === run) this.preparing = null;
    });
    this.preparing = run;
    return run;
  }

  /** Whether a stage is being prepared right now. */
  isPreparing(): boolean {
    return this.preparing !== null;
  }

  private async run(
    assist: AssistLevel,
    handedness: Handedness,
    epoch: number,
    recheck: boolean,
  ): Promise<PracticeStageLike | null> {
    const core = this.core;
    const stale = () => epoch !== this.epoch;
    const engineeringPreview = unityPracticeEngineeringPreviewEnabled();
    if (recheck) this.forcedClassicReason = null;
    let assessment = recheck ? null : core.getState().assessment;
    // R-43: a Unity measurement cannot choose or profile the web renderer the camera needs (as in the fallback below).
    if (assessment?.backend === 'unity' && this.needsWeb()) assessment = null;
    let fresh = false;
    let q = this.qualityFor(assessment);
    let made: PracticeStageLike | null = null;
    let nativeEngineeringPreview = false;
    let engineeringPreviewReason: UnityPracticeEngineeringPreviewReason = 'explicit_preview';
    if (q.stage === '3d') {
      try {
        made = await this.create(false, assist, handedness, assessment ? q.profile : 'standard', q.tier, epoch);
        if (this.forcedClassicReason) {
          assessment = null;
          fresh = true;
        } else if (!assessment) {
          try {
            assessment = await this.benchmark(made);
          } catch {
            if (
              !canRetainUnityPracticeEngineeringPreview({
                enabled: engineeringPreview,
                ownsInput: made.ownsInput === true,
                assessment: null,
              })
            )
              throw new Error('native renderer benchmark failed');
            nativeEngineeringPreview = true;
            engineeringPreviewReason = 'benchmark_unavailable';
          }
          // A dependency that violates its typed contract by resolving without evidence is still a failed native
          // benchmark. Only the separately marked engineering preview may retain it for inspection.
          if (!assessment && !nativeEngineeringPreview) {
            if (
              !canRetainUnityPracticeEngineeringPreview({
                enabled: engineeringPreview,
                ownsInput: made.ownsInput === true,
                assessment: null,
              })
            )
              throw new Error('native renderer benchmark returned no evidence');
            nativeEngineeringPreview = true;
            engineeringPreviewReason = 'benchmark_unavailable';
          }
          if (stale()) return null;
          // A fast-looking native renderer is not enough: unknown touch-to-visible response is an incomplete
          // qualification, and a below-cutoff result must try the retained Three.js path before Classic.
          if (__UNITY_PRACTICE_ENABLED__ && made.ownsInput && assessment && !nativeAssessmentEligible(assessment)) {
            if (
              !canRetainUnityPracticeEngineeringPreview({
                enabled: engineeringPreview,
                ownsInput: true,
                assessment,
              })
            )
              throw new Error('native renderer did not pass its complete qualification gate');
            nativeEngineeringPreview = true;
            engineeringPreviewReason = 'qualification_incomplete';
          }
          if (assessment) {
            fresh = true;
            // Preview evidence never populates the release admission cache. A subsequent normal build must prove
            // the renderer again through the unchanged fail-closed path.
            if (!engineeringPreview) saveCachedAssessment(core.deps.appVersion, assessment, core.store);
          }
        }
        if (engineeringPreview && made.ownsInput) {
          nativeEngineeringPreview = true;
          this.clearEngineeringPreviewMarker?.();
          this.clearEngineeringPreviewMarker = activateUnityPracticeEngineeringPreviewMarker(engineeringPreviewReason);
        }
      } catch {
        if (stale()) return null;
        this.release();
        made = null;
        if (!this.forcedClassicReason) {
          // A native Unity launch/runtime failure first returns to the established Three.js surface. Only a failure
          // of that surface proceeds to the normal Classic/device-assessment path below.
          if (__UNITY_PRACTICE_ENABLED__) {
            // A Unity assessment cannot select or profile the fallback WebGL renderer. Benchmark the fallback on its
            // own evidence; one generic cache slot intentionally holds only the renderer used most recently.
            if (assessment?.backend === 'unity') assessment = null;
            q = this.qualityFor(assessment);
            try {
              made = await this.create(
                false,
                assist,
                handedness,
                assessment ? q.profile : 'standard',
                q.tier,
                epoch,
                true,
              );
              if (!assessment) {
                assessment = await this.benchmark(made);
                if (stale()) return null;
                fresh = true;
                saveCachedAssessment(core.deps.appVersion, assessment, core.store);
              }
            } catch {
              if (stale()) return null;
              this.release();
              made = null;
            }
          }
          if (!made && (!assessment || assessment.tier !== 'below')) {
            assessment = await this.benchmark(null);
            if (stale()) return null;
            fresh = true;
            saveCachedAssessment(core.deps.appVersion, assessment, core.store);
          }
          core.track('renderer_fallback', {
            reason: assessment?.backend === 'unity' || assessment?.webgl2 ? 'context_lost' : 'no_webgl',
          });
          core.saveMetrics(bump(core.metrics, 'fallbacks'));
        }
      }
    }
    if (stale()) return null;
    q = this.qualityFor(assessment);
    core.set({ assessment, quality: q });
    if (!nativeEngineeringPreview) this.reportTier(assessment, q);
    this.monitor = new SessionMonitor({ tier: q.tier, profile: q.profile, stage: q.stage });
    if (q.stage === '2d') {
      // The check has just placed this device in Classic: say so in product words, once, with Play as the action.
      if (fresh && (this.forcedClassicReason || assessment?.tier === 'below')) core.set({ notice: 'classic' });
      if (made?.kind === '2d') made.setProfile('lite');
      else {
        if (made) this.release();
        try {
          made = await this.create(true, assist, handedness, 'lite', q.tier, epoch);
        } catch {
          if (!stale()) core.set({ error: 'stage' });
          return null;
        }
      }
    } else made?.setProfile(q.profile);
    if (stale()) return null;
    core.set({ stageReady: true });
    return made;
  }

  private reportTier(a: DeviceAssessment | null, q: QualityState): void {
    if (!a || this.tierReported) return;
    this.tierReported = true;
    this.core.saveMetrics(addTier(this.core.metrics, a.tier));
    this.core.track('practice_tier', {
      tier: a.tier,
      quality: q.stage === '2d' ? '2d' : q.profile,
      fpsBucket: fpsBucket(a.avgFps),
    });
  }

  /** Settings changed: a graphics choice applies before the next ball. */
  settingsChanged(): void {
    const s = this.core.getState();
    const q = this.qualityFor(s.assessment);
    const cur = s.quality;
    if (q.stage !== cur.stage || q.profile !== cur.profile)
      this.pending = { q: { ...q, tier: cur.tier, toleranceMs: cur.toleranceMs }, why: 'settings' };
  }

  /**
   * Forget the device check; it runs again the next time a stage is prepared (the next setup screen). Until then the
   * stage in use, and the quality it reports, stay exactly as they are.
   */
  rerunCheck(): void {
    this.tierReported = false;
    this.recheck = true;
  }

  /** Between balls only: a step down from the monitor, a settings change or a renderer fallback. Returns a notice. */
  async applyPending(scene: () => void, assist: AssistLevel, handedness: Handedness): Promise<FlowNotice> {
    const core = this.core;
    // Never alongside a preparation (both would build a stage on one canvas).
    if (this.preparing) await this.preparing;
    const epoch = this.epoch;
    const decision = this.monitor?.checkpoint() ?? null;
    if (decision)
      this.pending = {
        q: { stage: decision.stage, profile: decision.profile, tier: decision.tier, toleranceMs: decision.toleranceMs },
        why: 'monitor',
      };
    const fallback = this.fallbackRequested;
    this.fallbackRequested = null;
    if (fallback && this.stage?.kind === '3d') {
      this.pending = {
        q: { stage: '2d', profile: 'lite', tier: 'below', toleranceMs: toleranceFor('below') },
        why: 'fallback',
      };
      core.track('renderer_fallback', { reason: fallback === 'low_fps' ? 'low_fps' : 'context_lost' });
      core.saveMetrics(bump(core.metrics, 'fallbacks'));
    }
    // R-43: a native stage cannot carry the camera. It is swapped for a web one here, once, between balls (never inside a
    // delivery). Only the renderer changes: the quality, the timing help and the device check stay as they were.
    const toWeb = this.stage?.ownsInput === true && this.needsWeb();
    const p = this.pending ?? (toWeb ? { q: core.getState().quality, why: 'camera' as const } : null);
    this.pending = null;
    if (!p) return null;
    let q = p.q;
    const prev = core.getState().quality;
    if (q.stage !== this.stage?.kind || toWeb) {
      this.release();
      try {
        await this.create(q.stage === '2d', assist, handedness, q.profile, q.tier, epoch);
      } catch {
        // The first-person stage would not come back: Classic keeps the innings going. If even that cannot load, the
        // flow stops calmly (no stage) instead of waiting.
        if (q.stage === '3d' && epoch === this.epoch)
          await this.create(true, assist, handedness, 'lite', q.tier, epoch).catch(() => undefined);
      }
      if (epoch !== this.epoch) return null;
      if (this.forcedClassicReason) {
        q = this.qualityFor(null);
        core.set({ assessment: null });
      }
      scene();
      core.set({ stageReady: Boolean(this.stage) });
    } else this.stage?.setProfile(q.profile);
    this.monitor?.reset({ tier: q.tier, profile: q.profile, stage: this.stage?.kind ?? q.stage });
    if (p.why !== 'settings' && p.why !== 'camera')
      core.track('practice_tier', {
        tier: q.tier,
        quality: q.stage === '2d' ? '2d' : q.profile,
        ...(q.stage === '2d' ? { reason: p.why === 'fallback' ? 'context_lost' : 'low_fps' } : {}),
      });
    core.set({ quality: q });
    if (p.why === 'camera') return 'camera_web';
    if (p.why === 'settings' || !tierChanged(prev, q)) return null;
    return tierForQuality(q) === 'classic' ? 'classic' : 'balanced';
  }
}
