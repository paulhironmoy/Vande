import { useId } from 'react';
import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { LOCALES, useT } from '@/i18n';
import { Icon } from '@/ui';
import s from './LanguagePicker.module.css';

/**
 * The language, changeable from the first screen anyone sees (onboarding, an invitation): a compact select with
 * every language in its own script, machine-drafted ones marked as drafts. The device's language is the default.
 */
export function LanguagePicker({ testId = 'language-picker', compact = false }: { testId?: string; compact?: boolean }) {
  const { t } = useT();
  const locale = useApp((st) => st.settings.locale);
  const updateSettings = useApp((st) => st.updateSettings);
  const id = useId();
  const draft = LOCALES.find((l) => l.id === locale)?.status === 'machine_draft';
  return (
    <div className={s.picker} data-compact={compact || undefined}>
      <label className={s.label} htmlFor={id}>
        <Icon name="globe" size={18} />
        <span className={compact ? 'sr-only' : undefined}>{t('onboarding.language_label')}</span>
      </label>
      <select id={id} className={s.select} value={locale} onChange={(e) => updateSettings({ locale: e.target.value as LocaleId })} data-testid={testId}>
        {LOCALES.map((l) => (
          <option key={l.id} value={l.id} lang={l.htmlLang}>
            {l.nativeName}
            {l.nativeName !== l.englishName ? ` · ${l.englishName}` : ''}
            {l.status === 'machine_draft' ? ` (${t('settings.draft_translation')})` : ''}
          </option>
        ))}
      </select>
      {draft && !compact && <span className={s.draft}>{t('settings.draft_note')}</span>}
    </div>
  );
}
