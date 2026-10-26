/**
 * The boundary between the React app and the 3D match renderer — ROOT-OWNED interface, implemented by the
 * experience workstream in src/render3d. The same renderer powers live batting, in-app replay, Key Moments, and
 * offline highlight rendering (deterministic frame stepping with renderAt).
 */
import type { BallOutcome, MatchEventLog, PlayerRef, RevealedDelivery, FieldSetting, FieldZone, Conditions } from './cricket';

export type RenderQuality = 'low' | 'standard' | 'high';

export interface RendererOptions {
  quality: RenderQuality | 'auto';
  reducedMotion: boolean;
  /** Target frame rate: 30 (low mode) or 60. */
  fps: 30 | 60;
  /** Offline video rendering: fixed size, no wall clock, no adaptive quality. */
  offline?: { width: number; height: number };
}

export type ReplayMode = 'full' | 'key_moments' | 'result_only';

export interface LiveBallHandle {
  /** Resolves with the release time (performance.now()) once the ball leaves the bowler's hand. */
  released: Promise<number>;
  /** Show the batter's chosen shot animation and contact quality (no runs or wickets: those stay sealed). */
  showShot(anim: {
    shot: BallOutcome['shot'];
    timing: BallOutcome['timing'];
    contact: BallOutcome['contact'];
    /** The gap the batter aimed at (swipe direction), for the follow-through; never where the ball actually went. */
    zone?: FieldZone | null;
    /** Tap time relative to the release (ms), for the swing timing. */
    tapMs?: number | null;
  }): Promise<void>;
}

export type RendererFallbackReason = 'no_webgl' | 'context_lost' | 'low_fps' | 'error';

/** Event payloads of MatchRenderer.on. */
export interface RendererEvents {
  /** A ball starts: live batting gives the ball index; a replay gives the ball's ordinal and its index in log.events. */
  ball: { live: true; ball: number } | { live?: false; ordinal: number; eventIndex: number; innings: 0 | 1 | 'super'; ball: number; key: boolean };
  end: { durationMs: number };
  /** The app should switch to the 2D presentation (and record `renderer_fallback`). */
  fallback: { reason: RendererFallbackReason; fps?: number; message?: string };
}

export interface RendererStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  quality: RenderQuality;
}

export interface MatchRenderer {
  mount(canvas: HTMLCanvasElement, options: RendererOptions): Promise<void>;
  /** Live batting: set up the stadium, the field and the two players. */
  prepareInnings(setup: { conditions: Conditions; field: FieldSetting; batter: PlayerRef; bowler: PlayerRef }): Promise<void>;
  /** Live batting: bowl one revealed delivery. */
  bowl(delivery: RevealedDelivery): LiveBallHandle;
  /** Replay: load a revealed match log. */
  loadReplay(log: MatchEventLog, mode: ReplayMode): Promise<{ durationMs: number }>;
  play(speed?: number): void;
  pause(): void;
  seek(ms: number): void;
  /** Deterministic frame at timeline time `ms` (offline highlight rendering; no wall clock). */
  renderAt(ms: number): void;
  setQuality(quality: RenderQuality): void;
  setReducedMotion(on: boolean): void;
  stats(): RendererStats;
  /** Current timeline time in ms (replay) or scene time (live). */
  currentTime(): number;
  /** Called after every rendered frame with the timeline time; returns an unsubscribe function. */
  onFrame(cb: (ms: number) => void): () => void;
  on<E extends keyof RendererEvents>(event: E, cb: (payload: RendererEvents[E]) => void): () => void;
  dispose(): void;
}

/** Thrown or emitted when WebGL is unavailable; the app switches to the 2D fallback presentation. */
export class RendererUnavailableError extends Error {
  constructor(public reason: string) {
    super(`3D renderer unavailable: ${reason}`);
  }
}
