/**
 * The live screen's temporary panels: pause (resume, restart the over, leave, sound), the complete setup between
 * balls, the calm wait while the ground gets ready, "turn your phone", the replay bar, and the pre-delivery hint.
 * Each has one primary action and stays clear of the play when the play is live.
 */
import type { ReactNode } from 'react';
import { useApp } from '@/app/store';
import { prefersPointerFine } from '@/platform/orientation';
import { usePracticeT } from '@/i18n/practice';
import { PButton, PIconButton, sys } from '../design';
import s from './Panels.module.css';

export function Center({ children }: { children: ReactNode }) {
  return <div className={s.center}>{children}</div>;
}

export function PausePanel(p: { notice: string | null; canRestart: boolean; onResume: () => void; onRestart: () => void; onLeave: () => void; onSettings: () => void }) {
  const t = usePracticeT();
  const sound = useApp((st) => st.settings.sound);
  const update = useApp((st) => st.updateSettings);
  return (
    <Center>
      <section className={s.panel} role="dialog" aria-modal="true" aria-labelledby="practice-paused-title" data-testid="practice-paused">
        <h2 id="practice-paused-title" className={sys.title}>
          {t.t('practice.pause.title')}
        </h2>
        {p.notice && (
          <p className={s.notice} role="status" data-testid="practice-panel-notice">
            {p.notice}
          </p>
        )}
        <p className={sys.caption}>{t.t('practice.pause.safe')}</p>
        <div className={s.actions}>
          <PButton variant="primary" size="lg" icon="play" onClick={p.onResume} autoFocus data-testid="practice-resume">
            {t.t('practice.pause.resume')}
          </PButton>
          {p.canRestart && (
            <PButton variant="secondary" icon="replay" onClick={p.onRestart} data-testid="practice-restart-over">
              {t.t('practice.pause.restart')}
            </PButton>
          )}
          <PButton variant="secondary" icon="home" onClick={p.onLeave} data-testid="practice-leave">
            {t.t('practice.pause.leave')}
          </PButton>
        </div>
        <div className={s.quietRow}>
          <PButton variant="quiet" icon={sound ? 'sound' : 'sound-off'} aria-pressed={sound} onClick={() => update({ sound: !sound })} data-testid="practice-sound-toggle">
            {sound ? t.t('practice.pause.sound_on') : t.t('practice.pause.sound_off')}
          </PButton>
          <PButton variant="quiet" icon="settings" onClick={p.onSettings} data-testid="practice-pause-settings">
            {t.t('practice.home.settings')}
          </PButton>
        </div>
      </section>
    </Center>
  );
}

export function BriefSheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const t = usePracticeT();
  return (
    <aside className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="practice-brief-title" data-testid="practice-brief">
      <div className={s.sheetHead}>
        <h2 id="practice-brief-title" className={sys.section}>
          {t.t('practice.brief.title')}
        </h2>
        <PIconButton icon="close" label={t.t('practice.brief.close')} onClick={onClose} data-testid="practice-brief-close" autoFocus />
      </div>
      {children}
    </aside>
  );
}

export function Loading({ notice }: { notice: string | null }) {
  const t = usePracticeT();
  return (
    <Center>
      <section className={`${s.panel} ${s.loading}`} role="status" aria-live="polite" data-testid="practice-loading">
        <span className={s.seam} aria-hidden="true" />
        <h2 className={sys.section}>{t.t('practice.loading.title')}</h2>
        {notice && (
          <p className={s.notice} data-testid="practice-panel-notice">
            {notice}
          </p>
        )}
      </section>
    </Center>
  );
}

export function TurnPhone({ onContinue }: { onContinue: () => void }) {
  const t = usePracticeT();
  return (
    <div className={s.turn} role="dialog" aria-modal="true" aria-labelledby="practice-turn" data-testid="practice-turn">
      <div className={s.turnInner}>
        <svg className={s.turnIcon} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="7" y="2.5" width="10" height="19" rx="2" />
          <path d="M11 18.5h2" strokeLinecap="round" />
        </svg>
        <h2 id="practice-turn" className={sys.section}>
          {t.t('practice.live.turn_title')}
        </h2>
        <p className={sys.caption}>{t.t('practice.live.turn_body')}</p>
        {prefersPointerFine() && (
          <PButton variant="secondary" onClick={onContinue} data-testid="practice-turn-continue">
            {t.t('practice.live.turn_continue')}
          </PButton>
        )}
      </div>
    </div>
  );
}

export function ReplayBar(p: { title: string; playing: boolean; onAgain: () => void; onClose: () => void; index: number }) {
  const t = usePracticeT();
  return (
    <div className={s.replayBar} role="toolbar" aria-label={p.title} data-testid="practice-replay" data-index={p.index} data-playing={p.playing ? 'true' : 'false'}>
      <span className={sys.section}>{p.title}</span>
      {!p.playing && (
        <PButton variant="quiet" icon="replay" onClick={p.onAgain}>
          {t.t('practice.replay.again')}
        </PButton>
      )}
      <PButton variant="secondary" icon="close" onClick={p.onClose} data-testid="practice-replay-close">
        {t.t('practice.replay.close')}
      </PButton>
    </div>
  );
}

/** The first run's one short demonstration: what it is, and the one-tap ways past it (remembered). */
export function IntroPanel({ onSkip, onSkipAll }: { onSkip: () => void; onSkipAll: () => void }) {
  const t = usePracticeT();
  return (
    <section className={s.intro} aria-labelledby="practice-intro-title" data-testid="practice-intro">
      <h2 id="practice-intro-title" className={sys.section}>
        {t.t('practice.intro.title')}
      </h2>
      <p className={sys.caption}>{t.t('practice.intro.body')}</p>
      <div className={s.quietRow}>
        <PButton variant="secondary" onClick={onSkip} data-testid="practice-intro-skip">
          {t.t('practice.intro.skip')}
        </PButton>
        <PButton variant="quiet" onClick={onSkipAll} data-testid="practice-intro-skip-all">
          {t.t('practice.intro.skip_all')}
        </PButton>
      </div>
    </section>
  );
}

export function Hint({ text, accessibilityHidden = false }: { text: string; accessibilityHidden?: boolean }) {
  return (
    <p className={s.hint} data-testid="practice-hint" aria-hidden={accessibilityHidden || undefined}>
      {text}
    </p>
  );
}
