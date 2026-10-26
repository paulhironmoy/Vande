import type { MatchRenderer, RenderQuality } from '@/contracts';
import type { SceneEventKind } from './core/choreo';
import type { Timeline } from './core/timeline';

/** Receives timed presentation cues while playing (sound and haptics). Never called by renderAt or seek. */
export interface PresentationSink {
  cue(kind: SceneEventKind, intensity: number, rate: number): void;
  crowd(level: number): void;
}

export type FallbackReason = 'no_webgl' | 'context_lost' | 'low_fps' | 'error';

/**
 * Our implementation of the frozen MatchRenderer contract plus a few UI conveniences (current time, frame
 * callback, presentation sink). The extras are optional: anything that only knows MatchRenderer still works.
 */
export interface StageRenderer extends MatchRenderer {
  readonly kind: '3d' | '2d';
  /** Current timeline time in ms (replay) or scene time (live). */
  currentTime(): number;
  isPlaying(): boolean;
  /** Called after every rendered frame with the timeline time. */
  onFrame(cb: (ms: number) => void): () => void;
  setSink(sink: PresentationSink | null): void;
  timeline(): Timeline | null;
  /** Quality actually in use (after any automatic downgrade). */
  quality(): RenderQuality;
}
