import { useState } from 'react';
import type { FeedItem } from '@/engine/types';
import { FEED_ICON, FEED_LABEL, PlayIcon } from './icons';
import { formatClock } from './format';
import { SIMPLE_UI } from '@/app/simple';
import styles from './ConsequenceFeed.module.css';

export interface ConsequenceFeedProps {
  items: FeedItem[];
  limit?: number;
  /** Mobile strip: collapsed to the latest line until expanded. */
  collapsible?: boolean;
  className?: string;
  /** Simple play style: "What's happening" plus plain-language lines. */
  simple?: boolean;
  /** Maps a feed line to its plain-language version (identity when none exists). */
  simplify?: (text: string) => string;
}

export function ConsequenceFeed({ items, limit = 6, collapsible, className, simple, simplify }: ConsequenceFeedProps) {
  const [open, setOpen] = useState(false);
  const text = (t: string) => (simple && simplify ? simplify(t) : t);
  const recent = [...items].slice(-limit).reverse();
  const latest = recent[0];
  const expanded = !collapsible || open;
  const heading = simple ? SIMPLE_UI.happeningNow : 'Happening now';

  return (
    <section className={[styles.root, collapsible ? styles.collapsible : '', className ?? ''].filter(Boolean).join(' ')} data-testid="feed" aria-label={heading}>
      {collapsible ? (
        <button type="button" className={styles.toggle} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <span className={styles.toggleLabel}>
            <PlayIcon name="bell" size={14} />
            {heading}
          </span>
          {!open && latest ? (
            <span className={styles.latest}>
              <PlayIcon name={FEED_ICON[latest.kind]} size={13} />
              <span className={styles.latestText}>{text(latest.text)}</span>
            </span>
          ) : null}
          <PlayIcon name={open ? 'chevronDown' : 'chevronUp'} size={16} className={styles.chev} />
        </button>
      ) : (
        <h3 className={styles.heading}>
          <PlayIcon name="bell" size={14} />
          {heading}
        </h3>
      )}
      <ol className={styles.list} aria-live="polite" aria-relevant="additions" hidden={!expanded}>
        {recent.length === 0 ? <li className={styles.empty}>{simple ? 'All quiet for now.' : 'Quiet for now.'}</li> : null}
        {recent.map((f) => (
          <li key={f.id} className={styles.item} data-kind={f.kind}>
            <span className={styles.icon} title={FEED_LABEL[f.kind]}>
              <PlayIcon name={FEED_ICON[f.kind]} size={14} title={FEED_LABEL[f.kind]} />
            </span>
            <span className={styles.text}>{text(f.text)}</span>
            <time className={styles.time} aria-label={`${formatClock(f.tick)} into the chapter`}>{formatClock(f.tick)}</time>
          </li>
        ))}
      </ol>
    </section>
  );
}
