import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from './motion';
import s from './CountUp.module.css';

export interface CountUpProps {
  value: number;
  /** Animation length in ms (default 700). */
  durationMs?: number;
  /** Value shown on first mount, e.g. 0 to count a final score up from zero (default: `value`, no animation on mount). */
  from?: number;
  className?: string;
  format?: (n: number) => string;
  'data-testid'?: string;
}

/**
 * Rolling number. Animates from the currently displayed value to `value` with an ease-out curve on
 * requestAnimationFrame; renders the target immediately under reduced motion. The text always ends exactly at `value`.
 */
export function CountUp({ value, durationMs = 700, from, className, format, 'data-testid': testId }: CountUpProps) {
  const initial = from ?? value;
  const [display, setDisplay] = useState(initial);
  const shown = useRef(initial);

  useEffect(() => {
    const target = Math.round(value);
    const start = shown.current;
    if (start === target) {
      setDisplay(target);
      return undefined;
    }
    if (prefersReducedMotion() || durationMs <= 0 || typeof requestAnimationFrame !== 'function') {
      shown.current = target;
      setDisplay(target);
      return undefined;
    }
    let raf = 0;
    let t0: number | null = null;
    const step = (now: number) => {
      if (t0 === null) t0 = now;
      const p = Math.min(1, Math.max(0, (now - t0) / durationMs));
      const eased = 1 - Math.pow(1 - p, 3);
      const v = p >= 1 ? target : Math.round(start + (target - start) * eased);
      shown.current = v;
      setDisplay(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [value, durationMs]);

  return (
    <span className={[s.num, className ?? ''].filter(Boolean).join(' ')} data-testid={testId} aria-live="off">
      {format ? format(display) : String(display)}
    </span>
  );
}
