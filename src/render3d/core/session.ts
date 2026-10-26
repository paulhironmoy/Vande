/**
 * Playback session shared by the 3D renderer and the 2D fallback: replay clock (play, pause, seek, speed),
 * live batting state, contract events and timed presentation cues. Subclasses only draw a frame.
 * The wall clock is used only while playing or batting live; renderAt never reads it.
 */
import type {
  Conditions,
  FieldSetting,
  KitSpec,
  LiveBallHandle,
  MatchEventLog,
  PlayerRef,
  RenderQuality,
  RendererOptions,
  RendererStats,
  ReplayMode,
  RevealedDelivery,
  RendererEvents,
} from '@/contracts';
import type { PresentationSink, StageRenderer } from '../types';
import type { Look } from './actors';
import { type BallScript, type Cast, type LiveShot, buildAmbientScript, buildLiveScript } from './choreo';
import { hash32 } from './math';
import { type Segment, type Timeline, completeTimeline, locate, replayTimeline } from './timeline';
import { FRAME_BUDGET_MS, QualityController, autoQuality, shouldRender } from './quality';
import { PERF_SPIKE_MS, loadCachedAssessment } from '@/perf';
import { KITS } from '@/ui/avatar/traits';
import { runUpMs } from './engineBridge';
import { actionForFamily } from './choreo';

export interface DrawInput {
  script: BallScript;
  scene: number;
  segment: Segment | null;
  timelineMs: number;
  slow: boolean;
  live: boolean;
  conditions: Conditions;
  kits: [KitSpec, KitSpec];
}

export interface Clock {
  now(): number;
  raf(cb: (t: number) => void): number;
  caf(id: number): void;
}

const defaultClock: Clock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  raf: (cb) => (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(cb) : (setTimeout(() => cb(defaultClock.now()), 16) as unknown as number)),
  caf: (id) => (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame(id) : clearTimeout(id)),
};

type EventName = keyof RendererEvents;

interface LiveState {
  script: BallScript;
  start: number;
  delivery: RevealedDelivery | null;
  resolveRelease: ((t: number) => void) | null;
  released: boolean;
  /** Settles every showShot promise of this ball (a later showShot chains onto earlier ones, never drops them). */
  shotDone: (() => void) | null;
  shotDoneAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** Settles the shot on time even when no frames run (background tab, lost context, a stalled loop). */
  shotTimer: ReturnType<typeof setTimeout> | null;
}

/** How long after its scheduled end a shot settles without frames. */
const SHOT_SETTLE_GRACE_MS = 250;

export interface LiveSetup {
  conditions: Conditions;
  field: FieldSetting;
  batter: PlayerRef;
  bowler: PlayerRef;
}

export function liveCast(batter: PlayerRef, bowler: PlayerRef): Cast {
  const look = (p: PlayerRef, team: 0 | 1, slot: string, gear: Look['gear'], hero = false): Look => ({ seed: hero ? p.avatar.seed : `${p.id}:${slot}`, team, gear, hero });
  return {
    striker: look(batter, 0, 'b0', 'batter', true),
    nonStriker: look(batter, 0, 'b1', 'batter'),
    bowler: look(bowler, 1, 'bowler', 'bowler', true),
    keeper: look(bowler, 1, 'keeper', 'keeper'),
    fielders: Array.from({ length: 9 }, (_, i) => look(bowler, 1, `f${i}`, 'fielder')),
    umpires: [
      { seed: `umpire:${bowler.id}:0`, team: 0, gear: 'umpire' },
      { seed: `umpire:${bowler.id}:1`, team: 0, gear: 'umpire' },
    ],
  };
}

export abstract class SessionBase implements StageRenderer {
  abstract readonly kind: '3d' | '2d';
  protected options: RendererOptions = { quality: 'auto', reducedMotion: false, fps: 60 };
  protected reducedMotion = false;
  protected qc = new QualityController({ initial: 'standard', adaptive: false });
  protected clock: Clock;
  protected mounted = false;
  protected disposed = false;

  private listeners = new Map<EventName, Set<(p: unknown) => void>>();
  private frameListeners = new Set<(ms: number) => void>();
  private sink: PresentationSink | null = null;
  private rafId: number | null = null;
  private lastFrame = 0;
  private lastRender = 0;

  // Replay
  protected tl: Timeline | null = null;
  private t = 0;
  private playing = false;
  private speed = 1;
  private lastSegIndex = -1;
  private cueCursor: { seg: number; scene: number } | null = null;

  // Live
  protected mode: 'idle' | 'live' | 'replay' = 'idle';
  protected conditions: Conditions = { pitch: 'hard', weather: 'clear' };
  protected kits: [KitSpec, KitSpec] = [KITS[0], KITS[1]];
  private liveSetup: LiveSetup | null = null;
  private live: LiveState | null = null;
  private ambient: BallScript | null = null;
  private liveCueCursor = 0;

  constructor(clock: Clock = defaultClock) {
    this.clock = clock;
  }

  // ---- subclass hooks ------------------------------------------------------------------------------------------
  protected abstract draw(input: DrawInput): void;
  protected abstract applyQuality(q: RenderQuality): void;
  protected abstract drawCalls(): number;
  abstract mount(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void>;

  protected initSession(options: RendererOptions) {
    this.options = options;
    this.reducedMotion = options.reducedMotion;
    const offline = Boolean(options.offline);
    const initial: RenderQuality = options.quality === 'auto' ? this.estimate() : options.quality;
    this.qc = new QualityController({
      initial: options.fps === 30 && initial !== 'low' ? 'low' : initial,
      adaptive: options.quality === 'auto' && !offline,
      onChange: (q) => this.applyQuality(q),
    });
    this.mounted = true;
  }

  /**
   * Below 'low': first render fewer pixels (adaptive resolution), and only if even that cannot hold ~16 fps tell
   * the app to switch to the 2D view.
   */
  private slowFrames = 0;
  private verySlowFrames = 0;
  private checkLowFps(interval: number) {
    if (!this.qc.adaptive || this.qc.quality !== 'low' || this.kind === '2d') return;
    // Over the 30 fps budget: shed resolution. Every frame a visible hitch (src/perf's spike): the 2D view.
    this.slowFrames = interval > FRAME_BUDGET_MS[30] ? this.slowFrames + 1 : Math.max(0, this.slowFrames - 2);
    this.verySlowFrames = interval > PERF_SPIKE_MS ? this.verySlowFrames + 1 : Math.max(0, this.verySlowFrames - 2);
    if (this.slowFrames >= 60) {
      this.slowFrames = 0;
      if (this.reduceResolution()) this.verySlowFrames = 0;
    }
    if (this.verySlowFrames >= 100) {
      this.verySlowFrames = 0;
      if (!this.reduceResolution()) this.emit('fallback', { reason: 'low_fps', fps: this.qc.fps });
    }
  }
  /** Lower the render resolution one step; false when already at the floor (3D renderer overrides). */
  protected reduceResolution(): boolean {
    return false;
  }

  /** 'auto': the device assessment src/perf measured for this app version, else what the GPU probe says. */
  protected estimate(): RenderQuality {
    let assessment = null;
    try {
      assessment = loadCachedAssessment(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '');
    } catch {
      assessment = null;
    }
    return autoQuality(assessment, this.gpuName());
  }
  protected gpuName(): string {
    return '';
  }

  // ---- contract: events ----------------------------------------------------------------------------------------
  on<E extends keyof RendererEvents>(event: E, cb: (payload: RendererEvents[E]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const listener = cb as (payload: unknown) => void;
    set.add(listener);
    return () => set!.delete(listener);
  }
  protected emit<E extends EventName>(event: E, payload: RendererEvents[E]) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch {
        /* listener errors never break rendering */
      }
    });
  }
  onFrame(cb: (ms: number) => void): () => void {
    this.frameListeners.add(cb);
    return () => this.frameListeners.delete(cb);
  }
  setSink(sink: PresentationSink | null) {
    this.sink = sink;
  }

  // ---- contract: live batting ----------------------------------------------------------------------------------
  async prepareInnings(setup: LiveSetup): Promise<void> {
    this.stopLive();
    this.mode = 'live';
    this.liveSetup = setup;
    this.conditions = setup.conditions;
    this.kits = [setup.batter.kit, setup.bowler.kit];
    this.onSetup();
    this.ambient = buildAmbientScript(setup.field, liveCast(setup.batter, setup.bowler), 'pace', 60_000, hash32(setup.bowler.id), 'live');
    this.live = null;
    this.startLoop();
  }

  bowl(delivery: RevealedDelivery): LiveBallHandle {
    if (!this.liveSetup) throw new Error('prepareInnings must be called before bowl');
    this.stopLive();
    const setup = this.liveSetup;
    const seed = hash32(`${setup.bowler.id}:${setup.batter.id}:${delivery.ball}`);
    const releaseAt = runUpMs(actionForFamily(delivery.family, delivery.variant, delivery.intensity));
    const script = buildLiveScript({ delivery, field: setup.field, cast: liveCast(setup.batter, setup.bowler), seed, releaseAt, pitch: setup.conditions.pitch });
    const start = this.clock.now();
    let resolveRelease: (t: number) => void = () => undefined;
    const released = new Promise<number>((r) => {
      resolveRelease = r;
    });
    const state: LiveState = { script, start, delivery, resolveRelease, released: false, shotDone: null, shotDoneAt: 0, timer: null, shotTimer: null };
    // Resolve on time even if frames are throttled (background tab, slow device).
    state.timer = setTimeout(() => this.releaseLive(state), Math.max(0, script.times.release));
    this.live = state;
    this.liveCueCursor = -1;
    this.mode = 'live';
    this.startLoop();
    return {
      released,
      showShot: (anim) => {
        const extra = anim as typeof anim & { zone?: LiveShot['zone']; tapMs?: number | null };
        const shot: LiveShot = { shot: anim.shot, timing: anim.timing, contact: anim.contact, zone: extra.zone ?? null, tapMs: extra.tapMs ?? null };
        if (this.live !== state) return Promise.resolve();
        state.script = buildLiveScript({ delivery, field: setup.field, cast: liveCast(setup.batter, setup.bowler), seed, shot, releaseAt, pitch: setup.conditions.pitch });
        return new Promise<void>((resolve) => {
          // A second call (the real contact replacing a prediction) re-aims the animation; every earlier caller is
          // still waiting on its own promise, so its resolver is kept and settled together with this one.
          const prev = state.shotDone;
          state.shotDone = () => {
            prev?.();
            resolve();
          };
          state.shotDoneAt = (state.script.sealAt ?? state.script.duration) + 650;
          if (state.shotTimer) clearTimeout(state.shotTimer);
          const due = state.start + state.shotDoneAt - this.clock.now();
          state.shotTimer = setTimeout(() => this.settleShot(state), Math.max(0, due) + SHOT_SETTLE_GRACE_MS);
        });
      },
    };
  }

  private releaseLive(state: LiveState) {
    if (state.released) return;
    state.released = true;
    state.resolveRelease?.(state.start + state.script.times.release);
    this.emit('ball', { live: true, ball: state.delivery?.ball ?? 0 });
  }

  /** Settles every pending showShot promise of a ball (its animation finished, or it will never be drawn). */
  private settleShot(state: LiveState) {
    if (state.shotTimer) clearTimeout(state.shotTimer);
    state.shotTimer = null;
    const done = state.shotDone;
    state.shotDone = null;
    done?.();
  }

  /** The canvas can no longer show the ball (e.g. a lost WebGL context): nobody may wait on its animation. */
  protected settlePendingShot() {
    if (this.live) this.settleShot(this.live);
  }

  private stopLive() {
    if (this.live?.timer) clearTimeout(this.live.timer);
    if (this.live && !this.live.released) this.releaseLive(this.live);
    if (this.live) this.settleShot(this.live);
    this.live = null;
  }

  protected onSetup(): void {}

  // ---- contract: replay ----------------------------------------------------------------------------------------
  async loadReplay(log: MatchEventLog, mode: ReplayMode): Promise<{ durationMs: number }> {
    this.stopLive();
    this.mode = 'replay';
    this.conditions = log.conditions;
    this.kits = [log.players[0].kit, log.players[1].kit];
    this.onSetup();
    // The reveal screen's own timeline object (built progressively), so their times agree.
    this.tl = replayTimeline(log, mode);
    this.t = 0;
    this.playing = false;
    this.lastSegIndex = -1;
    this.cueCursor = null;
    this.renderTimeline(false);
    return { durationMs: this.tl.duration };
  }

  play(speed = 1) {
    if (!this.tl) return;
    this.speed = Math.max(0.05, Math.min(4, speed));
    if (this.t >= this.tl.duration - 1) this.t = 0;
    this.playing = true;
    this.cueCursor = null;
    this.startLoop();
  }
  pause() {
    this.playing = false;
  }
  seek(ms: number) {
    if (!this.tl) return;
    completeTimeline(this.tl);
    this.t = Math.max(0, Math.min(ms, this.tl.duration));
    this.cueCursor = null;
    this.renderTimeline(false);
  }
  renderAt(ms: number) {
    if (!this.tl) return;
    completeTimeline(this.tl);
    this.t = Math.max(0, Math.min(ms, this.tl.duration));
    this.cueCursor = null;
    this.renderTimeline(false);
  }
  currentTime(): number {
    if (this.mode === 'live' && this.live) return this.clock.now() - this.live.start;
    return this.t;
  }
  isPlaying(): boolean {
    return this.playing;
  }
  /** The whole timeline, every ball built (highlights and tools read every segment). */
  timeline(): Timeline | null {
    if (this.tl) completeTimeline(this.tl);
    return this.tl;
  }
  quality(): RenderQuality {
    return this.qc.quality;
  }

  setQuality(quality: RenderQuality) {
    this.qc.set(quality);
  }
  setReducedMotion(on: boolean) {
    // The timeline does not change (ball scripts do not depend on it): only the cameras do, as they are drawn.
    this.reducedMotion = on;
    if (!this.playing) this.renderTimeline(false);
  }

  stats(): RendererStats {
    return { fps: Math.round(this.qc.fps * 10) / 10, frameMs: Math.round(this.qc.frameMs * 10) / 10, drawCalls: this.drawCalls(), quality: this.qc.quality };
  }

  dispose() {
    this.disposed = true;
    this.mounted = false;
    this.stopLive();
    if (this.rafId !== null) this.clock.caf(this.rafId);
    this.rafId = null;
    this.listeners.clear();
    this.frameListeners.clear();
  }

  // ---- frame loop ------------------------------------------------------------------------------------------------
  protected startLoop() {
    if (this.rafId !== null || this.disposed || !this.mounted) return;
    this.lastFrame = this.clock.now();
    const tick = (now: number) => {
      this.rafId = null;
      if (this.disposed) return;
      const dt = now - this.lastFrame;
      this.lastFrame = now;
      const keepGoing = this.step(now, dt);
      if (keepGoing) this.rafId = this.clock.raf(tick);
    };
    this.rafId = this.clock.raf(tick);
  }

  /** One wall-clock tick. Returns whether the loop should continue. */
  private step(now: number, dt: number): boolean {
    if (this.mode === 'replay') {
      if (!this.playing || !this.tl) return false;
      const next = this.t + dt * this.speed;
      // A provisional end (balls still building) is not the end.
      if (next >= this.tl.duration) completeTimeline(this.tl);
      this.t = Math.min(this.tl.duration, next);
      if (shouldRender(now, this.lastRender, this.qc.preset.maxFps)) {
        this.qc.sample(now - this.lastRender);
        this.checkLowFps(now - this.lastRender);
        this.lastRender = now;
        this.renderTimeline(true);
      }
      if (this.t >= this.tl.duration) {
        this.playing = false;
        this.emit('end', { durationMs: this.tl.duration });
        return false;
      }
      return true;
    }
    if (this.mode === 'live') {
      if (shouldRender(now, this.lastRender, this.qc.preset.maxFps)) {
        this.qc.sample(now - this.lastRender);
        this.checkLowFps(now - this.lastRender);
        this.lastRender = now;
        this.renderLive(now);
      }
      return true;
    }
    return false;
  }

  private renderTimeline(dispatch: boolean) {
    const tl = this.tl;
    if (!tl || !this.mounted) return;
    const at = locate(tl, this.t);
    if (at.index !== this.lastSegIndex) {
      this.lastSegIndex = at.index;
      const seg = at.seg;
      if (seg.kind === 'ball' && seg.ballOrdinal !== null && seg.innings !== null && seg.ball !== null) {
        this.emit('ball', { ordinal: seg.ballOrdinal, eventIndex: seg.eventIndex, innings: seg.innings, ball: seg.ball, key: seg.key });
      }
    }
    if (dispatch && this.sink) {
      const prev = this.cueCursor && this.cueCursor.seg === at.index ? this.cueCursor.scene : at.seg.sceneStart - 1;
      for (const e of at.seg.script.events) if (e.t > prev && e.t <= at.scene) this.sink.cue(e.kind, e.intensity, at.slow ? this.speed * (at.seg.slow?.rate ?? 1) : this.speed);
      this.sink.crowd(this.crowdLevel(at.seg.script, at.scene));
    }
    this.cueCursor = { seg: at.index, scene: at.scene };
    this.safeDraw({ script: at.seg.script, scene: at.scene, segment: at.seg, timelineMs: this.t, slow: at.slow, live: false, conditions: this.conditions, kits: this.kits });
    this.frameListeners.forEach((cb) => cb(this.t));
  }

  private renderLive(now: number) {
    const live = this.live;
    if (live) {
      const scene = now - live.start;
      if (!live.released && scene >= live.script.times.release) this.releaseLive(live);
      if (this.sink) {
        for (const e of live.script.events) if (e.t > this.liveCueCursor && e.t <= scene) this.sink.cue(e.kind, e.intensity, 1);
        this.sink.crowd(this.crowdLevel(live.script, scene));
      }
      this.liveCueCursor = scene;
      if (live.shotDone && scene >= live.shotDoneAt) this.settleShot(live);
      const t = Math.min(scene, live.script.duration);
      this.safeDraw({ script: live.script, scene: t, segment: null, timelineMs: scene, slow: false, live: true, conditions: this.conditions, kits: this.kits });
      this.frameListeners.forEach((cb) => cb(scene));
      return;
    }
    if (this.ambient) {
      const t = (now % 60_000) + 0;
      this.safeDraw({ script: this.ambient, scene: t, segment: null, timelineMs: t, slow: false, live: true, conditions: this.conditions, kits: this.kits });
    }
  }

  private crowdLevel(script: BallScript, t: number): number {
    const keys = script.crowd;
    let v = keys.length ? keys[0][1] : 0.35;
    for (const [kt, kv] of keys) if (kt <= t) v = kv;
    return v;
  }

  private drawErrors = 0;
  private safeDraw(input: DrawInput) {
    try {
      this.draw(input);
      this.drawErrors = 0;
    } catch (err) {
      this.drawErrors++;
      if (this.drawErrors === 3) this.emit('fallback', { reason: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}
