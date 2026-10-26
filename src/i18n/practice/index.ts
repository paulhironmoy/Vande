/**
 * Practice copy (src/i18n/practice/<locale>.ts, keys `practice.*`). `usePracticeT()` follows the root store's
 * language; English is bundled, other files load on demand and are partials of English, so a missing key shows the
 * English line, never a raw key. Formatting is the app's ICU-lite `formatMessage`. Status: ./STATUS.md.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { formatMessage } from '@/i18n/format';
import { localeInfo } from '@/i18n/locales';
import { practiceEn, type PracticeKey } from './en';

export type { PracticeKey };
export type PracticeParams = Record<string, string | number | null | undefined>;
type Flat = Record<string, string>;

const loaders = import.meta.glob(['./*.ts', '!./en.ts', '!./index.ts']) as Record<string, () => Promise<unknown>>;
const loaded = new Map<string, Flat>([['en', practiceEn as Flat]]);
const pending = new Map<string, Promise<Flat>>();

function catalogOf(mod: unknown): Flat {
  if (!mod || typeof mod !== 'object') return {};
  const m = mod as Record<string, unknown>;
  const pick = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Flat) : null);
  return pick(m.default) ?? Object.values(m).map(pick).find(Boolean) ?? {};
}

/** Loads one locale's Practice copy (cached; English is bundled; a locale without a file is English). */
export function loadPracticeCatalog(locale: LocaleId): Promise<Flat> {
  const hit = loaded.get(locale);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(locale);
  if (!p) {
    const entry = Object.entries(loaders).find(([path]) => path.endsWith(`/${locale}.ts`));
    p = (entry ? entry[1]().then(catalogOf) : Promise.resolve({} as Flat)).then(
      (c) => {
        loaded.set(locale, c);
        pending.delete(locale);
        return c;
      },
      () => {
        pending.delete(locale);
        return {} as Flat;
      },
    );
    pending.set(locale, p);
  }
  return p;
}

export interface PracticeT {
  locale: LocaleId;
  intl: string;
  t(key: PracticeKey, params?: PracticeParams): string;
  /** A key built at runtime (variations, reasons, zones); unknown keys use `fallback`, never a raw key. */
  tk(key: string, params?: PracticeParams, fallback?: string): string;
  has(key: string): boolean;
  number(n: number, opts?: Intl.NumberFormatOptions): string;
}

function humanise(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function createPracticeT(locale: LocaleId, catalog: Flat | null): PracticeT {
  const intl = localeInfo(locale).intl;
  const en = practiceEn as Flat;
  const lookup = (key: string): string | undefined => catalog?.[key] ?? en[key];
  const fmt = (pattern: string, params?: PracticeParams) => formatMessage(pattern, params, intl);
  return {
    locale,
    intl,
    t: (key, params) => {
      const p = lookup(key);
      return p === undefined ? humanise(key) : fmt(p, params);
    },
    tk: (key, params, fallback) => {
      const p = lookup(key);
      if (p !== undefined) return fmt(p, params);
      return fallback !== undefined ? fmt(fallback, params) : humanise(key);
    },
    has: (key) => lookup(key) !== undefined,
    number: (n, opts) => {
      try {
        return new Intl.NumberFormat(intl, opts).format(n);
      } catch {
        return String(n);
      }
    },
  };
}

/** The Practice translator for the active language (re-renders when the catalog arrives or the language changes). */
export function usePracticeT(): PracticeT {
  const locale = useApp((s) => s.settings.locale);
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (loaded.has(locale)) return;
    let alive = true;
    void loadPracticeCatalog(locale).then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [locale]);
  const catalog = loaded.get(locale) ?? null;
  return useMemo(() => createPracticeT(locale, catalog), [locale, catalog]);
}
