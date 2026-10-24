import type { ActionFeedback, Dimension } from '@/engine/types';
import { DIMENSION_LABELS } from '@/engine/types';
import { DIMENSION_ICON, PlayIcon } from './icons';
import { PlayButton, PlayIconButton } from './PlayButton';
import { SIMPLE_DIMENSIONS, SIMPLE_UI } from '@/app/simple';
import { SIMPLE_FEEDBACK_WARNING, dimDirectionWords, encouragement } from './simpleCopy';
import styles from './FeedbackStrip.module.css';

export interface FeedbackStripProps {
  feedback: ActionFeedback;
  /** Undo window: ticks left and total window length. */
  undo?: { left: number; total: number };
  onUndo?: () => void;
  onDismiss: () => void;
  /** Simple play style: plain words and an encouraging line. */
  simple?: boolean;
  /** Plain-language replacements for the title/text (from the scenario's simple layer). */
  simpleOverride?: { title?: string; text?: string };
}

const WARNING_TEXT: Record<NonNullable<ActionFeedback['warning']>, string> = {
  'false-accusation': 'False accusation — freedom and trust took the hit.',
  disproportionate: 'Disproportionate force — freedom and trust took the hit.',
  'unverified-basis': 'Acted on unverified evidence.',
};

export function FeedbackStrip({ feedback, undo, onUndo, onDismiss, simple, simpleOverride }: FeedbackStripProps) {
  const warn = feedback.warning;
  const title = simple && simpleOverride?.title ? simpleOverride.title : feedback.title;
  const text = simple && simpleOverride?.text ? simpleOverride.text : feedback.text;
  return (
    <section className={[styles.root, simple ? styles.simple : ''].filter(Boolean).join(' ')} data-warning={warn ?? undefined} role="status" aria-live="polite" aria-label={simple ? 'What happened' : 'Consequence'}>
      <div className={styles.iconWrap} aria-hidden="true">
        <PlayIcon name={warn ? 'warning' : 'check'} size={18} />
      </div>
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        <p className={styles.text}>{text}</p>
        {warn ? <p className={styles.warn}>{simple ? SIMPLE_FEEDBACK_WARNING[warn] : WARNING_TEXT[warn]}</p> : null}
        {simple && !warn ? (
          <p className={styles.cheer} data-testid="feedback-cheer">
            {encouragement(feedback)}
          </p>
        ) : null}
        {feedback.dims.length > 0 ? (
          <ul className={styles.dims} aria-label={simple ? 'What changed' : 'Dimensions affected'}>
            {feedback.dims.map((d: Dimension) => {
              const dir = feedback.direction[d];
              return (
                <li key={d} className={styles.dim} data-dir={dir ?? 'none'} style={{ color: `var(--o-${d})` }}>
                  <PlayIcon name={DIMENSION_ICON[d]} size={14} />
                  {simple ? <span className={styles.dimWord}>{SIMPLE_DIMENSIONS[d].short}</span> : null}
                  {dir ? <PlayIcon name={dir === 'up' ? 'up' : 'down'} size={12} className={styles.dirIcon} /> : null}
                  <span className={styles.srOnly}>
                    {simple ? dimDirectionWords(d, dir) : `${DIMENSION_LABELS[d]} ${dir === 'up' ? 'rising' : dir === 'down' ? 'falling' : 'affected'}`}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
        {undo && onUndo && undo.left > 0 ? (
          <div className={styles.undoRow}>
            <PlayButton variant="secondary" icon="undo" onClick={onUndo} data-testid="undo" className={styles.undoBtn}>
              {simple ? SIMPLE_UI.undo : 'Undo'}
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
