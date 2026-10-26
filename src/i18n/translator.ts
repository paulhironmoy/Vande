import type { LocaleId } from '@/contracts';
import { en, type AppCatalogKey } from './catalogs/en';
import { formatMessage, numberFormat, type MessageParams } from './format';
import type { MessageKey } from './keys';
import { localeInfo } from './locales';

/** An app catalog file (src/i18n/catalogs/<locale>.ts): a partial of the English app catalog. */
export type Catalog = Partial<Record<AppCatalogKey, string>> & Record<string, string | undefined>;

export interface Translator {
  locale: LocaleId;
  /** BCP 47 tag used for Intl. */
  intl: string;
  t(key: MessageKey, params?: MessageParams): string;
  /**
   * Engine- or server-provided keys (tactical explanations, commentary, ghost names). Missing keys fall back to
   * `fallback`, then the English catalog, then a readable version of the key; never a crash.
   */
  tk(key: string, params?: MessageParams, fallback?: string): string;
  has(key: string): boolean;
  number(n: number, opts?: Intl.NumberFormatOptions): string;
  date(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string;
  /** "in 3 hours" / "2 minutes ago" from a millisecond delta (positive = future). */
  relative(deltaMs: number): string;
  list(items: string[], type?: 'conjunction' | 'disjunction'): string;
}

const dateFormats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(locale: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dateFormats.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, opts);
    } catch {
      f = new Intl.DateTimeFormat('en-IN', opts);
    }
    dateFormats.set(key, f);
  }
  return f;
}

const enAppCatalog = en as unknown as Record<string, string>;
const warned = new Set<string>();

function humanise(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/**
 * A translator for `locale`. `catalog` is the locale's merged catalog (all sources) and `english` the merged English
 * catalog used as the fallback; without `english` only the bundled English app catalog is available.
 */
export function createTranslator(locale: LocaleId, catalog: Record<string, string | undefined> | null, english: Record<string, string | undefined> | null = null): Translator {
  const info = localeInfo(locale);
  const intl = info.intl;
  const enCatalog = english ?? enAppCatalog;
  const lookup = (key: string): string | undefined => {
    const own = catalog?.[key];
    if (own !== undefined) return own;
    const fallback = enCatalog[key] ?? enAppCatalog[key];
    if (fallback !== undefined && locale !== 'en' && catalog && import.meta.env.DEV && !warned.has(`${locale}:${key}`)) {
      warned.add(`${locale}:${key}`);
      console.debug(`[i18n] ${locale} is missing "${key}" (using English)`);
    }
    return fallback;
  };
  return {
    locale,
    intl,
    t(key, params) {
      const pattern = lookup(key);
      return pattern === undefined ? humanise(key) : formatMessage(pattern, params, intl);
    },
    tk(key, params, fallback) {
      const pattern = lookup(key);
      if (pattern !== undefined) return formatMessage(pattern, params, intl);
      return fallback !== undefined ? formatMessage(fallback, params, intl) : humanise(key);
    },
    has(key) {
      return lookup(key) !== undefined;
    },
    number(n, opts) {
      return numberFormat(intl, opts).format(n);
    },
    date(d, opts = { day: 'numeric', month: 'short' }) {
      const value = d instanceof Date ? d : new Date(d);
      return Number.isNaN(value.getTime()) ? '' : dateFormat(intl, opts).format(value);
    },
    relative(deltaMs) {
      const abs = Math.abs(deltaMs);
      const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
        ['second', 1000],
      ];
      const [unit, size] = units.find(([, ms]) => abs >= ms) ?? units[units.length - 1];
      const value = Math.round(deltaMs / size);
      // Intl has no Hinglish: written out here, so no English slips into a Hinglish sentence ("5 ghante mein").
      if (locale === 'hi-Latn') return hinglishRelative(value, unit);
      try {
        return new Intl.RelativeTimeFormat(intl, { numeric: 'auto' }).format(value, unit);
      } catch {
        return new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' }).format(value, unit);
      }
    },
    list(items, type = 'conjunction') {
      try {
        return new Intl.ListFormat(intl, { style: 'long', type }).format(items);
      } catch {
        return items.join(', ');
      }
    },
  };
}

const HINGLISH_UNITS: Record<string, [string, string]> = {
  day: ['din', 'din'],
  hour: ['ghanta', 'ghante'],
  minute: ['minute', 'minute'],
  second: ['second', 'second'],
};

/** "5 ghante mein", "2 din pehle", "abhi", "kal". */
export function hinglishRelative(value: number, unit: Intl.RelativeTimeFormatUnit): string {
  if (value === 0) return unit === 'day' ? 'aaj' : 'abhi';
  if (unit === 'day' && Math.abs(value) === 1) return 'kal';
  const n = Math.abs(value);
  const [one, many] = HINGLISH_UNITS[unit] ?? [unit, unit];
  return `${n} ${n === 1 ? one : many} ${value > 0 ? 'mein' : 'pehle'}`;
}
