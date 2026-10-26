import type { ReactNode } from 'react';
import { useT, type MessageKey } from '@/i18n';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import s from './StateView.module.css';

export type StateKind =
  | 'loading'
  | 'offline'
  | 'reconnecting'
  | 'empty_cup'
  | 'pending_opponent'
  | 'locked'
  | 'deadline_expired'
  | 'reveal_ready'
  | 'error'
  | 'consent_declined'
  | 'upload_queued'
  | 'upload_failed'
  | 'muted_group'
  | 'reduced_motion';

const ICON: Record<StateKind, IconName> = {
  loading: 'ball',
  offline: 'offline',
  reconnecting: 'refresh',
  empty_cup: 'stumps',
  pending_opponent: 'clock',
  locked: 'seal',
  deadline_expired: 'clock',
  reveal_ready: 'sparkle',
  error: 'alert',
  consent_declined: 'eye-off',
  upload_queued: 'arrow-up',
  upload_failed: 'refresh',
  muted_group: 'sound-off',
  reduced_motion: 'slowmo',
};

const TONE: Partial<Record<StateKind, 'cyan' | 'amber' | 'danger' | 'violet'>> = {
  error: 'danger',
  upload_failed: 'danger',
  deadline_expired: 'amber',
  reveal_ready: 'amber',
  locked: 'violet',
};

export interface StateViewProps {
  kind: StateKind;
  /** Override the default copy. */
  title?: ReactNode;
  body?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  children?: ReactNode;
}

/** One consistent pattern for every loading, empty, waiting and error state. */
export function StateView({ kind, title, body, actionLabel, onAction, compact, children }: StateViewProps) {
  const { t } = useT();
  const busy = kind === 'loading' || kind === 'reconnecting';
  return (
    <div className={[s.state, compact ? s.compact : ''].join(' ')} data-tone={TONE[kind] ?? 'cyan'} role={kind === 'error' || kind === 'upload_failed' ? 'alert' : 'status'} aria-busy={busy || undefined}>
      <div className={s.emblem} data-busy={busy || undefined} aria-hidden="true">
        <span className={s.ring} />
        <Icon name={ICON[kind]} size={compact ? 22 : 30} />
      </div>
      <div className={s.text}>
        <h2 className={s.title}>{title ?? t(`state.${kind}.title` as MessageKey)}</h2>
        <p className={s.body}>{body ?? t(`state.${kind}.body` as MessageKey)}</p>
      </div>
      {children}
      {onAction && (
        <Button variant={kind === 'reveal_ready' ? 'accent' : 'primary'} onClick={onAction} icon={kind === 'error' || kind === 'upload_failed' ? 'refresh' : undefined}>
          {actionLabel ?? t('common.retry')}
        </Button>
      )}
    </div>
  );
}
