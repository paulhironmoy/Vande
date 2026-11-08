import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatMessage } from '@/i18n/format';
import { chaseEn } from '@/i18n/practice/en/chase';
import { chaseHi } from '@/i18n/practice/hi/chase';
import { chaseHiLatn } from '@/i18n/practice/hi-Latn/chase';
import { rateText } from '@/practice/ui/chase/ChaseNeed';
import {
  KEYS,
  LANGUAGES,
  buildCopyFixture,
  patternsOf,
  rateDigits,
  renderCs,
  requiredRateX100,
  type Catalogs,
} from './chaseCopyLib';

/**
 * The Unity chase HUD speaks the web COPY sheet's words (bridge contract v7). Two generated files follow the sheet:
 *   unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/ProductionHudChaseCopy.Generated.cs  (the patterns)
 *   tests/fixtures/unity-practice/chase-copy.json                                                       (what the web prints)
 * and the Unity EditMode test ChaseHudTests prints the same strings from C#. When COPY changes a chase HUD string this test
 * fails and names the files; regenerate with
 *   VANDE_WRITE_UNITY_CHASE_COPY=1 npx vitest run tests/unit/practice/unity/chaseCopy.test.ts
 * and run the Unity EditMode suite.
 */
const WRITE = process.env.VANDE_WRITE_UNITY_CHASE_COPY === '1';
const csFile = resolve(
  process.cwd(),
  'unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/ProductionHudChaseCopy.Generated.cs',
);
const fixtureFile = resolve(process.cwd(), 'tests/fixtures/unity-practice/chase-copy.json');

const catalogs: Catalogs = { en: chaseEn, hi: chaseHi, 'hi-Latn': chaseHiLatn };

/** The web HUD's own formatter for the rate number (ChaseNeed.rateText with the app's number formatter). */
const webRateDigits = (rateX100: number, intl: string): string =>
  rateText((n, options) => new Intl.NumberFormat(intl, options).format(n), rateX100);

const expectedCs = renderCs(catalogs);
const expectedFixture = `${JSON.stringify(buildCopyFixture(catalogs, formatMessage, webRateDigits))}\n`;

describe('the Unity chase HUD wording follows the web COPY sheet', () => {
  it('has a generated C# data file and a parity fixture that say what the sheet says now', () => {
    if (WRITE) {
      writeFileSync(csFile, expectedCs);
      writeFileSync(fixtureFile, expectedFixture);
    }
    expect(readFileSync(csFile, 'utf8'), 'ProductionHudChaseCopy.Generated.cs is out of date with the COPY sheet').toBe(
      expectedCs,
    );
    expect(
      readFileSync(fixtureFile, 'utf8'),
      'tests/fixtures/unity-practice/chase-copy.json is out of date with the COPY sheet',
    ).toBe(expectedFixture);
  });

  it('uses only sheet keys that exist in English and the three languages carry the same placeholders', () => {
    const patterns = patternsOf(catalogs);
    const placeholders = (pattern: string) => [...pattern.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort();
    for (const { name, key } of KEYS) {
      const english = patterns.en?.[name] as string;
      expect(english, key).toBeTypeOf('string');
      for (const language of LANGUAGES) {
        expect(placeholders(patterns[language.id]?.[name] as string), `${language.id} ${key}`).toEqual(
          placeholders(english),
        );
      }
    }
  });

  it('prints the required rate with the digits Unity prints, for every pair of a 12-ball chase', () => {
    let pairs = 0;
    for (let runs = 1; runs <= 72; runs += 1) {
      for (let balls = 1; balls <= 12; balls += 1) {
        const x100 = requiredRateX100(runs, balls);
        for (const language of LANGUAGES) {
          expect(webRateDigits(x100, language.intl), `${runs} off ${balls} (${language.id})`).toBe(rateDigits(x100));
        }
        pairs += 1;
      }
    }
    expect(pairs).toBe(864);
  });

  it('keeps the plural rules the C# evaluator hard-codes: Hindi one is 0 and 1, English and Hinglish one is exactly 1', () => {
    const hindi = new Intl.PluralRules('hi-IN');
    const english = new Intl.PluralRules('en-IN');
    expect([0, 1, 2, 5, 11].map((n) => hindi.select(n))).toEqual(['one', 'one', 'other', 'other', 'other']);
    expect([0, 1, 2, 5, 11].map((n) => english.select(n))).toEqual(['other', 'one', 'other', 'other', 'other']);
    expect(LANGUAGES.map((language) => language.intl)).toEqual(['en-IN', 'hi-IN', 'en-IN']);
  });
});
