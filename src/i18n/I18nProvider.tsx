import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { createTranslator, type Translator } from './translator';
import { localeInfo } from './locales';
import { currentCatalogs, ensureI18n, loadSource, onSourceLoaded } from './sources';

const english = createTranslator('en', null);

const I18nContext = createContext<Translator>(english);

export interface I18nProviderProps {
  /** Overrides the root store's locale (tests, previews). */
  locale?: LocaleId;
  children: ReactNode;
}

/**
 * Provides the translator for the active locale and keeps <html lang> in sync. Each source (the app catalog, then the
 * engine's cricket copy) is used as soon as it arrives, and anything not loaded yet falls back to English, so a slow
 * network never blocks the shell. The route loaders wait for the copy their screen needs (see preloadI18n).
 */
export function I18nProvider({ locale, children }: I18nProviderProps) {
  const storeLocale = useApp((s) => s.settings.locale);
  const active: LocaleId = locale ?? storeLocale ?? 'en';
  const [version, setVersion] = useState(0);

  useEffect(() => onSourceLoaded(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    // Start every load this locale needs; each one re-renders when it lands.
    void loadSource('app', active);
    void loadSource('engine', active);
    void loadSource('engine', 'en');
  }, [active]);

  const translator = useMemo<Translator>(() => {
    const c = currentCatalogs(active);
    // Until the locale's own app catalog arrives, keep English (never a mix of raw keys).
    if (!c.app) return english;
    return createTranslator(active, c.catalog, c.english);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, version]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const info = localeInfo(translator.locale);
    document.documentElement.lang = info.htmlLang;
    document.documentElement.dir = 'ltr';
  }, [translator.locale]);

  return <I18nContext.Provider value={translator}>{children}</I18nContext.Provider>;
}

/** The active translator: `const { t } = useT()`. */
export function useT(): Translator {
  return useContext(I18nContext);
}

/**
 * Loads the translations a screen needs before it renders (used by the lazy route loaders). Screens without cricket
 * vocabulary pass `{ engine: false }` and wait only for the app catalog (bundled for English).
 */
export function preloadI18n(locale: LocaleId = useApp.getState().settings.locale, opts: { engine?: boolean } = {}): Promise<void> {
  return ensureI18n(locale, opts).then(
    () => undefined,
    () => undefined,
  );
}

export { english as defaultTranslator };
