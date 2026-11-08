/**
 * The Practice home (constitution §1: choose an over; the product sequence's Stage 1 launch flow). Random Over is the
 * one dominant action (balanced defaults: Club bowling on a Balanced pitch, which the setup can change); Predefined
 * Over, with the reference over first, is the secondary choice. With an innings in progress, "Continue innings" leads
 * instead and a new innings sits behind a disclosure (confirmed: its score is final). Between overs of an innings the
 * same screen chooses the next over. It is the app's first screen, so it has no back action of its own.
 */
import { useEffect, useState } from 'react';
import type { PracticeInningsState } from '@/contracts';
import { Icon } from '@/ui';
import { usePracticeT } from '@/i18n/practice';
import { preloadPracticeStage } from '@/render3d';
import { PButton, PChoice, PConfirm, PDisclosure, PIconButton, Screen, sys } from '../design';
import { oversText } from '../coaching';
import type { FlowNotice } from '../flow/state';
import s from './Home.module.css';
import { PremiumShellBackdrop } from './PremiumShellBackdrop';

export interface HomeProps {
  /** 'next': choosing the next over of the innings in progress. */
  mode: 'new' | 'next';
  resumable: PracticeInningsState | null;
  notice: FlowNotice;
  storageOk: boolean;
  onChoose: (kind: 'random' | 'predefined') => void;
  onContinue: () => void;
  onDiscard: () => void;
  onSettings: () => void;
  /** Between overs only: back to the over summary. */
  onBack: (() => void) | null;
}

export function Home(p: HomeProps) {
  const t = usePracticeT();
  const [confirm, setConfirm] = useState<null | 'predefined' | 'random'>(null);
  // Fetch the stage's code while the player chooses (never earlier: a player who skips Practice never downloads it).
  useEffect(() => preloadPracticeStage(), []);
  const r = p.mode === 'new' ? p.resumable : null;
  const choose = (k: 'predefined' | 'random') => (r ? setConfirm(k) : p.onChoose(k));
  const notice = p.notice === 'updated' || p.notice === 'unreadable' ? t.tk(`practice.notice.${p.notice}`) : null;
  const choices = (primary: boolean) => (
    <div className={s.choices}>
      <PChoice className={s.randomChoice} primary={primary} title={t.t('practice.home.random')} description={t.t('practice.home.random_sub')} onClick={() => choose('random')} data-testid="practice-random" />
      <PChoice className={s.predefinedChoice} title={t.t('practice.home.predefined')} description={t.t('practice.home.predefined_sub')} onClick={() => choose('predefined')} data-testid="practice-predefined" />
    </div>
  );
  return (
    <div className={s.shell}>
      <PremiumShellBackdrop variant="home" />
      <Screen
        className={s.screen}
        title={p.mode === 'next' ? t.t('practice.home.next_title') : t.t('practice.home.title')}
        onBack={p.onBack ?? undefined}
        end={<PIconButton icon="settings" label={t.t('practice.home.settings')} onClick={p.onSettings} data-testid="practice-settings-open" />}
        testId="practice-menu"
      >
        <div className={s.commandPanel}>
          {!p.storageOk && (
            <p className={s.notice} role="status" data-testid="practice-storage-off">
              <Icon name="alert" size={18} /> {t.t('practice.common.storage_off')}
            </p>
          )}
          {notice && (
            <p className={s.notice} role="status" data-testid="practice-notice-updated">
              {notice}
            </p>
          )}
          {r ? (
            <>
              <section className={s.resume} data-testid="practice-resume-card" aria-labelledby="practice-resume-title">
                <h2 id="practice-resume-title" className={sys.section}>
                  {t.t('practice.home.resume_title')}
                </h2>
                <p className={s.score}>{t.t('practice.common.score', { runs: r.runs, wickets: 0 })}</p>
                <p className={sys.caption}>{t.t('practice.home.resume_body', { overs: oversText(r.balls) })}</p>
                {p.notice === 'resumed_leave' && (
                  <p className={sys.caption} role="status" data-testid="practice-resumed-leave">
                    {t.t('practice.notice.resumed_leave')}
                  </p>
                )}
                <PButton variant="primary" size="lg" block icon="play" onClick={p.onContinue} data-testid="practice-continue">
                  {t.t('practice.home.resume')}
                </PButton>
              </section>
              <PDisclosure label={t.t('practice.home.new_innings')} testId="practice-new-innings-choices">
                {choices(false)}
              </PDisclosure>
            </>
          ) : (
            choices(true)
          )}
          <p className={`${sys.caption} ${s.rules}`}>{t.t('practice.home.rules')}</p>
        </div>
        <PConfirm
          open={confirm !== null}
          title={t.t('practice.home.new_confirm_title')}
          body={t.t('practice.home.new_confirm_body', { runs: r?.runs ?? 0 })}
          confirmLabel={t.t('practice.home.new_confirm')}
          cancelLabel={t.t('practice.common.cancel')}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const k = confirm;
            setConfirm(null);
            p.onDiscard();
            if (k) p.onChoose(k);
          }}
          testId="practice-discard-dialog"
        />
      </Screen>
    </div>
  );
}
