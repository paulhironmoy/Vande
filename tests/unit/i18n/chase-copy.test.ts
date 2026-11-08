/**
 * Copy for Target Chase, the first-ball lesson and camera batting (owner: COPY): every new key exists in English,
 * Hindi and Hinglish with the same placeholders, every line renders with the worst parameters inside its layout cap,
 * the project's fallback rule holds for the locales that have no Practice file, the plural forms read right, and the
 * legacy Sealed Six chase commentary was rewritten without changing who may call it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formatMessage, parseMessage } from '@/i18n/format';
import { createPracticeT, type PracticeKey } from '@/i18n/practice';
import { practiceEn } from '@/i18n/practice/en';
import { practiceHi } from '@/i18n/practice/hi';
import { practiceHiLatn } from '@/i18n/practice/hi-Latn';
import { cameraEn } from '@/i18n/practice/en/camera';
import { chaseEn } from '@/i18n/practice/en/chase';
import { controlsEn } from '@/i18n/practice/en/controls';
import { lessonEn } from '@/i18n/practice/en/lesson';
import { cameraHi } from '@/i18n/practice/hi/camera';
import { chaseHi } from '@/i18n/practice/hi/chase';
import { controlsHi } from '@/i18n/practice/hi/controls';
import { lessonHi } from '@/i18n/practice/hi/lesson';
import { cameraHiLatn } from '@/i18n/practice/hi-Latn/camera';
import { chaseHiLatn } from '@/i18n/practice/hi-Latn/chase';
import { controlsHiLatn } from '@/i18n/practice/hi-Latn/controls';
import { lessonHiLatn } from '@/i18n/practice/hi-Latn/lesson';
import { LOCALES, localeInfo } from '@/i18n/locales';
import engineEn from '@/i18n/engine/en.json';
import engineHi from '@/i18n/engine/hi.json';
import engineHiLatn from '@/i18n/engine/hi-Latn.json';
import { CAPS, SAMPLE_PARAMS, capOf, classOf } from './copy-floors';

type Flat = Record<string, string>;
type Params = Record<string, string | number>;
const EN: Flat = { ...chaseEn, ...lessonEn, ...cameraEn, ...controlsEn };
const HI: Flat = { ...chaseHi, ...lessonHi, ...cameraHi, ...controlsHi };
const HI_LATN: Flat = { ...chaseHiLatn, ...lessonHiLatn, ...cameraHiLatn, ...controlsHiLatn };
const CATALOGS: Record<string, Flat> = { en: EN, hi: HI, 'hi-Latn': HI_LATN };
const KEYS = Object.keys(EN);
const WORST = SAMPLE_PARAMS as Params;

type Node = ReturnType<typeof parseMessage>[number];
function names(nodes: Node[], out = new Set<string>()): Set<string> {
  for (const n of nodes) {
    if (n.k === 'arg') out.add(n.name);
    if (n.k === 'plural' || n.k === 'select') {
      out.add(n.name);
      for (const opt of Object.values(n.options)) names(opt, out);
    }
  }
  return out;
}
const argsOf = (p: string) => [...names(parseMessage(p))].sort();
/** The words of a pattern with every {placeholder} and {plural, ...} block removed (the innermost braces first). */
function wordsOnly(p: string): string {
  let out = p;
  for (let before = ''; before !== out;) {
    before = out;
    out = out.replace(/\{[^{}]*\}/g, '');
  }
  return out;
}
/** The evaluator's own word lists (scripts/eval/scan.mjs), read from the file so they cannot drift from this test. */
const scanSource = readFileSync('scripts/eval/scan.mjs', 'utf8');
function scanList(name: string): RegExp[] {
  const body = scanSource.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`))?.[1] ?? '';
  return [...body.matchAll(/\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/([a-z]*)/g)].map((m) => new RegExp(m[1], m[2]));
}
const intlOf = (locale: string) => localeInfo(locale as 'en' | 'hi' | 'hi-Latn').intl;

describe('Chase, lesson and camera copy: completeness', () => {
  it('has the new keys, all joined into the Practice catalogs', () => {
    expect(KEYS.length).toBeGreaterThan(100);
    for (const k of KEYS) {
      expect(k.startsWith('practice.'), k).toBe(true);
      expect(k in practiceEn, `en ${k}`).toBe(true);
      expect(k in practiceHi, `hi ${k}`).toBe(true);
      expect(k in practiceHiLatn, `hi-Latn ${k}`).toBe(true);
    }
  });

  it.each(['hi', 'hi-Latn'])('%s has every new key, no extra, with the English placeholders', (locale) => {
    const c = CATALOGS[locale];
    expect(Object.keys(c).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) expect(argsOf(c[k]), `${locale}: ${k}`).toEqual(argsOf(EN[k]));
  });

  it('defines no key twice across the four new parts', () => {
    const parts = [chaseEn, lessonEn, cameraEn, controlsEn].flatMap((p) => Object.keys(p));
    expect(new Set(parts).size).toBe(parts.length);
  });

  it('every key a builder asked for a cap on exists, and every cap names a real key', () => {
    // A cap for a key that was renamed or removed would silently stop protecting a layout.
    return import('./copy-floors').then(({ KEY_CAPS }) => {
      expect(Object.keys(KEY_CAPS).filter((k) => !(k in EN))).toEqual([]);
    });
  });

  it('no line is empty or shouts, none carries an exclamation mark, none is English inside Hindi', () => {
    for (const [locale, c] of Object.entries(CATALOGS)) {
      for (const [k, v] of Object.entries(c)) {
        expect(v.trim().length, `${locale}: ${k}`).toBeGreaterThan(0);
        expect(v, `${locale}: ${k} has an exclamation mark`).not.toContain('!');
        expect(/\b[A-Z]{4,}\b/.test(v.replace(/VANDE/g, '')), `${locale}: ${k} is typed in capitals`).toBe(false);
      }
    }
    // Hindi is Devanagari: a long run of Latin letters in it is an English line that was never translated.
    for (const [k, v] of Object.entries(HI)) {
      const plain = wordsOnly(v).replace(
        /Space|Shift|MB|Chrome|Edge|Firefox|Safari|Android|Wi-Fi|VANDE|Cricket|https/g,
        '',
      );
      expect(/[A-Za-z]{4,}/.test(plain), `hi: ${k} has an untranslated word`).toBe(false);
    }
  });

  it("passes the evaluator's own scan: no device wording (F8) and no cricket jargon (RK2)", () => {
    const tech = [...scanList('TECH'), /\bmodel\b/i, /\bhardware\b/i, /\bacceleration\b/i, /\binference\b/i];
    const jargon = scanList('JARGON');
    // The lists were really read.
    expect(tech.length).toBeGreaterThan(14);
    expect(jargon.length).toBeGreaterThan(20);
    // The two lines the jargon list flags wrongly, each with its reason: the browser is called Edge, and the timing
    // check says "line" on its other inputs too (it is not on the first-session path).
    const allowed = new Set(['practice.camera.trouble.blocked.edge', 'practice.cal.camera.instruction']);
    const hits: string[] = [];
    for (const [locale, c] of Object.entries(CATALOGS))
      for (const [k, v] of Object.entries(c)) {
        const text = wordsOnly(v);
        for (const re of tech) if (re.test(text)) hits.push(`F8 ${locale}: ${k}: ${re.source}`);
        if (!allowed.has(k)) for (const re of jargon) if (re.test(text)) hits.push(`RK2 ${locale}: ${k}: ${re.source}`);
      }
    expect(hits).toEqual([]);
  });

  it('uses no technical, device or model wording a player would not know (F8 and the camera copy rules)', () => {
    const technical =
      /\b(tiers?|fps|frame rates?|gpu|webgl|renderer|software graphics|benchmark|shader|msaa|assisted|lite|model|pose|landmark|neural|inference|wasm|mediapipe|algorithm|hardware|acceleration|ai)\b/i;
    for (const [locale, c] of Object.entries(CATALOGS))
      for (const [k, v] of Object.entries(c)) expect(technical.test(wordsOnly(v)), `${locale}: ${k}`).toBe(false);
  });
});

describe('Chase, lesson and camera copy: layout floors at 200% text', () => {
  it('every key has a class', () => {
    expect(KEYS.filter((k) => classOf(k) === null)).toEqual([]);
  });

  it.each(['en', 'hi', 'hi-Latn'])(
    '%s: every line renders whole and fits its cap with the worst parameters',
    (locale) => {
      const tooLong: string[] = [];
      for (const [k, v] of Object.entries(CATALOGS[locale])) {
        const text = formatMessage(v, WORST, intlOf(locale));
        expect(/[{}#]/.test(text), `${locale}: ${k} left a placeholder: ${text}`).toBe(false);
        const cap = capOf(k) ?? CAPS.sr;
        const len = [...text].length;
        if (len > cap) tooLong.push(`${k} (cap ${cap}): ${len} "${text}"`);
      }
      expect(tooLong).toEqual([]);
    },
  );
});

describe('Chase, lesson and camera copy: the fallback rule', () => {
  const OTHERS = LOCALES.map((l) => l.id).filter((id) => id !== 'en' && id !== 'hi' && id !== 'hi-Latn');

  it('the eight other languages have no Practice file, so every new key shows its English line', () => {
    expect(OTHERS).toEqual(['bn', 'te', 'mr', 'ta', 'gu', 'kn', 'ml', 'pa']);
    const en = createPracticeT('en', null);
    for (const locale of OTHERS) {
      const t = createPracticeT(locale, null);
      // The words are English. The project formats numbers with the player's own locale, so a line may carry that
      // locale's digits (Bengali, Marathi): compare after turning each of its ten digits back into 0 to 9.
      const digits = new Map(Array.from({ length: 10 }, (_, d) => [t.number(d, { useGrouping: false }), String(d)]));
      const ascii = (text: string) => [...text].map((ch) => digits.get(ch) ?? ch).join('');
      for (const k of KEYS) {
        expect(ascii(t.tk(k, WORST)), `${locale}: ${k}`).toBe(en.tk(k, WORST));
        expect(t.has(k), `${locale}: ${k}`).toBe(true);
      }
    }
  });

  it('a partial catalog shows English for the key it lacks, never a raw key', () => {
    const partial = createPracticeT('hi', { 'practice.chase.back': 'प्रैक्टिस पर वापस' });
    expect(partial.t('practice.chase.back')).toBe('प्रैक्टिस पर वापस');
    expect(partial.t('practice.chase.again')).toBe('Try this chase again');
    for (const k of KEYS) expect(partial.tk(k, WORST)).not.toContain('practice.');
  });

  it('an unknown chase key is shown as readable words, not as a key', () => {
    const t = createPracticeT('en', null);
    expect(t.tk('practice.chase.not_a_key')).toBe('Not a key');
  });
});

describe('Chase, lesson and camera copy: wording that carries numbers', () => {
  const en = createPracticeT('en', null);
  const hi = createPracticeT('hi', practiceHi);
  const hl = createPracticeT('hi-Latn', practiceHiLatn);
  const rate = (t: typeof en, x: number) => t.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  it('reads "Need X off Y balls" with the right plural, in all three languages', () => {
    expect(en.t('practice.chase.need', { runs: 22, balls: 12 })).toBe('Need 22 off 12 balls');
    expect(en.t('practice.chase.need', { runs: 4, balls: 1 })).toBe('Need 4 off 1 ball');
    expect(en.t('practice.chase.need', { runs: 1, balls: 1 })).toBe('Need 1 off 1 ball');
    expect(hi.t('practice.chase.need', { runs: 22, balls: 12 })).toBe('12 गेंदों में 22 रन चाहिए');
    expect(hi.t('practice.chase.need', { runs: 4, balls: 1 })).toBe('1 गेंद में 4 रन चाहिए');
    expect(hl.t('practice.chase.need', { runs: 22, balls: 12 })).toBe('12 balls mein 22 chahiye');
    expect(hl.t('practice.chase.need', { runs: 4, balls: 1 })).toBe('1 ball mein 4 chahiye');
  });

  it('spells the cluster out in full for screen readers and takes the plural from the count', () => {
    expect(en.t('practice.chase.hud_label', { runs: 1, balls: 3, rate: '2.0' })).toBe(
      'Chase. Need 1 run from 3 balls. Required rate 2.0 runs an over.',
    );
    expect(en.t('practice.chase.hud_label', { runs: 7, balls: 1, rate: '42.0' })).toBe(
      'Chase. Need 7 runs from 1 ball. Required rate 42.0 runs an over.',
    );
    expect(en.t('practice.chase.announce_last', { runs: 1 })).toBe('Last ball. Need 1 run to win.');
    expect(en.t('practice.chase.announce_last', { runs: 6 })).toBe('Last ball. Need 6 runs to win.');
    expect(en.t('practice.chase.announce_start', { runs: 23, balls: 12 })).toBe('Chase. Need 23 off 12 balls.');
  });

  it('formats the required rate in the caller, in the locale', () => {
    expect(en.t('practice.chase.rate', { rate: rate(en, 11) })).toBe('11.0 an over');
    expect(hi.t('practice.chase.rate', { rate: rate(hi, 7.5) })).toBe('हर ओवर 7.5 रन');
    expect(hl.t('practice.chase.rate', { rate: rate(hl, 7.5) })).toBe('7.5 per over');
  });

  it('words the win by how it ended, and the loss by the margin', () => {
    expect(en.t('practice.chase.won.spare', { left: 0 })).toBe('Won on the last ball.');
    expect(en.t('practice.chase.won.spare', { left: 1 })).toBe('1 ball to spare.');
    expect(en.t('practice.chase.won.spare', { left: 4 })).toBe('4 balls to spare.');
    expect(en.t('practice.chase.lost.title', { short: 1 })).toBe('1 run short');
    expect(en.t('practice.chase.lost.title', { short: 9 })).toBe('9 runs short');
    expect(en.t('practice.chase.won.line', { runs: 24, balls: 10, target: 23 })).toBe(
      'You scored 24 off 10 balls. The target was 23.',
    );
    expect(
      en.t('practice.chase.why.wicket', {
        how: en.t('practice.result.bowled'),
        reason: en.t('practice.coach.too_late'),
      }),
    ).toBe('Out: Bowled. Too late on the ball.');
    expect(
      hi.t('practice.chase.why.wicket', {
        how: hi.t('practice.result.bowled'),
        reason: hi.t('practice.coach.too_late'),
      }),
    ).toContain('आउट: बोल्ड।');
    expect(en.t('practice.chase.why.short.plain', { dots: 5, balls: 12 })).toBe('5 of your 12 balls scored nothing.');
  });

  it('builds the setup card from the definition, for any number of overs and balls', () => {
    expect(en.t('practice.chase.setup.rules', { overs: 2 })).toBe('2 overs, one wicket. Reach the target to win.');
    expect(en.t('practice.chase.setup.rules', { overs: 1 })).toBe('1 over, one wicket. Reach the target to win.');
    expect(en.t('practice.chase.home.sub', { balls: 12 })).toBe('Reach a target in 12 balls. One wicket.');
    expect(en.t('practice.chase.home.resume_body', { runs: 9, balls: 4 })).toBe('Need 9 off 4 balls');
  });

  it('tells the camera distance as numbers the caller gives, on a laptop and on a phone', () => {
    expect(en.t('practice.camera.guide.laptop', { near: 1.5, far: 2.5 })).toBe(
      'Sit or stand about 1.5 to 2.5 metres back, with your upper body and hands in view.',
    );
    expect(en.t('practice.camera.guide.phone', { near: 1.5, far: 2.5 })).toContain('front camera faces you');
    for (const key of ['practice.camera.guide.laptop', 'practice.camera.guide.phone'] as const) {
      expect(hi.t(key, { near: 1.5, far: 2.5 })).toContain('1.5 से 2.5 मीटर');
      expect(hl.t(key, { near: 1.5, far: 2.5 })).toContain('1.5 se 2.5 metre');
    }
  });

  it('keeps the first-ball lesson to three short words for what the start of the swing decides', () => {
    const words = ['direction', 'power', 'loft'].map((w) => en.t(`practice.lesson.sets.${w}` as PracticeKey));
    expect(words).toEqual(['Direction', 'Power', 'Loft']);
    for (const t of [hi, hl])
      for (const w of ['direction', 'power', 'loft'])
        expect([...t.t(`practice.lesson.sets.${w}` as PracticeKey)].length).toBeLessThanOrEqual(CAPS.hud);
  });

  it('has a steps line, a screen-reader line and a picture description for every input type', () => {
    for (const input of ['touch', 'mouse', 'pen', 'keyboard', 'camera']) {
      for (const k of [
        `practice.lesson.${input}.load`,
        `practice.lesson.${input}.strike`,
        `practice.lesson.announce.${input}`,
        `practice.lesson.ghost.${input}`,
        `practice.input.${input}`,
      ])
        expect(k in EN, k).toBe(true);
    }
  });

  it('words every early and late band, and the on-time line is neutral about it', () => {
    for (const side of ['early', 'late'])
      for (const size of ['small', 'medium', 'large'])
        expect(`practice.lesson.timing.${side}.${size}` in EN, `${side}.${size}`).toBe(true);
    expect(en.t('practice.lesson.timing.on_time')).toBe('Right on time');
  });

  it('says in plain words, before the browser prompt, why the camera is used and that nothing is saved or sent', () => {
    expect(EN['practice.camera.consent.what']).toContain('front camera');
    expect(EN['practice.camera.consent.privacy']).toContain('stays on this device');
    expect(EN['practice.camera.consent.privacy']).toContain('never saved, recorded or sent');
    expect(EN['practice.camera.consent.stop']).toContain('switch the camera off at any time');
    expect(EN['practice.camera.privacy.line']).toContain('never saved or sent');
    expect(EN['practice.camera.privacy.replays']).toContain('never any pictures');
  });

  it("offers the same one-tap way back in the owner's words, on every failure screen", () => {
    expect(en.t('practice.camera.switch.mouse')).toBe('Bat with mouse');
    expect(en.t('practice.camera.switch.touch')).toBe('Bat with touch');
    expect(en.t('practice.camera.ready.line')).toBe('Show your upper body and your batting hand');
  });

  it('covers every troubleshooting case with a title and its own steps', () => {
    for (const c of ['blocked', 'busy', 'black', 'none', 'inapp', 'light', 'slow', 'unsupported'])
      expect(`practice.camera.trouble.${c}.title` in EN, `${c} title`).toBe(true);
    for (const c of ['blocked', 'busy', 'black', 'none', 'inapp', 'light', 'slow', 'unsupported'])
      expect(`practice.camera.trouble.${c}.body` in EN, `${c} body`).toBe(true);
    for (const browser of ['chrome', 'edge', 'firefox', 'safari', 'android', 'android_browser', 'other'])
      expect(`practice.camera.trouble.blocked.${browser}` in EN, `blocked ${browser}`).toBe(true);
    for (const k of ['black.shutter', 'black.toggle', 'inapp.open', 'inapp.copy', 'inapp.copied'])
      expect(`practice.camera.trouble.${k}` in EN, k).toBe(true);
  });

  it('states every download stage: progress, stalled, retrying, failed, offline, no space, cached', () => {
    for (const k of ['progress', 'stalled', 'retrying', 'failed', 'offline', 'space', 'ready'])
      expect(`practice.camera.download.${k}` in EN, k).toBe(true);
    expect(en.t('practice.camera.download.progress', { done: '4.2', total: '8.3' })).toBe('4.2 of 8.3 MB');
    expect(hi.t('practice.camera.download.progress', { done: '4.2', total: '8.3' })).toBe('4.2 / 8.3 MB');
    expect(en.t('practice.camera.download.retrying', { n: 2, max: 3 })).toBe('Trying again, 2 of 3…');
  });

  it('puts the input name in the chip and the announcements, in all three languages', () => {
    for (const t of [en, hi, hl]) {
      const mouse = t.t('practice.input.mouse');
      const touch = t.t('practice.input.touch');
      expect(t.t('practice.controls.selected', { control: mouse })).toContain(mouse);
      expect(t.t('practice.controls.chip', { control: mouse })).toContain(mouse);
      expect(t.t('practice.controls.chip_label', { control: touch })).toContain(touch);
      expect(t.t('practice.controls.switched', { control: touch })).toContain(touch);
      expect(t.t('practice.camera.lost.announce', { control: mouse })).toContain(mouse);
    }
    expect(en.t('practice.controls.title')).toBe('How do you want to bat?');
    expect(en.t('practice.controls.chip', { control: en.t('practice.input.keyboard') })).toBe('Batting: Keyboard');
    expect(en.t('practice.controls.camera.needs', { mb: 8.3 })).toBe(
      'Needs your camera and a one-time download of about 8.3 MB.',
    );
    expect(en.t('practice.controls.start')).toBe('Start batting');
  });

  it('says plainly what the camera needs, why it may be missing, and that the keyboard always works', () => {
    expect(EN['practice.controls.camera.needs']).toContain('one-time download');
    for (const k of ['secure', 'api', 'device']) expect(`practice.controls.unavailable.${k}` in EN, k).toBe(true);
    expect(EN['practice.controls.keyboard']).toContain('keyboard works too');
    expect(EN['practice.controls.setting.hint']).toContain('keyboard always works');
    expect(EN['practice.controls.safe']).toContain('never changes the ball');
    expect(EN['practice.controls.no_vibrate']).toContain('instead of vibration');
    // The words match the first-ball lesson, as CONTROLS asked.
    expect(EN['practice.controls.mouse.hint']).toContain('pull back, push forward');
    expect(EN['practice.controls.touch.hint']).toContain('pull back, flick forward');
    expect(EN['practice.lesson.mouse.strike']).toBe('Push forward');
    expect(EN['practice.lesson.touch.strike']).toBe('Flick forward');
  });
});

describe('Legacy Sealed Six chase commentary (engine catalogs)', () => {
  const LEGACY = [
    'commentary.chase_target',
    'commentary.chase_needs',
    'commentary.chase_won',
    'commentary.chase_short',
  ] as const;
  const PARAMS: Record<(typeof LEGACY)[number], string[]> = {
    'commentary.chase_target': ['balls', 'batter', 'field', 'target'],
    'commentary.chase_needs': ['balls', 'runs'],
    'commentary.chase_won': ['ballsLeft', 'batter'],
    'commentary.chase_short': ['by'],
  };
  const SOURCES: Record<string, Record<string, string>> = { en: engineEn, hi: engineHi, 'hi-Latn': engineHiLatn };

  it.each(['en', 'hi', 'hi-Latn'])('%s: the four keys keep the placeholders their callers send', (locale) => {
    for (const k of LEGACY) {
      expect(k in SOURCES[locale], `${locale}: ${k}`).toBe(true);
      expect(argsOf(SOURCES[locale][k]), `${locale}: ${k}`).toEqual(PARAMS[k]);
    }
  });

  it.each(['en', 'hi', 'hi-Latn'])('%s: each renders whole, for every plural form the callers reach', (locale) => {
    const cat = SOURCES[locale];
    const base: Params = { batter: 'Asha', field: 'Attacking', target: 31, balls: 6, runs: 7, ballsLeft: 2, by: 5 };
    for (const k of LEGACY) {
      for (const over of [{}, { balls: 1, runs: 1, ballsLeft: 0, by: 1 }, { ballsLeft: 1 }]) {
        const text = formatMessage(cat[k], { ...base, ...over }, intlOf(locale));
        expect(/[{}#]/.test(text), `${locale}: ${k}: ${text}`).toBe(false);
        expect(text.trim().length).toBeGreaterThan(0);
        expect(text, `${locale}: ${k} has an exclamation mark`).not.toContain('!');
      }
    }
    const sample = (k: (typeof LEGACY)[number]) => formatMessage(cat[k], base, intlOf(locale));
    expect(sample('commentary.chase_target')).toContain('31');
    expect(sample('commentary.chase_needs')).toContain('7');
    expect(sample('commentary.chase_short')).toContain('5');
  });

  it('English uses the same words as the new rail and result: Need X off Y, balls to spare, runs short', () => {
    const f = (k: (typeof LEGACY)[number], p: Params) => formatMessage(engineEn[k], p, 'en-IN');
    expect(f('commentary.chase_needs', { runs: 1, balls: 1 })).toBe('Need 1 run off 1 ball.');
    expect(f('commentary.chase_needs', { runs: 7, balls: 3 })).toBe('Need 7 runs off 3 balls.');
    expect(f('commentary.chase_target', { batter: 'Asha', field: 'Attacking', target: 31, balls: 6 })).toBe(
      'Asha needs 31 off 6 balls, against the Attacking field.',
    );
    expect(f('commentary.chase_won', { batter: 'Asha', ballsLeft: 0 })).toBe(
      'Chase won: Asha gets there off the very last ball.',
    );
    expect(f('commentary.chase_won', { batter: 'Asha', ballsLeft: 1 })).toBe(
      'Chase won: Asha gets there with a ball to spare.',
    );
    expect(f('commentary.chase_won', { batter: 'Asha', ballsLeft: 4 })).toBe(
      'Chase won: Asha gets there with 4 balls to spare.',
    );
    expect(f('commentary.chase_short', { by: 1 })).toBe('Chase lost: 1 run short of the target.');
    expect(f('commentary.chase_short', { by: 5 })).toBe('Chase lost: 5 runs short of the target.');
  });
});
