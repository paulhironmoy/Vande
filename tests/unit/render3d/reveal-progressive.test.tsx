/**
 * The reveal's first frame does not wait for the whole match: the screen and the renderer share one progressive
 * timeline (replayTimeline), built with the first ball at mount and the rest in idle time.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { MatchEventLog, ReplayMode, LiveBallHandle } from '@/contracts';
import type { StageRenderer } from '@/render3d';
import { replayTimeline, type Timeline } from '@/render3d/core/timeline';
import { fixtureMatchLog } from '@/screens/dev/fixtures';
import { defaultRevealMode } from '@/screens/reveal/disclosure';
import { loadI18n, renderUi } from '../ui/helpers';

const loaded: Array<{ log: MatchEventLog; mode: ReplayMode; tl: Timeline }> = [];

function sharingRenderer() {
  let tl: Timeline | null = null;
  return {
    kind: '3d' as const,
    async mount() {},
    async prepareInnings() {},
    bowl(): LiveBallHandle {
      throw new Error('not live');
    },
    // As the real session does: the very timeline object the screen shows.
    async loadReplay(log: MatchEventLog, mode: ReplayMode) {
      tl = replayTimeline(log, mode);
      loaded.push({ log, mode, tl });
      return { durationMs: tl.duration };
    },
    play: () => undefined,
    pause: () => undefined,
    seek: () => undefined,
    renderAt: () => undefined,
    setQuality: () => undefined,
    setReducedMotion: () => undefined,
    stats: () => ({ fps: 60, frameMs: 16.7, drawCalls: 1, quality: 'standard' as const }),
    on: () => () => undefined,
    onFrame: () => () => undefined,
    setSink: () => undefined,
    timeline: () => tl,
    quality: () => 'standard' as const,
    currentTime: () => 0,
    isPlaying: () => false,
    dispose: () => undefined,
  };
}

vi.mock('@/render3d', async () => {
  const actual = await vi.importActual<typeof import('@/render3d')>('@/render3d');
  return { ...actual, createMatchRenderer: async () => sharingRenderer() as unknown as StageRenderer, webglAvailable: () => true };
});
vi.mock('@/audio', async () => {
  const actual = await vi.importActual<typeof import('@/audio')>('@/audio');
  class Silent {
    cue() {}
    crowd() {}
    dispose() {}
  }
  return { ...actual, MatchAudio: Silent, playSealChime: () => undefined };
});

import { RevealScreen } from '@/screens/reveal/RevealScreen';

beforeAll(async () => {
  await loadI18n();
});
afterEach(() => {
  cleanup();
});

describe('reveal first frame', () => {
  it('mounts with only the first ball built, shares the timeline with the renderer, and finishes in idle time', async () => {
    const log = fixtureMatchLog();
    const mode = defaultRevealMode(log);
    renderUi(<RevealScreen log={log} autoplay={false} />);
    expect(screen.getByTestId('reveal-screen')).toBeTruthy();
    // Right after the first render: the intro and the first ball only.
    const tl = replayTimeline(log, mode);
    const balls = tl.balls.length;
    expect(balls).toBeGreaterThan(1);
    expect(tl.pending).toBe(balls - 1);
    // The renderer plays the same object.
    await waitFor(() => expect(loaded.some((l) => l.log === log && l.mode === mode)).toBe(true));
    expect(loaded.find((l) => l.log === log)!.tl).toBe(tl);
    // The rest lands in idle time without anything asking for it.
    await waitFor(() => expect(tl.pending).toBe(0), { timeout: 15_000 });
  });
});
