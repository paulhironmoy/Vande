import type { ReactNode } from 'react';
import styles from './Checklist.module.css';
import { StatusIcon, type StatusKind } from './icons';

export interface ChecklistItem {
  id: string;
  kind: StatusKind;
  text: ReactNode;
  meta?: ReactNode;
}

const TONE: Partial<Record<StatusKind, string>> = {
  resolved: 'var(--o-safety)',
  protected: 'var(--o-freedom)',
  unresolved: 'var(--a-saffron)',
  harmed: 'var(--o-danger)',
  exposed: 'var(--o-safety)',
  succeeded: 'var(--o-danger)',
  missed: 'var(--a-saffron)',
  info: 'var(--c-cyan)',
  up: 'var(--o-safety)',
  down: 'var(--o-danger)',
  flat: 'var(--t-tertiary)',
};

const SR: Record<StatusKind, string> = {
  resolved: 'Resolved',
  protected: 'Protected',
  unresolved: 'Unresolved',
  harmed: 'Harmed',
  exposed: 'Exposed',
  succeeded: 'Succeeded',
  missed: 'Missed',
  info: 'Note',
  up: 'Rising',
  down: 'Falling',
  flat: 'Steady',
};

export function Checklist({ items, emptyText, ariaLabel }: { items: ChecklistItem[]; emptyText: string; ariaLabel?: string }) {
  if (items.length === 0) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <ul className={styles.list} aria-label={ariaLabel}>
      {items.map((item) => (
        <li key={item.id} className={styles.item} style={{ ['--tone' as string]: TONE[item.kind] ?? 'var(--t-tertiary)' }}>
          <span className={styles.icon}>
            <StatusIcon kind={item.kind} size={18} />
            <span className={styles.srOnly}>{SR[item.kind]}:</span>
          </span>
          <span className={styles.text}>
            {item.text}
            {item.meta && <span className={styles.meta}>{item.meta}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
