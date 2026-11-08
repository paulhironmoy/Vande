/**
 * The timing check: "Tap when the moving ball crosses the line." Five counted taps (up to eight tries); each error is
 * the tap's own event timestamp minus the moment the ball crossed, computed from the animation's start time (never
 * from a frame). Each tap remembers the input that made it (touch, mouse, pen or keyboard), and src/input takes each
 * input's median separately (CTL9): a result replaces only that input's offset. Stored on the device only.
 */
import { useEffect, useRef, useState } from 'react';
import { PButton, Screen, sys } from '../design';
import { usePracticeT, type PracticeT } from '@/i18n/practice';
import { CALIBRATED_INPUTS, clearCalibration, loadCalibrations, saveCalibrations, type CalibratedInput, type StoredCalibrations } from '@/practice/store';
import { eventTime } from '@/input/pointer';
import { useKit } from '../context';
import s from './Tools.module.css';

const COUNTED = 5;
const MAX_TRIES = 8;
const TRAVEL_MS = 1300;
const LINE_AT = 0.68;
const REJECT_MS = 300;

type Phase = { kind: 'intro' } | { kind: 'running'; n: number; missed: boolean } | { kind: 'done'; set: StoredCalibrations };

/** "touch 42 ms, keyboard 18 ms": every input that has an offset. */
export function calibrationList(t: PracticeT, set: StoredCalibrations): string | null {
  const items = CALIBRATED_INPUTS.filter((m) => set[m]).map((m) => t.t('practice.cal.item', { input: t.tk(`practice.cal.input.${m}`), ms: Math.round(set[m]!.offsetMs) }));
  return items.length ? items.join(', ') : null;
}

export function Calibration({ onBack }: { onBack: () => void }) {
  const t = usePracticeT();
  const { input } = useKit();
  const [phase, setPhase] = useState<Phase>({ kind: 'intro' });
  const [current, setCurrent] = useState(() => loadCalibrations());
  const ball = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLButtonElement>(null);
  const run = useRef<{ start: number; cross: number; tapped: boolean; frame: number; timer: number } | null>(null);
  const errors = useRef<Array<{ modality: CalibratedInput; errorMs: number }>>([]);
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
    const set = input.calibrationsFromTaps(errors.current);
    if (Object.keys(set).length > 0) {
      saveCalibrations(set);
      setCurrent(loadCalibrations());
    }
    setPhase({ kind: 'done', set });
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

  const tap = (tapPerfMs: number, modality: CalibratedInput) => {
    const r = run.current;
    if (phase.kind !== 'running' || !r || r.tapped || !Number.isFinite(r.cross)) return;
    r.tapped = true;
    const err = tapPerfMs - r.cross;
    const ok = Math.abs(err) <= REJECT_MS;
    if (ok) errors.current.push({ modality, errorMs: err });
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
    <Screen title={t.t('practice.cal.title')} onBack={onBack} testId="practice-calibration">
      <p className={sys.section}>{t.t('practice.cal.instruction')}</p>
      <p className={sys.caption}>{t.t('practice.cal.body')}</p>
      <button
        ref={track}
        type="button"
        className={s.track}
        aria-label={t.t('practice.cal.tap_area')}
        onPointerDown={(e) => tap(eventTime(e.nativeEvent), input.eventModality(e.nativeEvent))}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            if (!e.repeat) tap(eventTime(e.nativeEvent), 'keyboard');
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
        {phase.kind === 'running' && phase.missed && <p className={sys.caption}>{t.t('practice.cal.missed')}</p>}
        {phase.kind === 'done' &&
          (Object.keys(phase.set).length > 0 ? (
            <div className={s.section} data-testid="practice-cal-result">
              {CALIBRATED_INPUTS.filter((m) => phase.set[m]).map((m) => (
                <p key={m} className={sys.section}>
                  {t.t('practice.cal.result', { input: t.tk(`practice.cal.input.${m}`), ms: Math.round(phase.set[m]!.offsetMs) })}
                </p>
              ))}
              <p className={sys.caption}>
                {t.t('practice.cal.result_body')} {t.t('practice.cal.saved')}
              </p>
            </div>
          ) : (
            <p className={sys.caption}>{t.t('practice.cal.none')}</p>
          ))}
      </div>
      <p className={sys.caption} data-testid="practice-cal-current">
        {calibrationList(t, current) ? t.t('practice.cal.current', { list: calibrationList(t, current)! }) : t.t('practice.cal.not_done')}
      </p>
      <div className={s.actions}>
        {phase.kind !== 'running' && (
          <PButton variant="primary" size="lg" onClick={begin} data-testid="practice-cal-start">
            {phase.kind === 'done' ? t.t('practice.cal.again') : t.t('practice.cal.start')}
          </PButton>
        )}
        {calibrationList(t, current) && phase.kind !== 'running' && (
          <PButton
            variant="quiet"
            onClick={() => {
              clearCalibration();
              setCurrent({});
            }}
          >
            {t.t('practice.cal.reset')}
          </PButton>
        )}
        {phase.kind === 'done' && (
          <PButton variant="secondary" onClick={onBack}>
            {t.t('practice.common.done')}
          </PButton>
        )}
      </div>
    </Screen>
  );
}
