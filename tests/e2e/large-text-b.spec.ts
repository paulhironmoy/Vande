/**
 * TEXT200-B: the first-ball lesson card and the camera cards at large text on short landscape phones (QA-VIS findings QV-01,
 * QV-02, QV-16). Each screen is opened once per language at 200% text and measured at 640x360, 844x390 and 915x412 and, as a
 * check that nothing else moved, 1280x800 (the window is resized in place); the lesson card is also measured at 100% text
 * (QV-02 happens there too). The hooks build is needed (project `practice`, VITE_PRACTICE_TEST_HOOKS=1).
 *
 * What every screen must satisfy (the TEXT200 acceptance list):
 *   1. every scrolling region that holds words is at least 120 px high (a 6 px region that still takes a keyboard stop is a defect);
 *   2. the first view shows the title, the first two lines of the words and the primary action;
 *   3. no word breaks inside the word ("Chro/me");
 *   4. every button is at least 44 px in both directions.
 * Also: the camera consent shows its privacy sentence wholly inside the first view, and the lesson card shows the answer to a dry
 * swing and to a tap as the player left it (whole when it fits the window, else its first two lines at the top of the window).
 *
 * Switches for evidence runs: T200B_OUT (a folder) writes one JSON line per measurement to records.jsonl and a capture of every
 * state; T200B_BUILD names the build id on each line; T200B_TEXT sets the text scale of the camera and 200% lesson tests (2 by
 * default; 1 compares the camera screens at 100%); T200B_BREAK (window, primary, small, break, sentence, answer) adds one deliberate
 * defect to show that the assertion for it can fail. Without them the spec writes nothing and checks the real screens.
 * Builder checks only: they measure layout; whether a person can read the words on a real phone is not claimed.
 */
import { expect, test, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { GPU_ARGS, configure, waitFor } from './practice-helpers';
import { failCamera } from './camera-helpers';

test.use({
  viewport: { width: 915, height: 412 },
  hasTouch: true,
  launchOptions: {
    args: [...GPU_ARGS.launchOptions.args, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
  permissions: ['camera'],
});

const SIZES = [
  { name: '640x360', width: 640, height: 360 },
  { name: '844x390', width: 844, height: 390 },
  { name: '915x412', width: 915, height: 412 },
  { name: '1280x800', width: 1280, height: 800 },
] as const;
const LANGS = ['en', 'hi', 'hi-Latn'] as const;
type Lang = (typeof LANGS)[number];

const ANDROID_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const INAPP_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android (33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 559587570)';

const OUT = process.env.T200B_OUT;
const BUILD = process.env.T200B_BUILD ?? 'unknown';
/** The text scale of the camera and 200% lesson tests (2 unless T200B_TEXT says otherwise, to compare 100% before and after). */
const TEXT = Number(process.env.T200B_TEXT ?? 2);
/**
 * A deliberate break, to show that an assertion can fail: T200B_BREAK=window|primary|small|break|sentence adds one harmful style to
 * every screen before it is measured; T200B_BREAK=answer instead stops the card scrolling to the answer (the old behaviour).
 */
const BREAKS: Record<string, string> = {
  window:
    '[data-testid="lesson-card-body"],[data-testid="camera-consent"],[data-testid="camera-trouble"]{max-height:60px!important}',
  primary:
    '[data-testid="lesson-bowl"],[data-testid="camera-consent-allow"],[data-testid="camera-trouble-retry"],[data-testid="camera-trouble-open-chrome"],[data-testid="camera-guide-start"]{position:relative!important;top:3000px!important}',
  small: 'button{max-height:30px!important;min-height:0!important}',
  break: 'button{max-width:70px!important;min-width:0!important;overflow-wrap:anywhere!important}',
  sentence: '[data-testid="camera-consent"] li:first-child{position:relative!important;top:3000px!important}',
};
const BREAK = process.env.T200B_BREAK ? BREAKS[process.env.T200B_BREAK] : undefined;
if (OUT) mkdirSync(`${OUT}/captures`, { recursive: true });

/**
 * Resizes the window in place. A touch phone goes full screen when Play is tapped (src/platform/orientation.ts), and the browser then
 * refuses to resize the window ("restore it to normal state first"), so full screen is left first.
 */
async function resize(page: Page, size: { width: number; height: number }) {
  await page.evaluate(async () => {
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined);
  });
  await page.waitForFunction(() => !document.fullscreenElement, undefined, { timeout: 5000 }).catch(() => undefined);
  await page.setViewportSize({ width: size.width, height: size.height });
}

const FIRST_RUN = { v: 1, teach: true, demoSeen: true, lessonSeen: false };
const CAMERA_CHOSEN = { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true };

/** The words of one catalog key, read from the source file (the same text the page shows). */
function catalog(lang: Lang, file: string, key: string): string {
  const src = readFileSync(`src/i18n/practice/${lang}/${file}.ts`, 'utf8');
  const m = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(src);
  if (!m) throw new Error(`no ${key} in ${lang}/${file}.ts`);
  return m[1].replace(/\\'/g, "'");
}

/** App settings (language, text scale) before any page script runs; read once per tab, like the real settings. */
async function seed(page: Page, lang: Lang, text: number) {
  if (process.env.T200B_BREAK === 'answer')
    await page.addInitScript(() => {
      Element.prototype.scrollIntoView = () => undefined;
    });
  await page.addInitScript(
    ([l, t]) => {
      if (sessionStorage.getItem('t200b-seeded')) return;
      sessionStorage.setItem('t200b-seeded', '1');
      try {
        localStorage.setItem(
          'vc:settings',
          JSON.stringify({
            locale: l,
            reducedMotion: 'off',
            sound: true,
            haptics: true,
            quality: 'auto',
            textScale: t,
            highContrast: false,
          }),
        );
      } catch {
        /* storage blocked */
      }
    },
    [lang, text] as const,
  );
}

interface Probe {
  /** data-testid of the card or dialog that holds the screen. */
  root: string;
  /** Selector (inside root) of the title. */
  title: string;
  /** Selectors (inside root): the first two lines of the first match of each must be inside the first view. */
  words: string[];
  /** data-testid of the primary action, wholly inside the first view. */
  primary: string;
  /** Text (inside root) of the one sentence that must be wholly inside the first view. */
  sentence?: string;
  /** Test ids of answers that must be wholly on screen as the player left the card (checked before the card is scrolled back to the top). */
  answers?: string[];
}

interface Seen {
  vw: number;
  vh: number;
  scale: number;
  root: number[];
  scrollers: Array<{ id: string; client: number; scroll: number; stop: boolean }>;
  titleIn: boolean;
  wordsIn: boolean[];
  primaryIn: boolean;
  sentenceIn: boolean | null;
  answersIn: Record<string, boolean>;
  breaks: string[];
  small: string[];
  buttons: Array<{ id: string; w: number; h: number; inView: boolean }>;
}

/** Runs in the page: measures the screen in `p.root` from the top of every scrolling region. No closure over the test file. */
function measureInPage(p: Probe): Seen | null {
  const root = document.querySelector<HTMLElement>(`[data-testid="${p.root}"]`);
  if (!root) return null;
  const vw = innerWidth;
  const vh = innerHeight;
  const idOf = (e: Element) => e.getAttribute('data-testid') ?? e.tagName.toLowerCase();
  // The regions that scroll: the screen, everything in it and everything around it (up to the page).
  const around: HTMLElement[] = [];
  for (let a: HTMLElement | null = root.parentElement; a && a !== document.body; a = a.parentElement) around.push(a);
  const all = [...around, root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))];
  const scrolls = (e: HTMLElement) =>
    /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1;
  const scrollers = all.filter(scrolls);
  const clipOf = (el: Element) => {
    let l = 0;
    let t = 0;
    let r = vw;
    let b = vh;
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ar = a.getBoundingClientRect();
      if (cs.overflowX !== 'visible') {
        l = Math.max(l, ar.left);
        r = Math.min(r, ar.right);
      }
      if (cs.overflowY !== 'visible') {
        t = Math.max(t, ar.top);
        b = Math.min(b, ar.bottom);
      }
    }
    return { l, t, r, b };
  };
  const whollyIn = (el: Element | null) => {
    if (!el) return false;
    const q = el.getBoundingClientRect();
    const c = clipOf(el);
    return (
      q.width > 0 && q.height > 0 && q.left >= c.l - 1 && q.right <= c.r + 1 && q.top >= c.t - 1 && q.bottom <= c.b + 1
    );
  };
  // The words of an element are whole in the view (its padding may run on below).
  const textIn = (el: Element | null) => {
    if (!el) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    const q = range.getBoundingClientRect();
    const c = clipOf(el);
    return q.width > 0 && q.left >= c.l - 1 && q.right <= c.r + 1 && q.top >= c.t - 1 && q.bottom <= c.b + 1;
  };
  // The words start in the first view: the first two lines of text of the first element are whole (a long paragraph may run on below).
  const startsIn = (el: Element | null) => {
    if (!el) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    const lines = Array.from(range.getClientRects())
      .filter((r) => r.width > 0.5 && r.height > 2)
      .sort((a, b) => a.top - b.top || a.left - b.left);
    if (!lines.length) return false;
    const c = clipOf(el);
    // The first two lines: the rects whose top is one of the two highest distinct tops.
    const tops: number[] = [];
    for (const r of lines) if (!tops.some((t) => Math.abs(t - r.top) < 3)) tops.push(r.top);
    const firstTop = tops[0];
    const bottom = Math.max(
      ...lines.filter((r) => tops.slice(0, 2).some((t) => Math.abs(t - r.top) < 3)).map((r) => r.bottom),
    );
    return lines[0].left >= c.l - 1 && firstTop >= c.t - 1 && bottom <= c.b + 1;
  };
  // The answers, where the player left the card; then every region goes back to its top for the first-view checks.
  const answersIn: Record<string, boolean> = {};
  // An answer is whole in the window when it fits there; one taller than the window starts at its top (two lines at least).
  const answerIn = (el: Element | null) => {
    if (!el) return false;
    const range = document.createRange();
    range.selectNodeContents(el);
    const q = range.getBoundingClientRect();
    const c = clipOf(el);
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4;
    if (q.height <= c.b - c.t + 1) return textIn(el);
    return q.left >= c.l - 1 && q.right <= c.r + 1 && q.top >= c.t - 1 && q.top + 2 * line <= c.b + 1;
  };
  for (const id of p.answers ?? []) answersIn[id] = answerIn(document.querySelector(`[data-testid="${id}"]`));
  for (const sc of scrollers) sc.scrollTop = 0;
  const rendered = (el: Element) => el.getClientRects().length > 0;
  // A word that wraps onto two lines inside the word (a hyphen is a fair place to wrap, so the hyphen ends a piece).
  const breaks: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    if (!el || !rendered(el) || el.closest('.sr-only, script, style')) continue;
    const text = n.textContent ?? '';
    for (const m of text.matchAll(/[^\s\-‐‑–—]+-?/g)) {
      const range = document.createRange();
      range.setStart(n, m.index ?? 0);
      range.setEnd(n, (m.index ?? 0) + m[0].length);
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0.5);
      if (rects.length > 1 && Math.max(...rects.map((r) => r.top)) - Math.min(...rects.map((r) => r.top)) > 3)
        breaks.push(m[0]);
    }
  }
  const buttons = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"], a[href], input')).filter(
    rendered,
  );
  const first = (sel: string) => root.querySelector(sel);
  const sentence = p.sentence
    ? (Array.from(root.querySelectorAll('li, p')).find((e) => (e.textContent ?? '').includes(p.sentence ?? '')) ?? null)
    : null;
  const prim = root.querySelector(`[data-testid="${p.primary}"]`);
  const rr = root.getBoundingClientRect();
  return {
    vw,
    vh,
    scale: parseFloat(getComputedStyle(document.documentElement).fontSize) / 16,
    root: [rr.left, rr.top, rr.right, rr.bottom].map(Math.round),
    scrollers: scrollers.map((s) => ({
      id: idOf(s),
      client: s.clientHeight,
      scroll: s.scrollHeight,
      stop: s.tabIndex >= 0,
    })),
    titleIn: whollyIn(first(p.title)),
    wordsIn: p.words.map((w) => startsIn(first(w))),
    primaryIn: whollyIn(prim),
    sentenceIn: p.sentence ? textIn(sentence) : null,
    answersIn,
    breaks: Array.from(new Set(breaks)),
    small: buttons
      .filter((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height) < 43.5)
      .map(
        (b) =>
          `${idOf(b)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`,
      ),
    buttons: buttons.map((b) => {
      const q = b.getBoundingClientRect();
      return { id: idOf(b), w: Math.round(q.width), h: Math.round(q.height), inView: whollyIn(b) };
    }),
  };
}

interface Where {
  screen: string;
  lang: Lang;
  text: number;
  size: string;
}

/** Measures, records and checks one state of one screen at the current window size. */
async function look(page: Page, where: Where, p: Probe, opts: { minScroller?: number } = {}) {
  if (BREAK) await page.addStyleTag({ content: BREAK });
  await page.waitForTimeout(350);
  // What the player sees as the card was left (the measure scrolls every region back to its top).
  if (OUT && p.answers)
    await page
      .screenshot({ path: `${OUT}/captures/${where.screen}-${where.lang}-${where.size}-t${where.text}-left.png` })
      .catch(() => undefined);
  const m = await page.evaluate(measureInPage, p);
  const tag = `${where.screen} ${where.lang} ${where.size} t${where.text}`;
  expect(m, `${tag}: the screen is on the page`).not.toBeNull();
  if (!m) return;
  if (OUT) {
    appendFileSync(
      `${OUT}/records.jsonl`,
      `${JSON.stringify({ build: BUILD, utc: new Date().toISOString(), ...where, ...m })}\n`,
    );
    await page
      .screenshot({ path: `${OUT}/captures/${where.screen}-${where.lang}-${where.size}-t${where.text}.png` })
      .catch(() => undefined);
  }
  const need = opts.minScroller ?? 120;
  for (const s of m.scrollers) {
    expect
      .soft(
        Math.min(s.client, m.vh),
        `${tag}: the scrolling region ${s.id} (${s.client} px for ${s.scroll} px of words)`,
      )
      .toBeGreaterThanOrEqual(need);
  }
  expect.soft(m.titleIn, `${tag}: the title is in the first view`).toBe(true);
  expect
    .soft(m.wordsIn, `${tag}: the first words are in the first view (${p.words.join(', ')})`)
    .toEqual(p.words.map(() => true));
  expect.soft(m.primaryIn, `${tag}: the primary action ${p.primary} is in the first view`).toBe(true);
  if (p.sentence) expect.soft(m.sentenceIn, `${tag}: "${p.sentence.slice(0, 40)}..." is in the first view`).toBe(true);
  for (const id of p.answers ?? [])
    expect.soft(m.answersIn[id], `${tag}: ${id} is whole on screen as the player left the card`).toBe(true);
  expect.soft(m.breaks, `${tag}: no word breaks inside the word`).toEqual([]);
  expect.soft(m.small, `${tag}: every button is at least 44 px`).toEqual([]);
  return m;
}

const ready = async (page: Page, lang: Lang, text: number) => {
  await seed(page, lang, text);
};

/** From the Practice home to the lesson card (a touch phone on its first run). */
async function toLesson(page: Page) {
  await configure(
    page,
    { tier: 'below', timeScale: 1, seed: 'e2e-t200b-lesson' },
    { teach: true, settings: FIRST_RUN },
  );
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['lesson'], 120_000);
  await expect(page.getByTestId('lesson')).toBeVisible();
  await page.waitForTimeout(800);
}

/** The batting area of the lesson (the lower part of the screen), as the page lays it out now. */
const battingArea = async (page: Page) => {
  const box = await page.locator('[data-testid="lesson"] [role="application"]').boundingBox();
  if (!box) throw new Error('the lesson has no batting area');
  return box;
};

/** A real touch stroke on the batting area, clear of the card (the right of the screen): pull back, then flick forward. */
async function dryDrive(page: Page) {
  const box = await battingArea(page);
  const x = box.x + box.width * 0.84;
  const y = box.y + box.height * 0.35;
  const down = Math.min(90, box.height * 0.3);
  const up = Math.min(60, box.height * 0.2);
  const cdp = await page.context().newCDPSession(page);
  const pts: Array<{ x: number; y: number }> = [];
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, n: number) => {
    for (let i = pts.length ? 1 : 0; i <= n; i++)
      pts.push({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n });
  };
  line({ x, y }, { x, y: y + down }, 8);
  line({ x, y: y + down }, { x: x + 24, y: y - up }, 8);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pts[0]] });
  for (const q of pts.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [q] });
    await page.waitForTimeout(12);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => undefined);
}

async function dryTap(page: Page) {
  const box = await battingArea(page);
  await page.touchscreen.tap(box.x + box.width * 0.84, box.y + box.height * 0.35);
}

const LESSON: Probe = {
  root: 'lesson-card',
  title: '#lesson-title',
  words: ['[data-testid="lesson-do"] li'],
  primary: 'lesson-bowl',
};

/**
 * The lesson card in its three states, at every phone size: before any try, after a dry swing, after a tap. Every try is made at the
 * size being measured (a player does not resize the phone), so the card has scrolled to the answer the way it does for a player.
 * `both(size)` says where both answers (the read-back and the correction) must be whole at once, without scrolling.
 */
async function lessonWalk(page: Page, lang: Lang, text: number, both: (width: number) => boolean) {
  for (const size of SIZES) {
    await resize(page, size);
    await look(page, { screen: 'lesson-start', lang, text, size: size.name }, LESSON);
  }
  for (const phase of ['after-swing', 'after-tap'] as const) {
    const newest = phase === 'after-swing' ? 'lesson-read' : 'lesson-note';
    for (const size of SIZES) {
      await resize(page, size);
      if (phase === 'after-swing') await dryDrive(page);
      else await dryTap(page);
      await expect(page.getByTestId(newest)).toBeVisible({ timeout: 20_000 });
      // The newest answer is always whole; where the card has the room, the earlier one is too.
      const answers = phase === 'after-tap' && both(size.width) ? ['lesson-note', 'lesson-read'] : [newest];
      await look(page, { screen: `lesson-${phase}`, lang, text, size: size.name }, { ...LESSON, answers });
    }
  }
}

for (const lang of LANGS) {
  test(`QV-01 the lesson card at 200% text on three phones, ${lang}`, async ({ page }) => {
    test.setTimeout(300_000);
    await ready(page, lang, TEXT);
    await toLesson(page);
    await lessonWalk(page, lang, TEXT, () => false);
  });
}

test('QV-02 the answer to a dry swing and a tap is readable at 100% text', async ({ page }) => {
  test.setTimeout(300_000);
  await ready(page, 'en', 1);
  await toLesson(page);
  // At 100% the card shows both answers whole on the two wider phones; on 640x360 the newest one.
  await lessonWalk(page, 'en', 1, (width) => width >= 844);
});

// ---- the camera cards ---------------------------------------------------------------------------------------------------

/** The consent card or dialog: the title, the privacy sentence inside the first view, and the one primary action. */
const CONSENT = (root: string, lang: Lang): Probe => ({
  root,
  title: '[data-testid="camera-consent-title"]',
  words: [],
  primary: 'camera-consent-allow',
  sentence: catalog(lang, 'camera', 'practice.camera.consent.privacy'),
});

const TROUBLE = (root: string, primary: string): Probe => ({
  root,
  title: '[data-testid="camera-trouble-title"]',
  words: ['[data-testid="camera-trouble"] p'],
  primary,
});

/** A device that chose Camera earlier: Play, and the camera's own card before the ball (an Android Chrome phone). */
async function toCard(page: Page, lang: Lang, seedName: string) {
  await seed(page, lang, TEXT);
  await configure(page, { tier: 'below', seed: seedName }, { settings: CAMERA_CHOSEN });
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['camera'], 120_000);
}

/** A fresh device: the setup screen's control row, Camera, and the camera's own dialog. */
async function toDialog(page: Page, lang: Lang, seedName: string) {
  await seed(page, lang, TEXT);
  await configure(page, { tier: 'below', seed: seedName }, { settings: { controlChosen: false } });
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('practice-control-row-camera').click();
  await expect(page.getByTestId('camera-setup')).toBeVisible({ timeout: 30_000 });
}

async function atEverySize(page: Page, fn: (size: (typeof SIZES)[number]) => Promise<void>) {
  for (const size of SIZES) {
    await resize(page, size);
    await fn(size);
  }
}

for (const lang of LANGS) {
  test.describe(`camera cards at 200% text, ${lang}`, () => {
    test.use({ userAgent: ANDROID_UA });

    test(`QV-16 the consent card and the blocked help, ${lang}`, async ({ page }) => {
      test.setTimeout(240_000);
      await failCamera(page, { name: 'NotAllowedError', message: 'Permission denied' });
      await toCard(page, lang, 'e2e-t200b-blocked');
      await expect(page.getByTestId('camera-consent-allow')).toBeVisible({ timeout: 30_000 });
      await atEverySize(page, async (size) => {
        await look(
          page,
          { screen: 'camera-consent-card', lang, text: TEXT, size: size.name },
          CONSENT('camera-ready', lang),
        );
      });
      await resize(page, { width: 915, height: 412 });
      await page.getByTestId('camera-consent-allow').click();
      await expect(page.getByTestId('camera-trouble')).toBeVisible({ timeout: 40_000 });
      await atEverySize(page, async (size) => {
        await look(
          page,
          { screen: 'camera-blocked-card', lang, text: TEXT, size: size.name },
          TROUBLE('camera-ready', 'camera-trouble-retry'),
        );
      });
    });

    test(`QV-16 the consent dialog, the download and the guide, ${lang}`, async ({ page }) => {
      test.setTimeout(360_000);
      await toDialog(page, lang, 'e2e-t200b-dialog');
      await expect(page.getByTestId('camera-consent-allow')).toBeVisible({ timeout: 30_000 });
      await atEverySize(page, async (size) => {
        await look(
          page,
          { screen: 'camera-consent-dialog', lang, text: TEXT, size: size.name },
          CONSENT('camera-setup', lang),
        );
      });
      // Slow 4G, so that the one-time download stays on screen while it is measured.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable');
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: (1638.4 * 1000) / 8,
        uploadThroughput: (750 * 1000) / 8,
        latency: 150,
      });
      await resize(page, { width: 915, height: 412 });
      await page.getByTestId('camera-consent-allow').click();
      await expect(page.getByTestId('camera-guide')).toBeVisible({ timeout: 60_000 });
      const GUIDE: Probe = {
        root: 'camera-setup',
        title: '[data-testid="camera-guide-title"]',
        words: ['[data-testid="camera-guide"] li'],
        primary: 'camera-guide-start',
      };
      const downloading = await page
        .getByTestId('camera-download')
        .isVisible()
        .catch(() => false);
      await atEverySize(page, async (size) => {
        await look(
          page,
          { screen: downloading ? 'camera-download' : 'camera-guide-fast', lang, text: TEXT, size: size.name },
          GUIDE,
        );
      });
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });
      await expect(page.getByTestId('camera-download')).toHaveCount(0, { timeout: 120_000 });
      await atEverySize(page, async (size) => {
        await look(page, { screen: 'camera-guide', lang, text: TEXT, size: size.name }, GUIDE);
      });
    });
  });

  test.describe(`camera download that fails at 200% text, ${lang}`, () => {
    test.use({ userAgent: ANDROID_UA });

    test(`QV-16 the download fails: the strip, its note and "Try again", ${lang}`, async ({ page }) => {
      test.setTimeout(240_000);
      // The one-time download cannot be fetched: the guide shows the failed strip and makes "Try again" its primary action.
      await page.route(/\/models\/pose\//, (route) => route.abort('failed'));
      await toDialog(page, lang, 'e2e-t200b-download-failed');
      await expect(page.getByTestId('camera-consent-allow')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId('camera-consent-allow').click();
      await expect(page.getByTestId('camera-download-retry')).toBeVisible({ timeout: 60_000 });
      const FAILED: Probe = {
        root: 'camera-setup',
        title: '[data-testid="camera-guide-title"]',
        words: ['[data-testid="camera-guide"] li'],
        primary: 'camera-download-retry',
      };
      await atEverySize(page, async (size) => {
        await look(page, { screen: 'camera-download-failed', lang, text: TEXT, size: size.name }, FAILED);
      });
    });
  });

  test.describe(`camera in-app panel at 200% text, ${lang}`, () => {
    test.use({ userAgent: INAPP_UA });

    test(`QV-16 the in-app browser panel, ${lang}`, async ({ page }) => {
      test.setTimeout(240_000);
      await toCard(page, lang, 'e2e-t200b-inapp');
      const consent = page.getByTestId('camera-consent-allow');
      const help = page.getByTestId('camera-trouble');
      await expect(consent.or(help)).toBeVisible({ timeout: 30_000 });
      if (!(await help.isVisible())) await consent.click();
      await expect(help).toBeVisible({ timeout: 40_000 });
      await atEverySize(page, async (size) => {
        await look(
          page,
          { screen: 'camera-inapp-card', lang, text: TEXT, size: size.name },
          TROUBLE('camera-ready', 'camera-trouble-open-chrome'),
        );
      });
    });
  });
}
