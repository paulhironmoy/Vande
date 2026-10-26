/**
 * Translation sources (src/i18n/sources.ts): app catalogs (experience) and engine JSON (gameplay) are merged per
 * locale. A key may live in exactly one source, each source keeps to its reserved prefixes (social.* and banter.*
 * belong to the social workstream's own catalogs), and every translation uses the same placeholders as its English.
 */
import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/i18n/format';
import { createTranslator } from '@/i18n/translator';
import { catalogFromModule, ensureI18n, loadLocale, mergeCatalogs, SOCIAL_PREFIXES, sourceLocales } from '@/i18n/sources';
import { LOCALES } from '@/i18n/locales';
import { en } from '@/i18n/catalogs/en';

type Cat = Record<string, string>;
const eagerApp = import.meta.glob('../../../src/i18n/catalogs/*.ts', { eager: true }) as Record<string, unknown>;
const eagerEngine = import.meta.glob('../../../src/i18n/engine/*.json', { eager: true }) as Record<string, unknown>;

const byLocale = (files: Record<string, unknown>): Record<string, Cat> =>
  Object.fromEntries(Object.entries(files).map(([p, m]) => [p.replace(/^.*\/|\.(ts|json)$/g, ''), (catalogFromModule(m) ?? {}) as Cat]));

const SOURCES = { app: byLocale(eagerApp), engine: byLocale(eagerEngine) };
const prefix = (k: string) => k.split('.')[0];
const ENGINE_PREFIXES = new Set(Object.keys(SOURCES.engine.en ?? {}).map(prefix));
const APP_PREFIXES = new Set(Object.keys(en).map(prefix));

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
const argsOf = (p: string) => [...args(parseMessage(p))].sort().join(',');

describe('translation sources', () => {
  it('the app catalog in the tests is the one the app bundles', () => {
    expect(SOURCES.app.en).toEqual(en);
    expect(sourceLocales('app').sort()).toEqual(Object.keys(SOURCES.app).sort());
  });

  it('no key is defined by more than one source in any locale', () => {
    const locales = new Set([...Object.keys(SOURCES.app), ...Object.keys(SOURCES.engine)]);
    const dupes: string[] = [];
    for (const locale of locales) {
      const seen = new Map<string, string>();
      for (const [source, files] of Object.entries(SOURCES)) {
        for (const key of Object.keys(files[locale] ?? {})) {
          const other = seen.get(key);
          if (other) dupes.push(`${locale}: ${key} in ${other} and ${source}`);
          else seen.set(key, source);
        }
      }
    }
    expect(dupes).toEqual([]);
  });

  it('each source keeps to its reserved prefixes', () => {
    const social = new Set<string>(SOCIAL_PREFIXES);
    for (const [locale, cat] of Object.entries(SOURCES.app)) {
      const wrong = Object.keys(cat).filter((k) => ENGINE_PREFIXES.has(prefix(k)) || social.has(prefix(k)));
      expect(wrong, `app ${locale} uses engine or social prefixes`).toEqual([]);
    }
    for (const [locale, cat] of Object.entries(SOURCES.engine)) {
      const wrong = Object.keys(cat).filter((k) => social.has(prefix(k)) || APP_PREFIXES.has(prefix(k)));
      expect(wrong, `engine ${locale} uses app or social prefixes`).toEqual([]);
    }
  });

  it('every translation parses and uses the same placeholders as its source English', () => {
    const bad: string[] = [];
    for (const [source, files] of Object.entries(SOURCES)) {
      const english = files.en ?? {};
      for (const [locale, cat] of Object.entries(files)) {
        for (const [k, v] of Object.entries(cat)) {
          if (typeof v !== 'string') continue;
          try {
            parseMessage(v);
          } catch {
            bad.push(`${source}/${locale}: ${k} does not parse`);
            continue;
          }
          if (locale === 'en') continue;
          if (!(k in english)) bad.push(`${source}/${locale}: stray key ${k}`);
          else if (argsOf(v) !== argsOf(english[k])) bad.push(`${source}/${locale}: ${k} uses {${argsOf(v)}} not {${argsOf(english[k])}}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('merges a locale from both sources and falls back to merged English', async () => {
    const { english } = await ensureI18n('en');
    for (const k of Object.keys(SOURCES.engine.en ?? {}).slice(0, 20)) expect(english[k]).toBe(SOURCES.engine.en[k]);
    expect(english['brand.name']).toBe(en['brand.name']);
    const hi = await loadLocale('hi');
    const t = createTranslator('hi', hi, english);
    expect(t.t('brand.mode')).toBe(SOURCES.app.hi['brand.mode']);
    // An engine key the Hindi engine file lacks (or that has no Hindi file yet) falls back to English, never a raw key.
    const engineKey = Object.keys(SOURCES.engine.en ?? { 'variant.yorker': 'Yorker' })[0];
    expect(t.t(engineKey as 'brand.name')).toBe((SOURCES.engine.hi ?? {})[engineKey] ?? SOURCES.engine.en[engineKey]);
  });

  it('merge order resolves an accidental duplicate in favour of the app catalog', () => {
    expect(mergeCatalogs([{ a: 'app' }, { a: 'engine', b: 'e' }, { c: 's' }])).toEqual({ a: 'app', b: 'e', c: 's' });
  });

  it('knows every supported locale', () => {
    expect(LOCALES.map((l) => l.id).sort()).toEqual(Object.keys(SOURCES.app).sort());
  });
});
