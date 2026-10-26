import type { BallOutcome, WicketKind } from '@/contracts';
import { useT } from '@/i18n';
import s from './OutcomeBadge.module.css';

/** What a ball slot shows. Every state has its own shape and text, so colour is never the only signal. */
export type BallMark =
  | { kind: 'upcoming' }
  | { kind: 'current' }
  | { kind: 'sealed' }
  | { kind: 'dot' }
  | { kind: 'runs'; runs: 1 | 2 | 3 }
  | { kind: 'four' }
  | { kind: 'six' }
  | { kind: 'wicket'; wicket?: WicketKind };

export function markFromOutcome(o: Pick<BallOutcome, 'runs' | 'wicket'>): BallMark {
  if (o.wicket) return { kind: 'wicket', wicket: o.wicket };
  if (o.runs === 6) return { kind: 'six' };
  if (o.runs === 4) return { kind: 'four' };
  if (o.runs === 0) return { kind: 'dot' };
  return { kind: 'runs', runs: o.runs as 1 | 2 | 3 };
}

const SHAPES: Record<BallMark['kind'], string> = {
  upcoming: 'M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19z',
  current: 'M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19z',
  dot: 'M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19z',
  runs: 'M12 2.5a9.5 9.5 0 110 19 9.5 9.5 0 010-19z',
  four: 'M6 2.5h12a3.5 3.5 0 013.5 3.5v12a3.5 3.5 0 01-3.5 3.5H6A3.5 3.5 0 012.5 18V6A3.5 3.5 0 016 2.5z',
  six: 'M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75L12 1.5z',
  wicket: 'M12 1.2l10.8 10.8L12 22.8 1.2 12 12 1.2z',
  sealed: 'M12 1.5l9.1 5.25v10.5L12 22.5l-9.1-5.25V6.75L12 1.5z',
};

export interface OutcomeBadgeProps {
  mark: BallMark;
  size?: 'sm' | 'md' | 'lg';
  /** Ball number (1-based) for the accessible label. */
  ball?: number;
  className?: string;
}

export function OutcomeBadge({ mark, size = 'md', ball, className }: OutcomeBadgeProps) {
  const { t } = useT();
  const text =
    mark.kind === 'runs' ? String(mark.runs) : mark.kind === 'four' ? '4' : mark.kind === 'six' ? '6' : mark.kind === 'wicket' ? t('outcome.short.wicket') : mark.kind === 'dot' ? t('outcome.short.dot') : '';
  const result =
    mark.kind === 'runs'
      ? t('outcome.runs', { runs: mark.runs })
      : mark.kind === 'four'
        ? t('outcome.four')
        : mark.kind === 'six'
          ? t('outcome.six')
          : mark.kind === 'wicket'
            ? mark.wicket
              ? t(`wicket.${mark.wicket}`)
              : t('outcome.wicket')
            : mark.kind === 'dot'
              ? t('outcome.dot')
              : '';
  const label =
    ball === undefined
      ? result || t(mark.kind === 'sealed' ? 'common.sealed' : 'common.ball_n', { n: '' })
      : mark.kind === 'upcoming'
        ? t('a11y.ball_state_upcoming', { n: ball })
        : mark.kind === 'current'
          ? t('a11y.ball_state_current', { n: ball })
          : mark.kind === 'sealed'
            ? t('a11y.ball_state_sealed', { n: ball })
            : t('a11y.ball_state_result', { n: ball, result });
  return (
    <span className={[s.badge, s[size], className ?? ''].join(' ')} data-kind={mark.kind} role="img" aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={SHAPES[mark.kind]} className={s.shape} />
        {mark.kind === 'sealed' && <path d="M8.6 11h6.8v5.4H8.6zM10.2 11V9.4a1.8 1.8 0 013.6 0V11" className={s.glyph} />}
      </svg>
      {text && <span className={s.text}>{text}</span>}
    </span>
  );
}
