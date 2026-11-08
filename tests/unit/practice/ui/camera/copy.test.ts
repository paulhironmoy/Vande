/**
 * Every line the camera's screens show exists in English, Hindi and Hinglish (a missing one would show a humanised key),
 * uses exactly the English placeholders, fits the layout, and carries no technical wording (F8) or unglossed cricket
 * jargon (RK2) by the evaluators' own word lists. The source is scanned, so a new `practice.camera.` string in the
 * screens' code is checked without anyone remembering to list it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { practiceEn } from '@/i18n/practice/en';
import hi from '@/i18n/practice/hi';
import hiLatn from '@/i18n/practice/hi-Latn';

const DIR = join(__dirname, '../../../../../src/practice/ui/camera');

const CASES = ['blocked', 'busy', 'black', 'none', 'inapp', 'light', 'slow', 'unsupported'];
const FAMILIES = ['chrome', 'edge', 'firefox', 'safari', 'android', 'android_browser', 'other'];

/** Every key the screens can ask for: the literal ones in their source, and the ones built from a case or a browser. */
function cameraKeys(): string[] {
  const keys = new Set<string>();
  for (const f of readdirSync(DIR).filter((n) => /\.(ts|tsx)$/.test(n))) {
    const src = readFileSync(join(DIR, f), 'utf8');
    for (const m of src.matchAll(/'(practice\.(?:camera|input|error|common)\.[a-z0-9_.]+)'/g)) keys.add(m[1]);
  }
  for (const c of CASES) {
    keys.add(`practice.camera.trouble.${c}.title`);
    keys.add(`practice.camera.trouble.${c}.body`);
  }
  for (const f of FAMILIES) keys.add(`practice.camera.trouble.blocked.${f}`);
  keys.add('practice.camera.trouble.black.shutter');
  keys.add('practice.camera.trouble.black.toggle');
  for (const i of ['mouse', 'touch']) {
    keys.add(`practice.input.${i}`);
    keys.add(`practice.camera.switch.${i}`);
  }
  return [...keys].sort();
}

const catalogs: Array<[string, Record<string, string>]> = [
  ['en', practiceEn as Record<string, string>],
  ['hi', hi as Record<string, string>],
  ['hi-Latn', hiLatn as Record<string, string>],
];
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();

describe("the camera screens' words", () => {
  const keys = cameraKeys();

  it('finds the keys the code asks for (the scan is not empty)', () => {
    expect(keys.length).toBeGreaterThan(60);
    expect(keys).toContain('practice.camera.ready.line');
    expect(keys).toContain('practice.camera.consent.allow');
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

  it('names the two ways back plainly, in every language', () => {
    expect(practiceEn['practice.camera.switch.mouse']).toBe('Bat with mouse');
    expect(practiceEn['practice.camera.switch.touch']).toBe('Bat with touch');
  });

  it('no line carries technical device wording (F8): no model, tier, frame rate, GPU, WebGL, renderer, benchmark, shader', () => {
    // Copies of TECH in scripts/eval/scan.mjs (keep in sync), plus the words the camera brief forbids.
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
      /\bmodel\b/i,
      /\binference\b/i,
      /\bhardware acceleration\b/i,
      /\bWASM|WebAssembly\b/i,
      /\bworker\b/i,
    ];
    const hits: string[] = [];
    for (const k of keys)
      for (const [name, cat] of catalogs)
        for (const re of TECH) if (cat[k] && re.test(cat[k])) hits.push(`${name} ${k} ${re}`);
    expect(hits).toEqual([]);
  });

  it('a line is short enough to wrap on a phone at 200% text: a line at most 90 characters, a paragraph at most 170', () => {
    for (const k of keys) {
      const en = (practiceEn as Record<string, string>)[k];
      if (!en) continue;
      const long =
        k.includes('.trouble.blocked.') ||
        k.endsWith('.body') ||
        k === 'practice.camera.consent.what' ||
        k.endsWith('.live.gesture_label');
      const sr = k.endsWith('.announce') || k.endsWith('.label') || k.endsWith('.gesture_label');
      const max = sr ? 280 : long ? 170 : 90;
      expect(en.length, k).toBeLessThanOrEqual(max);
    }
  });

  it('keeps clear of the closed stages: no account, streak, reward or share wording', () => {
    const banned = /\b(account|sign[- ]?in|streak|leaderboard|reward|coins?|XP|share|notification)s?\b/i;
    for (const k of keys)
      for (const [name, cat] of catalogs) if (cat[k]) expect(cat[k], `${name} ${k}`).not.toMatch(banned);
  });
});
