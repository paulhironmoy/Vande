/**
 * The timing check: "Tap when the moving ball crosses the line." Five counted taps (up to eight tries); each error is
 * the tap's own event timestamp minus the moment the ball crossed, computed from the animation's start time (never
 * from a frame), and src/input's calibrationFromTaps takes the median. Stored on the device only.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, ScreenShell } from '@/ui';
import type { Calibration as CalibrationValue } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { clearCalibration, loadCalibration, saveCalibration } from '@/practice/store';
import { eventTime } from '@/input/pointer';
import { useKit } from '../context';
import s from './Tools.module.css';

const COUNTED = 5;
const MAX_TRIES = 8;
const TRAVEL_MS = 1300;
const LINE_AT = 0.68;
const REJECT_MS = 300;

type Phase = { kind: 'intro' } | { kind: 'running'; n: number; missed: boolean } | { kind: 'done'; cal: CalibrationValue };

export function Calibration({ onBack }: { onBack: () => void }) {
  const t = usePracticeT();
  const { input } = useKit();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [current, setCurrent] = useState(() => loadCalibration());
  const ball = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLButtonElement>(null);
  const run = useRef<{ start: number; cross: number; tapped: boolean; frame: number; timer: number } | null>(null);
  const errors = useRef<number[]>([]);
  const tries = useRef(0);

  const stopAnim = () => {
    const r = run.current;
    if (r) {
      cancelAnimationFrame(r.frame);
      clearTimeout(r.timer);
    }
    run.current = null;
  };
  useEffect(() => stopAnim, []);
  // Keyboard players tap with Space: the tap area takes focus once it is enabled.
  const running = phase.kind === 'running';
  useEffect(() => {
    if (running) track.current?.focus({ preventScroll: true });
  }, [running]);

  const finish = () => {
    stopAnim();
    const cal = input.calibrationFromTaps(errors.current);
    if (cal.attempts > 0) {
      saveCalibration(cal);
      setCurrent(loadCalibration());
    }
    setPhase({ kind: 'done', cal });
  };

  const attempt = (missed: boolean) => {
    if (errors.current.length >= COUNTED || tries.current >= MAX_TRIES) {
      finish();
      return;
    }
    tries.current++;
    setPhase({ kind: 'running', n: errors.current.length + 1, missed });
    const delay = 500 + Math.random() * 900;
    const timer = window.setTimeout(() => {
      const start = performance.now();
      const state = { start, cross: start + TRAVEL_MS * LINE_AT, tapped: false, frame: 0, timer: 0 };
      run.current = state;
      const width = () => track.current?.clientWidth ?? 300;
      const tick = (now: number) => {
        const p = Math.min(1, (now - start) / TRAVEL_MS);
        if (ball.current) ball.current.style.transform = `translateX(${p * width()}px)`;
        if (p < 1) state.frame = requestAnimationFrame(tick);
        else if (!state.tapped) {
          // No tap at all this time: try again.
          state.timer = window.setTimeout(() => attempt(true), 250);
        }
      };
      state.frame = requestAnimationFrame(tick);
    }, delay);
    run.current = { start: Infinity, cross: Infinity, tapped: false, frame: 0, timer };
    if (ball.current) ball.current.style.transform = 'translateX(0px)';
  };

  const tap = (tapPerfMs: number) => {
    const r = run.current;
    if (phase.kind !== 'running' || !r || r.tapped || !Number.isFinite(r.cross)) return;
    r.tapped = true;
    const err = tapPerfMs - r.cross;
    const ok = Math.abs(err) <= REJECT_MS;
    if (ok) errors.current.push(err);
    window.setTimeout(() => {
      stopAnim();
      attempt(!ok);
    }, 350);
  };

  const begin = () => {
    errors.current = [];
    tries.current = 0;
    attempt(false);
  };

  return (
    <ScreenShell title={t.t('practice.cal.title')} onBack={onBack} backLabel={t.t('practice.common.back')} narrow testId="practice-calibration" contentClassName={s.content}>
      <p className={s.strong}>{t.t('practice.cal.instruction')}</p>
      <p className={s.text}>{t.t('practice.cal.body')}</p>
      <button
        ref={track}
        type="button"
        className={s.track}
        aria-label={t.t('practice.cal.tap_area')}
        onPointerDown={(e) => tap(eventTime(e.nativeEvent))}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!e.repeat) tap(eventTime(e.nativeEvent));
          }
        }}
        disabled={phase.kind !== 'running'}
        data-testid="practice-cal-track"
      >
        <span className={s.line} style={{ left: `${LINE_AT * 100}%` }} aria-hidden="true" />
        <span ref={ball} className={s.calBall} aria-hidden="true" />
        <span className={s.trackLabel} aria-hidden="true">
          {phase.kind === 'running' ? t.t('practice.cal.attempt', { n: phase.n, total: COUNTED }) : ''}
        </span>
      </button>
      <div aria-live="polite">
        {phase.kind === 'running' && phase.missed && <p className={s.text}>{t.t('practice.cal.missed')}</p>}
        {phase.kind === 'done' &&
          (phase.cal.attempts > 0 ? (
            <div className={s.section} data-testid="practice-cal-result">
              <p className={s.strong}>{t.t('practice.cal.result', { ms: Math.round(phase.cal.offsetMs) })}</p>
              <p className={s.text}>
                {t.t('practice.cal.result_body')} {t.t('practice.cal.saved')}
              </p>
            </div>
          ) : (
            <p className={s.text}>{t.t('practice.cal.none')}</p>
          ))}
      </div>
      <p className={s.text} data-testid="practice-cal-current">
        {current ? t.t('practice.cal.current', { ms: Math.round(current.offsetMs) }) : t.t('practice.cal.not_done')}
      </p>
      <div className={s.actions}>
        {phase.kind !== 'running' && (
          <Button variant="primary" size="lg" onClick={begin} data-testid="practice-cal-start">
            {phase.kind === 'done' ? t.t('practice.cal.again') : t.t('practice.cal.start')}
          </Button>
        )}
        {current && phase.kind !== 'running' && (
          <Button
            variant="ghost"
            onClick={() => {
              clearCalibration();
              setCurrent(null);
            }}
          >
            {t.t('practice.cal.reset')}
          </Button>
        )}
        {phase.kind === 'done' && (
          <Button variant="secondary" onClick={onBack}>
            {t.t('practice.common.done')}
          </Button>
        )}
      </div>
    </ScreenShell>
  );
}
