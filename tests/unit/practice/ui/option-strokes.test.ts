/**
 * "Alternative shots" names a grounded option by its stroke family (COACH RERUN-REPORT §6 request 3): the family the
 * physics itself plays for the option's swing and footwork (src/physics/shot.ts shotFamily), never a bearing mapping
 * of the UI's own, so a steer reads as a steer, a cut as a cut and a glance as a glance, not always "Drive". Raised
 * and lofted options keep their height words. Every family has its words in every Practice language, and none of
 * them reads wrong with any region the physics names.
 */
import { describe, expect, it } from 'vitest';
import type { CoachOption, LocaleId } from '@/contracts';
import { createPracticeT, type PracticeT } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { SHOT_FAMILY_FORMS, shotFamily } from '@/physics/shot';
import { optionWords } from '@/practice/ui/components/Alternatives';
import type { Region } from '@/practice/ui/flow/types';
import { regionDefects } from './copyChecks';

const LOCALES: Array<[LocaleId, Record<string, string>]> = [
  ['en', practiceEn as Record<string, string>],
  ['hi', practiceHi as Record<string, string>],
  ['hi-Latn', practiceHiLatn as Record<string, string>],
];
const translators: Array<[LocaleId, PracticeT]> = LOCALES.map(([l, c]) => [
  l,
  createPracticeT(l, l === 'en' ? null : c),
]);
const en = translators[0][1];
const REGIONS: Array<Region | null> = [
  'third_man',
  'point',
  'cover',
  'mid_off',
  'mid_on',
  'midwicket',
  'square_leg',
  'fine_leg',
  'straight',
  'behind',
  null,
];
const ATTACK_FAMILIES = Object.keys(SHOT_FAMILY_FORMS).filter((f) => f !== 'forward_defence' && f !== 'back_defence');

const option = (
  directionDeg: number,
  footwork: CoachOption['footwork'],
  elevation = 0,
  region: Region | null = 'cover',
): CoachOption =>
  ({
    kind: 'recommended',
    decision: 'attack',
    footwork,
    swing: { kind: 'attack', startT: 0.4, directionDeg, power: 0.6, elevation, footwork },
    region,
    expectedRuns: 1,
    dismissalRisk: 0,
    risks: [],
    contactT: null,
    contactPoint: null,
  }) as unknown as CoachOption;

describe('a grounded option is named by its stroke family', () => {
  it('every attacking family of the physics has its words in en, hi and hi-Latn', () => {
    expect(ATTACK_FAMILIES.length).toBeGreaterThanOrEqual(14);
    for (const [locale, catalog] of LOCALES) {
      const missing = ATTACK_FAMILIES.filter((f) => !(`practice.option.stroke.${f}` in catalog));
      expect(missing, locale).toEqual([]);
    }
  });

  it('the family is the physics’ own, for every bearing and footwork', () => {
    for (const footwork of ['forward', 'back', 'across', 'down_track'] as const) {
      for (let d = -180; d <= 180; d += 5) {
        const family = shotFamily('attack', d, footwork);
        expect(optionWords(en, option(d, footwork)), `${footwork} ${d}°`).toBe(
          en
            .tk(`practice.option.stroke.${family}`, {
              footwork: en.tk(`practice.footwork.${footwork}`),
              towards: 'towards cover',
              to: 'to cover',
              gap: 'the cover gap',
            })
            .replace(/^./u, (c) => c.toLocaleUpperCase('en')),
        );
      }
    }
  });

  it('en: a steer, a cut, a glance and a pull read as themselves; a drive still reads as a drive', () => {
    expect(optionWords(en, option(140, 'forward', 0, 'third_man'))).toBe(
      'Steer it on the front foot towards third man',
    );
    expect(optionWords(en, option(100, 'back', 0, 'point'))).toBe('Cut it on the back foot towards point');
    expect(optionWords(en, option(-150, 'forward', 0, 'fine_leg'))).toBe(
      'Glance it on the front foot towards fine leg',
    );
    expect(optionWords(en, option(-80, 'back', 0, 'square_leg'))).toBe('Pull it on the back foot towards square leg');
    expect(optionWords(en, option(40, 'forward'))).toBe('Drive on the front foot towards cover');
  });

  it('raised and lofted options keep their height words, whatever the family', () => {
    expect(optionWords(en, option(140, 'forward', 0.3, 'third_man'))).toBe(
      'Raise it on the front foot towards third man',
    );
    expect(optionWords(en, option(100, 'back', 0.5, 'point'))).toBe('Loft on the back foot towards point');
  });

  for (const [locale, t] of translators) {
    it(`${locale}: no family reads wrong with any region (no doubled words, the gap at most once)`, () => {
      const found: string[] = [];
      for (const region of REGIONS)
        for (const footwork of ['forward', 'back'] as const)
          for (const d of [0, 25, 55, 100, 150, -25, -80, -150]) {
            const line = optionWords(t, option(d, footwork, 0, region));
            for (const defect of regionDefects(locale, line))
              found.push(`${region ?? 'none'} ${footwork} ${d}°: "${line}" (${defect})`);
          }
      expect(found).toEqual([]);
    });
  }
});
