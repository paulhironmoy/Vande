import { useState } from 'react';
import { useApp } from '@/app/store';
import type { Settings, TextScale, TimerPace } from '@/engine/types';
import { Button, Card, Dialog, Field, ScreenShell, SegmentedControl, Switch } from '@/components/ui';
import { saveTextFile } from './exportHelpers';
import s from './SettingsScreen.module.css';

const PACE_OPTIONS: { value: TimerPace; label: string; description: string }[] = [
  { value: 'standard', label: 'Standard', description: '3:00 per chapter' },
  { value: 'relaxed', label: 'Relaxed', description: '4:30 per chapter' },
  { value: 'extended', label: 'Extended', description: '6:00 per chapter' },
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
    <ScreenShell title="Settings & accessibility" onBack={() => back()} narrow testId="settings-screen">
      <p className={s.intro}>Everything here applies immediately and is saved on this device only.</p>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-motion">
        <h2 id="st-motion" className={s.sectionTitle}>
          Motion &amp; display
        </h2>
        <Field label="Reduced motion" description="Collapses animations and skips the launch sequence." data-testid="setting-reducedMotion">
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
        <Field inline label="High contrast" description="Stronger borders, solid surfaces and brighter text." data-testid="setting-highContrast">
          <Switch label="High contrast" checked={settings.highContrast} onChange={(v) => set('highContrast', v)} />
        </Field>
        <Field label="Text size" description="Scales every label, card and timer. Layouts adapt up to 200%." data-testid="setting-textScale">
          <SegmentedControl label="Text size" value={settings.textScale} onChange={(v) => set('textScale', v)} options={SCALE_OPTIONS} />
        </Field>
        <Field inline label="Colour-blind-safe indicators" description="Separates the six dimension colours further. Icons and labels always accompany colour." data-testid="setting-colourBlindSafe">
          <Switch label="Colour-blind-safe indicators" checked={settings.colourBlindSafe} onChange={(v) => set('colourBlindSafe', v)} />
        </Field>
        <Field inline label="Always show Pulse values" description="Display the six numeric values without tapping the Republic Pulse." data-testid="setting-alwaysShowValues">
          <Switch label="Always show Pulse values" checked={settings.alwaysShowValues} onChange={(v) => set('alwaysShowValues', v)} />
        </Field>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-sound">
        <h2 id="st-sound" className={s.sectionTitle}>
          Sound &amp; touch
        </h2>
        <Field inline label="Sound cues" description="Short, quiet tones for decisions, verification and warnings." data-testid="setting-sound">
          <Switch label="Sound cues" checked={settings.sound} onChange={(v) => set('sound', v)} />
        </Field>
        <Field inline label="Haptic feedback" description="Gentle vibration on supported devices." data-testid="setting-haptics">
          <Switch label="Haptic feedback" checked={settings.haptics} onChange={(v) => set('haptics', v)} />
        </Field>
        <Field inline label="Captions" description="Describe map events and sound cues in text." data-testid="setting-captions">
          <Switch label="Captions" checked={settings.captions} onChange={(v) => set('captions', v)} />
        </Field>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-time">
        <h2 id="st-time" className={s.sectionTitle}>
          Time pressure
        </h2>
        <Field label="Timer pace" description="The crisis unfolds at the same rhythm; a slower pace simply gives you more real time per decision. You can pause at any moment." data-testid="setting-timerPace">
          <SegmentedControl label="Timer pace" value={settings.timerPace} onChange={(v) => set('timerPace', v)} options={PACE_OPTIONS} block />
        </Field>
        <p className={s.hint}>Scores are not affected by the pace you choose.</p>
      </Card>

      <Card padding={0} className={s.section} as="section" aria-labelledby="st-data">
        <h2 id="st-data" className={s.sectionTitle}>
          Your data
        </h2>
        <p className={s.hint}>VANDE keeps progress, settings and results only in this browser or app. Nothing is uploaded.</p>
        <div className={s.actions}>
          <Button icon="download" onClick={onExport} data-testid="settings-export">
            Export local progress
          </Button>
          <Button icon="refresh" onClick={() => setConfirmReset(true)} data-testid="settings-reset-republic">
            Reset your Republic
          </Button>
          <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)} data-testid="settings-delete">
            Delete all local progress
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
