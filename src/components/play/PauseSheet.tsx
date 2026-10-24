import { useEffect, useState } from 'react';
import type { TimerPace } from '@/engine/types';
import { PlaySheet } from './PlaySheet';
import { PlayButton } from './PlayButton';
import { PlayIcon } from './icons';
import { SIMPLE_UI } from '@/app/simple';
import { SIMPLE_PACE, SIMPLE_TEXT } from './simpleCopy';
import styles from './PauseSheet.module.css';

export interface PauseSheetProps {
  open: boolean;
  pace: TimerPace;
  chapterTitle: string;
  onResume: () => void;
  onAbandon: () => void;
  onOpenSettings?: () => void;
  /** Simple play style: plain words. */
  simple?: boolean;
}

const PACE_TEXT: Record<TimerPace, string> = {
  standard: 'Standard pace: a chapter lasts about three minutes.',
  relaxed: 'Relaxed pace: the clock runs at two-thirds speed, so a chapter lasts about four and a half minutes.',
  extended: 'Extended pace: the clock runs at half speed, so a chapter lasts about six minutes.',
};

export function PauseSheet({ open, pace, chapterTitle, onResume, onAbandon, onOpenSettings, simple }: PauseSheetProps) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!open) setConfirm(false);
  }, [open]);
  return (
    <PlaySheet open={open} onClose={onResume} title="Paused" testId="pause-sheet" closeLabel={simple ? SIMPLE_UI.resume : 'Resume'}>
      <div className={styles.root}>
        <p className={styles.lead}>
          <PlayIcon name="pause" size={16} />
          {simple ? SIMPLE_TEXT.pauseLead : 'The clock is stopped. Nothing in the city moves until you resume.'}
        </p>
        <p className={styles.chapter}>{chapterTitle}</p>
        <PlayButton variant="primary" size="lg" block icon="play" onClick={onResume} data-testid="resume" data-autofocus>
          {simple ? SIMPLE_UI.resume : 'Resume'}
        </PlayButton>
        <section className={styles.section} aria-labelledby="pause-pace">
          <h3 id="pause-pace" className={styles.h3}>
            {simple ? SIMPLE_TEXT.speedHeading : 'Timer pace'}
          </h3>
          <p className={styles.text}>{simple ? SIMPLE_PACE[pace] : PACE_TEXT[pace]}</p>
          <p className={styles.text}>
            {simple
              ? SIMPLE_TEXT.settingsNote
              : 'The pace, text size, contrast and motion can be changed in Settings at any time. Pausing never costs anything; the game also pauses by itself if you leave the app.'}
          </p>
          {onOpenSettings ? (
            <PlayButton variant="ghost" icon="chevronRight" onClick={onOpenSettings}>
              {simple ? SIMPLE_TEXT.openSettings : 'Open settings'}
            </PlayButton>
          ) : null}
        </section>
        <section className={styles.section} aria-labelledby="pause-abandon">
          <h3 id="pause-abandon" className={styles.h3}>
            {simple ? SIMPLE_TEXT.leaveHeading : 'Leave this chapter'}
          </h3>
          {!confirm ? (
            <PlayButton variant="ghost" icon="close" onClick={() => setConfirm(true)}>
              {simple ? SIMPLE_TEXT.abandon : 'Abandon chapter'}
            </PlayButton>
          ) : (
            <div className={styles.confirm} role="group" aria-label={simple ? 'Are you sure you want to stop?' : 'Confirm abandoning the chapter'}>
              <p className={styles.text}>{simple ? SIMPLE_TEXT.abandonConfirm : 'Abandoning ends this campaign. Your Republic record keeps earlier chapters, but this chapter will not be scored.'}</p>
              <div className={styles.confirmRow}>
                <PlayButton variant="danger" onClick={onAbandon} data-testid="abandon-confirm">
                  {simple ? SIMPLE_TEXT.yesStop : 'Yes, abandon'}
                </PlayButton>
                <PlayButton variant="secondary" onClick={() => setConfirm(false)}>
                  {simple ? SIMPLE_TEXT.keepPlaying : 'Keep playing'}
                </PlayButton>
              </div>
            </div>
          )}
        </section>
      </div>
    </PlaySheet>
  );
}
