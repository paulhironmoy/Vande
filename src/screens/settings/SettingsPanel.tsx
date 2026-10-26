import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { LOCALES, useT } from '@/i18n';
import { Field, SegmentedControl, Switch } from '@/ui';
import s from './SettingsPanel.module.css';

/** Presentation settings (root store). Drop into a Sheet or a settings route. */
export function SettingsPanel() {
  const { t } = useT();
  const settings = useApp((st) => st.settings);
  const update = useApp((st) => st.updateSettings);
  return (
    <div className={s.panel}>
      <Field label={t('settings.quality')}>
        <SegmentedControl
          label={t('settings.quality')}
          testId="settings-quality"
          value={settings.quality}
          onChange={(quality) => update({ quality })}
          block
          options={[
            { value: 'auto', label: t('settings.quality.auto') },
            { value: 'low', label: t('settings.quality.low') },
            { value: 'standard', label: t('settings.quality.standard') },
          ]}
        />
      </Field>
      <Field label={t('settings.sound')} inline>
        <Switch checked={settings.sound} onChange={(sound) => update({ sound })} label={t('settings.sound')} data-testid="settings-sound" />
      </Field>
      <Field label={t('settings.haptics')} inline>
        <Switch checked={settings.haptics} onChange={(haptics) => update({ haptics })} label={t('settings.haptics')} data-testid="settings-haptics" />
      </Field>
      <Field label={t('settings.reduced_motion')} description={t('state.reduced_motion.body')} inline>
        <Switch checked={settings.reducedMotion === 'on'} onChange={(on) => update({ reducedMotion: on ? 'on' : 'system' })} label={t('settings.reduced_motion')} data-testid="settings-reduced-motion" />
      </Field>
      <Field label={t('settings.high_contrast')} inline>
        <Switch checked={settings.highContrast} onChange={(highContrast) => update({ highContrast })} label={t('settings.high_contrast')} data-testid="settings-high-contrast" />
      </Field>
      <Field label={t('settings.text_size')}>
        <SegmentedControl
          label={t('settings.text_size')}
          testId="settings-text-size"
          value={settings.textScale}
          onChange={(textScale) => update({ textScale })}
          block
          options={[
            { value: 1, label: 'A' },
            { value: 1.15, label: 'A+' },
            { value: 1.3, label: 'A++' },
          ]}
        />
      </Field>
      <label className={s.lang}>
        <span className={s.legend}>{t('onboarding.language_label')}</span>
        <select value={settings.locale} onChange={(e) => update({ locale: e.target.value as LocaleId })} data-testid="settings-language">
          {LOCALES.map((l) => (
            <option key={l.id} value={l.id} lang={l.htmlLang}>
              {l.nativeName}
              {l.nativeName !== l.englishName ? ` · ${l.englishName}` : ''}
              {l.status === 'machine_draft' ? ` (${t('settings.draft_translation')})` : ''}
            </option>
          ))}
        </select>
        {LOCALES.find((l) => l.id === settings.locale)?.status === 'machine_draft' && <span className={s.draft}>{t('settings.draft_note')}</span>}
      </label>
    </div>
  );
}
