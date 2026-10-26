/**
 * The Practice flow controller. Per ball:
 *
 *   over plan → physics flight → [in-flight saved] → stage.bowl → GestureSurface → normalizeGesture
 *     → physics resolveDelivery → [record committed and saved] → stage.play → coaching → next ball
 *
 * Rules it enforces (docs/PRACTICE.md): one wicket ends the innings, at most ten overs, a full over before the next
 * is configured, the over plan is fixed before its first ball. The in-flight flag is saved before a delivery is
 * bowled and the resolved record is saved before the stage shows it, so closing the app at any moment can only ever
 * turn the ball in play into a leave (src/practice/game resumeInnings); nothing is replayed for a better score.
 * Quality and the device tier change only between balls. The stage plays the delivery's sound and haptics itself.
 */
import type {
  AnalyticsEventName,
  AnalyticsProps,
  AssistLevel,
  BallFlight,
  BowlerProfile,
  DeliveryRecord,
  DeliveryResult,
  DeviceAssessment,
  FieldLayout,
  GestureInput,
  Handedness,
  NormalizedSwing,
  PerfTier,
  PitchCondition,
  PracticeDeliveryPlan,
  PracticeInningsState,
  PracticeOverPlan,
  QualityProfileId,
} from '@/contracts';
import { PRACTICE_MAX_OVERS } from '@/contracts';
import {
  SessionMonitor,
  createFrameSampler,
  effectiveQuality,
  loadCachedAssessment,
  runDeviceBenchmark,
  saveCachedAssessment,
  toleranceFor,
  type FrameSampler,
} from '@/perf';
import {
  addDelivery,
  addTier,
  addTtfd,
  bump,
  calibrationMs,
  clearInnings,
  durationBucket,
  fpsBucket,
  intentMatch,
  isResumable,
  latencyBucket,
  loadSavedInnings,
  loadMetrics,
  loadPracticeSettings,
  outcomeProp,
  overNumberProp,
  saveInnings,
  saveMetrics,
  timingProp,
  ttfdBucket,
  updatePracticeSettings,
  localStore,
  type KeyStore,
  type PracticeMetrics,
  type PracticeSettings,
} from '@/practice/store';
import { createClock, type FlowClock } from './clock';
import type { NextDeliveryLike, PracticeEngine, PracticeStageLike, StageFactory } from './types';

export type FlowScreen = 'idle' | 'preparing' | 'compat' | 'live' | 'over_summary' | 'out' | 'complete' | 'error';
export type LivePhase = 'idle' | 'radar' | 'runup' | 'live' | 'playing' | 'coaching' | 'warmup_explain' | 'replay' | 'paused';
export type BallKind = 'innings' | 'warmup' | 'repeat';
export type FlowNotice = 'lite' | 'classic' | 'interrupted' | 'resumed_leave' | null;

export interface LastBall {
  kind: BallKind;
  result: DeliveryResult;
  /** The committed record (innings balls), or the record a repeat was taken from. */
  record: DeliveryRecord | null;
  overNumber: number;
  ballNumber: number;
  interrupted: boolean;
}

export interface ReplayItem {
  result: DeliveryResult;
  overNumber: number;
  ballNumber: number;
}

export interface ReplayState {
  kind: 'over' | 'ball' | 'dismissal';
  items: ReplayItem[];
  index: number;
  slow: boolean;
  diag: boolean;
  playing: boolean;
  /** Where Close returns. */
  back: { screen: FlowScreen; phase: LivePhase };
}

export interface QualityState {
  stage: '3d' | '2d';
  profile: QualityProfileId;
  tier: PerfTier;
  toleranceMs: number;
}

export interface FlowState {
  screen: FlowScreen;
  phase: LivePhase;
  innings: PracticeInningsState | null;
  /** The scoreboard as shown: it changes when the stage has shown the outcome, never before. */
  board: { runs: number; wickets: number; balls: number; over: Array<{ runs: number; dismissal: DeliveryRecord['dismissal'] }> };
  ball: { kind: BallKind; overNumber: number; ballNumber: number; bowler: BowlerProfile } | null;
  /** The GestureSurface: armed at release, one gesture per key. */
  gesture: { enabled: boolean; key: string };
  last: LastBall | null;
  replay: ReplayState | null;
  field: FieldLayout | null;
  conditions: PitchCondition;
  handedness: Handedness;
  assessment: DeviceAssessment | null;
  /** The assessment was just measured (show the compatibility explanation); false when it came from the cache. */
  freshAssessment: boolean;
  quality: QualityState;
  notice: FlowNotice;
  /** The first-time flow: warm-up ball, explanation, the guided over. */
  guided: boolean;
  /** Waiting for landscape before the delivery (the "turn your phone" overlay). */
  needLandscape: boolean;
  /** Waiting for one tap before the first delivery, so the audio unlock never lands on a swing. */
  needTap: boolean;
  canvasKey: number;
  storageOk: boolean;
  /** Announcement for screen readers (polite live region). */
  announce: { text: string; id: number } | null;
  error: string | null;
}

export interface FlowHooks {
  /** Test builds only: the swing for the next delivery (an exact NormalizedSwing on the simulation clock, or a leave). */
  takeSwing?(flight: BallFlight, kind: BallKind): NormalizedSwing | 'leave' | null;
  /** Test builds only: a fixed assessment instead of the benchmark. */
  assessment?: DeviceAssessment | null;
  /** Test builds only: simulation and flow time run k times faster. */
  timeScale?: number;
  /** Test builds only: deterministic over seeds. */
  seed?(): string | null;
  /** Test builds only: the benchmark length. */
  benchmarkMs?: number;
}

export interface FlowDeps {
  engine: PracticeEngine;
  createStage: StageFactory;
  appVersion: string;
  analytics?: (event: AnalyticsEventName, props?: AnalyticsProps) => void;
  store?: KeyStore | null;
  clock?: FlowClock;
  benchmark?: (stage: PracticeStageLike | null, opts: { durationMs?: number }) => Promise<DeviceAssessment>;
  reducedMotion?: () => boolean;
  newId?: () => string;
  newSeed?: () => string;
  hooks?: FlowHooks | null;
  /** performance.now() when Practice was selected (the launch tap), for time to first delivery. */
  openedAt?: number;
  isLandscape?: () => boolean;
  frameSampler?: (onInterval: (ms: number) => void) => FrameSampler;
  /** Text for the screen-reader announcements (the route passes the translator's lines). */
  words?: FlowWords;
  /** Whether a press has already warmed audio (src/practice/ui/audioWarm.ts); without it no tap is asked for. */
  audioWarmed?: () => boolean;
}

/** Announcement text, so the controller stays free of copy. */
export interface FlowWords {
  runup(ballNumber: number): string;
  outcome(last: LastBall, board: FlowState['board']): string;
}

/** The radar shows this long before the first ball of an over (or until "Bat" is tapped). */
export const RADAR_MS = 2400;
/** The coaching card stays this long before the next ball (or until "Next ball" is tapped). */
export const COACH_MS = 3000;
/** After the sixth ball or a wicket, the summary follows this long after the card. */
export const END_MS = 2600;
/** No gesture by this long after the ball reaches the stumps: a leave (s, simulation time). */
export const LEAVE_GRACE_S = 0.12;
/** A test-hook swing is "emitted" this long after its start, like a real flick read over 40 ms (ms, scaled). */
export const HOOK_EMIT_MS = 40;
/** A swing that began before the leave deadline is waited for this long more (its gesture is read over ~40–60 ms). */
export const SWING_ARRIVAL_MS = 250;

function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(a);
  } catch {
    for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

const EMPTY_BOARD: FlowState['board'] = { runs: 0, wickets: 0, balls: 0, over: [] };

interface BallSpec {
  kind: BallKind;
  plan: PracticeDeliveryPlan;
  bowler: BowlerProfile;
  seed: string;
  field: FieldLayout;
  conditions: PitchCondition;
  assist: AssistLevel;
  handedness: Handedness;
  overNumber: number;
  ballNumber: number;
  /** The record a repeat re-bowls. */
  source?: DeliveryRecord;
  /** Innings balls: the game's NextDelivery the record is made from. */
  next?: NextDeliveryLike;
}

interface SwingWaiter {
  gesture(input: GestureInput): void;
  interrupt(): void;
}

export class PracticeFlow {
  private state: FlowState;
  private listeners = new Set<() => void>();
  private readonly engine: PracticeEngine;
  private readonly store: KeyStore | null;
  private readonly clock: FlowClock;
  private settings: PracticeSettings;
  private metrics: PracticeMetrics;
  private stage: PracticeStageLike | null = null;
  private stageKind: '3d' | '2d' | null = null;
  private stageOff: Array<() => void> = [];
  private canvas: HTMLCanvasElement | null = null;
  private used = new WeakSet<HTMLCanvasElement>();
  private canvasWaiters: Array<(c: HTMLCanvasElement) => void> = [];
  private landscapeWaiters: Array<() => void> = [];
  private tapWaiters: Array<() => void> = [];
  private portraitOk = false;
  /** Bumped whenever a running sequence must stop (leaving, a new innings, dispose). */
  private gen = 0;
  private timers: Array<() => void> = [];
  private waiter: SwingWaiter | null = null;
  /** When the current swing began (its pointer-down's own timestamp), until its gesture arrives. */
  private swingStartPerf: number | null = null;
  private releasePerfMs = 0;
  private interrupted = false;
  private hiddenPause = false;
  private monitor: SessionMonitor | null = null;
  private sampler: FrameSampler;
  private pendingQuality: { q: QualityState; why: 'monitor' | 'settings' | 'fallback' } | null = null;
  private fallbackRequested: string | null = null;
  /** A notice raised between balls (a quality change) stays for the coming ball; others clear when it starts. */
  private noticeFresh = false;
  private results = new Map<string, DeliveryResult>();
  private guidedOver: PracticeOverPlan | null = null;
  private pendingStart: (() => void) | null = null;
  private openedAt: number;
  private firstDelivery = false;
  private ttfd: number | null = null;
  private startedAt = 0;
  private tierReported = false;
  private disposed = false;

  constructor(private readonly deps: FlowDeps) {
    this.engine = deps.engine;
    this.store = deps.store === undefined ? localStore() : deps.store;
    this.clock = deps.clock ?? createClock(deps.hooks?.timeScale ?? 1);
    this.settings = loadPracticeSettings(this.store);
    this.metrics = loadMetrics(this.store);
    this.openedAt = deps.openedAt ?? this.clock.now();
    this.sampler = (deps.frameSampler ?? createFrameSampler)((ms) => this.monitor?.sample(ms));
    const assessment = deps.hooks?.assessment ?? loadCachedAssessment(deps.appVersion, this.store);
    this.state = {
      screen: 'idle',
      phase: 'idle',
      innings: null,
      board: EMPTY_BOARD,
      ball: null,
      gesture: { enabled: false, key: '0' },
      last: null,
      replay: null,
      field: null,
      conditions: this.settings.conditions,
      handedness: this.settings.handedness,
      assessment,
      freshAssessment: false,
      quality: this.qualityFor(assessment),
      notice: null,
      guided: false,
      needLandscape: false,
      needTap: false,
      canvasKey: 0,
      storageOk: this.probeStorage(),
      announce: null,
      error: null,
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Store plumbing
  // ------------------------------------------------------------------------------------------------------------

  getState = (): FlowState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private set(patch: Partial<FlowState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private probeStorage(): boolean {
    if (!this.store) return false;
    try {
      this.store.setItem('vc:practice:probe', '1');
      this.store.removeItem('vc:practice:probe');
      return true;
    } catch {
      return false;
    }
  }

  private track(event: AnalyticsEventName, props: AnalyticsProps = {}): void {
    try {
      this.deps.analytics?.(event, { mode: 'practice', ...props });
    } catch {
      /* analytics never breaks practice */
    }
  }

  private saveMetrics(next: PracticeMetrics): void {
    this.metrics = next;
    saveMetrics(next, this.store);
  }

  private persist(notice: 'resumed_leave' | null = null): void {
    const s = this.state.innings;
    if (!s) return;
    if (!saveInnings(s, this.store, notice) && this.state.storageOk) this.set({ storageOk: false });
  }

  private after(ms: number, cb: () => void): void {
    this.timers.push(this.clock.after(ms, cb));
  }

  private clearTimers(): void {
    for (const c of this.timers) c();
    this.timers = [];
  }

  /** Current local metrics (diagnostics). */
  localMetrics(): PracticeMetrics {
    return this.metrics;
  }

  /** Practice chosen → the first ball released, this visit (ms), or null before it. */
  firstDeliveryMs(): number | null {
    return this.ttfd;
  }

  /** This session's per-delivery frame rates (diagnostics). */
  sessionFps(): number[] {
    return this.monitor?.recentFps() ?? [];
  }

  /** The stage's last input-to-bat latency (diagnostics). */
  lastInputToBatMs(): number | null {
    try {
      return this.stage?.stats().lastInputToBatMs ?? null;
    } catch {
      return null;
    }
  }

  settingsNow(): PracticeSettings {
    return this.settings;
  }

  /** Settings changed in the settings screen: graphics apply before the next ball; hand and assistance next innings. */
  refreshSettings(): void {
    this.settings = loadPracticeSettings(this.store);
    const q = this.qualityFor(this.state.assessment);
    const cur = this.state.quality;
    if (q.stage !== cur.stage || q.profile !== cur.profile) this.pendingQuality = { q: { ...q, tier: cur.tier, toleranceMs: cur.toleranceMs }, why: 'settings' };
    if (!this.state.innings) this.set({ conditions: this.settings.conditions, handedness: this.settings.handedness });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Start-up and resume
  // ------------------------------------------------------------------------------------------------------------

  /**
   * Loads the saved innings and resolves anything left in flight (as a leave). Returns what the route should show:
   * the first-time flow, the menu (with a resumable innings, if any) or a finished innings' summary.
   */
  init(): 'guided' | 'menu' | 'summary' {
    this.metrics = bump(this.metrics, 'sessions');
    this.saveMetrics(this.metrics);
    this.track('practice_opened', {});
    const loaded = loadSavedInnings(this.store);
    if (loaded) {
      const saved = loaded.state;
      const wasInFlight = Boolean(saved.inFlight);
      const resumed = wasInFlight ? this.engine.resumeInnings(saved) : saved;
      // Either the ball was still in flight, or the app already settled it as it went away (a reload or an OS kill
      // fires "hidden" first): both are said the same way.
      const notice: FlowNotice = wasInFlight || loaded.notice ? 'resumed_leave' : null;
      this.set({ innings: resumed, board: this.boardOf(resumed), conditions: resumed.conditions, handedness: resumed.handedness, notice });
      if (wasInFlight) this.persist();
      if (resumed.status === 'out' || resumed.status === 'complete') {
        this.set({ screen: resumed.status === 'out' ? 'out' : 'complete' });
        return 'summary';
      }
      if (isResumable(resumed)) return 'menu';
    }
    return this.settings.guidedDone ? 'menu' : 'guided';
  }

  /** An innings worth continuing (the menu's resume card). */
  resumable(): PracticeInningsState | null {
    const s = this.state.innings;
    return isResumable(s) ? s : null;
  }

  // ------------------------------------------------------------------------------------------------------------
  // The stage, the device check and quality
  // ------------------------------------------------------------------------------------------------------------

  attachCanvas = (el: HTMLCanvasElement | null): void => {
    this.canvas = el;
    if (el && !this.used.has(el)) {
      const w = this.canvasWaiters.shift();
      if (w) {
        this.used.add(el);
        w(el);
      }
    }
  };

  private freshCanvas(): Promise<HTMLCanvasElement> {
    const c = this.canvas;
    if (c && !this.used.has(c)) {
      this.used.add(c);
      return Promise.resolve(c);
    }
    return new Promise((resolve) => {
      this.canvasWaiters.push(resolve);
      this.set({ canvasKey: this.state.canvasKey + 1 });
    });
  }

  private qualityFor(a: DeviceAssessment | null): QualityState {
    // Classic chosen in settings: the 2D stage straight away (no device check needed for it).
    if (this.settings.quality === 'classic') return { stage: '2d', profile: 'lite', tier: a?.tier ?? 'full', toleranceMs: toleranceFor(a?.tier ?? 'full') };
    if (!a) return { stage: '3d', profile: 'standard', tier: 'full', toleranceMs: 0 };
    const eff = effectiveQuality(a, this.settings.quality);
    return { stage: eff.stage, profile: eff.profile, tier: a.tier, toleranceMs: toleranceFor(a.tier) };
  }

  private mountOpts(assist: AssistLevel, handedness: Handedness, profile: QualityProfileId) {
    return { profile, handedness, reducedMotion: this.deps.reducedMotion?.() ?? false, learnCue: assist === 'learn' && this.settings.learnCue };
  }

  private async createStage(force2d: boolean, assist: AssistLevel, handedness: Handedness, profile: QualityProfileId): Promise<PracticeStageLike> {
    const canvas = await this.freshCanvas();
    const stage = await this.deps.createStage({ force2d });
    if (!force2d && stage.kind !== '3d') {
      // No WebGL 2: the factory chose the 2D stage itself. Treat it as the 3D stage failing (the device check says why).
      stage.dispose();
      throw new Error('no first-person stage');
    }
    let fellBack = false;
    const off = stage.on('fallback', (payload) => {
      fellBack = true;
      this.fallbackRequested = payload?.reason ?? 'error';
    });
    try {
      await stage.mount(canvas, this.mountOpts(assist, handedness, profile));
    } catch (e) {
      off();
      stage.dispose();
      throw e;
    }
    if (fellBack && !force2d) {
      off();
      stage.dispose();
      throw new Error('fallback during mount');
    }
    stage.setTimeScale(this.clock.scale);
    this.stageOff = [off, stage.on('contextlost', () => this.monitor?.noteContextLoss())];
    this.stage = stage;
    this.stageKind = stage.kind;
    return stage;
  }

  private disposeStage(): void {
    for (const off of this.stageOff) off();
    this.stageOff = [];
    try {
      this.stage?.dispose();
    } catch {
      /* already gone */
    }
    this.stage = null;
    this.stageKind = null;
    this.sampler.stop();
  }

  /**
   * The stage for the coming innings: the first-person stage when the device check allows it, the Classic stage
   * otherwise. Runs the device check ("Preparing the pitch…") once per app version. Null when the player must first
   * see the compatibility message (playClassic continues from there).
   */
  private async ensureStage(assist: AssistLevel, handedness: Handedness): Promise<PracticeStageLike | null> {
    if (this.stage) return this.stage;
    const gen = this.gen;
    this.set({ screen: 'preparing', error: null });
    let assessment = this.state.assessment;
    let fresh = false;
    let q = this.qualityFor(assessment);
    let made: PracticeStageLike | null = null;
    if (q.stage === '3d') {
      try {
        const stage = await this.createStage(false, assist, handedness, assessment ? q.profile : 'standard');
        made = stage;
        if (gen !== this.gen) return null;
        if (!assessment) {
          assessment = await (this.deps.benchmark ?? ((s, o) => runDeviceBenchmark(s, o)))(stage, { durationMs: this.deps.hooks?.benchmarkMs });
          if (gen !== this.gen) return null;
          fresh = true;
          saveCachedAssessment(this.deps.appVersion, assessment, this.store);
        }
      } catch {
        this.disposeStage();
        made = null;
        if (gen !== this.gen) return null;
        if (!assessment || assessment.tier !== 'below') {
          assessment = await (this.deps.benchmark ?? ((s, o) => runDeviceBenchmark(s, o)))(null, {});
          fresh = true;
          saveCachedAssessment(this.deps.appVersion, assessment, this.store);
        }
        this.track('renderer_fallback', { reason: assessment.webgl2 ? 'context_lost' : 'no_webgl' });
        this.saveMetrics(bump(this.metrics, 'fallbacks'));
      }
    }
    if (gen !== this.gen) return null;
    q = this.qualityFor(assessment);
    this.set({ assessment, freshAssessment: fresh, quality: q });
    this.reportTier(assessment, q);
    this.monitor = new SessionMonitor({ tier: q.tier, profile: q.profile, stage: q.stage });
    if (q.stage === '2d') {
      if (made) this.disposeStage();
      if (fresh && assessment?.tier === 'below') {
        // Below the cutoff: say so plainly and offer Classic practice (never first-person express bowling).
        this.set({ screen: 'compat' });
        return null;
      }
      try {
        return await this.createStage(true, assist, handedness, 'lite');
      } catch {
        this.set({ screen: 'error', error: 'stage' });
        return null;
      }
    }
    made?.setProfile(q.profile);
    return made;
  }

  private reportTier(a: DeviceAssessment | null, q: QualityState): void {
    if (!a || this.tierReported) return;
    this.tierReported = true;
    this.saveMetrics(addTier(this.metrics, a.tier));
    this.track('practice_tier', { tier: a.tier, quality: q.stage === '2d' ? '2d' : q.profile, fpsBucket: fpsBucket(a.avgFps) });
  }

  /** From the compatibility message: continue in Classic (the 2D stage, same physics and rules). */
  async playClassic(): Promise<void> {
    const start = this.pendingStart;
    this.pendingStart = null;
    try {
      await this.createStage(true, this.state.guided ? 'learn' : this.settings.assist, this.state.handedness, 'lite');
    } catch {
      this.set({ screen: 'error', error: 'stage' });
      return;
    }
    start?.();
  }

  /** Between balls only: a step down from the monitor, a settings change, or a renderer fallback. */
  private async applyPendingQuality(): Promise<void> {
    const decision = this.monitor?.checkpoint() ?? null;
    if (decision) this.pendingQuality = { q: { stage: decision.stage, profile: decision.profile, tier: decision.tier, toleranceMs: decision.toleranceMs }, why: 'monitor' };
    const fallback = this.fallbackRequested;
    this.fallbackRequested = null;
    if (fallback && this.stageKind === '3d') {
      this.pendingQuality = { q: { stage: '2d', profile: 'lite', tier: 'below', toleranceMs: toleranceFor('below') }, why: 'fallback' };
      this.track('renderer_fallback', { reason: fallback === 'low_fps' ? 'low_fps' : 'context_lost' });
      this.saveMetrics(bump(this.metrics, 'fallbacks'));
    }
    const p = this.pendingQuality;
    this.pendingQuality = null;
    if (!p) return;
    const q = p.q;
    const prev = this.state.quality;
    const notice: FlowNotice = q.stage === '2d' && this.stageKind === '3d' && p.why !== 'settings' ? 'classic' : q.profile === 'lite' && prev.profile !== 'lite' && p.why === 'monitor' ? 'lite' : null;
    if (q.stage !== this.stageKind) {
      const inn = this.state.innings;
      this.disposeStage();
      try {
        await this.createStage(q.stage === '2d', inn?.assist ?? this.settings.assist, this.state.handedness, q.profile);
      } catch {
        // The first-person stage would not come back: Classic keeps the innings going.
        if (q.stage === '3d') await this.createStage(true, inn?.assist ?? this.settings.assist, this.state.handedness, 'lite');
      }
      const field = this.state.field;
      const bowler = inn?.current?.plan.bowler ?? this.state.ball?.bowler;
      if (field && bowler) this.stage?.setScene({ field, bowler, conditions: this.state.conditions, handedness: this.state.handedness });
    } else this.stage?.setProfile(q.profile);
    this.monitor?.reset({ tier: q.tier, profile: q.profile, stage: this.stageKind ?? q.stage });
    if (p.why !== 'settings') this.track('practice_tier', { tier: q.tier, quality: q.stage === '2d' ? '2d' : q.profile, ...(q.stage === '2d' ? { reason: p.why === 'fallback' ? 'context_lost' : 'low_fps' } : {}) });
    this.noticeFresh = notice !== null;
    this.set({ quality: q, notice: notice ?? this.state.notice });
  }

  /** Settings: forget the device check; it runs again the next time a stage is prepared. */
  rerunDeviceCheck(): void {
    this.tierReported = false;
    this.set({ assessment: null, quality: this.qualityFor(null) });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Viewport and app lifecycle
  // ------------------------------------------------------------------------------------------------------------

  setLandscape(landscape: boolean): void {
    if (landscape || this.portraitOk) {
      this.set({ needLandscape: false });
      const w = this.landscapeWaiters;
      this.landscapeWaiters = [];
      for (const f of w) f();
    }
  }

  /** "Continue anyway" on the turn-your-phone overlay (desktop windows, or a player who prefers portrait). */
  allowPortrait(): void {
    this.portraitOk = true;
    this.setLandscape(true);
  }

  /** Before the first delivery: one tap, unless a press has already warmed audio. */
  private waitTap(): Promise<void> {
    if (!this.deps.audioWarmed || this.deps.audioWarmed()) return Promise.resolve();
    this.set({ needTap: true });
    return new Promise((resolve) => this.tapWaiters.push(resolve));
  }

  /** The "Start batting" tap (its press has just warmed audio). */
  tapped(): void {
    this.set({ needTap: false });
    const w = this.tapWaiters;
    this.tapWaiters = [];
    for (const f of w) f();
  }

  private waitLandscape(): Promise<void> {
    const landscape = this.deps.isLandscape?.() ?? true;
    if (landscape || this.portraitOk) return Promise.resolve();
    this.set({ needLandscape: true });
    return new Promise((resolve) => this.landscapeWaiters.push(resolve));
  }

  /**
   * The app went to the background or came back. Hidden during a delivery: the swing is gone, so the ball resolves
   * as a leave at once (exactly what a resumed innings would do). Hidden between balls: nothing else starts until
   * the player resumes.
   */
  setHidden(hidden: boolean): void {
    if (!hidden) return;
    this.hiddenPause = true;
    this.clearTimers();
    const p = this.state.phase;
    if (p === 'runup' || p === 'live') {
      this.interrupted = true;
      this.waiter?.interrupt();
    } else if (p === 'coaching' || p === 'radar') this.set({ phase: 'paused' });
  }

  pause(): void {
    const p = this.state.phase;
    if (p === 'runup' || p === 'live' || p === 'playing') return; // never mid-delivery
    this.clearTimers();
    this.set({ phase: 'paused' });
  }

  /** Resume after a pause: the next ball (or the summary the innings reached). */
  resume(): void {
    this.hiddenPause = false;
    if (this.state.phase !== 'paused') return;
    this.continueAfterBall();
  }

  // ------------------------------------------------------------------------------------------------------------
  // Starting play
  // ------------------------------------------------------------------------------------------------------------

  private seed(): string {
    return this.deps.hooks?.seed?.() ?? this.deps.newSeed?.() ?? randomHex();
  }

  private newId(): string {
    return this.deps.newId?.() ?? `p-${randomHex(8)}`;
  }

  /** The first-time flow: Balanced, Learn, one explained warm-up ball, then the guided over. */
  async startGuided(): Promise<void> {
    const gen = ++this.gen;
    this.pendingStart = () => void this.startGuided();
    this.startedAt = this.clock.now();
    this.set({ guided: true, conditions: 'balanced', handedness: this.settings.handedness, board: EMPTY_BOARD, last: null, notice: null });
    const stage = await this.ensureStage('learn', this.settings.handedness);
    if (!stage || gen !== this.gen) return;
    this.pendingStart = null;
    const g = this.engine.guidedStart(this.seed());
    this.guidedOver = g.over;
    const handedness = this.settings.handedness;
    const field = this.engine.autoField(g.warmup.bowler, 'balanced', handedness);
    stage.setScene({ field, bowler: g.warmup.bowler, conditions: 'balanced', handedness });
    this.set({ screen: 'live', phase: 'idle', field });
    const out = await this.runBall({ kind: 'warmup', plan: g.warmup.plan, bowler: g.warmup.bowler, seed: g.warmup.seed, field, conditions: 'balanced', assist: 'learn', handedness, overNumber: 1, ballNumber: 1 });
    if (!out || gen !== this.gen) return;
    this.set({ phase: 'warmup_explain' });
  }

  /** After the explained warm-up: the guided six-ball over begins and counts. */
  startGuidedOver(): void {
    if (!this.guidedOver) return;
    this.settings = updatePracticeSettings({ guidedDone: true }, this.store);
    const innings = this.engine.newInnings({ id: this.newId(), conditions: 'balanced', assist: 'learn', handedness: this.settings.handedness });
    this.set({ innings, board: EMPTY_BOARD, last: null });
    this.chooseOver(this.guidedOver, { radar: false });
    this.guidedOver = null;
  }

  /** Quick Random Over from the menu: a new innings and six unknown, fixed deliveries. */
  async startRandom(): Promise<void> {
    await this.startInnings(() => this.randomPlan());
  }

  /** A built over from the editor starts a new innings (or, between overs, becomes the next over). */
  async startBuilt(plan: PracticeOverPlan): Promise<void> {
    const s = this.state.innings;
    if (s && s.status === 'choosing_over') {
      await this.continueWith(plan);
      return;
    }
    await this.startInnings(() => plan);
  }

  private randomPlan(): PracticeOverPlan {
    const s = this.state.innings;
    const assist = s?.assist ?? this.settings.assist;
    return this.engine.randomOver({ seed: this.seed(), conditions: s?.conditions ?? this.settings.conditions, assist, beginner: assist === 'learn' });
  }

  private async startInnings(planFor: () => PracticeOverPlan): Promise<void> {
    const gen = ++this.gen;
    this.pendingStart = () => void this.startInnings(planFor);
    this.startedAt = this.clock.now();
    const { assist, handedness, conditions } = this.settings;
    this.set({ guided: false, conditions, handedness, board: EMPTY_BOARD, last: null, notice: null, replay: null });
    const stage = await this.ensureStage(assist, handedness);
    if (!stage || gen !== this.gen) return;
    this.pendingStart = null;
    if (!this.settings.guidedDone) this.settings = updatePracticeSettings({ guidedDone: true }, this.store);
    // Starting over while an innings is saved ends that one (its score is final), never silently.
    if (isResumable(this.state.innings)) this.discardInnings();
    this.results.clear();
    const innings = this.engine.newInnings({ id: this.newId(), conditions, assist, handedness });
    this.set({ innings });
    this.chooseOver(planFor(), { radar: true });
  }

  /** The menu's "Continue innings": straight back to the ball, the summary or the next over. */
  async continueInnings(): Promise<void> {
    const s = this.state.innings;
    if (!s) return;
    const gen = ++this.gen;
    this.pendingStart = () => void this.continueInnings();
    this.startedAt = this.clock.now();
    const stage = await this.ensureStage(s.assist, s.handedness);
    if (!stage || gen !== this.gen) return;
    this.pendingStart = null;
    if (s.status === 'batting' && s.current) {
      stage.setScene({ field: s.current.field, bowler: s.current.plan.bowler, conditions: s.conditions, handedness: s.handedness });
      this.set({ screen: 'live', phase: 'radar', field: s.current.field, board: this.boardOf(s) });
      this.after(RADAR_MS, () => this.fieldReady());
    } else if (s.status === 'over_complete' || (s.status === 'choosing_over' && s.overs.length > 0)) {
      this.set({ screen: 'over_summary', phase: 'idle', board: this.boardOf(s) });
    } else if (s.status === 'choosing_over') this.chooseOver(this.randomPlan(), { radar: true });
  }

  /** Abandons the saved innings (the menu's "New innings"). Its score is final. */
  discardInnings(): void {
    const s = this.state.innings;
    if (s && isResumable(s)) this.finishInnings(this.engine.inningsReducer(s, { type: 'abandon' }), 'abandon');
    clearInnings(this.store);
    this.set({ innings: null, board: EMPTY_BOARD, last: null, notice: null });
  }

  private chooseOver(plan: PracticeOverPlan, opts: { radar: boolean }): void {
    const s = this.state.innings;
    if (!s) return;
    const field = this.engine.autoField(plan.bowler, s.conditions, s.handedness);
    const next = this.engine.inningsReducer(s, { type: 'chooseOver', plan, field });
    this.set({ innings: next, field, screen: 'live', board: { ...this.boardOf(next), over: [] }, last: null, replay: null });
    this.persist();
    this.stage?.setScene({ field, bowler: plan.bowler, conditions: s.conditions, handedness: s.handedness });
    if (opts.radar) {
      this.set({ phase: 'radar' });
      this.after(RADAR_MS, () => this.fieldReady());
    } else void this.bowlNext();
  }

  /** The radar was read (or its time ran out): the first ball of the over. */
  fieldReady(): void {
    if (this.state.phase !== 'radar') return;
    this.clearTimers();
    if (this.hiddenPause) {
      this.set({ phase: 'paused' });
      return;
    }
    void this.bowlNext();
  }

  // ------------------------------------------------------------------------------------------------------------
  // One ball
  // ------------------------------------------------------------------------------------------------------------

  /** The next ball of the over in progress. */
  async bowlNext(): Promise<void> {
    this.clearTimers();
    const s = this.state.innings;
    if (!s || s.status !== 'batting' || !s.current || this.busy()) return;
    const gen = this.gen;
    await this.applyPendingQuality();
    if (gen !== this.gen) return;
    const now = this.state.innings;
    const next = now ? this.engine.nextDelivery(now) : null;
    if (!next) return;
    const out = await this.runBall({ kind: 'innings', ...next, overNumber: next.overIndex + 1, ballNumber: next.ballIndex + 1, next });
    if (!out || gen !== this.gen) return;
    this.continueAfterBall(true);
  }

  private busy(): boolean {
    const p = this.state.phase;
    return p === 'runup' || p === 'live' || p === 'playing';
  }

  private simToPerf(t: number): number {
    const v = this.stage?.simToPerf(t);
    return typeof v === 'number' && Number.isFinite(v) ? v : this.releasePerfMs + (t * 1000) / this.clock.scale;
  }

  /** Bowls one delivery and resolves it through the physics; innings balls are committed and saved first. */
  private async runBall(b: BallSpec): Promise<{ result: DeliveryResult; record: DeliveryRecord | null } | null> {
    const stage = this.stage;
    if (!stage) return null;
    const gen = this.gen;
    this.hiddenPause = false;
    await this.waitLandscape();
    if (gen !== this.gen) return null;
    await this.waitTap();
    if (gen !== this.gen) return null;
    const flight = this.engine.flight({ plan: b.plan, bowler: b.bowler, conditions: b.conditions, seed: b.seed, handedness: b.handedness });
    if (b.kind === 'innings') {
      const s = this.state.innings!;
      this.set({ innings: this.engine.inningsReducer(s, { type: 'deliveryStarted' }) });
      this.persist();
    }
    this.interrupted = false;
    const key = `${b.kind}:${b.overNumber}.${b.ballNumber}:${this.clock.now().toFixed(0)}`;
    const notice = this.noticeFresh ? this.state.notice : null;
    this.noticeFresh = false;
    this.set({
      notice,
      phase: 'runup',
      ball: { kind: b.kind, overNumber: b.overNumber, ballNumber: b.ballNumber, bowler: b.bowler },
      gesture: { enabled: false, key },
      last: null,
      announce: this.deps.words ? { text: this.deps.words.runup(b.ballNumber), id: Date.now() } : this.state.announce,
    });
    this.sampler.start();
    let releasePerfMs: number;
    try {
      releasePerfMs = (await stage.bowl(flight)).releasePerfMs;
    } catch {
      releasePerfMs = this.clock.now();
      this.interrupted = true;
    }
    if (gen !== this.gen || this.disposed) return null;
    this.releasePerfMs = releasePerfMs;
    if (!this.firstDelivery) {
      this.firstDelivery = true;
      const ms = releasePerfMs - this.openedAt;
      this.ttfd = ms;
      this.saveMetrics(addTtfd(this.metrics, ms));
      this.track('practice_first_delivery', { ttfdBucket: ttfdBucket(ms), assist: b.assist });
    }
    this.set({ phase: 'live', gesture: { enabled: !this.interrupted, key } });
    const swing = this.interrupted ? null : await this.awaitSwing(flight, releasePerfMs, b.kind, b.handedness);
    if (gen !== this.gen || this.disposed) return null;
    this.set({ gesture: { enabled: false, key } });
    const tierToleranceMs = this.state.quality.toleranceMs;
    const result =
      b.kind === 'repeat' && b.source
        ? this.engine.repeatDelivery(b.source, swing)
        : this.engine.resolveDelivery({ flight, swing, field: b.field, bowler: b.bowler, conditions: b.conditions, handedness: b.handedness, assist: b.assist, tierToleranceMs });
    let record: DeliveryRecord | null = b.source ?? null;
    if (b.kind === 'innings' && b.next) {
      const s = this.state.innings!;
      record = this.engine.makeRecord(b.next, swing, tierToleranceMs, result);
      // Committed and saved before anything shows it: closing the app now cannot change this ball. A ball settled
      // because the app went away is marked, so a next start (after a kill) can say what happened.
      this.set({ innings: this.engine.inningsReducer(s, { type: 'deliveryResolved', record }) });
      this.persist(this.interrupted ? 'resumed_leave' : null);
      this.results.set(`${record.overIndex}:${record.ballIndex}`, result);
    }
    this.set({ phase: 'playing' });
    try {
      await stage.play(result);
    } catch {
      /* a stage that failed mid-play is replaced between balls; the result already stands */
    }
    this.sampler.stop();
    if (gen !== this.gen || this.disposed) return null;
    const latency = swing ? stage.stats().lastInputToBatMs : null;
    this.saveMetrics(addDelivery(b.kind === 'repeat' ? bump(this.metrics, 'repeats') : b.kind === 'warmup' ? bump(this.metrics, 'warmups') : this.metrics, result, { scoring: b.kind === 'innings', latencyMs: latency }));
    if (this.settings.hintsShown < 10) this.settings = updatePracticeSettings({ hintsShown: this.settings.hintsShown + 1 }, this.store);
    const last: LastBall = { kind: b.kind, result, record, overNumber: b.overNumber, ballNumber: b.ballNumber, interrupted: this.interrupted };
    const board = b.kind === 'innings' ? this.boardOf(this.state.innings!) : this.state.board;
    if (b.kind === 'innings') {
      this.track('practice_delivery', {
        assist: b.assist,
        tier: this.state.quality.tier,
        timing: timingProp(result),
        intentMatch: intentMatch(result),
        outcome: outcomeProp(result.outcome),
        ...(latency !== null && Number.isFinite(latency) ? { latencyBucket: latencyBucket(latency) } : {}),
      });
    }
    this.set({
      phase: 'coaching',
      last,
      board,
      notice: this.interrupted ? 'interrupted' : this.state.notice,
      announce: this.deps.words ? { text: this.deps.words.outcome(last, board), id: Date.now() } : this.state.announce,
    });
    return { result, record };
  }

  private awaitSwing(flight: BallFlight, releasePerfMs: number, kind: BallKind, handedness: Handedness): Promise<NormalizedSwing | null> {
    return new Promise((resolve) => {
      let done = false;
      let cancels: Array<() => void> = [];
      const finish = (swing: NormalizedSwing | null) => {
        if (done) return;
        done = true;
        for (const c of cancels) c();
        cancels = [];
        this.waiter = null;
        this.swingStartPerf = null;
        resolve(swing);
      };
      const at = (perfMs: number, cb: () => void) => {
        const id = setTimeout(cb, Math.max(0, perfMs - this.clock.now()));
        cancels.push(() => clearTimeout(id));
      };
      const calibration = calibrationMs(this.store);
      this.swingStartPerf = null;
      const injected = this.deps.hooks?.takeSwing?.(flight, kind) ?? null;
      const injectedStart = injected && injected !== 'leave' ? this.simToPerf(injected.startT) : null;
      // No gesture by the time the ball has passed the stumps: a leave. Timing is judged by the events' own
      // timestamps, never by when a busy main thread got round to them: a swing that started before the deadline
      // still counts (its gesture is on its way), and input already queued is handled before a leave is declared.
      const deadline = this.simToPerf(flight.stumpsT + LEAVE_GRACE_S);
      at(deadline, () => {
        if (injectedStart !== null && injectedStart <= deadline) return; // its own timer delivers it
        if (this.swingStartPerf !== null && this.swingStartPerf <= deadline) {
          at(this.clock.now() + SWING_ARRIVAL_MS, () => finish(null));
          return;
        }
        at(this.clock.now(), () => (this.swingStartPerf !== null && this.swingStartPerf <= deadline ? at(this.clock.now() + SWING_ARRIVAL_MS, () => finish(null)) : finish(null)));
      });
      this.waiter = {
        gesture: (input) => {
          const swing = this.engine.normalizeGesture(input, {
            releasePerfMs,
            calibrationMs: calibration,
            handedness,
            ...(this.clock.scale !== 1 ? { timeScale: this.clock.scale } : {}),
          });
          if (swing) finish(swing);
          // Not a swing (a cancelled touch): re-arm for the rest of the delivery.
          else {
            this.swingStartPerf = null;
            this.set({ gesture: { enabled: true, key: `${this.state.gesture.key}+` } });
          }
        },
        interrupt: () => finish(null),
      };
      if (injected && injected !== 'leave' && injectedStart !== null) {
        at(injectedStart, () => this.stage?.beginSwing(injectedStart + calibration, calibration));
        at(injectedStart + HOOK_EMIT_MS / this.clock.scale, () => finish(injected));
      }
    });
  }

  /** From the GestureSurface. */
  onSwingStart = (atPerfMs: number): void => {
    if (this.state.phase !== 'live' || !this.state.gesture.enabled) return;
    if (this.swingStartPerf === null) this.swingStartPerf = atPerfMs;
    this.stage?.beginSwing(atPerfMs, calibrationMs(this.store));
  };

  onGesture = (input: GestureInput): void => {
    if (this.state.phase === 'live') this.waiter?.gesture(input);
  };

  /** After a ball's card: the next ball, or the summary the innings reached. */
  private continueAfterBall(auto = false): void {
    const s = this.state.innings;
    const last = this.state.last;
    if (this.hiddenPause) {
      this.set({ phase: 'paused' });
      return;
    }
    if (last?.kind === 'warmup') {
      this.set({ phase: 'warmup_explain' });
      return;
    }
    if (last?.kind === 'repeat') {
      this.set({ phase: 'coaching' });
      return;
    }
    if (!s) return;
    if (s.status === 'batting') {
      if (auto) this.after(COACH_MS, () => this.nextBall());
      else void this.bowlNext();
      return;
    }
    const show = () => this.showEnd(s);
    if (auto) this.after(END_MS, show);
    else show();
  }

  /** "Next ball" on the card (or its time ran out). */
  nextBall(): void {
    if (this.state.phase !== 'coaching' && this.state.phase !== 'paused') return;
    this.clearTimers();
    const s = this.state.innings;
    if (this.state.last?.kind === 'innings' && s && s.status !== 'batting') {
      this.showEnd(s);
      return;
    }
    if (this.hiddenPause) {
      this.set({ phase: 'paused' });
      return;
    }
    void this.bowlNext();
  }

  private showEnd(s: PracticeInningsState): void {
    this.clearTimers();
    if (s.status === 'over_complete') {
      const over = s.overs.length;
      this.saveMetrics(bump(this.metrics, 'overs'));
      this.track('practice_over_completed', { overNumber: overNumberProp(over), assist: s.assist });
      this.set({ screen: 'over_summary', phase: 'idle' });
    } else if (s.status === 'out') {
      this.track('practice_wicket', { overNumber: overNumberProp(s.overs.length + 1), assist: s.assist });
      this.finishInnings(s, 'out');
      this.set({ screen: 'out', phase: 'idle' });
    } else if (s.status === 'complete') {
      this.saveMetrics(bump(this.metrics, 'overs'));
      this.track('practice_over_completed', { overNumber: overNumberProp(PRACTICE_MAX_OVERS), assist: s.assist });
      this.finishInnings(s, 'complete');
      this.set({ screen: 'complete', phase: 'idle' });
    }
    if (this.state.guided) this.set({ guided: false });
  }

  private finishInnings(s: PracticeInningsState, how: 'out' | 'complete' | 'abandon'): void {
    this.saveMetrics(bump(this.metrics, 'innings'));
    const overs = Math.max(1, Math.min(PRACTICE_MAX_OVERS, s.overs.length + (s.current?.deliveries.length ? 1 : 0)));
    this.track('practice_innings_completed', {
      overNumber: overNumberProp(overs),
      assist: s.assist,
      ...(how === 'out' ? { outcome: 'out' as const } : {}),
      durationBucket: durationBucket(this.clock.now() - (this.startedAt || this.openedAt)),
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Between overs, the end of the innings
  // ------------------------------------------------------------------------------------------------------------

  /** Moves a completed over on to choosing the next one (Next Over, or Build the next over). */
  private toNextOver(): boolean {
    const s = this.state.innings;
    if (!s || s.status !== 'over_complete') return s?.status === 'choosing_over';
    const next = this.engine.inningsReducer(s, { type: 'nextOver' });
    this.set({ innings: next });
    this.persist();
    this.saveMetrics(bump(this.metrics, 'nextOver'));
    this.track('practice_next_over', { overNumber: overNumberProp(next.overs.length + 1), assist: next.assist });
    return true;
  }

  /** Next Over: a new random over (six unknown deliveries). */
  async nextOver(): Promise<void> {
    if (!this.toNextOver()) return;
    await this.continueWith(this.randomPlan());
  }

  /** Build the next over: the innings waits in "choosing" while the editor is open. */
  prepareBuiltNextOver(): boolean {
    return this.toNextOver();
  }

  private async continueWith(plan: PracticeOverPlan): Promise<void> {
    const s = this.state.innings;
    if (!s || s.status !== 'choosing_over') return;
    const gen = ++this.gen;
    const stage = await this.ensureStage(s.assist, s.handedness);
    if (!stage || gen !== this.gen) return;
    this.chooseOver(plan, { radar: true });
  }

  /** End innings from the over summary: the score is final. */
  endInnings(): void {
    const s = this.state.innings;
    if (!s) return;
    this.finishInnings(this.engine.inningsReducer(s, { type: 'abandon' }), 'abandon');
    clearInnings(this.store);
    this.set({ innings: null, screen: 'idle', phase: 'idle' });
  }

  /** Leaving a finished innings' summary forgets it on the device. */
  closeFinished(): void {
    const s = this.state.innings;
    if (s && (s.status === 'out' || s.status === 'complete')) clearInnings(this.store);
    this.set({ innings: null, board: EMPTY_BOARD, last: null });
  }

  /**
   * A delivery left in flight (leaving or closing mid-ball) is resolved as a leave at once, exactly as a resumed
   * innings would be, so continuing in the same visit can never bowl that ball again.
   */
  private settleInFlight(): void {
    const s = this.state.innings;
    if (!s?.inFlight) return;
    this.set({ innings: this.engine.resumeInnings(s), notice: 'resumed_leave' });
    this.persist();
  }

  /** Back to the menu (the innings stays saved; a ball in play is resolved as a leave). */
  leave(): void {
    this.gen++;
    this.clearTimers();
    this.waiter?.interrupt();
    this.waiter = null;
    this.settleInFlight();
    this.disposeStage();
    this.set({ screen: 'idle', phase: 'idle', replay: null, gesture: { enabled: false, key: this.state.gesture.key }, needLandscape: false });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Results, replays and non-scoring repeats
  // ------------------------------------------------------------------------------------------------------------

  /** The resolved result of a committed delivery (re-simulated from its record when not cached). */
  resultOf(record: DeliveryRecord): DeliveryResult {
    const key = `${record.overIndex}:${record.ballIndex}`;
    let r = this.results.get(key);
    if (!r) {
      r = this.engine.replayDelivery(record);
      this.results.set(key, r);
    }
    return r;
  }

  /** Results resolved or re-simulated so far, keyed "overIndex:ballIndex" (for the game's summaries). */
  resultsMap(): ReadonlyMap<string, DeliveryResult> {
    const s = this.state.innings;
    if (s) for (const o of [...s.overs, ...(s.current ? [s.current] : [])]) for (const r of o.deliveries) this.resultOf(r);
    return this.results;
  }

  /** Every result of an over (index into innings.overs, or the over in progress). */
  overResults(overIndex: number): DeliveryResult[] {
    const s = this.state.innings;
    if (!s) return [];
    const over = s.overs[overIndex] ?? (overIndex === s.overs.length ? s.current : null);
    return over ? over.deliveries.map((r) => this.resultOf(r)) : [];
  }

  /** Replay This Over (the last completed over). */
  replayOver(overIndex?: number): void {
    const s = this.state.innings;
    if (!s) return;
    const i = overIndex ?? s.overs.length - 1;
    const over = s.overs[i];
    if (!over) return;
    void this.startReplay('over', over.deliveries.map((r) => ({ result: this.resultOf(r), overNumber: i + 1, ballNumber: r.ballIndex + 1 })), { slow: false, diag: false });
  }

  /** The slow-motion diagnostic replay of the ball just played. */
  replayLast(): void {
    const last = this.state.last;
    if (!last) return;
    this.clearTimers();
    void this.startReplay('ball', [{ result: last.result, overNumber: last.overNumber, ballNumber: last.ballNumber }], { slow: true, diag: true });
  }

  /** The dismissal, in slow motion with the diagnostics. */
  replayDismissal(): void {
    const rec = this.state.innings?.dismissal?.record;
    if (!rec) return;
    void this.startReplay('dismissal', [{ result: this.resultOf(rec), overNumber: rec.overIndex + 1, ballNumber: rec.ballIndex + 1 }], { slow: true, diag: true });
  }

  /** The stage, created when a summary was reached without one (a resumed, finished innings). */
  private async withStage(): Promise<PracticeStageLike | null> {
    if (this.stage) return this.stage;
    const screen = this.state.screen;
    const s = this.state.innings;
    this.pendingStart = () => this.set({ screen });
    const stage = await this.ensureStage(s?.assist ?? this.settings.assist, s?.handedness ?? this.settings.handedness);
    if (!stage) return null;
    this.pendingStart = null;
    this.set({ screen });
    return stage;
  }

  private async startReplay(kind: ReplayState['kind'], items: ReplayItem[], opts: { slow: boolean; diag: boolean }): Promise<void> {
    if (!items.length || this.busy()) return;
    const back = { screen: this.state.screen, phase: this.state.phase };
    if (!(await this.withStage())) return;
    this.saveMetrics(bump(this.metrics, 'replays'));
    this.track('practice_replay', { overNumber: overNumberProp(items[0].overNumber) });
    this.set({ replay: { kind, items, index: 0, slow: opts.slow, diag: opts.diag, playing: false, back }, screen: 'live', phase: 'replay' });
    void this.playReplay(0);
  }

  private replayGen = 0;

  private async playReplay(index: number): Promise<void> {
    const r = this.state.replay;
    const stage = this.stage;
    if (!r || !stage || index < 0 || index >= r.items.length) return;
    const gen = ++this.replayGen;
    this.set({ replay: { ...r, index, playing: true } });
    try {
      await stage.replay(r.items[index].result, { speed: r.slow ? 0.3 : 1, diagnostics: r.diag });
    } catch {
      /* nothing to show */
    }
    if (gen !== this.replayGen || !this.state.replay) return;
    const cur = this.state.replay;
    // A whole over plays through; a single ball stays on its last frame.
    if (cur.kind === 'over' && index + 1 < cur.items.length) void this.playReplay(index + 1);
    else this.set({ replay: { ...cur, playing: false } });
  }

  replaySelect(index: number): void {
    void this.playReplay(index);
  }

  replayToggle(what: 'slow' | 'diag'): void {
    const r = this.state.replay;
    if (!r) return;
    this.set({ replay: { ...r, [what]: !r[what] } });
    void this.playReplay(r.index);
  }

  closeReplay(): void {
    const r = this.state.replay;
    if (!r) return;
    this.replayGen++;
    this.set({ replay: null, screen: r.back.screen, phase: r.back.phase === 'replay' ? 'idle' : r.back.phase });
  }

  /** Repeat a ball of the last completed over, or the dismissal ball: same plan and seed, never counts. */
  async repeatBall(record: DeliveryRecord): Promise<void> {
    if (this.busy()) return;
    const stage = await this.withStage();
    if (!stage) return;
    const gen = this.gen;
    this.clearTimers();
    stage.setScene({ field: record.field, bowler: record.bowler, conditions: record.conditions, handedness: record.handedness });
    this.set({ screen: 'live', phase: 'idle', replay: null, field: record.field });
    const out = await this.runBall({
      kind: 'repeat',
      plan: record.plan,
      bowler: record.bowler,
      seed: record.seed,
      field: record.field,
      conditions: record.conditions,
      assist: record.assist,
      handedness: record.handedness,
      overNumber: record.overIndex + 1,
      ballNumber: record.ballIndex + 1,
      source: record,
    });
    if (!out || gen !== this.gen) return;
  }

  /** From a repeat's card: back to the summary it came from. */
  backToSummary(): void {
    const s = this.state.innings;
    this.clearTimers();
    const screen: FlowScreen = s?.status === 'out' ? 'out' : s?.status === 'complete' ? 'complete' : 'over_summary';
    this.set({ screen, phase: 'idle', last: null });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Helpers and teardown
  // ------------------------------------------------------------------------------------------------------------

  private boardOf(s: PracticeInningsState): FlowState['board'] {
    const lastOver = s.overs[s.overs.length - 1]?.deliveries ?? [];
    const balls = s.current ? s.current.deliveries : s.status === 'batting' ? [] : lastOver;
    return { runs: s.runs, wickets: s.status === 'out' ? 1 : 0, balls: s.balls, over: balls.map((r) => ({ runs: r.runs, dismissal: r.dismissal })) };
  }

  /** The innings' plan for an over (summaries and repeats). */
  overPlan(overIndex: number): PracticeOverPlan | null {
    const s = this.state.innings;
    return s?.overs[overIndex]?.plan ?? (overIndex === s?.overs.length ? (s?.current?.plan ?? null) : null);
  }

  dispose(): void {
    this.gen++;
    this.clearTimers();
    this.waiter?.interrupt();
    this.settleInFlight();
    this.disposeStage();
    this.disposed = true;
    this.listeners.clear();
  }
}
