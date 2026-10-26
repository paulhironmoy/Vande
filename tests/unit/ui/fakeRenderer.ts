import { vi } from 'vitest';
import type { LiveBallHandle, MatchEventLog, ReplayMode, RevealedDelivery } from '@/contracts';
import type { StageRenderer } from '@/render3d';
import { buildTimeline } from '@/render3d/core/timeline';

/** Records calls; `released` resolves at `releaseAt()` (a controlled clock in tests). */
export function createFakeRenderer(releaseAt: () => number) {
  const calls: Array<[string, unknown[]]> = [];
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  let duration = 0;
  let t = 0;
  let tl: ReturnType<typeof buildTimeline> | null = null;
  const r: StageRenderer & { calls: typeof calls; shots: unknown[] } = {
    kind: '3d',
    calls,
    shots: [],
    async mount(...a) {
      calls.push(['mount', a]);
    },
    async prepareInnings(...a) {
      calls.push(['prepareInnings', a]);
    },
    bowl(d: RevealedDelivery): LiveBallHandle {
      calls.push(['bowl', [d]]);
      return {
        released: Promise.resolve(releaseAt()),
        showShot: async (anim) => {
          r.shots.push(anim);
        },
      };
    },
    async loadReplay(log: MatchEventLog, mode: ReplayMode) {
      calls.push(['loadReplay', [mode]]);
      tl = buildTimeline(log, mode);
      duration = tl.duration;
      return { durationMs: duration };
    },
    play: (s) => calls.push(['play', [s]]),
    pause: () => calls.push(['pause', []]),
    seek: (ms) => {
      t = ms;
      calls.push(['seek', [ms]]);
    },
    renderAt: (ms) => {
      t = ms;
    },
    setQuality: (q) => calls.push(['setQuality', [q]]),
    setReducedMotion: (on) => calls.push(['setReducedMotion', [on]]),
    stats: () => ({ fps: 60, frameMs: 16.7, drawCalls: 50, quality: 'standard' }),
    on(event, cb) {
      let s = listeners.get(event);
      if (!s) listeners.set(event, (s = new Set()));
      const listener = cb as (p: unknown) => void;
      s.add(listener);
      return () => s!.delete(listener);
    },
    onFrame: () => () => undefined,
    setSink: () => undefined,
    timeline: () => tl,
    quality: () => 'standard',
    currentTime: () => t,
    isPlaying: () => false,
    dispose: vi.fn(),
  };
  return r;
}
