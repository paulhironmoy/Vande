/**
 * Real-time driver for the pure engine. One window interval (250 ms) measures elapsed wall time with
 * performance.now() and advances whole ticks at the configured pace. Using window timers means
 * Playwright's fake clock (page.clock) can fast-forward gameplay deterministically.
 */
import { useEffect } from 'react';
import { PACE_MS } from '@/engine';
import { useApp } from './store';

const INTERVAL_MS = 250;

export function useGameLoop(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let last = performance.now();
    let acc = 0;

    const step = () => {
      const s = useApp.getState();
      const game = s.game;
      const now = performance.now();
      if (!game || game.status !== 'running' || s.screen.name !== 'play') {
        // Not running: keep the accumulator empty so time away never counts.
        last = now;
        acc = 0;
        if (game?.status === 'running' && s.screen.name !== 'play') s.pauseGame();
        return;
      }
      const pace = PACE_MS[s.settings.timerPace] ?? 1000;
      acc += Math.max(0, now - last);
      last = now;
      const n = Math.floor(acc / pace);
      if (n > 0) {
        acc -= n * pace;
        s.tickGame(n);
      }
    };

    const id = window.setInterval(step, INTERVAL_MS);

    const onVisibility = () => {
      const s = useApp.getState();
      if (document.hidden) {
        if (s.game?.status === 'running') s.pauseGame();
      } else {
        last = performance.now();
        acc = 0;
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // When the engine reaches the end of the chapter, record the result once.
  const ended = useApp((s) => s.game?.status === 'ended');
  useEffect(() => {
    if (ended) useApp.getState().endChapter();
  }, [ended]);
}
