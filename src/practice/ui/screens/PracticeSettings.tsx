/**
 * Practice settings: batting (assistance, hand, the landing cue, the ball focus aid), sound (the app's master sound
 * and vibration, then src/audio's music, effects, crowd, captions), display (language, text size, contrast, motion),
 * graphics (Automatic, Premium, Balanced, Classic: never tiers or frame rates), the timing check, and clearing
 * Practice data. Five taps on the graphics line open the hidden diagnostics (and the tester mode).
 */
import { useRef, useState, useSyncExternalStore } from 'react';
import type { AssistLevel, DeviceAssessment, Handedness, LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { TEXT_SCALES, type TextScale } from '@/app/storeTypes';
import { LOCALES } from '@/i18n/locales';
import { clearCachedAssessment, effectiveTier, qualityChoiceForTier, tierChoiceFor, tierChoices, tierForAssessment, type QualityTierChoice } from '@/perf';
import { usePracticeT } from '@/i18n/practice';
import { clearPracticeData, loadCalibrations, loadPracticeSettings, updatePracticeSettings, type PracticeSettings as Settings } from '@/practice/store';
import { calibrationList } from './Calibration';
import { PButton, PConfirm, PSegmented, PSetting, PSwitch, Screen, sys } from '../design';
import type { AudioKit } from '../flow/types';
import s from './Settings.module.css';

export interface PracticeSettingsProps {
  assessment: DeviceAssessment | null;
  inningsInProgress: boolean;
  audio: AudioKit | null;
  onChanged: () => void;
  onRerunCheck?: () => void;
  /** Absent where the timing check cannot open (the launch screen). */
  onCalibrate?: () => void;
  onDiagnostics?: () => void;
  onCleared: () => void;
  onBack: () => void;
}

const PRACTICE_LOCALES: readonly LocaleId[] = ['en', 'hi', 'hi-Latn'];
const noop = () => () => undefined;

export function PracticeSettings(p: PracticeSettingsProps) {
  const t = usePracticeT();
  const app = useApp((st) => st.settings);
  const updateApp = useApp((st) => st.updateSettings);
  const [settings, setSettings] = useState<Settings>(() => loadPracticeSettings());
  const [confirmClear, setConfirmClear] = useState(false);
  const [rerun, setRerun] = useState(false);
  const taps = useRef(0);
  const audio = p.audio;
  const sound = useSyncExternalStore(audio?.subscribeSettings ?? noop, () => audio?.getSettings() ?? null, () => null);
  const cal = calibrationList(t, loadCalibrations());
  const update = (patch: Partial<Omit<Settings, 'v'>>) => {
    setSettings(updatePracticeSettings(patch));
    audio?.uiCue('select');
    p.onChanged();
  };
  const a = p.assessment;
  const choices = tierChoices(a);
  const graphics = tierChoiceFor(settings.quality);
  const autoTier = effectiveTier(a, 'auto').tier;
  const earned = tierForAssessment(a);
  const tierName = (k: QualityTierChoice) => t.tk(`practice.settings.quality.${k}`);
  const level = (v: number) => (audio?.levels ?? [0, 0.5, 1]).reduce((b, x) => (Math.abs(x - v) < Math.abs(b - v) ? x : b), 1);
  const levelOptions = (audio?.levels ?? [0, 0.5, 1]).map((v) => ({ value: v, label: t.t(v === 0 ? 'practice.settings.level.off' : v < 1 ? 'practice.settings.level.low' : 'practice.settings.level.full') }));
  const locales = Array.from(new Set<LocaleId>([...PRACTICE_LOCALES, app.locale]));
  return (
    <Screen title={t.t('practice.settings.title')} onBack={p.onBack} testId="practice-settings">
      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.settings.batting')}</h2>
        <PSegmented
          label={t.t('practice.settings.assist')}
          value={settings.assist}
          onChange={(v: AssistLevel) => update({ assist: v })}
          options={(['learn', 'play', 'real'] as AssistLevel[]).map((v) => ({ value: v, label: t.tk(`practice.settings.assist.${v}`), description: t.tk(`practice.settings.assist.${v}_hint`) }))}
          testId="practice-settings-assist"
        />
        {p.inningsInProgress && <p className={sys.caption}>{t.t('practice.settings.next_innings')}</p>}
        <PSegmented
          label={t.t('practice.settings.hand')}
          value={settings.handedness}
          onChange={(v: Handedness) => update({ handedness: v })}
          options={[
            { value: 'right', label: t.t('practice.settings.hand.right') },
            { value: 'left', label: t.t('practice.settings.hand.left') },
          ]}
          testId="practice-settings-hand"
        />
        {settings.assist === 'learn' && (
          <PSetting label={t.t('practice.settings.cue')} hint={t.t('practice.settings.cue_hint')} id="ps-cue">
            <PSwitch checked={settings.learnCue} onChange={(v) => update({ learnCue: v })} labelledBy="ps-cue" testId="practice-settings-cue" />
          </PSetting>
        )}
        <PSetting label={t.t('practice.settings.focus')} hint={t.t('practice.settings.focus_hint')} id="ps-focus">
          <PSwitch checked={settings.focusAid} onChange={(v) => update({ focusAid: v })} labelledBy="ps-focus" testId="practice-settings-focus" />
        </PSetting>
      </section>

      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.settings.sound')}</h2>
        <PSetting label={t.t('practice.settings.sound_on')} id="ps-sound">
          <PSwitch checked={app.sound} onChange={(v) => updateApp({ sound: v })} labelledBy="ps-sound" testId="practice-settings-sound" />
        </PSetting>
        {sound && audio && app.sound && (
          <>
            {(['effects', 'crowd', 'music'] as const).map((k) => (
              <PSegmented key={k} label={t.t(`practice.settings.${k}`)} value={level(sound[k])} onChange={(v: number) => audio.setSettings({ [k]: v })} options={levelOptions.map((o) => ({ ...o, label: `${t.t(`practice.settings.${k}`)}: ${o.label}` }))} testId={`practice-settings-${k}`} />
            ))}
          </>
        )}
        <PSetting label={t.t('practice.settings.vibration')} id="ps-haptics">
          <PSwitch checked={app.haptics} onChange={(v) => updateApp({ haptics: v })} labelledBy="ps-haptics" testId="practice-settings-haptics" />
        </PSetting>
        {sound && audio && (
          <PSetting label={t.t('practice.settings.captions')} hint={t.t('practice.settings.captions_hint')} id="ps-captions">
            <PSwitch checked={sound.captions} onChange={(v) => audio.setSettings({ captions: v })} labelledBy="ps-captions" testId="practice-settings-captions" />
          </PSetting>
        )}
      </section>

      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.settings.display')}</h2>
        <PSegmented label={t.t('practice.settings.language')} value={app.locale} onChange={(v: LocaleId) => updateApp({ locale: v })} options={LOCALES.filter((l) => locales.includes(l.id)).map((l) => ({ value: l.id, label: l.nativeName }))} testId="practice-settings-language" />
        <PSegmented
          label={t.t('practice.settings.text')}
          value={app.textScale}
          onChange={(v: TextScale) => updateApp({ textScale: v })}
          options={TEXT_SCALES.map((v) => ({ value: v, label: t.t('practice.settings.text_value', { pct: Math.round(v * 100) }) }))}
          testId="practice-settings-text"
        />
        <PSetting label={t.t('practice.settings.contrast')} id="ps-contrast">
          <PSwitch checked={app.highContrast} onChange={(v) => updateApp({ highContrast: v })} labelledBy="ps-contrast" testId="practice-settings-contrast" />
        </PSetting>
        <PSegmented
          label={t.t('practice.settings.motion')}
          value={app.reducedMotion}
          onChange={(v: 'system' | 'on' | 'off') => updateApp({ reducedMotion: v })}
          options={(['system', 'on', 'off'] as const).map((v) => ({ value: v, label: t.tk(`practice.settings.motion.${v}`) }))}
          testId="practice-settings-motion"
        />
      </section>

      <section className={s.section}>
        <h2 className={sys.section}>{t.t('practice.settings.graphics')}</h2>
        <PSegmented
          label={t.t('practice.settings.graphics')}
          value={graphics}
          onChange={(v: QualityTierChoice) => update({ quality: qualityChoiceForTier(v, a) })}
          options={(['auto', 'premium', 'balanced', 'classic'] as QualityTierChoice[]).map((v) => ({ value: v, label: v === 'auto' && a ? `${tierName('auto')} (${tierName(autoTier)})` : tierName(v), disabled: !choices.includes(v) }))}
          testId="practice-settings-quality"
        />
        {/* Five taps on this line open the local diagnostics. */}
        <p
          className={sys.caption}
          onClick={() => {
            if (p.onDiagnostics && ++taps.current >= 5) {
              taps.current = 0;
              p.onDiagnostics();
            }
          }}
          data-testid="practice-settings-device"
          data-tier={a?.tier ?? 'none'}
        >
          {earned ? t.t('practice.settings.device_best', { tier: tierName(earned) }) : t.t('practice.settings.device_none')}
        </p>
        {p.onRerunCheck && (
          <div className={s.actions}>
            <PButton
              variant="quiet"
              icon="refresh"
              onClick={() => {
                clearCachedAssessment();
                p.onRerunCheck?.();
                setRerun(true);
              }}
              data-testid="practice-settings-rerun"
            >
              {t.t('practice.settings.device_rerun')}
            </PButton>
          </div>
        )}
        {rerun && (
          <p className={sys.caption} role="status">
            {t.t('practice.settings.device_rerun_done')}
          </p>
        )}
      </section>

      {p.onCalibrate && (
        <section className={s.section}>
          <h2 className={sys.section}>{t.t('practice.settings.timing')}</h2>
          <p className={sys.caption}>{cal ? t.t('practice.cal.current', { list: cal }) : t.t('practice.cal.not_done')}</p>
          <div className={s.actions}>
            <PButton variant="secondary" icon="clock" onClick={p.onCalibrate} data-testid="practice-settings-calibrate">
              {t.t('practice.settings.timing_run')}
            </PButton>
          </div>
        </section>
      )}

      <section className={s.section}>
        <div className={s.actions}>
          <PButton variant="danger" icon="trash" onClick={() => setConfirmClear(true)} data-testid="practice-settings-clear">
            {t.t('practice.settings.clear')}
          </PButton>
        </div>
      </section>
      <PConfirm
        open={confirmClear}
        title={t.t('practice.settings.clear_title')}
        body={t.t('practice.settings.clear_body')}
        confirmLabel={t.t('practice.settings.clear_confirm')}
        cancelLabel={t.t('practice.common.cancel')}
        danger
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          clearPracticeData();
          audio?.resetSettings();
          setSettings(loadPracticeSettings());
          p.onCleared();
        }}
        testId="practice-clear-dialog"
      />
    </Screen>
  );
}
