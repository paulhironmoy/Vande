import { useEffect, useState, type ReactNode } from 'react';
import type { GameStatus } from '@/engine/types';
import { PlayIcon } from './icons';
import { PlayIconButton } from './PlayButton';
import { formatClock, phaseLabel, worldTime } from './format';
import styles from './StatusBar.module.css';

export interface StatusBarProps {
  chapter: number;
  title: string;
  tick: number;
  duration: number;
  status: GameStatus;
  onPause: () => void;
  /** Slot for the compact Republic Pulse (mobile). */
  pulseSlot?: ReactNode;
  className?: string;
}

export function StatusBar({ chapter, title, tick, duration, status, onPause, pulseSlot, className }: StatusBarProps) {
  const left = Math.max(0, duration - tick);
  const urgent = left <= 20 && status !== 'ended';
  const [announce, setAnnounce] = useState('');
  useEffect(() => {
    if (left === 30 && status === 'running') {
      setAnnounce('30 seconds left');
      const t = window.setTimeout(() => setAnnounce(''), 4000);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [left, status]);

  return (
    <header className={[styles.bar, className ?? ''].filter(Boolean).join(' ')} data-testid="status-bar">
      {pulseSlot ? <div className={styles.pulseSlot}>{pulseSlot}</div> : null}
      <div className={styles.titles}>
        <p className={styles.kicker}>
          <span className={styles.chapter}>Chapter {chapter}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.phase}>{phaseLabel(tick, duration)}</span>
        </p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.right}>
        <div className={styles.clockGroup}>
          <span className={styles.world} aria-label={`In-world time ${worldTime(tick)}`}>
            <PlayIcon name="clock" size={13} />
            {worldTime(tick)}
          </span>
          <span className={styles.timer} role="timer" aria-live="off" aria-label={`Time left ${formatClock(left)}`} data-testid="timer" data-urgent={urgent ? 'true' : undefined} data-status={status}>
            {formatClock(left)}
          </span>
        </div>
        <PlayIconButton icon={status === 'paused' ? 'play' : 'pause'} label={status === 'paused' ? 'Resume' : 'Pause'} onClick={onPause} data-testid="pause" variant="solid" disabled={status === 'ended'} />
      </div>
      <span className={styles.srOnly} aria-live="polite">
        {announce}
      </span>
    </header>
  );
}
