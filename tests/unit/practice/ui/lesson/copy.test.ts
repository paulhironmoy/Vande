/**
 * Every line the lesson shows exists in English, Hindi and Hinglish (a missing one would show a humanised key), uses
 * exactly the English placeholders, and fits the layout; no technical wording (F8). The source is scanned, so a new
 * `practice.lesson.` string in the lesson's code is checked without anyone remembering to list it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { practiceEn } from '@/i18n/practice/en';
import hi from '@/i18n/practice/hi';
import hiLatn from '@/i18n/practice/hi-Latn';

const DIR = join(__dirname, '../../../../../src/practice/ui/lesson');
const INPUTS = ['touch', 'mouse', 'pen', 'keyboard', 'camera'];

/** Every key the lesson can ask for: the literal ones found in its source, and the ones it builds from the input. */
function lessonKeys(): string[] {
  const keys = new Set<string>();
  for (const f of readdirSync(DIR).filter((n) => /\.(ts|tsx)$/.test(n))) {
    const src = readFileSync(join(DIR, f), 'utf8');
    for (const m of src.matchAll(/'(practice\.lesson\.[a-z_.]+)'/g)) keys.add(m[1]);
  }
  for (const i of INPUTS) {
    for (const k of ['load', 'strike']) keys.add(`practice.lesson.${i}.${k}`);
    keys.add(`practice.lesson.announce.${i}`);
    keys.add(`practice.lesson.ghost.${i}`);
  }
  for (const k of ['defend', 'loft']) keys.add(`practice.lesson.keyboard.${k}`);
  for (const n of ['tap', 'pull', 'key_defend', 'camera']) keys.add(`practice.lesson.note.${n}`);
  for (const side of ['early', 'late'])
    for (const size of ['small', 'medium', 'large']) keys.add(`practice.lesson.timing.${side}.${size}`);
  return [...keys].sort();
}

const catalogs: Array<[string, Record<string, string>]> = [
  ['en', practiceEn as Record<string, string>],
  ['hi', hi as Record<string, string>],
  ['hi-Latn', hiLatn as Record<string, string>],
];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe('the lesson’s words', () => {
  const keys = lessonKeys();

  it('finds the keys the code asks for (the scan is not empty)', () => {
    expect(keys.length).toBeGreaterThan(40);
  });

  for (const [name, cat] of catalogs)
    it(`${name} has every one of them`, () => {
      expect(keys.filter((k) => typeof cat[k] !== 'string' || cat[k].trim() === '')).toEqual([]);
    });

  it('Hindi and Hinglish use exactly the English placeholders', () => {
    for (const k of keys)
      for (const [name, cat] of catalogs.slice(1))
        if (cat[k])
          expect(placeholders(cat[k]), `${name} ${k}`).toEqual(placeholders(practiceEn[k as keyof typeof practiceEn]));
  });

  it('no line carries technical device wording (F8)', () => {
    const banned = /\b(tier|fps|frame rate|gpu|webgl|renderer|software graphics|benchmark|shader|msaa)\b/i;
    for (const k of keys) for (const [, cat] of catalogs) if (cat[k]) expect(cat[k]).not.toMatch(banned);
  });

  it('no technical wording (F8) and no unglossed cricket jargon (RK2) by the evaluators’ own word lists', () => {
    // Copies of TECH and JARGON in scripts/eval/scan.mjs (keep in sync): the lists the independent scan applies.
    const TECH = [
      /\btiers?\b/i,
      /\bfps\b/i,
      /\bframe ?rates?\b/i,
      /\bGPU\b/i,
      /\bWebGL\b/i,
      /\brender(er|ing)?\b/i,
      /\bsoftware graphics\b/i,
      /\bbenchmark/i,
      /\bshaders?\b/i,
      /\bMSAA\b/i,
      /\bdevice check\b/i,
      /\bcutoff\b/i,
    ];
    const JARGON = [
      /\bline\b/i,
      /\blength\b/i,
      /\bseam(er|ing)?\b/i,
      /\bswing(ing|er)?\b/i,
      /\bspin(ner|ning)?\b/i,
      /\bcutters?\b/i,
      /\byorkers?\b/i,
      /\bedges?d?\b/i,
      /\bLBW\b/,
      /\bbouncers?\b/i,
      /\boff[ -]?(side|stump)\b/i,
      /\bleg[ -]?(side|stump)\b/i,
      /\boutswing|inswing/i,
      /\bgood length\b/i,
      /\bfull toss\b/i,
      /\bpace band\b/i,
      /\bdrift|dip|turn\b/i,
      /\bfootwork\b/i,
    ];
    const hits: string[] = [];
    for (const k of keys)
      for (const [name, cat] of catalogs)
        for (const re of [...TECH, ...JARGON]) if (cat[k] && re.test(cat[k])) hits.push(`${name} ${k} ${re}`);
    expect(hits).toEqual([]);
  });

  it('a card line is short enough to wrap on a phone at 200% text: at most 90 characters, an announcement at most 220', () => {
    for (const k of keys) {
      const en = (practiceEn as Record<string, string>)[k];
      if (!en) continue;
      const max = k.startsWith('practice.lesson.announce.') || k.startsWith('practice.lesson.ghost.') ? 220 : 90;
      expect(en.length, k).toBeLessThanOrEqual(max);
    }
  });
});
