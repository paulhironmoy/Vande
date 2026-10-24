import { useEffect, useState } from 'react';
import styles from './ScoreDisplay.module.css';
import { formatScore, scoreBand } from './format';

interface ScoreDisplayProps {
  score: number;
  label: string;
  /** CSS size, e.g. "11rem". */
  size?: string;
  testId?: string;
  animated?: boolean;
  className?: string;
}

const R = 54;
const CIRC = 2 * Math.PI * R;

/** Large tabular score inside a progress ring. The number is rendered at its final value immediately. */
export function ScoreDisplay({ score, label, size = '11rem', testId, animated = true, className }: ScoreDisplayProps) {
  const value = Math.max(0, Math.min(100, Math.round(score)));
  const [shown, setShown] = useState(animated ? 0 : value);
  useEffect(() => {
    if (!animated) {
      setShown(value);
      return;
    }
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value, animated]);
  const band = scoreBand(value);
  const offset = CIRC - (CIRC * shown) / 100;
  return (
    <div
      className={[styles.wrap, styles[band], className].filter(Boolean).join(' ')}
      style={{ ['--score-size' as string]: size }}
      role="img"
      aria-label={`${label}: ${value} out of 100`}
    >
      <svg className={styles.ring} viewBox="0 0 120 120" aria-hidden="true">
        <circle className={styles.track} cx="60" cy="60" r={R} />
        <circle
          className={styles.progress}
          cx="60"
          cy="60"
          r={R}
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
        />
      </svg>
      <div className={styles.inner} aria-hidden="true">
        <div className={styles.value} data-testid={testId} data-score={value}>
          {formatScore(value)}
        </div>
        <div className={styles.outOf}>out of 100</div>
        <div className={styles.caption}>{label}</div>
      </div>
    </div>
  );
}
