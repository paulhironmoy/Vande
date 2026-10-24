import { useState } from 'react';
import type { FeedItem } from '@/engine/types';
import { FEED_ICON, FEED_LABEL, PlayIcon } from './icons';
import { worldTime } from './format';
import styles from './ConsequenceFeed.module.css';

export interface ConsequenceFeedProps {
  items: FeedItem[];
  limit?: number;
  /** Mobile strip: collapsed to the latest line until expanded. */
  collapsible?: boolean;
  className?: string;
}

export function ConsequenceFeed({ items, limit = 6, collapsible, className }: ConsequenceFeedProps) {
  const [open, setOpen] = useState(false);
  const recent = [...items].slice(-limit).reverse();
  const latest = recent[0];
  const expanded = !collapsible || open;

  return (
    <section className={[styles.root, collapsible ? styles.collapsible : '', className ?? ''].filter(Boolean).join(' ')} data-testid="feed" aria-label="What is happening">
      {collapsible ? (
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className={styles.toggleLabel}>
            <PlayIcon name="bell" size={14} />
            Happening now
          </span>
          {!open && latest ? (
            <span className={styles.latest}>
              <PlayIcon name={FEED_ICON[latest.kind]} size={13} />
              <span className={styles.latestText}>{latest.text}</span>
            </span>
          ) : null}
          <PlayIcon name={open ? 'chevronDown' : 'chevronUp'} size={16} className={styles.chev} />
        </button>
      ) : (
        <h3 className={styles.heading}>
          <PlayIcon name="bell" size={14} />
          Happening now
        </h3>
      )}
      <ol className={styles.list} aria-live="polite" aria-relevant="additions" hidden={!expanded}>
        {recent.length === 0 ? <li className={styles.empty}>Quiet for now.</li> : null}
        {recent.map((f) => (
          <li key={f.id} className={styles.item} data-kind={f.kind}>
            <span className={styles.icon} title={FEED_LABEL[f.kind]}>
              <PlayIcon name={FEED_ICON[f.kind]} size={14} title={FEED_LABEL[f.kind]} />
            </span>
            <span className={styles.text}>{f.text}</span>
            <time className={styles.time}>{worldTime(f.tick)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
