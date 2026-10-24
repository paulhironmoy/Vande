import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetPersistenceForTests } from '@/app/persistence';
import { __resetStoreForTests, useApp } from '@/app/store';
import { END_BEAT_MS, useGameLoop } from '@/app/gameLoop';

async function startRunningGame() {
  await __resetPersistenceForTests(true);
  __resetStoreForTests();
  window.history.replaceState(null, '', '/');
  await useApp.getState().hydrate();
  const s = useApp.getState();
  s.completeIntro();
  s.beginCampaignSetup();
  s.confirmSetup();
  s.startChapter();
  expect(useApp.getState().game?.status).toBe('running');
  expect(useApp.getState().screen).toEqual({ name: 'play' });
}

describe('game loop', () => {
  beforeEach(async () => {
    vi.useRealTimers();
    await startRunningGame();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances whole ticks at the configured pace, never double-ticks on a pace change and never catches up paused time', () => {
    const hook = renderHook(() => useGameLoop());
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(useApp.getState().game!.tick).toBe(3);

    useApp.getState().updateSettings({ timerPace: 'relaxed' }); // 1500 ms per tick
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(useApp.getState().game!.tick).toBe(5);

    useApp.getState().pauseGame();
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(useApp.getState().game!.tick).toBe(5);
    useApp.getState().resumeGame();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(useApp.getState().game!.tick).toBe(6);

    // A single interval firing after a long jump (what page.clock.fastForward does) processes every elapsed tick.
    useApp.getState().updateSettings({ timerPace: 'standard' });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    const before = useApp.getState().game!.tick;
    const base = performance.now();
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => base + 20_250);
    act(() => {
      vi.advanceTimersByTime(250);
    });
    spy.mockRestore();
    expect(useApp.getState().game!.tick).toBeGreaterThanOrEqual(before + 20);
    hook.unmount();
  });

  it('pauses the game when the document is hidden and when the player leaves the play screen', () => {
    const hook = renderHook(() => useGameLoop());
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(useApp.getState().game!.status).toBe('paused');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    useApp.getState().resumeGame();
    useApp.getState().navigate({ name: 'settings' });
    expect(useApp.getState().game!.status).toBe('paused');
    hook.unmount();
  });

  it('records the chapter result after a short beat once the engine ends the chapter', () => {
    const hook = renderHook(() => useGameLoop());
    act(() => {
      useApp.getState().tickGame(useApp.getState().game!.duration);
    });
    expect(useApp.getState().game!.status).toBe('ended');
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    act(() => {
      vi.advanceTimersByTime(END_BEAT_MS - 50);
    });
    expect(useApp.getState().screen).toEqual({ name: 'play' });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(useApp.getState().screen).toEqual({ name: 'chapter-result' });
    expect(useApp.getState().campaign?.completed.length).toBe(1);
    hook.unmount();
  });
});
