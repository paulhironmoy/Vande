import type { CSSProperties } from 'react';
import { Icon } from '@/components/ui';
import { ACTION_META, type ActionKind } from './actionKind';
import s from './ActionCard.module.css';

export interface ActionCardProps {
  kind: ActionKind;
  title: string;
  /** Optional small chip, e.g. "×2 clue checked" (bonus) or "Clue not checked" (caution). */
  badge?: { text: string; tone: 'bonus' | 'caution' };
  onSelect: () => void;
  /** This card was picked: it lifts and glows while the others fade back. */
  picked?: boolean;
  /** Another card was picked. */
  faded?: boolean;
  /** Visual feedback after resolution. */
  verdict?: 'right' | 'wrong';
  layout?: 'tile' | 'wide';
  /** Entrance stagger position. */
  index?: number;
  hideLabel?: boolean;
  disabled?: boolean;
  testId: string;
}

/** A playable action: app-icon badge, type, title. Feels like a card in a hand, not a quiz option. */
export function ActionCard({ kind, title, badge, onSelect, picked, faded, verdict, layout = 'tile', index = 0, hideLabel, disabled, testId }: ActionCardProps) {
  const meta = ACTION_META[kind];
  const style = { '--kind': meta.color, '--kind-deep': meta.deep, '--i': index } as CSSProperties;
  return (
    <button
      type="button"
      className={[s.card, layout === 'wide' ? s.wide : '', picked ? s.picked : '', faded ? s.faded : ''].filter(Boolean).join(' ')}
      style={style}
      onClick={onSelect}
      disabled={disabled}
      data-verdict={verdict}
      data-testid={testId}
      aria-label={hideLabel ? title : `${meta.label}: ${title}`}
    >
      <span className={s.sheen} aria-hidden="true" />
      <span className={s.badge} aria-hidden="true">
        <Icon name={verdict === 'right' ? 'check' : verdict === 'wrong' ? 'close' : meta.icon} size={22} strokeWidth={2.2} />
      </span>
      <span className={s.body}>
        {hideLabel ? null : (
          <span className={s.kind} aria-hidden="true">
            {meta.label}
          </span>
        )}
        <span className={s.title}>{title}</span>
        {badge ? (
          <span className={s.chip} data-tone={badge.tone}>
            {badge.text}
          </span>
        ) : null}
      </span>
    </button>
  );
}
