import { useEffect, useState, type ReactNode } from 'react';
import type { GameStatus } from '@/engine/types';
import { PlayIconButton } from './PlayButton';
import { PlayIcon } from './icons';
import { formatClock, phaseLabel } from './format';
import { SIMPLE_UI } from '@/app/simple';
import { simplePhase } from './simpleCopy';
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
  /** Simple play style: plain phase words. */
  simple?: boolean;
  /** The clock is paused automatically for a new decision (Simple style). */
  waiting?: boolean;
  /** Simple style: city mood shown in the kicker on narrow phones (where the compact pulse hides its label). */
  mood?: { label: string; tone: 'great' | 'good' | 'shaky' | 'trouble' };
}

export function StatusBar({ chapter, title, tick, duration, status, onPause, pulseSlot, className, simple, waiting, mood }: StatusBarProps) {
  const left = Math.max(0, duration - tick);
  const urgent = left <= 20 && status !== 'ended' && !waiting;
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
          <span aria-hidden="true" className={styles.sepPhase}>
            ·
          </span>
          <span className={styles.phase}>{simple ? simplePhase(tick, duration) : phaseLabel(tick, duration)}</span>
          {mood ? (
            <>
              <span aria-hidden="true" className={styles.sepMood}>
                ·
              </span>
              <span className={styles.mood} data-tone={mood.tone}>
                {mood.label}
              </span>
            </>
          ) : null}
        </p>
        <h1 className={styles.title}>{title}</h1>
      </div>
      <div className={styles.right}>
        <div className={styles.clockGroup}>
          <span
            className={styles.timer}
            role="timer"
            aria-live="off"
            aria-label={`${simple ? SIMPLE_UI.timeLeft : 'Time left'} ${formatClock(left)}${waiting ? ', clock waiting for you' : ''}`}
            data-testid="timer"
            data-urgent={urgent ? 'true' : undefined}
            data-status={status}
            data-waiting={waiting ? 'true' : undefined}
          >
            {waiting ? <PlayIcon name="pause" size={14} className={styles.waitGlyph} /> : null}
            {formatClock(left)}
          </span>
        </div>
        <PlayIconButton
          icon={status === 'paused' ? 'play' : 'pause'}
          label={status === 'paused' ? (simple ? SIMPLE_UI.resume : 'Resume') : SIMPLE_UI.pause}
          onClick={onPause}
          data-testid="pause"
          variant="solid"
          disabled={status === 'ended'}
        />
      </div>
      <span className={styles.srOnly} aria-live="polite">
        {announce}
      </span>
    </header>
  );
}
