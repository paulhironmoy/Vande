/**
 * The Practice menu: Quick Random Over (primary), Build an Over (secondary), an optional pitch (Balanced unless the
 * player opens it), and the innings in progress when there is one. Portrait is fine here.
 */
import { useEffect, useState } from 'react';
import { Button, Card, CardButton, Dialog, Icon, IconButton, ScreenShell, SegmentedControl } from '@/ui';
import type { PitchCondition, PracticeInningsState } from '@/contracts';
import { usePracticeT } from '@/i18n/practice';
import { preloadPracticeStage } from '@/render3d';
import { oversText } from '../coaching';
import s from './Menu.module.css';

const PITCHES: PitchCondition[] = ['balanced', 'green', 'hard', 'turning'];

export interface MenuProps {
  resumable: PracticeInningsState | null;
  /** Shown on the resume card: the ball in play when the app closed counted as a leave. */
  resumedLeave?: boolean;
  conditions: PitchCondition;
  storageOk: boolean;
  onPitch: (p: PitchCondition) => void;
  onRandom: () => void;
  onBuild: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  onSettings: () => void;
  onCalibrate: () => void;
  onBack: () => void;
}

export function Menu(p: MenuProps) {
  const t = usePracticeT();
  const [pitchOpen, setPitchOpen] = useState(false);
  /** What to do once the player confirms ending the saved innings. */
  const [confirmNew, setConfirmNew] = useState<null | 'discard' | 'random' | 'build'>(null);
  const guard = (what: 'random' | 'build', go: () => void) => (r ? setConfirmNew(what) : go());
  const r = p.resumable;
  // Fetch the stage's code while the player chooses (never earlier: a player who skips Practice never downloads it).
  useEffect(() => preloadPracticeStage(), []);
  return (
    <ScreenShell
      eyebrow={t.t('practice.menu.eyebrow')}
      title={t.t('practice.menu.title')}
      onBack={p.onBack}
      backLabel={t.t('practice.common.back')}
      actions={<IconButton icon="settings" label={t.t('practice.menu.settings')} onClick={p.onSettings} data-testid="practice-settings-open" />}
      narrow
      testId="practice-menu"
      contentClassName={s.content}
    >
      {!p.storageOk && (
        <Card variant="sunken" role="status" data-testid="practice-storage-off">
          <Icon name="alert" size={18} /> {t.t('practice.common.storage_off')}
        </Card>
      )}
      {r && (
        <Card className={s.resume} accent="var(--c-amber-500)" data-testid="practice-resume-card">
          <h2>{t.t('practice.menu.resume_title')}</h2>
          <p>{t.t('practice.menu.resume_body', { score: t.t('practice.common.score', { runs: r.runs, wickets: 0 }), overs: oversText(r.balls) })}</p>
          {p.resumedLeave && (
            <p role="status" data-testid="practice-resumed-leave">
              {t.t('practice.menu.resumed_leave')}
            </p>
          )}
          <div className={s.row}>
            <Button variant="accent" size="lg" icon="play" onClick={p.onContinue} data-testid="practice-continue">
              {t.t('practice.menu.resume')}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmNew('discard')} data-testid="practice-discard">
              {t.t('practice.menu.new')}
            </Button>
          </div>
        </Card>
      )}
      <CardButton className={`${s.choice} ${s.primary}`} padding={5} onClick={() => guard('random', p.onRandom)} data-testid="practice-random">
        <span className={s.choiceTitle}>
          <Icon name="shuffle" size={22} /> {t.t('practice.menu.random')}
        </span>
        <span className={s.choiceSub}>{t.t('practice.menu.random_sub')}</span>
      </CardButton>
      <CardButton className={s.choice} padding={5} onClick={() => guard('build', p.onBuild)} data-testid="practice-build">
        <span className={s.choiceTitle}>
          <Icon name="target" size={22} /> {t.t('practice.menu.build')}
        </span>
        <span className={s.choiceSub}>{t.t('practice.menu.build_sub')}</span>
      </CardButton>
      <section className={s.pitch}>
        <Button variant="secondary" iconEnd={pitchOpen ? 'chevron-up' : 'chevron-down'} aria-expanded={pitchOpen} aria-controls="practice-pitch" onClick={() => setPitchOpen((v) => !v)} data-testid="practice-pitch-toggle">
          {t.t('practice.menu.pitch_value', { pitch: t.tk(`practice.pitch.${p.conditions}`) })}
        </Button>
        {pitchOpen && (
          <div id="practice-pitch" className={s.pitch}>
            <p className={s.note}>{t.t('practice.menu.pitch_hint')}</p>
            <SegmentedControl
              label={t.t('practice.menu.pitch')}
              value={p.conditions}
              onChange={p.onPitch}
              options={PITCHES.map((v) => ({ value: v, label: t.tk(`practice.pitch.${v}`), description: t.tk(`practice.pitch.${v}_hint`) }))}
              block
              testId="practice-pitch"
            />
          </div>
        )}
      </section>
      <p className={s.note}>{t.t('practice.menu.rules')}</p>
      <div className={s.links}>
        <Button variant="link" icon="clock" onClick={p.onCalibrate} data-testid="practice-calibrate-open">
          {t.t('practice.menu.calibrate')}
        </Button>
        <Button variant="link" icon="settings" onClick={p.onSettings}>
          {t.t('practice.menu.settings')}
        </Button>
      </div>
      <Dialog
        open={confirmNew !== null}
        title={t.t('practice.menu.new_confirm_title')}
        description={t.t('practice.menu.new_confirm_body', { runs: r?.runs ?? 0 })}
        confirmLabel={t.t('practice.menu.new_confirm')}
        cancelLabel={t.t('practice.common.cancel')}
        onCancel={() => setConfirmNew(null)}
        onConfirm={() => {
          const what = confirmNew;
          setConfirmNew(null);
          p.onDiscard();
          // The dialog's confirm is itself a tap, so play can still ask for landscape inside it.
          if (what === 'random') p.onRandom();
          else if (what === 'build') p.onBuild();
        }}
        testId="practice-discard-dialog"
      />
    </ScreenShell>
  );
}
