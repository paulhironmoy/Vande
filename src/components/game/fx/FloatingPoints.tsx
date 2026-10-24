import { useEffect, useLayoutEffect, useState, type RefObject } from 'react';
import { prefersReducedMotion } from './motion';
import s from './FloatingPoints.module.css';

export interface FloatingPointsProps {
  amount: number;
  tone?: 'good' | 'great' | 'bad';
  /** Element to float above (centre of its top edge); without it the number floats at the centre of the screen. */
  anchorRef?: RefObject<HTMLElement | null>;
  onDone?: () => void;
}

const LIFE_MS = 950;
const LIFE_REDUCED_MS = 700;

/** "+658" that rises with a little spring overshoot and fades. Decorative: hidden from assistive tech. */
export function FloatingPoints({ amount, tone = 'good', anchorRef, onDone }: FloatingPointsProps) {
  const [visible, setVisible] = useState(true);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const reduced = prefersReducedMotion();

  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (!el) {
      setPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setPos({ left: r.left + r.width / 2, top: r.top });
  }, [anchorRef, amount]);

  useEffect(() => {
    setVisible(true);
    const t = window.setTimeout(() => {
      setVisible(false);
      onDone?.();
    }, reduced ? LIFE_REDUCED_MS : LIFE_MS);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  if (!visible) return null;
  const text = amount >= 0 ? `+${amount}` : String(amount);
  return (
    <span
      className={[s.float, pos ? s.anchored : s.centred, reduced ? s.still : ''].filter(Boolean).join(' ')}
      data-tone={tone}
      aria-hidden="true"
      style={pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : undefined}
    >
      {text}
    </span>
  );
}
