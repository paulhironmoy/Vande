import type { LocaleId } from '@/contracts';

/**
 * Locale metadata. `status` is the honest translation state (see src/i18n/STATUS.md):
 * - source: the English source catalog
 * - complete: every key translated; authored in-house, native-speaker review still recommended before release
 * - machine_draft: machine-drafted, REQUIRES human linguistic QA before it can be called production quality
 */
export type TranslationStatus = 'source' | 'complete' | 'machine_draft';

export interface LocaleInfo {
  id: LocaleId;
  /** Name in its own script (what the language picker shows). */
  nativeName: string;
  englishName: string;
  /** BCP 47 tag for Intl (numbers, dates, plurals). Hinglish uses en-IN data: Latin script, Indian grouping. */
  intl: string;
  /** Value for <html lang>. */
  htmlLang: string;
  script: 'Latn' | 'Deva' | 'Beng' | 'Telu' | 'Taml' | 'Gujr' | 'Knda' | 'Mlym' | 'Guru';
  status: TranslationStatus;
}

export const LOCALES: readonly LocaleInfo[] = [
  { id: 'en', nativeName: 'English', englishName: 'English', intl: 'en-IN', htmlLang: 'en-IN', script: 'Latn', status: 'source' },
  { id: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', intl: 'hi-IN', htmlLang: 'hi', script: 'Deva', status: 'complete' },
  { id: 'hi-Latn', nativeName: 'Hinglish', englishName: 'Hinglish', intl: 'en-IN', htmlLang: 'hi-Latn', script: 'Latn', status: 'complete' },
  { id: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', intl: 'bn-IN', htmlLang: 'bn', script: 'Beng', status: 'machine_draft' },
  { id: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', intl: 'te-IN', htmlLang: 'te', script: 'Telu', status: 'machine_draft' },
  { id: 'mr', nativeName: 'मराठी', englishName: 'Marathi', intl: 'mr-IN', htmlLang: 'mr', script: 'Deva', status: 'machine_draft' },
  { id: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', intl: 'ta-IN', htmlLang: 'ta', script: 'Taml', status: 'machine_draft' },
  { id: 'gu', nativeName: 'ગુજરાતી', englishName: 'Gujarati', intl: 'gu-IN', htmlLang: 'gu', script: 'Gujr', status: 'machine_draft' },
  { id: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada', intl: 'kn-IN', htmlLang: 'kn', script: 'Knda', status: 'machine_draft' },
  { id: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam', intl: 'ml-IN', htmlLang: 'ml', script: 'Mlym', status: 'machine_draft' },
  { id: 'pa', nativeName: 'ਪੰਜਾਬੀ', englishName: 'Punjabi', intl: 'pa-IN', htmlLang: 'pa', script: 'Guru', status: 'machine_draft' },
];

export function localeInfo(id: LocaleId): LocaleInfo {
  return LOCALES.find((l) => l.id === id) ?? LOCALES[0];
}

/** Best supported locale for a list of browser languages (navigator.languages). */
export function matchLocale(preferred: readonly string[]): LocaleId {
  for (const raw of preferred) {
    const tag = raw.toLowerCase();
    if (tag === 'hi-latn') return 'hi-Latn';
    const base = tag.split('-')[0];
    const hit = LOCALES.find((l) => l.id.toLowerCase() === base);
    if (hit) return hit.id;
  }
  return 'en';
}
