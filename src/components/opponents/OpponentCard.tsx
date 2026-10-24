import { useId } from 'react';
import type { OpponentMeta } from '@/engine/types';
import { SIMPLE_OPPONENTS } from '@/app/simple';
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
  /** Simple play style: nickname first, plain-words behaviour. */
  simple?: boolean;
}

const DOTS: Record<OpponentMeta['baseDifficulty'], number> = { Low: 1, Medium: 2, High: 3 };

export function OpponentCard({ opponent, selected, onToggle, animated = true, difficultyLabel, simple = false }: OpponentCardProps) {
  const nameId = useId();
  const descId = useId();
  const dots = DOTS[opponent.baseDifficulty];
  const easy = SIMPLE_OPPONENTS[opponent.id];
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
          {simple ? easy.nickname : opponent.name}
          {simple && <span className={styles.officialName}>{opponent.name}</span>}
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
        <p className={styles.behavior}>{simple ? easy.behavior : opponent.behavior}</p>
        <p className={styles.pressure}>
          {simple ? (
            <>
              <strong>Your move:</strong> {easy.pressure}
            </>
          ) : (
            <>
              <strong>Pressures you by</strong> {opponent.pressure.charAt(0).toLowerCase() + opponent.pressure.slice(1)}
            </>
          )}
        </p>
      </div>
      <button
        type="button"
        className={styles.toggle}
        aria-pressed={selected}
        aria-label={`${selected ? (simple ? 'Added' : 'Selected') : (simple ? 'Add' : 'Add opponent')} — ${opponent.name}`}
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
        {selected ? (simple ? 'Added' : 'Selected') : simple ? 'Add' : 'Add opponent'}
      </button>
    </article>
  );
}
