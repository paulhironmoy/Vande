/**
 * Words (DoD CTR-08, G-09): every string the control choice shows exists in English, Hindi and Hinglish with the same
 * {placeholders}, none uses technical device wording (F8: tier, fps, GPU, WebGL, renderer, benchmark, shader...), and each
 * one fits the plain, short voice (no exclamation marks, no fake urgency). Hindi and Hinglish quality is for native
 * speakers (S/chase/COPY-REVIEW.md); this checks shape, not language.
 */
import { describe, expect, it } from 'vitest';
import { loadPracticeCatalog } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';

/** The F8 list of scripts/eval/scan.mjs (technical device wording a player must never read). */
const F8 = [
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
  /\bpose\b/i,
  /\bAI\b/,
  /\bhardware acceleration\b/i,
];

const en = practiceEn as Record<string, string>;
const mine = Object.keys(en).filter((k) => k.startsWith('practice.controls.') || k.startsWith('practice.input.'));
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the control choice words', () => {
  it('there are control keys at all, and the ones the screens use exist', () => {
    expect(mine.length).toBeGreaterThanOrEqual(20);
    for (const k of [
      'practice.controls.title',
      'practice.controls.mouse.hint',
      'practice.controls.touch.hint',
      'practice.controls.camera.hint',
      'practice.controls.camera.needs',
      'practice.controls.keyboard',
      'practice.controls.remembered',
      'practice.controls.safe',
      'practice.controls.unavailable.secure',
      'practice.controls.unavailable.api',
      'practice.controls.unavailable.device',
      'practice.controls.setting.title',
      'practice.controls.setting.hint',
      'practice.controls.chip',
      'practice.controls.change',
      'practice.controls.between_balls',
      'practice.controls.switched',
      'practice.input.mouse',
      'practice.input.touch',
      'practice.input.camera',
      'practice.camera.setting.use',
    ])
      expect(en[k], k).toBeTruthy();
  });

  for (const locale of ['en', 'hi', 'hi-Latn'] as const) {
    it(`${locale}: no technical device wording, no exclamation marks`, async () => {
      const cat = (await loadPracticeCatalog(locale)) as Record<string, string>;
      for (const k of mine) {
        const text = cat[k] ?? en[k];
        for (const re of F8) expect(text, `${locale} ${k}`).not.toMatch(re);
        expect(text, `${locale} ${k}`).not.toContain('!');
      }
    });
  }

  for (const locale of ['hi', 'hi-Latn'] as const) {
    it(`${locale}: every control string is translated with the same {placeholders}`, async () => {
      const cat = (await loadPracticeCatalog(locale)) as Record<string, string>;
      for (const k of mine) {
        expect(cat[k], `${locale} is missing ${k}`).toBeTruthy();
        expect(holes(cat[k]), `${locale} ${k}`).toEqual(holes(en[k]));
      }
    });
  }
});
