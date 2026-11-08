/**
 * The flow's core: its state container, dependencies and the shared plumbing (timers, analytics, metrics, saving the
 * innings). PracticeFlow (./controller.ts) extends it; the stage host (./stageHost.ts) and the delivery runner
 * (./delivery.ts) work through it, so the controller's pieces share one state and one generation counter.
 */
import type { AnalyticsEventName, AnalyticsProps, BallFlight, DeviceAssessment, NormalizedSwing } from '@/contracts';
import {
  loadMetrics,
  loadPracticeSettings,
  localStore,
  saveInnings,
  saveMetrics,
  type KeyStore,
  type PracticeMetrics,
  type PracticeSettings,
} from '@/practice/store';
import type { FrameSampler } from '@/perf';
import { createClock, type FlowClock } from './clock';
import type { CoachKit, PracticeEngine, PracticeStageLike, StageFactory } from './types';
import type { OffThreadWork } from './offThread';
import type { BallKind, Board, FlowState, LastBall } from './state';
import type { ChaseState } from '@/practice/chase/types';
import { saveChase } from '../chase/store';
import type { LessonInput } from '../lesson/inputType';
import type { CameraGate } from '../camera/gate';

export interface FlowHooks {
  /** Test builds only: the swing for the next delivery (an exact NormalizedSwing on the simulation clock, or a leave). */
  takeSwing?(flight: BallFlight, kind: BallKind): NormalizedSwing | 'leave' | null;
  /** Test builds only: a fixed assessment instead of the benchmark. */
  assessment?: DeviceAssessment | null;
  /** Test builds only: simulation and flow time run k times faster. */
  timeScale?: number;
  /** Test builds only: deterministic over seeds. */
  seed?(): string | null;
  /** Test builds only: the chase seed of the next Chase (a pool seed, "c000" to "c255"), instead of one drawn from seed(). */
  chaseSeed?(): string | null;
  /** Test builds only: the benchmark length. */
  benchmarkMs?: number;
  /** Test builds only: a dead innings ball continues to the next ball by itself (long journeys). */
  autoNext?: boolean;
  /** Test builds only: 'off' computes everything on the main thread (the work thread's fallback), for A/B runs. */
  work?: 'on' | 'off';
}

/** Announcement text, so the controller stays free of copy. */
export interface FlowWords {
  /** `chase` is given in a chase (its first ball announces the target). */
  runup(ballNumber: number, chase?: ChaseState | null): string;
  outcome(last: LastBall, board: Board): string;
  /** The chase after a ball, for the same polite announcement: what is needed now, or how it ended. */
  chase?(state: ChaseState): string;
}

export interface FlowDeps {
  engine: PracticeEngine;
  /** The exact-ball coach; without it the dead ball shows the outcome only (and Coach Mode is not offered). */
  coach?: CoachKit | null;
  /**
   * The work thread (./offThread.ts): the live ball's physics and the coach's readings off the main thread, with the
   * engine and coach above as the fallback. Without it everything is computed here, exactly as before.
   */
  work?: OffThreadWork | null;
  createStage: StageFactory;
  appVersion: string;
  analytics?: (event: AnalyticsEventName, props?: AnalyticsProps) => void;
  store?: KeyStore | null;
  clock?: FlowClock;
  benchmark?: (
    stage: PracticeStageLike | null,
    opts: { durationMs?: number; allowProbeFallback?: boolean },
  ) => Promise<DeviceAssessment>;
  reducedMotion?: () => boolean;
  newId?: () => string;
  newSeed?: () => string;
  hooks?: FlowHooks | null;
  /** performance.now() when Practice was selected (the launch tap), for time to first delivery. */
  openedAt?: number;
  isLandscape?: () => boolean;
  frameSampler?: (onInterval: (ms: number) => void) => FrameSampler;
  words?: FlowWords;
  /** The restrained mastery confirmation (src/audio playMasteryFeel), on the coach's mastery event. */
  masteryFeel?: (event: 'mastered' | 'stage_up') => void;
  /**
   * The first-ball lesson (src/practice/ui/lesson): present only where the UI can show it (PracticeApp). Without it the
   * first ball is bowled as it always was. `input` is the kind of input the card starts with.
   */
  lesson?: { input(): LessonInput };
  /**
   * Camera batting (src/practice/ui/camera): present only where the UI can run it (PracticeApp). Before every ball, when the
   * camera is the control in force, the flow waits in its `camera` phase until a person is in frame and steady (pre-delivery
   * pacing only: a ball in flight is never touched). Without it every ball starts as it always did.
   */
  camera?: CameraGate;
  /** The match context for the stage's emotion signals (src/audio deliveryContext); never the simulation. */
  deliveryContext?: (s: {
    runs: number;
    wicketsInHand: number;
    ballsLeft: number | null;
    /** The runs to win, in a chase (src/audio/situation.ts MatchSituation). */
    target?: number | null;
    batterRuns?: number;
  }) => import('./types').StageDeliveryContext;
}

export function randomHex(bytes = 16): string {
  const a = new Uint8Array(bytes);
  try {
    crypto.getRandomValues(a);
  } catch {
    for (let i = 0; i < bytes; i++) a[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export abstract class FlowCore {
  protected state: FlowState;
  private listeners = new Set<() => void>();
  readonly engine: PracticeEngine;
  readonly coach: CoachKit | null;
  readonly work: OffThreadWork | null;
  readonly store: KeyStore | null;
  readonly clock: FlowClock;
  settings: PracticeSettings;
  metrics: PracticeMetrics;
  /** Bumped whenever a running sequence must stop (leaving, a new innings, dispose). */
  gen = 0;
  private timers: Array<() => void> = [];
  protected disposed = false;

  protected constructor(
    readonly deps: FlowDeps,
    initial: (settings: PracticeSettings) => FlowState,
  ) {
    this.engine = deps.engine;
    this.coach = deps.coach ?? null;
    this.work = deps.work ?? null;
    this.store = deps.store === undefined ? localStore() : deps.store;
    this.clock = deps.clock ?? createClock(deps.hooks?.timeScale ?? 1);
    this.settings = loadPracticeSettings(this.store);
    this.metrics = loadMetrics(this.store);
    this.state = initial(this.settings);
  }

  getState = (): FlowState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  set(patch: Partial<FlowState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  protected clearListeners(): void {
    this.listeners.clear();
  }

  track(event: AnalyticsEventName, props: AnalyticsProps = {}): void {
    try {
      this.deps.analytics?.(event, { mode: 'practice', ...props });
    } catch {
      /* analytics never breaks practice */
    }
  }

  saveMetrics(next: PracticeMetrics): void {
    this.metrics = next;
    saveMetrics(next, this.store);
  }

  /** Saves the innings at once (before a ball is bowled, and before its result is shown). */
  persist(notice: 'resumed_leave' | null = null): void {
    const s = this.state.innings;
    if (!s) return;
    // A chase keeps its definition with its innings under its own key, so it can never come back as a Practice innings.
    const chase = this.state.chase;
    const saved = chase ? saveChase(chase.state.definition, s, this.store, notice) : saveInnings(s, this.store, notice);
    if (!saved && this.state.storageOk) this.set({ storageOk: false });
  }

  after(ms: number, cb: () => void): void {
    this.timers.push(this.clock.after(ms, cb));
  }

  clearTimers(): void {
    const timers = this.timers;
    this.timers = [];
    for (const c of timers) c();
  }

  /**
   * Waits `ms` on the flow clock: true when the time has passed, false when the wait was cleared first (leaving,
   * the app going away). Never left pending, so nothing can wait for ever on a cancelled timer.
   */
  wait(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (passed: boolean) => {
        if (done) return;
        done = true;
        resolve(passed);
      };
      const cancel = this.clock.after(ms, () => finish(true));
      this.timers.push(() => {
        cancel();
        finish(false);
      });
    });
  }

  seed(): string {
    return this.deps.hooks?.seed?.() ?? this.deps.newSeed?.() ?? randomHex();
  }

  newId(): string {
    return this.deps.newId?.() ?? `p-${randomHex(8)}`;
  }

  isDisposed(): boolean {
    return this.disposed;
  }
}
