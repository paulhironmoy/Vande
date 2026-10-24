import { useRef } from 'react';
import type { Difficulty } from '@/engine/types';
import { DIFFICULTIES } from '@/engine/types';
import styles from './DifficultyControl.module.css';

interface DifficultyControlProps {
  value: Difficulty;
  onChange: (d: Difficulty) => void;
  meta: Record<Difficulty, { label: string; description: string }>;
  labelledBy?: string;
}

/** Accessible radio group with arrow-key navigation. */
export function DifficultyControl({ value, onChange, meta, labelledBy }: DifficultyControlProps) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: React.KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % DIFFICULTIES.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + DIFFICULTIES.length) % DIFFICULTIES.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = DIFFICULTIES.length - 1;
    if (next === null) return;
    e.preventDefault();
    const d = DIFFICULTIES[next];
    onChange(d);
    refs.current[d]?.focus();
  };
  return (
    <div className={styles.group} role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : 'Difficulty'}>
      {DIFFICULTIES.map((d, i) => {
        const checked = d === value;
        return (
          <button
            key={d}
            ref={(el) => {
              refs.current[d] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.option}
            onClick={() => onChange(d)}
            onKeyDown={(e) => onKey(e, i)}
            data-testid={`difficulty-${d}`}
          >
            <span className={styles.label}>
              <span className={styles.mark} aria-hidden="true" />
              {meta[d]?.label ?? d}
            </span>
            <span className={styles.description}>{meta[d]?.description}</span>
          </button>
        );
      })}
    </div>
  );
}
