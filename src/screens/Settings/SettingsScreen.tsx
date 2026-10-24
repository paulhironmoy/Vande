import { useState } from 'react';
import { useApp } from '@/app/store';
import { SIMPLE_PACE, useSimple } from '@/app/simple';
import type { PlayStyle, Settings, TextScale, TimerPace } from '@/engine/types';
import { Button, Card, Dialog, Field, ScreenShell, SegmentedControl, Switch } from '@/components/ui';
import { saveTextFile } from './exportHelpers';
import s from './SettingsScreen.module.css';

const PACE_OPTIONS: { value: TimerPace; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard', description: '3:00 per chapter' },
  { value: 'relaxed', label: 'Relaxed', description: '4:30 per chapter' },
  { value: 'extended', label: 'Extended', description: '6:00 per chapter' },
];

const STYLE_OPTIONS: { value: PlayStyle; label: string }[] = [
  { value: 'simple', label: 'Simple' },
  { value: 'full', label: 'Full' },
];

const SCALE_OPTIONS: { value: TextScale; label: string }[] = [
  { value: 1, label: '100%' },
  { value: 1.25, label: '125%' },
  { value: 1.5, label: '150%' },
  { value: 2, label: '200%' },
];

export function SettingsScreen() {
  const settings = useApp((st) => st.settings);
  const update = useApp((st) => st.updateSettings);
  const setPlayStyle = useApp((st) => st.setPlayStyle);
  const simple = useSimple();
  /** Short copy for the Simple style, fuller copy otherwise. */
  const d = (full: string, easy: string) => (simple ? easy : full);
  const back = useApp((st) => st.back);
  const navigate = useApp((st) => st.navigate);
  const toast = useApp((st) => st.toast);
  const exportData = useApp((st) => st.exportData);
  const deleteAllData = useApp((st) => st.deleteAllData);
  const resetRepublic = useApp((st) => st.resetRepublic);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => update({ [key]: value } as Partial<Settings>);

  const onExport = async () => {
    try {
      const json = await exportData();
      const date = new Date().toISOString().slice(0, 10);
      const how = await saveTextFile(`vande-progress-${date}.json`, json);
      toast({
        text: how === 'clipboard' ? 'Export copied to the clipboard.' : how === 'shared' ? 'Choose where to save your export.' : 'Export downloaded.',
        kind: 'success',
        duration: 3500,
      });
    } catch {
      toast({ text: 'Export failed. Please try again.', kind: 'danger', duration: 4000 });
    }
  };

  const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
  const build = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'local';

  return (
    <ScreenShell title={simple ? 'Settings' : 'Settings & accessibility'} onBack={() => back()} narrow testId="settings-screen">
      <p className={s.intro}>{d('Everything here applies immediately and is saved on this device only.', 'Changes happen right away. They are saved only on this device.')}</p>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-style">
        <h2 id="st-style" className={s.sectionTitle}>
          {d('Play style', 'How you play')}
        </h2>
        <Field label="Play style" description={d('Simple uses plain words, bigger controls and a clock that waits for you. Full shows every detail with a real-time clock.', 'Simple: easy words, big buttons, the clock waits for you. Full: more detail and a real-time clock.')} data-testid="setting-playStyle">
          <SegmentedControl label="Play style" value={settings.playStyle} onChange={(v) => setPlayStyle(v)} options={STYLE_OPTIONS} />
        </Field>
        <Field inline label="Wait for me" description="Pause the clock whenever something new needs your answer." data-testid="setting-autoPauseOnDecision">
          <Switch label="Wait for me" checked={settings.autoPauseOnDecision} onChange={(v) => set('autoPauseOnDecision', v)} />
        </Field>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-motion">
        <h2 id="st-motion" className={s.sectionTitle}>
          Motion &amp; display
        </h2>
        <Field label="Reduced motion" description={d('Collapses animations and skips the launch sequence.', 'Turns off moving animations.')} data-testid="setting-reducedMotion">
          <SegmentedControl
            label="Reduced motion"
            value={settings.reducedMotion}
            onChange={(v) => set('reducedMotion', v)}
            options={[
              { value: 'system', label: 'System' },
              { value: 'on', label: 'On' },
              { value: 'off', label: 'Off' },
            ]}
          />
        </Field>
        <Field inline label="High contrast" description={d('Stronger borders, solid surfaces and brighter text.', 'Bolder lines and brighter text.')} data-testid="setting-highContrast">
          <Switch label="High contrast" checked={settings.highContrast} onChange={(v) => set('highContrast', v)} />
        </Field>
        <Field label="Text size" description={d('Scales every label, card and timer. Layouts adapt up to 200%.', 'Makes all the words bigger.')} data-testid="setting-textScale">
          <SegmentedControl label="Text size" value={settings.textScale} onChange={(v) => set('textScale', v)} options={SCALE_OPTIONS} />
        </Field>
        <Field inline label={d('Colour-blind-safe indicators', 'Easy-to-tell-apart colours')} description={d('Separates the six dimension colours further. Icons and labels always accompany colour.', 'Uses colours that are easier to tell apart.')} data-testid="setting-colourBlindSafe">
          <Switch label="Colour-blind-safe indicators" checked={settings.colourBlindSafe} onChange={(v) => set('colourBlindSafe', v)} />
        </Field>
        <Field inline label={d('Always show Pulse values', 'Always show city numbers')} description={d('Display the six numeric values without tapping the Republic Pulse.', 'Always show the six city numbers.')} data-testid="setting-alwaysShowValues">
          <Switch label="Always show Pulse values" checked={settings.alwaysShowValues} onChange={(v) => set('alwaysShowValues', v)} />
        </Field>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-sound">
        <h2 id="st-sound" className={s.sectionTitle}>
          Sound &amp; touch
        </h2>
        <Field inline label="Sound cues" description={d('Short, quiet tones for decisions, verification and warnings.', 'Quiet sounds when things happen.')} data-testid="setting-sound">
          <Switch label="Sound cues" checked={settings.sound} onChange={(v) => set('sound', v)} />
        </Field>
        <Field inline label="Haptic feedback" description={d('Gentle vibration on supported devices.', 'A small buzz on phones that support it.')} data-testid="setting-haptics">
          <Switch label="Haptic feedback" checked={settings.haptics} onChange={(v) => set('haptics', v)} />
        </Field>
        <Field inline label="Captions" description={d('Describe map events and sound cues in text.', 'Show words for what happens on the map.')} data-testid="setting-captions">
          <Switch label="Captions" checked={settings.captions} onChange={(v) => set('captions', v)} />
        </Field>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-time">
        <h2 id="st-time" className={s.sectionTitle}>
          Time pressure
        </h2>
        <Field label={d('Timer pace', 'Clock speed')} description={d('The crisis unfolds at the same rhythm; a slower pace simply gives you more real time per decision. You can pause at any moment.', 'Slower gives you more time to think. You can pause any time.')} data-testid="setting-timerPace">
          <SegmentedControl label="Timer pace" value={settings.timerPace} onChange={(v) => set('timerPace', v)} options={simple ? (Object.keys(SIMPLE_PACE) as TimerPace[]).map((v) => ({ value: v, label: SIMPLE_PACE[v].label, description: SIMPLE_PACE[v].description })) : PACE_OPTIONS} block />
        </Field>
        <p className={s.hint}>{d('Scores are not affected by the pace you choose.', 'Your score is the same at any speed.')}</p>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-data">
        <h2 id="st-data" className={s.sectionTitle}>
          Your data
        </h2>
        <p className={s.hint}>{d('VANDE keeps progress, settings and results only in this browser or app. Nothing is uploaded.', 'Your games and settings stay on this device. Nothing is sent anywhere.')}</p>
        <div className={s.actions}>
          <Button icon="download" onClick={onExport} data-testid="settings-export">
            {d('Export local progress', 'Save a copy of my progress')}
          </Button>
          <Button icon="refresh" onClick={() => setConfirmReset(true)} data-testid="settings-reset-republic">
            {d('Reset your Republic', 'Start my city again')}
          </Button>
          <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} data-testid="settings-delete">
            {d('Delete all local progress', 'Delete everything')}
          </Button>
        </div>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-about">
        <h2 id="st-about" className={s.sectionTitle}>
          About VANDE
        </h2>
        <div className={s.links}>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'disclosure' })}>
            Independence disclosure
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'privacy' })}>
            Privacy
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'accessibility' })}>
            Accessibility statement
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'attribution' })}>
            Open-source attribution
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'support' })}>
            Support
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate({ name: 'about', page: 'version' })}>
            Version &amp; build
          </Button>
        </div>
        <p className={s.version} data-testid="settings-version">
          VANDE {version} · build {build}
        </p>
      </Card>

      <Dialog
        open={confirmReset}
        title="Reset your Republic?"
        description="Your long-term Republic condition returns to its starting point. History and personal bests are kept."
        confirmLabel="Reset Republic"
        confirmVariant="danger"
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          void resetRepublic();
        }}
      />
      <Dialog
        open={confirmDelete}
        title="Delete all local progress?"
        description="This removes your campaign, history, personal bests, Republic and settings from this device. It cannot be undone."
        confirmLabel="Delete everything"
        confirmVariant="danger"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void deleteAllData();
        }}
        testId="settings-delete-dialog"
      />
    </ScreenShell>
  );
}
