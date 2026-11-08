/**
 * The Practice stage's session, shared by the 3D and the Classic 2D stage (subclasses only draw a frame): the
 * delivery's timebase, the release, swing, play and replay promises, feedback timing, profiles, stats and events.
 *
 * Timing never depends on frames. A delivery's timebase maps simulation time to performance.now(); every frame
 * draws the simulation at its own timestamp, and every sound and haptic is scheduled for its event's exact
 * performance time, not "the next frame". Sounds are handed to the sink one output latency ahead (audio.ts
 * soundLeadMs), so the sink can start them on the audio clock to be heard at that moment (COH6); the sink holds their
 * haptics and captions until it. Moments fire on a timer at their own time. Promises resolve on timers, so they keep
 * time even when no frame is drawn (a lost context, a background tab).
 */
import type {
  AssistanceStage,
  BallFlight,
  CoachOption,
  DeliveryResult,
  QualityProfileId,
  TimingBands,
  Vec3,
} from '@/contracts/practice';
import { TAP_HOLD_MS, type OneGestureState } from '@/input';
import { activeBands } from '@/physics/timing';
import { frameStats, PERF_WARMUP_FRAMES } from '@/perf';
import { practicePlan, prewarmPracticeGaze, replayShot, type DirectorCue } from '../core/camera';
import { type BallScript, crowdAt } from '../core/choreo';
import { batMoved, freezeBatTrace, TOUCHDOWN, type TouchStroke } from './bat';
import { buildDiagnostics, type Diagnostics } from './diagnostics';
import { PITCH_HALF } from '../core/ground';
import { perfAtScene, perfToSim, releasePerf, sceneAtPerf, simToPerf, simToScene, type Timebase } from './frame';
import { buildPracticeScript, practiceReleaseScene } from './script';
import { applyChaseMoment, type ChaseMoment } from './resultMoments';
import { createPracticeAudio, soundLeadMs, type PracticeAudio } from './audio';
import { emotionAt } from './emotion';
import type {
  AssistanceGuide,
  CloseUpOptions,
  DeliveryContext,
  PracticeBenchmarkRun,
  PracticeEventPayloads,
  PracticeMountOptions,
  PracticeSceneSetup,
  PracticeSink,
  PracticeStage,
  PracticeStageEvent,
  PracticeStageStats,
  ProtectedRegion,
  ReplayOptions,
} from './types';

export interface StageClock {
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export const defaultStageClock: StageClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  raf: (cb) =>
    typeof requestAnimationFrame !== 'undefined'
      ? requestAnimationFrame(cb)
      : (setTimeout(() => cb(defaultStageClock.now()), 16) as unknown as number),
  caf: (id) => (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type StageMode = 'idle' | 'live' | 'replay' | 'benchmark' | 'demo' | 'closeup';

/**
 * Why a script was just built (`onScript`): the scene between balls; a delivery before its result; the result's script
 * taking over a live delivery (the previous script is handed over); a replay, a Coach demonstration or the ball
 * close-up built from a result or a flight alone; the benchmark scene.
 */
export type ScriptKind = 'idle' | 'live' | 'result' | 'replay' | 'demo' | 'closeup' | 'bench';

/** One frame to draw. */
export interface StageFrame {
  mode: StageMode;
  script: BallScript;
  /** Scene ms. */
  scene: number;
  plan: readonly DirectorCue[];
  /** Ambient clock for the stadium (sky, crowd), ms. */
  clockMs: number;
  slow: boolean;
  diagnostics: Diagnostics | null;
  /** The replayed delivery's timing bands (its assistance level), when known. */
  bands: TimingBands | null;
  /** The exact Coach option represented by this frame; non-null only during a demonstration. */
  coachOption: CoachOption | null;
  /** The exact flight whose surface is being inspected; non-null only during the training close-up. */
  closeUpFlight: BallFlight | null;
}

/** Frame intervals kept for stats(). */
const STATS_WINDOW = 120;
/** A frame at 60 Hz has about this long (ms) for a draw and for idle work; idle work takes at most IDLE_SLICE_MAX_MS of it. */
const FRAME_BUDGET_MS = 12;
const IDLE_SLICE_MAX_MS = 4;
/** A lost context that is not restored within this long asks for the 2D stage. */
const LOST_FALLBACK_MS = 3500;
/**
 * The benchmark scene plays for the requested time AND until it has this many frames beyond src/perf's warm-up, so a
 * slow device (a software renderer at 2–6 fps) is still measured on real frames; it stops at BENCH_CAP_MS whatever
 * happens (a device that cannot draw that many frames in that time is measured on what it drew).
 */
export const BENCH_MIN_MEASURED_FRAMES = 6;
export const BENCH_CAP_MS = 6000;

/** Replay: the delivery stride before release, the slow window around the bat, and the aftermath. */
export const REPLAY = { leadMs: 900, slowBeforeMs: 150, slowAfterMs: 450, afterMinMs: 1600, afterMaxMs: 3200 } as const;

/** Replay time warp: [replay ms, scene ms] anchors (slow motion through the bat's window). */
export interface ReplayWarp {
  anchors: Array<[number, number]>;
  duration: number;
  /** Scene window played in slow motion. */
  slow: [number, number];
}

export function replayWarp(script: BallScript, speed: number): ReplayWarp {
  const p = script.practice!;
  const release = p.releaseScene;
  const contact = p.contactScene ?? (p.flight ? simToScene(p, p.flight.idealContactT) : release + 500);
  const start = Math.max(0, release - REPLAY.leadMs);
  const dead = p.deadScene ?? contact + REPLAY.afterMaxMs;
  const end = Math.min(
    script.duration,
    contact + Math.min(REPLAY.afterMaxMs, Math.max(REPLAY.afterMinMs, dead + 400 - contact)),
  );
  const s0 = Math.max(start, release - REPLAY.slowBeforeMs);
  const s1 = Math.min(end, contact + REPLAY.slowAfterMs);
  const k = Math.min(1, Math.max(0.05, speed));
  const a1 = s0 - start;
  const a2 = a1 + (s1 - s0) / k;
  const a3 = a2 + (end - s1);
  return {
    anchors: [
      [0, start],
      [a1, s0],
      [a2, s1],
      [a3, end],
    ],
    duration: a3,
    slow: [s0, s1],
  };
}

/** Scene time for a replay time (pure). */
export function warpScene(w: ReplayWarp, ms: number): number {
  const a = w.anchors;
  if (ms <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++) {
    const [r0, s0] = a[i - 1];
    const [r1, s1] = a[i];
    if (ms <= r1) return r1 > r0 ? s0 + ((ms - r0) / (r1 - r0)) * (s1 - s0) : s1;
  }
  return a[a.length - 1][1];
}

interface FiredCue {
  key: string;
  /** Scene ms. */
  t: number;
  fire: () => void;
  /** A sound the sink schedules on the audio clock: handed over SOUND_LEAD ahead of its time (COH6). */
  ahead: boolean;
  /** Not played once it is this late (ms): a held bounce whose result came too late to be heard with the ball. */
  staleMs?: number;
}

/** A cue waiting on a timer for its own time. */
interface PendingCue {
  id: unknown;
  due: number;
  fire: () => void;
  /** From the flight alone (before the result): the result re-decides it when it arrives. */
  preResult: boolean;
}

/**
 * Before the result, a flight that pitches within this distance of the striker's stumps (m) might be met on the full
 * (COH4): the furthest contact plane is 2.9 m out (down the track) and the bat reaches about a metre beyond it. Its
 * pitch is never handed to the sink ahead of time, and is held for the result once a swing has begun.
 */
const CONTESTED_BOUNCE_M = 4.5;
/** A bounce sound more than this late (ms) is not played: the ball is long gone from the pitch. */
const BOUNCE_STALE_MS = 90;

interface LiveDelivery {
  flight: BallFlight;
  tb: Timebase;
  script: BallScript;
  plan: DirectorCue[];
  provisionalStart: number | null;
  /** The touch-down stroke (bat.ts TOUCHDOWN): from the press until the committed swing takes over. Live only. */
  touch: TouchStroke | null;
  result: DeliveryResult | null;
  resultAt: number | null;
  resolveRelease: ((v: { releasePerfMs: number }) => void) | null;
  releaseTimer: unknown;
  resolvePlay: (() => void) | null;
  playTimer: unknown;
  dead: boolean;
  fired: Set<string>;
  pending: Map<string, PendingCue>;
}

interface ReplayRun {
  script: BallScript;
  plan: DirectorCue[];
  startPerf: number;
  warp: ReplayWarp;
  diagnostics: Diagnostics | null;
  bands: TimingBands | null;
  resolve: (() => void) | null;
  timer: unknown;
  done: boolean;
  /** Coach Mode's demonstration (mode 'demo'). */
  demo: { option: CoachOption } | null;
  /** The training close-up (mode 'closeup'). */
  closeUp: { flight: BallFlight } | null;
}

/** Coach Mode's demonstration plays slower than a replay through the bat (it is watched to be copied). */
const DEMO_SPEED = 0.25;
/** A live Chase moment starts this long after it is presented (ms of scene time): the frame being drawn is never rewritten. */
const CHASE_MOMENT_LEAD_MS = 120;
/** The close-up: a moment in the hand before release, then the ball leaving it at CLOSE_UP_RATE of real time. */
export const CLOSE_UP_MS = 3200;
const CLOSE_UP_LEAD_MS = 260;
const CLOSE_UP_HOLD_MS = 900;
const CLOSE_UP_RATE = 0.06;

export abstract class PracticeSessionBase implements PracticeStage {
  abstract readonly kind: '3d' | '2d';
  protected clock: StageClock;
  protected options: PracticeMountOptions = {
    profile: 'standard',
    handedness: 'right',
    reducedMotion: false,
    learnCue: false,
  };
  protected profileId: QualityProfileId = 'standard';
  protected reducedMotion = false;
  protected learnCue = false;
  protected setup: PracticeSceneSetup | null = null;
  protected mounted = false;
  protected disposed = false;
  protected contextLosses = 0;
  protected mode: StageMode = 'idle';

  private pendingProfile: QualityProfileId | null = null;
  private timeScale = 1;
  private idleScript: BallScript | null = null;
  private idlePlan: DirectorCue[] = [];
  private idleStart = 0;
  private live: LiveDelivery | null = null;
  private rep: ReplayRun | null = null;
  private rafId: number | null = null;
  private lastFrame = 0;
  private intervals: number[] = [];
  private latencyPending: number | null = null;
  private lastLatency: number | null = null;
  private drawErrors = 0;
  private lostTimer: unknown = null;
  private listeners = new Map<PracticeStageEvent, Set<(p: unknown) => void>>();
  /** undefined: the default (src/audio) sink, created on first use; null: muted. */
  private sink: PracticeSink | null | undefined = undefined;
  private ownSink: PracticeAudio | null = null;
  /** Coach Mode's assistance: set between balls, taken by the next bowl(). */
  protected assistance: { stage: AssistanceStage | null; guide: AssistanceGuide | null } = { stage: null, guide: null };
  private pendingAssistance: { stage: AssistanceStage | null; guide: AssistanceGuide | null } | null = null;
  /** The assistance the live delivery was bowled with. */
  protected liveAssistance: { stage: AssistanceStage | null; guide: AssistanceGuide | null } = {
    stage: null,
    guide: null,
  };
  protected focusAid = false;
  private quietOn = false;
  protected deliveryContext: DeliveryContext = {};

  constructor(clock: StageClock = defaultStageClock) {
    this.clock = clock;
  }

  // ---- subclass hooks --------------------------------------------------------------------------------------------
  protected abstract drawFrame(frame: StageFrame): void;
  /**
   * Work that can wait for a spare moment of the frame just drawn, `budgetMs` of it (never more than the frame has
   * left): a subclass builds what a later frame would otherwise build all at once. Optional: never stops a frame.
   */
  protected idleWork(_frame: StageFrame, _budgetMs: number): void {}
  /**
   * A script was just built for `kind` (`prev`: for a result, the live script it replaces). Subclasses prepare what each
   * of the script's frames would otherwise build in the frame (the Director's plans); it runs where the script is built,
   * outside any drawn frame, and must cost next to nothing for a result (that frame is already the busiest of a delivery).
   */
  protected onScript(_script: BallScript, _kind: ScriptKind, _prev: BallScript | null): void {}
  /** Reduced Motion changed (the subclass rebuilds what it baked with the old setting). */
  protected onReducedMotion(_on: boolean): void {}
  protected abstract applyProfile(id: QualityProfileId): void;
  protected abstract rendererName(): string;
  protected abstract drawCalls(): number;
  /** Bowling hand at release relative to the bowler's root (the 3D stage measures its rig), or undefined. */
  protected releaseHand(_setup: PracticeSceneSetup): Vec3 | undefined {
    return undefined;
  }
  abstract mount(canvas: HTMLCanvasElement, options: PracticeMountOptions): Promise<void>;
  abstract benchmark(ms: number): Promise<PracticeBenchmarkRun>;

  /** Subclasses call this once their canvas is ready. */
  protected startSession(options: PracticeMountOptions) {
    this.options = options;
    this.profileId = options.profile;
    this.reducedMotion = options.reducedMotion;
    this.learnCue = options.learnCue;
    this.mounted = true;
    this.startLoop();
  }

  // ---- events ----------------------------------------------------------------------------------------------------
  on<E extends PracticeStageEvent>(event: E, cb: (payload: PracticeEventPayloads[E]) => void): () => void;
  on(event: PracticeStageEvent, cb: (payload: never) => void): () => void;
  on(event: PracticeStageEvent, cb: (payload: never) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const l = cb as (p: unknown) => void;
    set.add(l);
    return () => set!.delete(l);
  }
  protected emit<E extends PracticeStageEvent>(event: E, payload: PracticeEventPayloads[E]) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* a listener never breaks the stage */
      }
    });
  }
  protected onContextLost() {
    this.contextLosses++;
    this.emit('contextlost', {});
    if (this.lostTimer !== null) this.clock.clearTimer(this.lostTimer);
    this.lostTimer = this.clock.setTimer(() => {
      this.lostTimer = null;
      this.emit('fallback', { reason: 'context_lost' });
    }, LOST_FALLBACK_MS);
  }
  protected onContextRestored() {
    if (this.lostTimer !== null) this.clock.clearTimer(this.lostTimer);
    this.lostTimer = null;
    this.emit('contextrestored', {});
  }

  // ---- scene -----------------------------------------------------------------------------------------------------
  setScene(setup: PracticeSceneSetup): void {
    this.setup = setup;
    this.idleScript = buildPracticeScript({ setup, flight: null, releaseHand: this.releaseHand(setup) });
    this.idlePlan = practicePlan(this.idleScript, this.reducedMotion);
    prewarmPracticeGaze(this.idleScript, this.reducedMotion);
    this.idleStart = this.clock.now();
    this.onScript(this.idleScript, 'idle', null);
  }

  setSink(sink: PracticeSink | null): void {
    this.sink = sink;
  }
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (this.idleScript) this.idlePlan = practicePlan(this.idleScript, on);
    // The other motion setting has its own gaze: build it now, not in the next frame.
    if (this.live?.script?.practice) prewarmPracticeGaze(this.live.script, on);
    this.onReducedMotion(on);
  }
  setLearnCue(on: boolean): void {
    this.learnCue = on;
  }
  setAssistance(stage: AssistanceStage | null, guide: AssistanceGuide | null = null): void {
    const next = { stage, guide: stage === null ? null : guide };
    // Between deliveries it applies now (for the next bowl); during one it waits for that bowl.
    if (this.live && !this.live.dead) this.pendingAssistance = next;
    else {
      this.pendingAssistance = null;
      this.assistance = next;
    }
  }
  setFocusAid(on: boolean): void {
    this.focusAid = on;
  }
  /** Screen regions the HUD must not cover (subclasses project them through their camera). */
  protectedRegions(): ProtectedRegion[] {
    return [];
  }
  setTimeScale(k: number): void {
    if (Number.isFinite(k) && k > 0) this.timeScale = k;
  }

  protected activeSink(): PracticeSink | null {
    if (this.sink === undefined) {
      if (!this.ownSink) {
        try {
          this.ownSink = createPracticeAudio();
        } catch {
          this.ownSink = null;
        }
      }
      return this.ownSink;
    }
    return this.sink;
  }

  // ---- delivery --------------------------------------------------------------------------------------------------
  bowl(flight: BallFlight, context: DeliveryContext = {}): Promise<{ releasePerfMs: number }> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before bowl'));
    this.endLive();
    this.endReplay();
    this.applyPending();
    if (this.pendingAssistance) {
      this.assistance = this.pendingAssistance;
      this.pendingAssistance = null;
    }
    this.liveAssistance = this.assistance;
    this.deliveryContext = context;
    this.activeSink()?.context?.({ ...context, conditions: setup.conditions });
    this.setQuiet(true);
    const now = this.clock.now();
    const tb: Timebase = {
      startPerfMs: now,
      releaseScene: practiceReleaseScene(setup.bowler),
      timeScale: this.timeScale,
    };
    const script = buildPracticeScript({
      setup,
      flight,
      learnCue: this.learnCue,
      releaseHand: this.releaseHand(setup),
      context,
    });
    tb.releaseScene = script.practice!.releaseScene;
    // The first-person gaze is built here, outside any animation frame (frames only read it).
    prewarmPracticeGaze(script, this.reducedMotion);
    this.onScript(script, 'live', null);
    const live: LiveDelivery = {
      flight,
      tb,
      script,
      plan: practicePlan(script, this.reducedMotion),
      provisionalStart: null,
      touch: null,
      result: null,
      resultAt: null,
      resolveRelease: null,
      releaseTimer: null,
      resolvePlay: null,
      playTimer: null,
      dead: false,
      fired: new Set(),
      pending: new Map(),
    };
    this.live = live;
    this.mode = 'live';
    this.latencyPending = null;
    const at = releasePerf(tb);
    return new Promise((resolve) => {
      live.resolveRelease = resolve;
      live.releaseTimer = this.clock.setTimer(() => this.settleRelease(live), Math.max(0, at - this.clock.now()));
    });
  }

  private settleRelease(live: LiveDelivery) {
    if (live.releaseTimer !== null) this.clock.clearTimer(live.releaseTimer);
    live.releaseTimer = null;
    const r = live.resolveRelease;
    live.resolveRelease = null;
    r?.({ releasePerfMs: releasePerf(live.tb) });
  }

  releasePerfMs(): number | null {
    return this.live ? releasePerf(this.live.tb) : null;
  }
  simToPerf(t: number): number {
    return this.live ? simToPerf(this.live.tb, t) : Number.NaN;
  }
  perfToSim(perfMs: number): number {
    return this.live ? perfToSim(this.live.tb, perfMs) : Number.NaN;
  }

  /**
   * Touch-down (owner decision 2026-11-04, CTL1): the bat's stroke starts at the press minus calibration, the instant a
   * tap's physics swing starts (normalizeGesture), and CTL1's latency is measured from the press. The stroke stays
   * short of the ball until beginSwing commits it (bat.ts TOUCHDOWN), and checks back at the tap window's end.
   */
  prepareSwing(atPerfMs: number, calibrationMs = 0): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || live.provisionalStart !== null || live.result || !Number.isFinite(atPerfMs))
      return;
    const cal = Number.isFinite(calibrationMs) ? calibrationMs : 0;
    live.touch = {
      start: sceneAtPerf(live.tb, atPerfMs - cal),
      end: sceneAtPerf(live.tb, atPerfMs + TAP_HOLD_MS),
      commitAt: null,
      state: null,
      ball: live.flight.samples,
    };
    live.script.practice!.bat = { ...live.script.practice!.bat, readyAt: null, touch: live.touch };
    this.latencyPending = atPerfMs;
  }

  beginSwing(atPerfMs: number, calibrationMs = 0): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || live.provisionalStart !== null || live.result) return;
    if (!Number.isFinite(atPerfMs)) return;
    live.provisionalStart = sceneAtPerf(live.tb, atPerfMs - (Number.isFinite(calibrationMs) ? calibrationMs : 0));
    const bat = live.script.practice!.bat;
    const touch = live.touch;
    const now = sceneAtPerf(live.tb, this.clock.now());
    // The commitment continues the touch-down stroke (a tap: the very same start). Only a bat already back at rest
    // (no touch, or a stroke that checked back: a held press, a pullback) starts afresh, so only then is CTL1's
    // latency measured again, from this commitment's own input.
    const fresh = !touch || touch.commitAt !== null || now >= touch.end + TOUCHDOWN.checkMs;
    if (touch && touch.commitAt === null)
      live.touch = { ...touch, commitAt: Math.max(now, touch.start), state: bat.contactState ?? null };
    live.script.practice!.bat = { ...bat, readyAt: null, provisionalStart: live.provisionalStart, touch: live.touch };
    if (fresh) this.latencyPending = atPerfMs;
  }

  cancelSwing(): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || live.result) return;
    live.provisionalStart = null;
    live.touch = this.checkBack(live);
    live.script.practice!.bat = {
      ...live.script.practice!.bat,
      readyAt: null,
      contactState: null,
      provisionalStart: null,
      touch: live.touch,
    };
    this.latencyPending = null;
  }

  previewContact(state: OneGestureState): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || live.result) return;
    const uncommittedEnd = (state.phase === 'cancelled' || state.phase === 'intentional_leave') && !state.committed;
    if (uncommittedEnd) {
      live.provisionalStart = null;
      live.touch = this.checkBack(live);
      live.script.practice!.bat = {
        ...live.script.practice!.bat,
        readyAt: null,
        contactState: null,
        provisionalStart: null,
        touch: live.touch,
      };
      this.latencyPending = null;
      return;
    }
    // A press that is no longer a tap (held past the window, or pulled back into a load): the stroke checks back.
    if (state.phase === 'waiting' || state.phase === 'loading' || state.phase === 'tracking')
      live.touch = this.checkBack(live);
    live.script.practice!.bat = {
      ...live.script.practice!.bat,
      readyAt: state.phase === 'ready' ? live.script.practice!.bat.readyAt : null,
      contactState: { ...state },
      touch: live.touch,
    };
  }

  /** An uncommitted touch-down stroke checks back from now (never later than it would anyway); a committed one stays. */
  private checkBack(live: LiveDelivery): TouchStroke | null {
    const t = live.touch;
    if (!t) return null;
    if (t.commitAt !== null) return live.provisionalStart === null ? null : t;
    const now = sceneAtPerf(live.tb, this.clock.now());
    return now < t.end ? { ...t, end: Math.max(t.start, now) } : t;
  }

  play(result: DeliveryResult): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before play'));
    // A result from the physics worker is a thawed copy: freeze its bat trace so the frames share one prepared track.
    freezeBatTrace(result.bat);
    this.endReplay();
    let live = this.live;
    const now = this.clock.now();
    if (!live || live.flight.seed !== result.flight.seed || live.result) {
      // No live delivery for this result: show it from its release now (no run-up wait).
      this.endLive();
      const releaseScene = practiceReleaseScene(setup.bowler);
      const tb: Timebase = {
        startPerfMs: now - releaseScene / this.timeScale,
        releaseScene,
        timeScale: this.timeScale,
      };
      live = {
        flight: result.flight,
        tb,
        script: null as unknown as BallScript,
        plan: [],
        provisionalStart: null,
        touch: null,
        result: null,
        resultAt: null,
        resolveRelease: null,
        releaseTimer: null,
        resolvePlay: null,
        playTimer: null,
        dead: false,
        fired: new Set(['release:' + Math.round(releaseScene)]),
        pending: new Map(),
      };
      this.live = live;
      this.mode = 'live';
    }
    const l = live;
    l.result = result;
    l.resultAt = sceneAtPerf(l.tb, now);
    // Recovery can synthesize a live container before it has a script; only a real in-flight script can carry input.
    const contactState = l.script?.practice?.bat.contactState ?? null;
    // The script on screen hands over to the result's: the camera keeps its eye and its gaze carries on (no jump).
    const handover = l.script?.practice ? { script: l.script, atScene: l.resultAt } : null;
    const liveScript = l.script ?? null;
    l.script = buildPracticeScript({
      setup,
      flight: l.flight,
      result,
      provisionalStart: l.provisionalStart,
      contactState,
      resultAt: l.provisionalStart !== null ? l.resultAt : null,
      handover,
      learnCue: this.learnCue,
      releaseHand: this.releaseHand(setup),
      context: this.deliveryContext,
    });
    // The touch-down stroke stays on the drawn bat: it hands over to the committed swing (or has checked back).
    if (l.touch) l.script.practice!.bat = { ...l.script.practice!.bat, touch: l.touch };
    l.tb.releaseScene = l.script.practice!.releaseScene;
    prewarmPracticeGaze(l.script, this.reducedMotion);
    l.plan = practicePlan(l.script, this.reducedMotion);
    this.onScript(l.script, 'result', handover ? liveScript : null);
    // What the flight alone predicted and has not happened yet is re-decided by the result (a bounce the bat beat).
    for (const [key, p] of l.pending) {
      if (!p.preResult) continue;
      this.clock.clearTimer(p.id);
      l.pending.delete(key);
      l.fired.delete(key);
    }
    const deadAt = simToPerf(l.tb, result.deadT);
    const promise = new Promise<void>((resolve) => {
      l.resolvePlay = resolve;
      // At dead ball, everything due by then fires first: what the dead ball wakes (the outcome screens) can hold the
      // main thread, and the wicket's haptic and caption must not wait behind it (+381 ms on 2026-11-03).
      l.playTimer = this.clock.setTimer(
        () => {
          if (l === this.live && this.mode === 'live') this.flushDue(l);
          this.settlePlay(l);
        },
        Math.max(0, deadAt - this.clock.now()),
      );
    });
    // The result's sounds go to the sink now, ahead of their time, not at the next frame.
    if (this.mode === 'live' && this.live === l) this.dispatch(l, this.clock.now());
    return promise;
  }

  /**
   * A Target Chase was decided by the live ball and its dead ball is shown (flow `presentChaseMoment`): the striker's and the
   * bowler's result clips are put into the script on screen, from now (never before the physics event that earns them or before
   * their own business is over: practice/resultMoments.ts). Presentation only and best effort: it never touches the ball, the
   * bat, the fielders or the result, and a stage with no live result ignores it. A replay of the ball takes the same moment
   * through `replay(..., { chaseMoment })` and starts it at the physics events.
   */
  presentChaseMoment(moment: ChaseMoment): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || !live.result || !live.script?.practice?.result) return;
    const now = sceneAtPerf(live.tb, this.clock.now());
    try {
      applyChaseMoment(live.script, moment, now + CHASE_MOMENT_LEAD_MS, this.reducedMotion);
    } catch {
      /* a moment never breaks a delivery: the scene stays as it was */
    }
  }

  private settlePlay(live: LiveDelivery) {
    if (live.playTimer !== null) this.clock.clearTimer(live.playTimer);
    live.playTimer = null;
    const wasLive = !live.dead;
    live.dead = true;
    const r = live.resolvePlay;
    live.resolvePlay = null;
    this.applyPending();
    if (wasLive && live === this.live) this.setQuiet(false);
    r?.();
  }

  /** Delivery Quiet Mode on or off: the event, the sink, and the subclass's own quiet (decorative motion). */
  private setQuiet(on: boolean) {
    if (this.quietOn === on) return;
    this.quietOn = on;
    this.onQuiet(on);
    try {
      this.activeSink()?.quiet?.(on);
    } catch {
      /* a sink never breaks the stage */
    }
    this.emit('quiet', { quiet: on });
  }
  /** Subclass hook: Delivery Quiet Mode began or ended. */
  protected onQuiet(_on: boolean): void {}
  quiet(): boolean {
    return this.quietOn;
  }

  /** Ends the live delivery: every promise settles and pending sounds are cancelled. */
  private endLive() {
    const live = this.live;
    if (!live) return;
    for (const p of live.pending.values()) this.clock.clearTimer(p.id);
    live.pending.clear();
    this.settleRelease(live);
    this.settlePlay(live);
    this.live = null;
    this.setQuiet(false);
    if (this.mode === 'live') this.mode = 'idle';
  }

  // ---- replay ----------------------------------------------------------------------------------------------------
  replay(result: DeliveryResult, options: ReplayOptions = {}): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before replay'));
    freezeBatTrace(result.bat);
    this.endLive();
    this.endReplay();
    this.applyPending();
    const script = buildPracticeScript({
      setup,
      flight: result.flight,
      result,
      releaseHand: this.releaseHand(setup),
      // The deciding ball of a chase (flow `chaseMoment` option): the striker's and the bowler's moments, from the physics events.
      ...(options.chaseMoment ? { chaseMoment: options.chaseMoment, reducedMotion: this.reducedMotion } : {}),
    });
    this.onScript(script, 'replay', null);
    const warp = replayWarp(script, options.speed ?? 0.3);
    const shot = replayShot(options.camera ?? 'side');
    if (shot === 'batter_eye') prewarmPracticeGaze(script, this.reducedMotion);
    const run: ReplayRun = {
      script,
      plan: [{ shot, atMs: 0, durationMs: script.duration }],
      startPerf: this.clock.now(),
      warp,
      diagnostics:
        options.diagnostics === false
          ? null
          : buildDiagnostics(result, script.practice!.releaseScene, script.practice!.mirror),
      bands: options.assist ? activeBands(options.assist, options.tierToleranceMs ?? 0) : null,
      resolve: null,
      timer: null,
      done: false,
      demo: null,
      closeUp: null,
    };
    this.rep = run;
    this.mode = 'replay';
    return new Promise((resolve) => {
      run.resolve = resolve;
      run.timer = this.clock.setTimer(() => this.finishReplay(run), warp.duration);
    });
  }

  /**
   * Coach Mode's demonstration: the exact delivery played with the ghost batter performing the option (the subclass
   * draws the ghost from frame.demo). Built like a replay: slow through the bat, then the ball into the field.
   */
  demonstrate(result: DeliveryResult, option: CoachOption): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before demonstrate'));
    freezeBatTrace(result.bat);
    this.endLive();
    this.endReplay();
    this.applyPending();
    // `result` is the option re-simulated by the engine on the exact delivery. Presentation changes its treatment,
    // never the script or outcome: the same striker track, footwork and physics bat are drawn as a ghost below.
    const script = buildPracticeScript({ setup, flight: result.flight, result, releaseHand: this.releaseHand(setup) });
    this.onScript(script, 'demo', null);
    const warp = replayWarp(script, DEMO_SPEED);
    const run: ReplayRun = {
      script,
      plan: [{ shot: 'demo_side', atMs: 0, durationMs: script.duration }],
      startPerf: this.clock.now(),
      warp,
      diagnostics: null,
      bands: null,
      resolve: null,
      timer: null,
      done: false,
      demo: { option },
      closeUp: null,
    };
    this.rep = run;
    this.mode = 'demo';
    return new Promise((resolve) => {
      run.resolve = resolve;
      run.timer = this.clock.setTimer(() => this.finishReplay(run), warp.duration);
    });
  }

  /** The training close-up of the ball (the subclass draws it from frame.closeUp). */
  closeUp(flight: BallFlight, options: CloseUpOptions = {}): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before closeUp'));
    this.endLive();
    this.endReplay();
    this.applyPending();
    const script = buildPracticeScript({ setup, flight, releaseHand: this.releaseHand(setup) });
    this.onScript(script, 'closeup', null);
    const durationMs = Math.max(800, options.durationMs ?? CLOSE_UP_MS);
    const release = script.practice!.releaseScene;
    const warp: ReplayWarp = {
      anchors: [
        [0, release - CLOSE_UP_LEAD_MS],
        [durationMs, release + (durationMs - CLOSE_UP_HOLD_MS) * CLOSE_UP_RATE],
      ],
      duration: durationMs,
      slow: [release - CLOSE_UP_LEAD_MS, release + durationMs],
    };
    const run: ReplayRun = {
      script,
      plan: [{ shot: 'ball_close', atMs: 0, durationMs: script.duration }],
      startPerf: this.clock.now(),
      warp,
      diagnostics: null,
      bands: null,
      resolve: null,
      timer: null,
      done: false,
      demo: null,
      closeUp: { flight },
    };
    this.rep = run;
    this.mode = 'closeup';
    return new Promise((resolve) => {
      run.resolve = resolve;
      run.timer = this.clock.setTimer(() => this.finishReplay(run), durationMs);
    });
  }

  private finishReplay(run: ReplayRun) {
    if (run.timer !== null) this.clock.clearTimer(run.timer);
    run.timer = null;
    run.done = true;
    // Replays deliberately hold their last frame for ReplayBar. Coach demonstrations and ball close-ups have no
    // transport: when their promise settles the normal between-ball scene must return, including removal of the
    // demonstration ghost. Check identity so a superseded run cannot clear the presentation that replaced it.
    if (this.rep === run && (this.mode === 'demo' || this.mode === 'closeup')) {
      this.rep = null;
      this.mode = 'idle';
    }
    const r = run.resolve;
    run.resolve = null;
    r?.();
  }

  private endReplay() {
    if (!this.rep) return;
    this.finishReplay(this.rep);
    this.rep = null;
    if (this.mode === 'replay' || this.mode === 'demo' || this.mode === 'closeup') this.mode = 'idle';
  }

  // ---- profiles --------------------------------------------------------------------------------------------------
  setProfile(profile: QualityProfileId): void {
    if (this.live && !this.live.dead) {
      // Never mid-delivery: it applies when this ball is dead (or the next one starts).
      this.pendingProfile = profile;
      return;
    }
    this.pendingProfile = null;
    if (profile === this.profileId) return;
    this.profileId = profile;
    this.applyProfile(profile);
  }
  private applyPending() {
    const p = this.pendingProfile;
    this.pendingProfile = null;
    if (p && p !== this.profileId) {
      this.profileId = p;
      this.applyProfile(p);
    }
  }

  // ---- stats -----------------------------------------------------------------------------------------------------
  stats(): PracticeStageStats {
    const s = frameStats(this.intervals, { warmup: 0 });
    return {
      fps: Math.round(s.avgFps * 10) / 10,
      avgFrameMs: s.frames ? Math.round((s.durationMs / s.frames) * 10) / 10 : 0,
      p95FrameMs: Math.round(s.p95FrameMs * 10) / 10,
      spikes: s.spikes,
      lastInputToBatMs: this.lastLatency === null ? null : Math.round(this.lastLatency * 10) / 10,
      renderer: this.rendererName(),
      profile: this.profileId,
      drawCalls: this.drawCalls(),
      contextLosses: this.contextLosses,
    };
  }

  /** Frame intervals since `from` (for the benchmark): the raw list, in order. */
  protected intervalsSince(count: number): number[] {
    return this.intervals.slice(Math.max(0, this.intervals.length - count));
  }

  // ---- frame loop ------------------------------------------------------------------------------------------------
  private benchScript: BallScript | null = null;
  private benchPlan: DirectorCue[] = [];
  private benchStart = 0;
  private benchFrames: number[] | null = null;

  /**
   * Plays the benchmark scene (the bowler running in, the field set, the batter's eye) and records every frame
   * interval: for `ms`, and at least until BENCH_MIN_MEASURED_FRAMES frames beyond the warm-up exist (capped at
   * BENCH_CAP_MS). Ends early, with what it has, if a delivery or replay takes over.
   */
  protected runBenchmarkScene(ms: number, script: BallScript): Promise<number[]> {
    this.endLive();
    this.endReplay();
    this.benchScript = script;
    this.benchPlan = practicePlan(script, this.reducedMotion);
    prewarmPracticeGaze(script, this.reducedMotion);
    this.onScript(script, 'bench', null);
    const start = this.clock.now();
    this.benchStart = start;
    this.benchFrames = [];
    this.mode = 'benchmark';
    this.startLoop();
    const frames = this.benchFrames;
    const want = PERF_WARMUP_FRAMES + BENCH_MIN_MEASURED_FRAMES;
    const cap = Math.max(BENCH_CAP_MS, ms);
    return new Promise((resolve) => {
      const check = () => {
        const elapsed = this.clock.now() - start;
        const interrupted = this.mode !== 'benchmark' || this.disposed;
        if (interrupted || (elapsed >= ms && frames.length >= want) || elapsed >= cap) {
          if (this.mode === 'benchmark') this.mode = 'idle';
          if (this.benchFrames === frames) this.benchFrames = null;
          resolve(frames);
          return;
        }
        this.clock.setTimer(check, elapsed < ms ? ms - elapsed : 50);
      };
      this.clock.setTimer(check, Math.max(0, ms));
    });
  }

  protected startLoop() {
    if (this.rafId !== null || this.disposed || !this.mounted) return;
    this.rafId = this.clock.raf(this.tick);
  }

  private tick = (now: number) => {
    this.rafId = null;
    if (this.disposed) return;
    if (this.lastFrame > 0) {
      const dt = now - this.lastFrame;
      this.intervals.push(dt);
      if (this.intervals.length > STATS_WINDOW) this.intervals.shift();
      this.benchFrames?.push(dt);
    }
    this.lastFrame = now;
    const tickStart = this.clock.now();
    // Nothing in a frame may stop the loop: timing, sound and promises keep running whatever one frame does.
    try {
      const frame = this.frameAt(now);
      if (frame) {
        this.drawFrame(frame);
        this.drawErrors = 0;
        this.afterDraw(frame);
        const spare = Math.min(IDLE_SLICE_MAX_MS, FRAME_BUDGET_MS - (this.clock.now() - tickStart));
        if (spare >= 1) {
          try {
            this.idleWork(frame, spare);
          } catch {
            /* optional work: a failure in it is not a drawing error */
          }
        }
      }
    } catch (err) {
      this.drawErrors++;
      if (this.drawErrors === 3)
        this.emit('fallback', { reason: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (!this.disposed) this.rafId = this.clock.raf(this.tick);
  };

  /** The frame for performance time `now` (and the delivery's sound and haptics up to the next frame). */
  protected frameAt(now: number): StageFrame | null {
    const live = this.live;
    if (this.mode === 'live' && live) {
      const scene = sceneAtPerf(live.tb, now);
      this.dispatch(live, now);
      this.activeSink()?.emotion?.(emotionAt(live.script.practice!.emotion, scene));
      this.activeSink()?.crowd(crowdAt(live.script, scene));
      return {
        mode: 'live',
        script: live.script,
        scene,
        plan: live.plan,
        clockMs: now,
        slow: false,
        diagnostics: null,
        bands: null,
        coachOption: null,
        closeUpFlight: null,
      };
    }
    const rep = this.rep;
    if ((this.mode === 'replay' || this.mode === 'demo' || this.mode === 'closeup') && rep) {
      const ms = Math.min(rep.warp.duration, now - rep.startPerf);
      const scene = warpScene(rep.warp, ms);
      // The stadium's own clock (crowd, boards) runs on replay time too, so a replay frame depends on nothing else.
      return {
        mode: this.mode,
        script: rep.script,
        scene,
        plan: rep.plan,
        clockMs: ms,
        slow: scene >= rep.warp.slow[0] && scene < rep.warp.slow[1],
        diagnostics: rep.diagnostics,
        bands: rep.bands,
        coachOption: rep.demo?.option ?? null,
        closeUpFlight: rep.closeUp?.flight ?? null,
      };
    }
    if (this.mode === 'benchmark' && this.benchScript) {
      const scene = ((now - this.benchStart) % Math.max(1, this.benchScript.duration)) * 1;
      return {
        mode: 'benchmark',
        script: this.benchScript,
        scene,
        plan: this.benchPlan,
        clockMs: now,
        slow: false,
        diagnostics: null,
        bands: null,
        coachOption: null,
        closeUpFlight: null,
      };
    }
    if (this.idleScript) {
      const scene = (now - this.idleStart) % Math.max(1, this.idleScript.duration);
      return {
        mode: 'idle',
        script: this.idleScript,
        scene,
        plan: this.idlePlan,
        clockMs: now,
        slow: false,
        diagnostics: null,
        bands: null,
        coachOption: null,
        closeUpFlight: null,
      };
    }
    return null;
  }

  private afterDraw(frame: StageFrame) {
    if (this.latencyPending === null || frame.mode !== 'live') return;
    const p = frame.script.practice;
    if (!p || !batMoved(p.bat, frame.scene)) return;
    this.lastLatency = this.clock.now() - this.latencyPending;
    this.latencyPending = null;
  }

  /** The lead (ms) a sound is handed to the sink ahead of its time: the live audio context's output latency. */
  protected soundLead(): number {
    return soundLeadMs();
  }

  /**
   * Cues of the live delivery: each fires once. A sound goes to the sink one output latency ahead of its time, with
   * that time, so it is heard on it (COH6); a moment fires on a timer at its own time.
   */
  private dispatch(live: LiveDelivery, now: number) {
    const sink = this.activeSink();
    const p = live.script.practice!;
    const list: FiredCue[] = [];
    for (const moment of p.emotion.moments) {
      list.push({
        key: `moment:${moment.kind}:${Math.round(moment.scene)}`,
        t: moment.scene,
        ahead: false,
        fire: () => sink?.moment?.(moment, perfAtScene(live.tb, moment.scene)),
      });
    }
    if (live.result) {
      for (const c of p.cues) {
        const key = `${c.scene?.kind ?? c.feel?.kind}:${Math.round(c.t)}`;
        list.push({
          key,
          t: c.t,
          ahead: true,
          ...(c.scene?.kind === 'bounce' ? { staleMs: BOUNCE_STALE_MS } : {}),
          fire: () => {
            const at = perfAtScene(live.tb, c.t);
            if (c.scene) sink?.cue(c.scene.kind, c.scene.intensity, 1, at);
            if (c.feel) sink?.feel?.(c.feel.kind, c.feel.intensity, c.feel.contact, c.feel.timing, at);
          },
        });
      }
    } else {
      // Before the result: the flight's own release and pitch. A pitch the swing might beat (COH4) is not handed over
      // ahead, and once a swing has begun it waits for the result, which decides whether the ball pitched at all.
      const contested = p.flight?.bounce ? PITCH_HALF - p.flight.bounce.p.z <= CONTESTED_BOUNCE_M : false;
      for (const e of live.script.events) {
        const hold = e.kind === 'bounce' && contested;
        if (hold && live.provisionalStart !== null) continue;
        const key = `${e.kind}:${Math.round(e.t)}`;
        list.push({
          key,
          t: e.t,
          ahead: !hold,
          fire: () => {
            if (hold && live.provisionalStart !== null && !live.result) {
              // A swing began after this was queued: the result decides.
              live.fired.delete(key);
              return;
            }
            sink?.cue(e.kind, e.intensity, 1, perfAtScene(live.tb, e.t));
          },
        });
      }
    }
    const last = this.intervals.length ? this.intervals[this.intervals.length - 1] : 16.7;
    const horizon = now + Math.min(40, Math.max(12, last * 1.5));
    const lead = this.soundLead();
    const clockNow = this.clock.now();
    for (const c of list) {
      if (live.fired.has(c.key)) continue;
      const due = perfAtScene(live.tb, c.t);
      if (due > horizon + (c.ahead ? lead : 0)) continue;
      live.fired.add(c.key);
      const wait = due - clockNow;
      if (c.staleMs !== undefined && -wait > c.staleMs) continue;
      if (c.ahead || wait <= 0.5) c.fire();
      else {
        const pending: PendingCue = { id: null, due, fire: c.fire, preResult: !live.result };
        pending.id = this.clock.setTimer(() => {
          live.pending.delete(c.key);
          c.fire();
        }, wait);
        live.pending.set(c.key, pending);
      }
    }
  }

  /** Fires, now, every cue of the live delivery that is due (the dead ball's own moment among them). */
  private flushDue(live: LiveDelivery) {
    const now = this.clock.now();
    this.dispatch(live, now);
    for (const [key, p] of live.pending) {
      if (p.due > now + 1) continue;
      this.clock.clearTimer(p.id);
      live.pending.delete(key);
      p.fire();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.mounted = false;
    this.endLive();
    this.endReplay();
    if (this.rafId !== null) this.clock.caf(this.rafId);
    this.rafId = null;
    if (this.lostTimer !== null) this.clock.clearTimer(this.lostTimer);
    this.listeners.clear();
    this.ownSink?.dispose();
    this.ownSink = null;
  }
}
