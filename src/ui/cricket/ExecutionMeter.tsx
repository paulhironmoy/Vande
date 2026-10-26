import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ExecutionGrade, InputTrace } from '@/contracts';
import { useT } from '@/i18n';
import { PointerTrace } from '@/input/pointer';
import { meterRules, previewGrade } from './meter';
import s from './ExecutionMeter.module.css';

export interface ExecutionMeterProps {
  /** Called with the raw trace when the player releases. */
  onComplete: (trace: InputTrace, preview: { quality: number; grade: ExecutionGrade } | null) => void;
  /** Last recorded result to display. */
  result?: { grade: ExecutionGrade } | null;
  disabled?: boolean;
  size?: number;
  hint?: string;
}

const SWEEP = 270;
/** Samples kept per pointer hold (the release is always kept), well inside the engine's MAX_TRACE_SAMPLES. */
const MAX_SAMPLES = 110;

/** A hold: a pointer's trace, timed from its own events, or a Space / Enter hold, timed by its key handlers. */
type Hold = PointerTrace | { pointer: 'keyboard'; t0: number; samples: InputTrace['samples'] };

/**
 * Release meter: press and hold, the needle sweeps; let go in the gold band. The raw trace (timestamps and finger
 * positions) is sent, never a quality number. A pointer hold runs from its down event to its up event, each at its own
 * timestamp; the animation frame reads the clock only to draw the needle and to end a hold at the end of the dial.
 * Keyboard: hold Space or Enter.
 */
export function ExecutionMeter({ onComplete, result, disabled, size = 200, hint }: ExecutionMeterProps) {
  const { t } = useT();
  const rules = meterRules();
  /** The longest hold a trace may record (the engine rejects longer ones). */
  const longest = rules.maxHoldMs - 1;
  const ref = useRef<HTMLDivElement>(null);
  const press = useRef<{ hold: Hold; raf: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const labelId = useId();
  const hintId = useId();

  const tick = useCallback(() => {
    const p = press.current;
    if (!p) return;
    const el = performance.now() - p.hold.t0;
    setProgress(el / rules.fillMs);
    if (el >= rules.maxHoldMs - 5) {
      finish();
      return;
    }
    p.raf = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = (hold: () => Hold) => {
    if (disabled || press.current) return;
    press.current = { hold: hold(), raf: 0 };
    setHolding(true);
    setProgress(0);
    press.current.raf = requestAnimationFrame(tick);
  };
  /**
   * Ends the hold at `e`'s own timestamp (a pointer hold), else on the clock (the keyboard, the end of the dial). A
   * pointer's release (`up`) is kept where the finger left; anything else ends where the hold last was. Never past
   * the longest legal hold.
   */
  const finish = (e?: PointerEvent, up = false) => {
    const p = press.current;
    if (!p) return;
    cancelAnimationFrame(p.raf);
    press.current = null;
    setHolding(false);
    const { hold } = p;
    const at = hold instanceof PointerTrace && e ? hold.elapsed(e) : Math.round((performance.now() - hold.t0) * 10) / 10;
    const t = Math.min(longest, at);
    if (up && e && hold instanceof PointerTrace && at <= longest) hold.end(e);
    else {
      const last = hold.samples[hold.samples.length - 1];
      if (t > last[0]) hold.samples.push([t, last[1], last[2]]);
    }
    setProgress(t / rules.fillMs);
    const trace: InputTrace = { pointer: hold.pointer, samples: hold.samples };
    onComplete(trace, previewGrade(trace));
  };

  useEffect(() => () => {
    if (press.current) cancelAnimationFrame(press.current.raf);
  }, []);

  // Arc geometry: a 270° dial from bottom-left; the full sweep is the longest legal hold (maxHoldMs).
  const R = 42;
  const span = rules.maxHoldMs / rules.fillMs;
  const angleFor = (frac: number) => ((135 + (SWEEP * Math.min(span, Math.max(0, frac))) / span) * Math.PI) / 180;
  const pt = (frac: number, r = R) => `${(Math.cos(angleFor(frac)) * r).toFixed(2)} ${(Math.sin(angleFor(frac)) * r).toFixed(2)}`;
  const arc = (a: number, b: number, r = R) => `M${pt(a, r)} A${r} ${r} 0 ${(SWEEP * (b - a)) / span > 180 ? 1 : 0} 1 ${pt(b, r)}`;
  const goodHalf = ((1 - rules.goodQuality) * rules.falloffMs) / rules.fillMs;
  const perfHalf = ((1 - rules.perfectQuality) * rules.falloffMs) / rules.fillMs;
  const sweet = rules.sweetMs / rules.fillMs;
  const needle = Math.min(span, progress);
  const gradeText = result ? t(`execution.${result.grade}`) : null;

  return (
    <div className={s.wrap}>
      <div
        ref={ref}
        className={s.meter}
        style={{ width: size, height: size }}
        data-holding={holding || undefined}
        data-disabled={disabled || undefined}
        role="button"
        tabIndex={disabled ? -1 : 0}
        data-testid="execution-meter"
        aria-labelledby={labelId}
        aria-describedby={hintId}
        aria-pressed={holding}
        aria-disabled={disabled || undefined}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          start(() => new PointerTrace(e.nativeEvent, ref.current!.getBoundingClientRect(), { maxSamples: MAX_SAMPLES }));
        }}
        onPointerMove={(e) => {
          const hold = press.current?.hold;
          // Nothing after the longest legal hold is kept: a release that late is recorded at the longest hold.
          if (hold instanceof PointerTrace && hold.elapsed(e.nativeEvent) <= longest) hold.move(e.nativeEvent);
        }}
        onPointerUp={(e) => finish(e.nativeEvent, true)}
        onPointerCancel={(e) => finish(e.nativeEvent)}
        onKeyDown={(e: KeyboardEvent) => {
          if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
            e.preventDefault();
            start(() => ({ pointer: 'keyboard', t0: performance.now(), samples: [[0, 0.5, 0.5]] }));
          }
        }}
        onKeyUp={(e: KeyboardEvent) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            finish();
          }
        }}
      >
        <svg viewBox="-50 -50 100 100" aria-hidden="true">
          <path d={arc(0, span)} className={s.track} />
          <path d={arc(sweet - goodHalf, sweet + goodHalf)} className={s.good} />
          <path d={arc(sweet - perfHalf, sweet + perfHalf)} className={s.perfect} />
          {needle > 0 && <path d={arc(0, Math.max(0.001, needle))} className={s.fill} />}
          <line x1="0" y1="0" x2={Math.cos(angleFor(needle)) * (R + 5)} y2={Math.sin(angleFor(needle)) * (R + 5)} className={s.needle} />
          <circle r="27" className={s.core} />
        </svg>
        <span className={s.center}>
          <span className={s.big} id={labelId}>
            {holding ? `${Math.round(Math.min(150, progress * 100))}%` : gradeText ?? t('plan.gesture')}
          </span>
        </span>
      </div>
      <p className={s.hint} id={hintId}>
        {hint ?? t('plan.gesture_hint')} <span className="sr-only">{t('a11y.gesture_pad')}</span>
      </p>
    </div>
  );
}
