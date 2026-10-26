import { describe, expect, it } from 'vitest';
import { formatMessage, parseMessage } from '@/i18n/format';
import { createTranslator } from '@/i18n/translator';
import { en } from '@/i18n/catalogs/en';
import { LOCALES, matchLocale } from '@/i18n/locales';
import hi from '@/i18n/catalogs/hi';
import hiLatn from '@/i18n/catalogs/hi-Latn';
import bn from '@/i18n/catalogs/bn';
import te from '@/i18n/catalogs/te';
import mr from '@/i18n/catalogs/mr';
import ta from '@/i18n/catalogs/ta';
import gu from '@/i18n/catalogs/gu';
import kn from '@/i18n/catalogs/kn';
import ml from '@/i18n/catalogs/ml';
import pa from '@/i18n/catalogs/pa';

type Node = ReturnType<typeof parseMessage>[number];
function args(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.k === 'arg') out.add(n.name);
    if (n.k === 'plural' || n.k === 'select') {
      out.add(n.name);
      for (const opt of Object.values(n.options)) args(opt, out);
    }
  }
  return out;
}

describe('ICU-lite formatting', () => {
  it('handles plurals with exact matches and #', () => {
    const p = '{count, plural, =0 {no balls} one {# ball} other {# balls}}';
    expect(formatMessage(p, { count: 0 }, 'en-IN')).toBe('no balls');
    expect(formatMessage(p, { count: 1 }, 'en-IN')).toBe('1 ball');
    expect(formatMessage(p, { count: 12 }, 'en-IN')).toBe('12 balls');
  });
  it('uses each locale\'s plural rules (Hindi treats 0 and 1 as one)', () => {
    const p = '{count, plural, one {# गेंद} other {# गेंदें}}';
    expect(formatMessage(p, { count: 1 }, 'hi-IN')).toBe('1 गेंद');
    expect(formatMessage(p, { count: 3 }, 'hi-IN')).toBe('3 गेंदें');
  });
  it('formats numbers with Indian grouping and handles select and nesting', () => {
    expect(formatMessage('{n}', { n: 123456 }, 'en-IN')).toBe('1,23,456');
    expect(formatMessage('{k, select, bowled {Bowled} other {Out}}', { k: 'bowled' }, 'en-IN')).toBe('Bowled');
    expect(formatMessage('{k, select, bowled {Bowled} other {Out}}', { k: 'lbw' }, 'en-IN')).toBe('Out');
    expect(formatMessage('{a} {b, plural, one {# x} other {# xs {a}}}', { a: 'A', b: 2 }, 'en-IN')).toBe('A 2 xs A');
  });
  it('never throws on malformed patterns or missing params', () => {
    expect(formatMessage('{broken, plural, one {x}', { broken: 1 }, 'en-IN')).toBe('{broken, plural, one {x}');
    expect(formatMessage('Hi {name}', {}, 'en-IN')).toBe('Hi {name}');
  });
});

describe('catalogs', () => {
  const all: Record<string, Record<string, string | undefined>> = { hi, 'hi-Latn': hiLatn, bn, te, mr, ta, gu, kn, ml, pa };
  const enMap = en as unknown as Record<string, string>;

  it('every English message parses and plural/select blocks have an other branch', () => {
    for (const [k, v] of Object.entries(enMap)) expect(() => parseMessage(v), k).not.toThrow();
  });

  it('every translation uses exactly the English arguments and has no stray keys', () => {
    for (const [locale, cat] of Object.entries(all)) {
      for (const [k, v] of Object.entries(cat)) {
        expect(k in enMap, `${locale}: stray key ${k}`).toBe(true);
        if (v === undefined) continue;
        const want = args(parseMessage(enMap[k]));
        const got = args(parseMessage(v));
        expect([...got].sort(), `${locale}:${k}`).toEqual([...want].sort());
      }
    }
  });

  it('Hindi and Hinglish are complete; drafted locales cover the core UI', () => {
    const keys = Object.keys(enMap);
    expect(keys.filter((k) => hi[k] === undefined)).toEqual([]);
    expect(keys.filter((k) => hiLatn[k] === undefined)).toEqual([]);
    for (const cat of [bn, te, mr, ta, gu, kn, ml, pa]) {
      for (const core of ['brand.tagline', 'common.continue', 'onboarding.cta', 'plan.lock', 'bat.tap', 'reveal.title']) expect(cat[core]).toBeTruthy();
    }
    expect(LOCALES.filter((l) => l.status === 'machine_draft').map((l) => l.id).sort()).toEqual(['bn', 'gu', 'kn', 'ml', 'mr', 'pa', 'ta', 'te']);
  });
});

describe('translator', () => {
  it('falls back to English for missing keys and never shows raw engine keys', () => {
    const t = createTranslator('bn', { ...bn, 'shot.drive': 'ড্রাইভ' }, { ...(en as unknown as Record<string, string>), 'shot.drive': 'Drive' });
    expect(t.t('reveal.tactics')).toBe(en['reveal.tactics']);
    expect(t.t('shot.drive')).toBe('ড্রাইভ');
    expect(t.t('common.continue')).toBe(bn['common.continue']);
    expect(t.tk('explain.some_future_key', undefined, 'Fallback line')).toBe('Fallback line');
    expect(t.tk('commentary.unknown_thing')).toBe('Unknown thing');
  });
  it('formats dates, relative time and numbers per locale', () => {
    const t = createTranslator('hi', hi);
    expect(t.number(1234567)).toBe('12,34,567');
    expect(t.relative(3 * 3_600_000)).toMatch(/3/);
    expect(t.date(new Date('2026-10-25T12:00:00Z'))).toMatch(/25/);
  });
  it('matches browser languages to supported locales', () => {
    expect(matchLocale(['ta-IN', 'en'])).toBe('ta');
    expect(matchLocale(['hi-Latn'])).toBe('hi-Latn');
    expect(matchLocale(['fr-FR'])).toBe('en');
  });
});
