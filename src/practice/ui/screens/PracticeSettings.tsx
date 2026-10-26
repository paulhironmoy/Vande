/**
 * Practice settings: assistance (Learn, Play, Real), batting hand, Learn's landing cue, graphics (never more than
 * the device check allows; Classic is always there), the device check and timing check, and clearing Practice data.
 * Tapping the device-check line five times opens the diagnostics (local numbers only).
 */
import { useRef, useState } from 'react';
import { Button, Dialog, ScreenShell, SegmentedControl, Switch } from '@/ui';
import type { AssistLevel, DeviceAssessment, Handedness } from '@/contracts';
import { allowedQualityChoices, clearCachedAssessment, type QualityChoice } from '@/perf';
import { usePracticeT } from '@/i18n/practice';
import { clearPracticeData, loadCalibration, loadPracticeSettings, updatePracticeSettings, type PracticeSettings as Settings } from '@/practice/store';
import s from './Tools.module.css';

export interface PracticeSettingsProps {
  assessment: DeviceAssessment | null;
  inningsInProgress: boolean;
  onChanged: () => void;
  onRerunCheck: () => void;
  onCalibrate: () => void;
  onDiagnostics: () => void;
  onCleared: () => void;
  onBack: () => void;
}

const QUALITIES: QualityChoice[] = ['auto', 'high', 'standard', 'lite', 'classic'];

export function PracticeSettings(p: PracticeSettingsProps) {
  const t = usePracticeT();
  const [settings, setSettings] = useState<Settings>(() => loadPracticeSettings());
  const [confirmClear, setConfirmClear] = useState(false);
  const [rerun, setRerun] = useState(false);
  const taps = useRef(0);
  const cal = loadCalibration();
  const allowed = allowedQualityChoices(p.assessment);
  const update = (patch: Partial<Omit<Settings, 'v'>>) => {
    setSettings(updatePracticeSettings(patch));
    p.onChanged();
  };
  const a = p.assessment;
  const tierText = a ? t.tk(`practice.settings.device.${a.tier}`) : t.t('practice.settings.device.none');
  return (
    <ScreenShell title={t.t('practice.settings.title')} onBack={p.onBack} backLabel={t.t('practice.common.back')} narrow testId="practice-settings" contentClassName={s.content}>
      <section className={s.section}>
        <h2>{t.t('practice.settings.assist')}</h2>
        <SegmentedControl
          label={t.t('practice.settings.assist')}
          value={settings.assist}
          onChange={(v: AssistLevel) => update({ assist: v })}
          options={(['learn', 'play', 'real'] as AssistLevel[]).map((v) => ({ value: v, label: t.tk(`practice.settings.assist.${v}`), description: t.tk(`practice.settings.assist.${v}_hint`) }))}
          block
          testId="practice-settings-assist"
        />
        {p.inningsInProgress && <p className={s.text}>{t.t('practice.settings.next_innings')}</p>}
      </section>
      <section className={s.section}>
        <h2>{t.t('practice.settings.hand')}</h2>
        <SegmentedControl
          label={t.t('practice.settings.hand')}
          value={settings.handedness}
          onChange={(v: Handedness) => update({ handedness: v })}
          options={[
            { value: 'right', label: t.t('practice.settings.hand.right') },
            { value: 'left', label: t.t('practice.settings.hand.left') },
          ]}
          block
          testId="practice-settings-hand"
        />
      </section>
      {settings.assist === 'learn' && (
        <section className={s.section}>
          <div className={s.row}>
            <div>
              <p className={s.strong} id="practice-cue-label" style={{ fontSize: 'var(--text-md)' }}>
                {t.t('practice.settings.cue')}
              </p>
              <p className={s.text}>{t.t('practice.settings.cue_hint')}</p>
            </div>
            <Switch checked={settings.learnCue} onChange={(v) => update({ learnCue: v })} aria-labelledby="practice-cue-label" data-testid="practice-settings-cue" />
          </div>
        </section>
      )}
      <section className={s.section}>
        <h2>{t.t('practice.settings.quality')}</h2>
        <SegmentedControl
          label={t.t('practice.settings.quality')}
          value={settings.quality}
          onChange={(v: QualityChoice) => update({ quality: v })}
          options={QUALITIES.map((v) => ({ value: v, label: t.tk(`practice.settings.quality.${v}`), disabled: !allowed.includes(v) }))}
          block
          testId="practice-settings-quality"
        />
        <p className={s.text}>{t.t('practice.settings.quality_hint')}</p>
      </section>
      <section className={s.section}>
        <h2>{t.t('practice.settings.device')}</h2>
        {/* Five taps on this line open the local diagnostics. */}
        <p
          className={s.strong}
          style={{ fontSize: 'var(--text-md)' }}
          onClick={() => {
            if (++taps.current >= 5) {
              taps.current = 0;
              p.onDiagnostics();
            }
          }}
          data-testid="practice-settings-device"
          data-tier={a?.tier ?? 'none'}
        >
          {tierText}
          {a && a.avgFps > 0 ? ` · ${t.t('practice.settings.device.fps', { fps: Math.round(a.avgFps) })}` : ''}
        </p>
        <div className={s.actions}>
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => {
              clearCachedAssessment();
              p.onRerunCheck();
              setRerun(true);
            }}
            data-testid="practice-settings-rerun"
          >
            {t.t('practice.settings.device.rerun')}
          </Button>
          {import.meta.env.VITE_PRACTICE_TEST_HOOKS === '1' && (
            <Button variant="ghost" onClick={p.onDiagnostics} data-testid="practice-settings-diagnostics">
              {t.t('practice.settings.diagnostics')}
            </Button>
          )}
        </div>
        {rerun && (
          <p className={s.text} role="status">
            {t.t('practice.settings.device.rerun_done')}
          </p>
        )}
      </section>
      <section className={s.section}>
        <h2>{t.t('practice.settings.timing')}</h2>
        <p className={s.text}>{cal ? t.t('practice.cal.current', { ms: Math.round(cal.offsetMs) }) : t.t('practice.cal.not_done')}</p>
        <div className={s.actions}>
          <Button variant="secondary" icon="clock" onClick={p.onCalibrate} data-testid="practice-settings-calibrate">
            {t.t('practice.settings.timing_run')}
          </Button>
        </div>
      </section>
      <section className={s.section}>
        <div className={s.actions}>
          <Button variant="danger" icon="trash" onClick={() => setConfirmClear(true)} data-testid="practice-settings-clear">
            {t.t('practice.settings.clear')}
          </Button>
        </div>
      </section>
      <Dialog
        open={confirmClear}
        title={t.t('practice.settings.clear_title')}
        description={t.t('practice.settings.clear_body')}
        confirmLabel={t.t('practice.settings.clear_confirm')}
        cancelLabel={t.t('practice.common.cancel')}
        confirmVariant="danger"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clearPracticeData();
          setSettings(loadPracticeSettings());
          p.onCleared();
        }}
        testId="practice-clear-dialog"
      />
    </ScreenShell>
  );
}
