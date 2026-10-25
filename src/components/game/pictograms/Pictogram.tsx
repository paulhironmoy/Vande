import type { OptionVisual } from '@/engine/types';
import { GLYPHS } from './glyphs';
import s from './Pictogram.module.css';

export interface PictogramProps {
  visual: OptionVisual;
  /** 'card' on answer cards; 'mini' beside answers in the reveal. */
  size?: 'card' | 'mini';
}

/**
 * A composed, neutral pictogram: who acts (left), the action (round badge in the middle) and the object (right),
 * standing on one ground line. The same structure for every answer gives every answer the same visual weight.
 * Decorative only: always aria-hidden, no text inside; the visible label carries the words.
 * Renders nothing when an id is unknown (the gate never lets that reach a card).
 */
export function Pictogram({ visual, size = 'card' }: PictogramProps) {
  const Actor = GLYPHS[visual.actor];
  const Action = GLYPHS[visual.action];
  const Thing = GLYPHS[visual.object];
  if (!Actor || !Action || !Thing) return null;
  return (
    <span className={`${s.pictogram} ${size === 'mini' ? s.mini : s.card}`} aria-hidden="true" data-pictogram={`${visual.actor}.${visual.action}.${visual.object}`}>
      <svg viewBox="0 0 144 72" focusable="false" aria-hidden="true" className={s.svg}>
        <path className={s.ground} d="M8 62.5h128" />
        <g transform="translate(-0.7 8.5) scale(0.9)">
          <Actor />
        </g>
        <g transform="translate(87.1 8.5) scale(0.9)">
          <Thing />
        </g>
        <circle className={s.ring} cx="72" cy="38" r="14.5" />
        <g transform="translate(61.2 27.2) scale(0.9)" className={s.action}>
          <Action />
        </g>
      </svg>
    </span>
  );
}
