/**
 * The social catalogs (src/i18n/social): every message parses, uses the same placeholders as its English, keeps to
 * the social.* and banter.* prefixes, and STATUS.md tells the truth about coverage and review: Hindi and Hinglish are
 * complete, the other eight are marked MACHINE-DRAFTED in their files and in the status table.
 */
import { describe, expect, it } from 'vitest';
import { parseMessage } from '@/i18n/format';
import { socialEn } from '@/i18n/social/en';
import status from '../../../src/i18n/social/STATUS.md?raw';

type Cat = Record<string, string>;
const modules = import.meta.glob('../../../src/i18n/social/*.ts', { eager: true }) as Record<string, { default?: Cat; socialEn?: Cat }>;
const sources = import.meta.glob('../../../src/i18n/social/*.ts', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const name = (p: string) => p.replace(/^.*\/|\.ts$/g, '');
const CATALOGS: Record<string, Cat> = Object.fromEntries(Object.entries(modules).map(([p, m]) => [name(p), (m.default ?? m.socialEn ?? {}) as Cat]));
const SOURCE: Record<string, string> = Object.fromEntries(Object.entries(sources).map(([p, s]) => [name(p), s]));
const DRAFTED = ['bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa'];

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
const argsOf = (m: string) => [...args(parseMessage(m))].sort().join(',');

describe('social catalogs', () => {
  it('has English, Hindi, Hinglish and the eight drafted languages', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual(['en', 'hi', 'hi-Latn', ...DRAFTED].sort());
    expect(CATALOGS.en).toEqual(socialEn);
  });

  it('every message parses, is not empty, keeps to its prefixes and matches the English placeholders', () => {
    const bad: string[] = [];
    for (const [locale, cat] of Object.entries(CATALOGS)) {
      for (const [k, v] of Object.entries(cat)) {
        if (!/^(social|banter)\./.test(k)) bad.push(`${locale}: ${k} is outside social.* / banter.*`);
        if (!v.trim()) bad.push(`${locale}: ${k} is empty`);
        try {
          parseMessage(v);
        } catch {
          bad.push(`${locale}: ${k} does not parse`);
          continue;
        }
        if (locale === 'en') continue;
        if (!(k in socialEn)) bad.push(`${locale}: stray key ${k}`);
        else if (argsOf(v) !== argsOf(socialEn[k as keyof typeof socialEn])) bad.push(`${locale}: ${k} uses {${argsOf(v)}}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('Hindi is complete; Hinglish has all the copy (city names fall back to English spellings)', () => {
    const english = Object.keys(socialEn);
    expect(english.filter((k) => !(k in CATALOGS.hi))).toEqual([]);
    expect(english.filter((k) => !k.startsWith('social.city.') && !(k in CATALOGS['hi-Latn']))).toEqual([]);
  });

  it('marks the drafted languages MACHINE-DRAFTED in their files and in STATUS.md, never as reviewed', () => {
    for (const l of DRAFTED) {
      expect(SOURCE[l], l).toContain('MACHINE-DRAFTED');
      expect(SOURCE[l], l).toMatch(/REQUIRES human linguistic QA/);
      const row = status.split('\n').find((line) => line.startsWith(`| \`${l}\``));
      expect(row, l).toContain('**MACHINE-DRAFTED**');
      expect(row, l).not.toMatch(/reviewed/i);
    }
  });

  it('STATUS.md counts are the real key counts', () => {
    const total = Object.keys(socialEn).length;
    const row = (l: string) => status.split('\n').find((line) => line.startsWith(`| \`${l}\``)) ?? '';
    expect(status).toContain(`(${total} keys:`);
    for (const l of Object.keys(CATALOGS)) expect(row(l), l).toContain(`${Object.keys(CATALOGS[l]).length} / ${total}`);
  });
});
