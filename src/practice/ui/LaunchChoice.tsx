/**
 * The launch choice: Practice ("Experience batting") or Skip ("Continue to VANDE"). Shown on a normal start, before
 * any sign-in, account, network or configuration (deep links skip it: shouldOfferLaunchChoice). Practice needs
 * nothing else: it runs on the device. A first-time player goes straight into batting, so the landscape lock is
 * requested inside this tap, while the browser still allows fullscreen.
 */
import { useEffect, useRef } from 'react';
import { Logo } from '@/ui';
import { lockLandscape } from '@/platform/orientation';
import { usePracticeT } from '@/i18n/practice';
import { loadPracticeSettings } from '@/practice/store';
import { markPracticeSelected } from './launch';
import { prepareAudioUnlock } from './audioWarm';
import s from './LaunchChoice.module.css';

export interface LaunchChoiceProps {
  onPractice: () => void;
  onSkip: () => void;
}

export function LaunchChoice({ onPractice, onSkip }: LaunchChoiceProps) {
  const t = usePracticeT();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus({ preventScroll: true });
    // The Practice tap then warms audio, so the first swing never pays for it.
    prepareAudioUnlock();
    // Fetch Practice's code while the player reads the choice: a shorter wait for the first ball.
    const prefetch = () => void import('./PracticeRoute').catch(() => undefined);
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(prefetch, { timeout: 2000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(prefetch, 800);
    return () => window.clearTimeout(id);
  }, []);
  const practice = () => {
    markPracticeSelected();
    // The first session bats at once (the guided over), so ask for landscape now, inside the tap.
    if (!loadPracticeSettings().guidedDone) void lockLandscape();
    onPractice();
  };
  return (
    <div className={s.root} role="dialog" aria-modal="true" aria-labelledby="launch-heading" data-testid="launch-choice">
      <main className={s.inner}>
        <Logo size={72} wordmark className={s.logo} />
        <h1 id="launch-heading" className={s.heading}>
          {t.t('practice.launch.heading')}
        </h1>
        <div className={s.choices}>
          <button ref={first} type="button" className={`${s.choice} ${s.practice}`} onClick={practice} data-testid="launch-practice">
            <span className={s.title}>{t.t('practice.launch.practice')}</span>
            <span className={s.sub}>{t.t('practice.launch.practice_sub')}</span>
          </button>
          <button type="button" className={`${s.choice} ${s.skip}`} onClick={onSkip} data-testid="launch-skip">
            <span className={s.title}>{t.t('practice.launch.skip')}</span>
            <span className={s.sub}>{t.t('practice.launch.skip_sub')}</span>
          </button>
        </div>
        <p className={s.note}>{t.t('practice.launch.note')}</p>
      </main>
    </div>
  );
}

export default LaunchChoice;
