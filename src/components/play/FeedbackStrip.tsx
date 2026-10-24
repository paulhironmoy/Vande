import type { ActionFeedback, Dimension } from '@/engine/types';
import { DIMENSION_LABELS } from '@/engine/types';
import { DIMENSION_ICON, PlayIcon } from './icons';
import { PlayButton, PlayIconButton } from './PlayButton';
import styles from './FeedbackStrip.module.css';

export interface FeedbackStripProps {
  feedback: ActionFeedback;
  /** Undo window: ticks left and total window length. */
  undo?: { left: number; total: number };
  onUndo?: () => void;
  onDismiss: () => void;
}

const WARNING_TEXT: Record<NonNullable<ActionFeedback['warning']>, string> = {
  'false-accusation': 'False accusation — freedom and trust took the hit.',
  disproportionate: 'Disproportionate force — freedom and trust took the hit.',
  'unverified-basis': 'Acted on unverified evidence.',
};

export function FeedbackStrip({ feedback, undo, onUndo, onDismiss }: FeedbackStripProps) {
  const warn = feedback.warning;
  return (
    <section className={styles.root} data-warning={warn ?? undefined} role="status" aria-live="polite" aria-label="Consequence">
      <div className={styles.iconWrap} aria-hidden="true">
        <PlayIcon name={warn ? 'warning' : 'check'} size={18} />
      </div>
      <div className={styles.body}>
        <p className={styles.title}>{feedback.title}</p>
        <p className={styles.text}>{feedback.text}</p>
        {warn ? <p className={styles.warn}>{WARNING_TEXT[warn]}</p> : null}
        {feedback.dims.length > 0 ? (
          <ul className={styles.dims} aria-label="Dimensions affected">
            {feedback.dims.map((d: Dimension) => {
              const dir = feedback.direction[d];
              return (
                <li key={d} className={styles.dim} data-dir={dir ?? 'none'} style={{ color: `var(--o-${d})` }}>
                  <PlayIcon name={DIMENSION_ICON[d]} size={14} />
                  {dir ? <PlayIcon name={dir === 'up' ? 'up' : 'down'} size={12} className={styles.dirIcon} /> : null}
                  <span className={styles.srOnly}>
                    {DIMENSION_LABELS[d]} {dir === 'up' ? 'rising' : dir === 'down' ? 'falling' : 'affected'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {undo && onUndo && undo.left > 0 ? (
          <div className={styles.undoRow}>
            <PlayButton variant="secondary" icon="undo" onClick={onUndo} data-testid="undo" className={styles.undoBtn}>
              Undo
              <span className={styles.srOnly}> — {undo.left} seconds left</span>
            </PlayButton>
            <span className={styles.undoBar} aria-hidden="true">
              <span className={styles.undoFill} style={{ width: `${Math.max(0, Math.min(100, (undo.left / Math.max(1, undo.total)) * 100))}%` }} />
            </span>
          </div>
        ) : null}
      </div>
      <PlayIconButton icon="close" label="Dismiss" onClick={onDismiss} className={styles.close} />
    </section>
  );
}
