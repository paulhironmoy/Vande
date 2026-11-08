/**
 * The Unity chase HUD wording, derived from the web's COPY sheet (src/i18n/practice/{en,hi,hi-Latn}/chase.ts) so the two
 * surfaces cannot drift. Pure functions, no file access: tests/unit/practice/unity/chaseCopy.test.ts calls them with the real
 * catalogs, the app's own formatMessage and the web HUD's own rate formatter, and either checks the two generated files against
 * the result or (VANDE_WRITE_UNITY_CHASE_COPY=1) rewrites them.
 *
 *  - renderCs(catalogs)             the C# data file Runtime/UI/Production/ProductionHudChaseCopy.Generated.cs
 *  - buildCopyFixture(catalogs, ..) tests/fixtures/unity-practice/chase-copy.json: what the web prints (via its own formatMessage)
 *                                   for a grid of numbers; the C# EditMode test must print the same, character for character.
 *
 * The Unity side evaluates a strict subset of the web's ICU-lite: {name}, and {name, plural, =N {..} one {..} other {..}} with #.
 * Anything else in a mapped pattern (select, number styles, offset, few/many/zero/two) stops the generator, so the small C#
 * evaluator never silently differs from the web formatter.
 */
import { createHash } from 'node:crypto';

export type Catalogs = Record<string, Record<string, string> | undefined>;
type Params = Record<string, number | string>;
export type Formatter = (pattern: string, params: Params | undefined, intl: string) => string;
export type RateDigits = (rateX100: number, intl: string) => string;

export const LANGUAGES = [
  { id: 'en', csharp: 'English', intl: 'en-IN' },
  { id: 'hi', csharp: 'Hindi', intl: 'hi-IN' },
  { id: 'hi-Latn', csharp: 'Hinglish', intl: 'en-IN' },
];

/** The sheet keys the Unity HUD speaks. `params` documents the arguments the C# side passes. */
export const KEYS = [
  { name: 'Status', key: 'practice.chase.status', params: [] },
  { name: 'Need', key: 'practice.chase.need', params: ['runs', 'balls'] },
  { name: 'Rate', key: 'practice.chase.rate', params: ['rate'] },
  { name: 'WonTitle', key: 'practice.chase.won.title', params: [] },
  { name: 'WonSpare', key: 'practice.chase.won.spare', params: ['left'] },
  { name: 'LostTitle', key: 'practice.chase.lost.title', params: ['short'] },
];

/** The pattern of each key per language; a key a language lacks reads as English, as the app does. */
export function patternsOf(catalogs: Catalogs): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const language of LANGUAGES) {
    const mine: Record<string, string> = {};
    out[language.id] = mine;
    for (const { name, key } of KEYS) {
      const own = catalogs[language.id]?.[key];
      const pattern = own ?? catalogs.en?.[key];
      if (typeof pattern !== 'string') throw new Error(`chase copy: the English sheet has no key ${key}`);
      mine[name] = pattern;
    }
  }
  return out;
}

/** Throws unless the pattern uses only the subset the C# evaluator implements. */
export function assertUnitySubset(pattern: string, where: string): void {
  let i = 0;
  const fail = (why: string): never => {
    throw new Error(`chase copy: ${where}: ${why} in "${pattern}"`);
  };
  const ws = () => {
    while (i < pattern.length && /\s/.test(pattern[i] as string)) i += 1;
  };
  const ident = (): string => {
    ws();
    const start = i;
    while (i < pattern.length && /[^\s,{}]/.test(pattern[i] as string)) i += 1;
    return pattern.slice(start, i);
  };
  const sequence = (untilBrace: boolean): void => {
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '}' && untilBrace) return;
      if (ch === '{') {
        argument();
        continue;
      }
      if (ch === '}') fail('a closing brace with no opening brace');
      i += 1;
    }
    if (untilBrace) fail('an unclosed option');
  };
  const argument = (): void => {
    i += 1; // {
    ident();
    ws();
    if (pattern[i] === '}') {
      i += 1;
      return;
    }
    if (pattern[i] !== ',') fail('an argument that is neither {name} nor a plural');
    i += 1;
    if (ident() !== 'plural') fail('a type other than plural');
    ws();
    if (pattern[i] !== ',') fail('a plural without options');
    i += 1;
    let other = false;
    for (;;) {
      ws();
      if (pattern[i] === '}') {
        i += 1;
        break;
      }
      const option = ident();
      if (!(option === 'one' || option === 'other' || /^=\d+$/.test(option))) fail(`the plural option "${option}"`);
      if (option === 'other') other = true;
      ws();
      if (pattern[i] !== '{') fail('a plural option without a body');
      i += 1;
      sequence(true);
      i += 1; // }
    }
    if (!other) fail("a plural without 'other'");
  };
  sequence(false);
}

const csString = (text: string): string => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

export function renderCs(catalogs: Catalogs): string {
  const patterns = patternsOf(catalogs);
  for (const language of LANGUAGES) {
    for (const { name } of KEYS) assertUnitySubset(patterns[language.id]?.[name] as string, `${language.id} ${name}`);
  }
  const digest = createHash('sha256').update(JSON.stringify(patterns)).digest('hex');
  const lines = [];
  lines.push('// <auto-generated>');
  lines.push(
    '// Generated from the web COPY sheet (src/i18n/practice/{en,hi,hi-Latn}/chase.ts) by tests/unit/practice/unity/chaseCopyLib.ts. Do not edit.',
  );
  lines.push(
    '// A COPY change shows up as a failing web test (tests/unit/practice/unity/chaseCopy.test.ts) until this file and',
  );
  lines.push(
    '// tests/fixtures/unity-practice/chase-copy.json are regenerated: VANDE_WRITE_UNITY_CHASE_COPY=1 npx vitest run tests/unit/practice/unity/chaseCopy.test.ts',
  );
  lines.push(
    '// Hindi and Hinglish are AI-authored and wait for native-speaker review (the COPY review sheet); this file only follows them.',
  );
  lines.push('// </auto-generated>');
  lines.push('');
  lines.push('namespace Vande.Practice.UI.Production');
  lines.push('{');
  lines.push('    internal static class ProductionHudChaseCopyData');
  lines.push('    {');
  lines.push(`        internal const string SourceSha256 = "${digest}";`);
  lines.push('');
  KEYS.forEach(({ name, key, params }, index) => {
    lines.push(`        /// <summary>${key}${params.length ? ' (' + params.join(', ') + ')' : ''}</summary>`);
    lines.push(`        internal const int ${name} = ${index};`);
  });
  lines.push('');
  lines.push(
    '        /// <summary>Patterns by language (0 English, 1 Hindi, 2 Hinglish), then by key index above.</summary>',
  );
  lines.push('        internal static readonly string[][] Patterns =');
  lines.push('        {');
  for (const language of LANGUAGES) {
    lines.push(`            new[] // ${language.csharp}`);
    lines.push('            {');
    for (const { name } of KEYS)
      lines.push(`                ${csString(patterns[language.id]?.[name] as string)}, // ${name}`);
    lines.push('            },');
  }
  lines.push('        };');
  lines.push('    }');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

/** One decimal of the required rate from the integer hundredths, half up: the figure Unity shows. */
export function rateDigits(rateX100: number): string {
  const tenths = Math.floor((rateX100 + 5) / 10);
  return `${Math.floor(tenths / 10)}.${tenths % 10}`;
}

export const requiredRateX100 = (runsNeeded: number, ballsLeft: number): number =>
  Math.floor((runsNeeded * 1200 + ballsLeft) / (2 * ballsLeft));

export const GRID = Object.freeze({
  runs: [1, 2, 3, 7, 14, 22, 48, 72],
  balls: [1, 2, 3, 6, 9, 12],
  left: [0, 1, 2, 5, 9, 11],
  short: [1, 2, 5, 17, 22, 72],
  rates: [50, 100, 600, 933, 935, 1100, 1200, 2640, 43200],
});

/**
 * What the web prints. `format(pattern, params, intl)` is the app's own formatMessage; `webRateDigits(x100, intl)` is how the
 * web HUD formats the rate number (ChaseNeed rateText: Intl, one decimal). Both are injected so this file imports nothing.
 */
export function buildCopyFixture(catalogs: Catalogs, format: Formatter, webRateDigits: RateDigits) {
  const patterns = patternsOf(catalogs);
  const languages = LANGUAGES.map((language) => {
    const p = patterns[language.id] as Record<string, string>;
    const f = (name: string, params?: Params): string => format(p[name] as string, params, language.intl);
    return {
      id: language.id,
      status: f('Status'),
      need: GRID.runs.flatMap((runs) => GRID.balls.map((balls) => ({ runs, balls, text: f('Need', { runs, balls }) }))),
      rate: GRID.rates.map((x100) => ({ x100, text: f('Rate', { rate: webRateDigits(x100, language.intl) }) })),
      wonTitle: f('WonTitle'),
      wonSpare: GRID.left.map((left) => ({ left, text: f('WonSpare', { left }) })),
      lostTitle: GRID.short.map((short) => ({ short, text: f('LostTitle', { short }) })),
    };
  });
  // The number text for every (runs needed, balls left) pair of a 12-ball chase, as the web's Intl prints it. Two parallel arrays
  // (the rates in ascending order and their texts) so JsonUtility in Unity can read them.
  const rateNumbers = new Map<number, string>();
  for (let runs = 1; runs <= 72; runs += 1) {
    for (let balls = 1; balls <= 12; balls += 1) {
      const x100 = requiredRateX100(runs, balls);
      const texts = LANGUAGES.map((language) => webRateDigits(x100, language.intl));
      if (new Set(texts).size !== 1)
        throw new Error(`chase copy: the languages print the rate ${x100} differently: ${texts.join(' | ')}`);
      rateNumbers.set(x100, texts[0] as string);
    }
  }
  const rateX100 = [...rateNumbers.keys()].sort((a, b) => a - b);
  const payload = {
    schema: 'vande.practice.unity-chase-copy',
    fixtureVersion: 1,
    note: 'What the web prints for the chase HUD, from the COPY sheet through the app formatMessage. The Unity EditMode test ChaseHudTests must print the same strings. rateX100 and rateText are parallel arrays: the web one-decimal text of every required rate a 12-ball chase can have.',
    sourceSha256: createHash('sha256').update(JSON.stringify(patterns)).digest('hex'),
    languages,
    rateX100,
    rateText: rateX100.map((x100) => rateNumbers.get(x100) as string),
  };
  return { ...payload, payloadSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') };
}
