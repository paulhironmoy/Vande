import { useId } from 'react';
import type { OpponentMeta } from '@/engine/types';
import styles from './OpponentCard.module.css';
import { SignalGlyph } from './SignalGlyph';
import { OPPONENT_TONE } from './tones';

interface OpponentCardProps {
  opponent: OpponentMeta;
  selected: boolean;
  onToggle: () => void;
  animated?: boolean;
  /** Difficulty label adjusted for the chosen difficulty (defaults to the base difficulty). */
  difficultyLabel?: string;
}

const DOTS: Record<OpponentMeta['baseDifficulty'], number> = { Low: 1, Medium: 2, High: 3 };

export function OpponentCard({ opponent, selected, onToggle, animated = true, difficultyLabel }: OpponentCardProps) {
  const nameId = useId();
  const descId = useId();
  const dots = DOTS[opponent.baseDifficulty];
  return (
    <article
      className={[styles.card, selected ? styles.selected : ''].join(' ')}
      style={{ ['--tone' as string]: OPPONENT_TONE[opponent.id] }}
      data-testid={`opponent-card-${opponent.id}`}
      data-selected={selected ? 'true' : 'false'}
    >
      <div className={styles.glyphWrap}>
        <SignalGlyph kind={opponent.signal} size={44} animated={animated && selected} />
      </div>
      <div className={styles.head}>
        <h3 className={styles.name} id={nameId}>
          {opponent.name}
        </h3>
        <span className={styles.difficulty} aria-label={`Difficulty ${difficultyLabel ?? opponent.baseDifficulty}`}>
          <span className={styles.dots} aria-hidden="true">
            {[1, 2, 3].map((i) => (
              <span key={i} className={[styles.dot, i <= dots ? styles.dotOn : ''].join(' ')} />
            ))}
          </span>
          {difficultyLabel ?? opponent.baseDifficulty}
        </span>
      </div>
      <div className={styles.body} id={descId}>
        <p className={styles.behavior}>{opponent.behavior}</p>
        <p className={styles.pressure}>
          <strong>Pressures you by</strong> {opponent.pressure.charAt(0).toLowerCase() + opponent.pressure.slice(1)}
        </p>
      </div>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={selected}
        aria-labelledby={nameId}
        aria-describedby={descId}
        onClick={onToggle}
        data-testid={`opponent-toggle-${opponent.id}`}
      >
        <span className={styles.check} aria-hidden="true">
          {selected && (
            <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2.5 6.5l2.5 2.5 4.5-5" />
            </svg>
          )}
        </span>
        {selected ? 'Selected' : 'Add opponent'}
      </button>
    </article>
  );
}
