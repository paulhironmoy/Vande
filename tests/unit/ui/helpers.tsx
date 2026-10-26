import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import type { LocaleId } from '@/contracts';
import { I18nProvider } from '@/i18n';
import { ensureI18n } from '@/i18n/sources';

/** Loads every translation source (app, engine, social) for the locales a test renders. */
export async function loadI18n(...locales: LocaleId[]): Promise<void> {
  await Promise.all(['en' as LocaleId, ...locales].map((l) => ensureI18n(l)));
}

export function renderUi(ui: ReactElement, opts: { locale?: LocaleId } = {}) {
  return render(<I18nProvider locale={opts.locale ?? 'en'}>{ui}</I18nProvider>);
}
