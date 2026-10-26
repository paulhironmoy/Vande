import { useT } from '@/i18n';
import { OutcomeBadge, type BallMark } from './OutcomeBadge';
import s from './BallTimeline.module.css';

export interface BallSlot {
  mark: BallMark;
  /** Super Ball slot (tie-breaker). */
  superBall?: boolean;
  /** Optional caption under the badge (e.g. delivery short name). */
  caption?: string;
  /** Extra words for screen readers after the badge's own label (e.g. "Auto: played for the player"). */
  note?: string;
}

export interface BallTimelineProps {
  slots: BallSlot[];
  /** Highlighted slot index. */
  active?: number | null;
  /** Makes slots buttons (seek in a replay, select a ball in the planner). */
  onSelect?: (index: number) => void;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** The over at a glance: six balls (and the Super Ball) as shaped, labelled badges. */
export function BallTimeline({ slots, active, onSelect, label, size = 'md', className }: BallTimelineProps) {
  const { t } = useT();
  return (
    <ol className={[s.timeline, className ?? ''].join(' ')} aria-label={label}>
      {slots.map((slot, i) => {
        const n = i + 1;
        // The shaped badge is an image labelled "Ball 2: Four"; it names the slot. The caption repeats it visually.
        const content = (
          <>
            <OutcomeBadge mark={slot.mark} size={size} ball={slot.superBall ? undefined : n} />
            <span className={s.caption} aria-hidden="true">
              {slot.superBall ? t('plan.super_tab') : slot.caption ?? n}
            </span>
            {slot.note && <span className="sr-only">{slot.note}</span>}
          </>
        );
        return (
          <li key={i} className={s.slot} data-active={active === i || undefined} data-super={slot.superBall || undefined}>
            {onSelect ? (
              <button type="button" className={s.button} onClick={() => onSelect(i)} aria-current={active === i ? 'step' : undefined}>
                {content}
              </button>
            ) : (
              content
            )}
          </li>
        );
      })}
    </ol>
  );
}
