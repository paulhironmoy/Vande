/**
 * The Practice stage's session, shared by the 3D and the Classic 2D stage (subclasses only draw a frame): the
 * delivery's timebase, the release, swing, play and replay promises, feedback timing, profiles, stats and events.
 *
 * Timing never depends on frames. A delivery's timebase maps simulation time to performance.now(); every frame
 * draws the simulation at its own timestamp, and every sound and haptic is scheduled for its event's exact
 * performance time (a timer inside the frame it falls in), not "the next frame". Promises resolve on timers, so
 * they keep time even when no frame is drawn (a lost context, a background tab).
 */
import type { BallFlight, DeliveryResult, QualityProfileId, TimingBands, Vec3 } from '@/contracts/practice';
import { activeBands } from '@/physics/timing';
import { frameStats, PERF_WARMUP_FRAMES } from '@/perf';
import { practicePlan, replayShot, type DirectorCue } from '../core/camera';
import { type BallScript, crowdAt } from '../core/choreo';
import { batMoved } from './bat';
import { buildDiagnostics, type Diagnostics } from './diagnostics';
import { perfAtScene, perfToSim, releasePerf, sceneAtPerf, simToPerf, simToScene, type Timebase } from './frame';
import { buildPracticeScript, practiceReleaseScene } from './script';
import { createPracticeAudio, type PracticeAudio } from './audio';
import type {
  PracticeBenchmarkRun,
  PracticeEventPayloads,
  PracticeMountOptions,
  PracticeSceneSetup,
  PracticeSink,
  PracticeStage,
  PracticeStageEvent,
  PracticeStageStats,
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
  raf: (cb) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(cb) : (setTimeout(() => cb(defaultStageClock.now()), 16) as unknown as number)),
  caf: (id) => (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id)),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export type StageMode = 'idle' | 'live' | 'replay' | 'benchmark';

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
}

/** Frame intervals kept for stats(). */
const STATS_WINDOW = 120;
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
  const end = Math.min(script.duration, contact + Math.min(REPLAY.afterMaxMs, Math.max(REPLAY.afterMinMs, dead + 400 - contact)));
  const s0 = Math.max(start, release - REPLAY.slowBeforeMs);
  const s1 = Math.min(end, contact + REPLAY.slowAfterMs);
  const k = Math.min(1, Math.max(0.05, speed));
  const a1 = s0 - start;
  const a2 = a1 + (s1 - s0) / k;
  const a3 = a2 + (end - s1);
  return { anchors: [[0, start], [a1, s0], [a2, s1], [a3, end]], duration: a3, slow: [s0, s1] };
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
  t: number;
  fire: () => void;
}

interface LiveDelivery {
  flight: BallFlight;
  tb: Timebase;
  script: BallScript;
  plan: DirectorCue[];
  provisionalStart: number | null;
  result: DeliveryResult | null;
  resultAt: number | null;
  resolveRelease: ((v: { releasePerfMs: number }) => void) | null;
  releaseTimer: unknown;
  resolvePlay: (() => void) | null;
  playTimer: unknown;
  dead: boolean;
  fired: Set<string>;
  timers: unknown[];
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
}

export abstract class PracticeSessionBase implements PracticeStage {
  abstract readonly kind: '3d' | '2d';
  protected clock: StageClock;
  protected options: PracticeMountOptions = { profile: 'standard', handedness: 'right', reducedMotion: false, learnCue: false };
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

  constructor(clock: StageClock = defaultStageClock) {
    this.clock = clock;
  }

  // ---- subclass hooks --------------------------------------------------------------------------------------------
  protected abstract drawFrame(frame: StageFrame): void;
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
    this.idleStart = this.clock.now();
  }

  setSink(sink: PracticeSink | null): void {
    this.sink = sink;
  }
  setReducedMotion(on: boolean): void {
    this.reducedMotion = on;
    if (this.idleScript) this.idlePlan = practicePlan(this.idleScript, on);
  }
  setLearnCue(on: boolean): void {
    this.learnCue = on;
  }
  setTimeScale(k: number): void {
    if (Number.isFinite(k) && k > 0) this.timeScale = k;
  }

  private activeSink(): PracticeSink | null {
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
  bowl(flight: BallFlight): Promise<{ releasePerfMs: number }> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before bowl'));
    this.endLive();
    this.endReplay();
    this.applyPending();
    const now = this.clock.now();
    const tb: Timebase = { startPerfMs: now, releaseScene: practiceReleaseScene(setup.bowler), timeScale: this.timeScale };
    const script = buildPracticeScript({ setup, flight, learnCue: this.learnCue, releaseHand: this.releaseHand(setup) });
    tb.releaseScene = script.practice!.releaseScene;
    const live: LiveDelivery = {
      flight,
      tb,
      script,
      plan: practicePlan(script, this.reducedMotion),
      provisionalStart: null,
      result: null,
      resultAt: null,
      resolveRelease: null,
      releaseTimer: null,
      resolvePlay: null,
      playTimer: null,
      dead: false,
      fired: new Set(),
      timers: [],
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

  beginSwing(atPerfMs: number, calibrationMs = 0): void {
    const live = this.live;
    if (this.mode !== 'live' || !live || live.provisionalStart !== null || live.result) return;
    if (!Number.isFinite(atPerfMs)) return;
    live.provisionalStart = sceneAtPerf(live.tb, atPerfMs - (Number.isFinite(calibrationMs) ? calibrationMs : 0));
    live.script.practice!.bat = { ...live.script.practice!.bat, provisionalStart: live.provisionalStart };
    this.latencyPending = atPerfMs;
  }

  play(result: DeliveryResult): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before play'));
    this.endReplay();
    let live = this.live;
    const now = this.clock.now();
    if (!live || live.flight.seed !== result.flight.seed || live.result) {
      // No live delivery for this result: show it from its release now (no run-up wait).
      this.endLive();
      const releaseScene = practiceReleaseScene(setup.bowler);
      const tb: Timebase = { startPerfMs: now - releaseScene / this.timeScale, releaseScene, timeScale: this.timeScale };
      live = { flight: result.flight, tb, script: null as unknown as BallScript, plan: [], provisionalStart: null, result: null, resultAt: null, resolveRelease: null, releaseTimer: null, resolvePlay: null, playTimer: null, dead: false, fired: new Set(['release:' + Math.round(releaseScene)]), timers: [] };
      this.live = live;
      this.mode = 'live';
    }
    const l = live;
    l.result = result;
    l.resultAt = sceneAtPerf(l.tb, now);
    l.script = buildPracticeScript({ setup, flight: l.flight, result, provisionalStart: l.provisionalStart, resultAt: l.provisionalStart !== null ? l.resultAt : null, learnCue: this.learnCue, releaseHand: this.releaseHand(setup) });
    l.tb.releaseScene = l.script.practice!.releaseScene;
    l.plan = practicePlan(l.script, this.reducedMotion);
    const deadAt = simToPerf(l.tb, result.deadT);
    return new Promise((resolve) => {
      l.resolvePlay = resolve;
      l.playTimer = this.clock.setTimer(() => this.settlePlay(l), Math.max(0, deadAt - this.clock.now()));
    });
  }

  private settlePlay(live: LiveDelivery) {
    if (live.playTimer !== null) this.clock.clearTimer(live.playTimer);
    live.playTimer = null;
    live.dead = true;
    const r = live.resolvePlay;
    live.resolvePlay = null;
    this.applyPending();
    r?.();
  }

  /** Ends the live delivery: every promise settles and pending sounds are cancelled. */
  private endLive() {
    const live = this.live;
    if (!live) return;
    for (const t of live.timers) this.clock.clearTimer(t);
    live.timers = [];
    this.settleRelease(live);
    this.settlePlay(live);
    this.live = null;
    if (this.mode === 'live') this.mode = 'idle';
  }

  // ---- replay ----------------------------------------------------------------------------------------------------
  replay(result: DeliveryResult, options: ReplayOptions = {}): Promise<void> {
    const setup = this.setup;
    if (!setup) return Promise.reject(new Error('setScene must be called before replay'));
    this.endLive();
    this.endReplay();
    this.applyPending();
    const script = buildPracticeScript({ setup, flight: result.flight, result, releaseHand: this.releaseHand(setup) });
    const warp = replayWarp(script, options.speed ?? 0.3);
    const shot = replayShot(options.camera ?? 'side');
    const run: ReplayRun = {
      script,
      plan: [{ shot, atMs: 0, durationMs: script.duration }],
      startPerf: this.clock.now(),
      warp,
      diagnostics: options.diagnostics === false ? null : buildDiagnostics(result, script.practice!.releaseScene, script.practice!.mirror),
      bands: options.assist ? activeBands(options.assist, options.tierToleranceMs ?? 0) : null,
      resolve: null,
      timer: null,
      done: false,
    };
    this.rep = run;
    this.mode = 'replay';
    return new Promise((resolve) => {
      run.resolve = resolve;
      run.timer = this.clock.setTimer(() => this.finishReplay(run), warp.duration);
    });
  }

  private finishReplay(run: ReplayRun) {
    if (run.timer !== null) this.clock.clearTimer(run.timer);
    run.timer = null;
    run.done = true;
    const r = run.resolve;
    run.resolve = null;
    r?.();
  }

  private endReplay() {
    if (!this.rep) return;
    this.finishReplay(this.rep);
    this.rep = null;
    if (this.mode === 'replay') this.mode = 'idle';
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
    // Nothing in a frame may stop the loop: timing, sound and promises keep running whatever one frame does.
    try {
      const frame = this.frameAt(now);
      if (frame) {
        this.drawFrame(frame);
        this.drawErrors = 0;
        this.afterDraw(frame);
      }
    } catch (err) {
      this.drawErrors++;
      if (this.drawErrors === 3) this.emit('fallback', { reason: 'error', message: err instanceof Error ? err.message : String(err) });
    }
    if (!this.disposed) this.rafId = this.clock.raf(this.tick);
  };

  /** The frame for performance time `now` (and the delivery's sound and haptics up to the next frame). */
  protected frameAt(now: number): StageFrame | null {
    const live = this.live;
    if (this.mode === 'live' && live) {
      const scene = sceneAtPerf(live.tb, now);
      this.dispatch(live, now);
      this.activeSink()?.crowd(crowdAt(live.script, scene));
      return { mode: 'live', script: live.script, scene, plan: live.plan, clockMs: now, slow: false, diagnostics: null, bands: null };
    }
    const rep = this.rep;
    if (this.mode === 'replay' && rep) {
      const ms = Math.min(rep.warp.duration, now - rep.startPerf);
      const scene = warpScene(rep.warp, ms);
      // The stadium's own clock (crowd, boards) runs on replay time too, so a replay frame depends on nothing else.
      return { mode: 'replay', script: rep.script, scene, plan: rep.plan, clockMs: ms, slow: scene >= rep.warp.slow[0] && scene < rep.warp.slow[1], diagnostics: rep.diagnostics, bands: rep.bands };
    }
    if (this.mode === 'benchmark' && this.benchScript) {
      const scene = ((now - this.benchStart) % Math.max(1, this.benchScript.duration)) * 1;
      return { mode: 'benchmark', script: this.benchScript, scene, plan: this.benchPlan, clockMs: now, slow: false, diagnostics: null, bands: null };
    }
    if (this.idleScript) {
      const scene = (now - this.idleStart) % Math.max(1, this.idleScript.duration);
      return { mode: 'idle', script: this.idleScript, scene, plan: this.idlePlan, clockMs: now, slow: false, diagnostics: null, bands: null };
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

  /** Cues of the live delivery: each fires once, at its own performance time. */
  private dispatch(live: LiveDelivery, now: number) {
    const sink = this.activeSink();
    const p = live.script.practice!;
    const list: FiredCue[] = [];
    if (live.result) {
      for (const c of p.cues) {
        const key = `${c.scene?.kind ?? c.feel?.kind}:${Math.round(c.t)}`;
        list.push({
          key,
          t: c.t,
          fire: () => {
            if (c.scene) sink?.cue(c.scene.kind, c.scene.intensity, 1);
            if (c.feel) sink?.feel?.(c.feel.kind, c.feel.intensity);
          },
        });
      }
    } else {
      for (const e of live.script.events) list.push({ key: `${e.kind}:${Math.round(e.t)}`, t: e.t, fire: () => sink?.cue(e.kind, e.intensity, 1) });
    }
    const last = this.intervals.length ? this.intervals[this.intervals.length - 1] : 16.7;
    const horizon = now + Math.min(40, Math.max(12, last * 1.5));
    for (const c of list) {
      if (live.fired.has(c.key)) continue;
      const due = perfAtScene(live.tb, c.t);
      if (due > horizon) continue;
      live.fired.add(c.key);
      const wait = due - this.clock.now();
      if (wait <= 0.5) c.fire();
      else live.timers.push(this.clock.setTimer(c.fire, wait));
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
