import { useEffect, useState } from 'react';
import type { Scores } from '@/engine/types';
import { DIMENSIONS, DIMENSION_LABELS } from '@/engine/types';
import styles from './DimensionBreakdown.module.css';
import { DimensionIcon, StatusIcon } from './icons';
import { dimensionColorVar, formatScore } from './format';

interface DimensionBreakdownProps {
  scores: Scores;
  /** When provided, a start marker and a delta chip are shown per dimension. */
  startScores?: Scores;
  columns?: 1 | 2;
  animated?: boolean;
  ariaLabel?: string;
}

export function DimensionBreakdown({ scores, startScores, columns = 1, animated = true, ariaLabel = 'Six-dimension breakdown' }: DimensionBreakdownProps) {
  const [ready, setReady] = useState(!animated);
  useEffect(() => {
    if (!animated) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [animated]);
  return (
    <ul className={[styles.list, columns === 2 ? styles.twoCol : ''].join(' ')} aria-label={ariaLabel}>
      {DIMENSIONS.map((dim) => {
        const value = Math.round(scores[dim]);
        const start = startScores ? Math.round(startScores[dim]) : undefined;
        const delta = start === undefined ? undefined : value - start;
        const direction = delta === undefined ? undefined : delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
        const deltaText = delta === undefined ? '' : delta > 0 ? `up ${delta}` : delta < 0 ? `down ${Math.abs(delta)}` : 'unchanged';
        return (
          <li
            key={dim}
            className={styles.row}
            style={{ ['--dim-color' as string]: dimensionColorVar(dim) }}
            aria-label={`${DIMENSION_LABELS[dim]}: ${value} out of 100${delta !== undefined ? `, ${deltaText} since the start` : ''}`}
          >
            <span className={styles.icon}>
              <DimensionIcon dim={dim} size={20} />
            </span>
            <span className={styles.label} aria-hidden="true">
              {DIMENSION_LABELS[dim]}
            </span>
            <span className={styles.value} aria-hidden="true">
              {direction && (
                <span className={[styles.delta, direction === 'up' ? styles.deltaUp : direction === 'down' ? styles.deltaDown : styles.deltaFlat].join(' ')}>
                  <StatusIcon kind={direction} size={12} />
                  {delta === 0 ? '0' : `${delta! > 0 ? '+' : '−'}${Math.abs(delta!)}`}
                </span>
              )}
              <span className={styles.number}>{formatScore(value)}</span>
            </span>
            <span className={styles.meter} aria-hidden="true">
              <span className={styles.fill} style={{ ['--w' as string]: `${ready ? value : 0}%` }} />
              {start !== undefined && <span className={styles.startMark} style={{ ['--start' as string]: `${start}%` }} />}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
