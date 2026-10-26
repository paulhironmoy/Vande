/**
 * Social copy: `useSocialT()` follows the root store's language, loads src/i18n/social/<locale>.ts lazily (English is
 * bundled, so the first paint is never a raw key) and formats ICU-lite messages with `formatMessage` from '@/i18n'.
 * Every key starts with `social.` (or `banter.` for the predefined Cricket Room phrases).
 */
import { useEffect, useMemo, useState } from 'react';
import type { LocaleId } from '@/contracts';
import { useApp } from '@/app/store';
import { formatMessage, loadSource, localeInfo, type MessageParams } from '@/i18n';
import { hinglishRelative } from '@/i18n/translator';
import { socialEn, type SocialMessageKey } from '@/i18n/social/en';
import { CITIES, isCityId } from '@/net/shared/cities';

export type { SocialMessageKey };
type Flat = Record<string, string>;

const loaded = new Map<string, Flat>([['en', socialEn as Flat]]);

/** Loads one locale's social catalog (cached; English is bundled). */
export function loadSocialCatalog(locale: LocaleId): Promise<Flat> {
  const hit = loaded.get(locale);
  if (hit) return Promise.resolve(hit);
  return loadSource('social', locale).then((cat) => {
    const c = (cat ?? {}) as Flat;
    loaded.set(locale, c);
    return c;
  });
}

/** For the lazy route loaders: the active locale's social copy is ready before the screen renders. */
export function preloadSocial(locale: LocaleId = useApp.getState().settings.locale): Promise<void> {
  return loadSocialCatalog(locale).then(
    () => undefined,
    () => undefined,
  );
}

export interface SocialT {
  locale: LocaleId;
  intl: string;
  t(key: SocialMessageKey, params?: MessageParams): string;
  /** A key built at runtime (post kinds, statuses, badges); unknown keys fall back to `fallback` or a readable form. */
  tk(key: string, params?: MessageParams, fallback?: string): string;
  has(key: string): boolean;
  number(n: number, opts?: Intl.NumberFormatOptions): string;
  date(d: Date | string | number, opts?: Intl.DateTimeFormatOptions): string;
  /** "in 3 hours" / "2 minutes ago" (positive = future). */
  relative(deltaMs: number): string;
  /** Localised city name from the fixed list. */
  city(id: string | null | undefined): string;
}

function humanise(key: string): string {
  const last = key.split('.').pop() ?? key;
  const words = last.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

export function createSocialT(locale: LocaleId, catalog: Flat | null): SocialT {
  const intl = localeInfo(locale).intl;
  const en = socialEn as Flat;
  const lookup = (key: string): string | undefined => catalog?.[key] ?? en[key];
  const fmt = (pattern: string, params?: MessageParams) => formatMessage(pattern, params, intl);
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
    date: (d, opts = { day: 'numeric', month: 'short' }) => {
      const v = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(v.getTime())) return '';
      try {
        return new Intl.DateTimeFormat(intl, opts).format(v);
      } catch {
        return new Intl.DateTimeFormat('en-IN', opts).format(v);
      }
    },
    relative: (deltaMs) => {
      const abs = Math.abs(deltaMs);
      const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['day', 86_400_000],
        ['hour', 3_600_000],
        ['minute', 60_000],
      ];
      const [unit, size] = units.find(([, ms]) => abs >= ms) ?? units[units.length - 1];
      const value = Math.round(deltaMs / size);
      // Intl has no Hinglish: "3 ghante mein", "21 ghante pehle" (the app's own wording, src/i18n/translator.ts).
      if (locale === 'hi-Latn') return hinglishRelative(value, unit);
      try {
        return new Intl.RelativeTimeFormat(intl, { numeric: 'auto' }).format(value, unit);
      } catch {
        return new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' }).format(value, unit);
      }
    },
    city: (id) => {
      if (!id || !isCityId(id)) return '';
      return lookup(`social.city.${id}`) ?? CITIES[id];
    },
  };
}

/** The social translator for the active language (re-renders when the catalog arrives or the language changes). */
export function useSocialT(): SocialT {
  const locale = useApp((s) => s.settings.locale);
  const [catalog, setCatalog] = useState<Flat | null>(() => loaded.get(locale) ?? null);
  useEffect(() => {
    let alive = true;
    const hit = loaded.get(locale);
    if (hit) {
      setCatalog(hit);
      return;
    }
    void loadSocialCatalog(locale).then((c) => alive && setCatalog(c));
    return () => {
      alive = false;
    };
  }, [locale]);
  return useMemo(() => createSocialT(locale, loaded.get(locale) ?? catalog), [locale, catalog]);
}
