/**
 * Acting at the wrong moment: a press on the batting area (or a batting key) before the bowler lets the ball go cannot
 * count, because the surface is armed at the release. Nothing is said during the run-up (Delivery Quiet Mode hides all
 * instruction); the dead ball says it once, in plain words, with "try again" and no penalty (the ball was not played).
 * Only for the first few balls, while teaching is on. It watches, it never changes anything: the delivery, its physics
 * and its result are the same with or without it.
 */
import { useEffect, useRef, useState } from 'react';
import { isShotKey } from '@/input';
import { usePracticeT } from '@/i18n/practice';
import { sys } from '../design';
import type { LivePhase } from '../flow/state';
import s from './Lesson.module.css';

/** Whether a press or a key landed on the batting area before this ball's release (forgotten when the next ball starts). */
export function useEarlyPress(phase: LivePhase, watching: boolean): boolean {
  const [early, setEarly] = useState(false);
  const before = phase === 'ready' || phase === 'runup';
  const wasBefore = useRef(false);
  useEffect(() => {
    if (before && !wasBefore.current) setEarly(false);
    wasBefore.current = before;
    if (!before || !watching) return;
    const onPress = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[role="application"]')) setEarly(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat && isShotKey(e.code)) setEarly(true);
    };
    window.addEventListener('pointerdown', onPress, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPress, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, [before, watching]);
  return early;
}

/**
 * During the first-run demonstration ("Watch first"): a press on the batting area gets one calm line, in the panel, and
 * the demonstration goes on. The live region is there from the start (empty), so the line is announced when it appears.
 */
export function WatchNote() {
  const t = usePracticeT();
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    const onPress = (e: PointerEvent) => {
      if (e.target instanceof Element && e.target.closest('[role="application"]')) setPressed(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!e.repeat && isShotKey(e.code)) setPressed(true);
    };
    window.addEventListener('pointerdown', onPress, { capture: true, passive: true });
    window.addEventListener('keydown', onKey, { capture: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', onPress, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    };
  }, []);
  return (
    <p className={s.watchNote} role="status" aria-live="polite" data-testid="lesson-watch-note">
      {pressed ? t.tk('practice.lesson.note.watch') : ''}
    </p>
  );
}

export function TooSoonNote() {
  const t = usePracticeT();
  return (
    <p className={`${s.timingLine} ${sys.body}`} data-testid="lesson-too-soon">
      {t.tk('practice.lesson.too_soon')} {t.tk('practice.lesson.try_again')}
    </p>
  );
}
