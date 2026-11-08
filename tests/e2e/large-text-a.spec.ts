/**
 * TEXT200-A: large text (200%) on short landscape phones for Setup, the Chase briefing, Predefined, Home, the dead-ball card and
 * the result screens (QA-VIS QV-03, QV-04, QV-05, QV-07, QV-12; BRIEF-TEXT200-COMMON, acceptance 1 to 5). Each screen is opened
 * once per language at 200% text and measured at 640x360, 844x390 and 915x412 (the window is resized in place), the dead-ball
 * card also at 1280x800, and the layout at 100% text is checked to be what it was.
 *
 *   1. the words are reachable: the room between the bars is at least 200 px, no scroll region is under 120 px high (a 6 px
 *      region is a defect too), and the dead-ball card holds its words in a window of about 120 px (the guard is 108 px: the
 *      measured least is 111 px, Hinglish on 640x360, where the rail's corner takes 153 px of the 360);
 *   2. the first view shows the title, the first words (the chase's "Need N off 12 balls" above all) and the primary action;
 *   3. no word breaks inside the word ("summa/ry"); a break after a hyphen, dash or slash is a normal break and is not counted;
 *   4. every control in view is at least 44 px in both directions;
 *   5. at 100% text the bars stay where they were (title bar sticky, bottom bar 73 px at 640x360 to 915x412, title at x 72).
 * Also: the field map's labels are not cut by its edge (QV-07), the result screens' title starts where the words under it start
 * (QV-12), and "Next ball" is wholly inside the dead-ball card and the screen (QV-03).
 *
 * The spec needs the hooks build (VITE_PRACTICE_TEST_HOOKS=1): `npx playwright test large-text-a --project practice`
 * (playwright.config.ts: add `large-text` to PRACTICE_SPEC) or, until then, `E2E_DIST=<hooks build> E2E_PORT=<port>
 * npx playwright test large-text-a --project chromium`. With T200A_OUT set (a folder) it writes one JSON line per measurement
 * to records.jsonl and a capture of every state there (evidence for the INDEX). Builder checks only: they measure layout;
 * whether a person can read the words on a real phone is not claimed.
 */
import { expect, test, type Page } from '@playwright/test';
import { appendFileSync, mkdirSync } from 'node:fs';
import { LOSS_BALLS, LOSS_WICKET } from './chase-paths';
import { openPractice, queue, waitFor, type PracticeTestConfig } from './practice-helpers';

const PHONES = [
  { name: '640x360', width: 640, height: 360 },
  { name: '844x390', width: 844, height: 390 },
  { name: '915x412', width: 915, height: 412 },
] as const;
const DESKTOP = { name: '1280x800', width: 1280, height: 800 } as const;
type Size = { name: string; width: number; height: number };
const LANGS = ['en', 'hi', 'hi-Latn'] as const;
type Lang = (typeof LANGS)[number];

const OUT = process.env.T200A_OUT;
const BUILD = process.env.T200A_BUILD ?? 'unknown';
if (OUT) mkdirSync(`${OUT}/captures`, { recursive: true });

/** One line per measurement, one capture per state, when T200A_OUT is set. */
async function note(page: Page, id: string, data: unknown) {
  if (!OUT) return;
  appendFileSync(
    `${OUT}/records.jsonl`,
    `${JSON.stringify({ id, build: BUILD, utc: new Date().toISOString(), data })}\n`,
  );
  await page.screenshot({ path: `${OUT}/captures/${id}.png` }).catch(() => undefined);
}

/** App settings (language, text scale) before any page script runs, read once per tab like the real settings. */
async function seed(page: Page, lang: Lang, text: number) {
  await page.addInitScript(
    ([l, t]) => {
      if (sessionStorage.getItem('t200a-seeded')) return;
      sessionStorage.setItem('t200a-seeded', '1');
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

/** Opens Practice at a size, language and text scale (a fresh device unless `settings` says otherwise). */
async function open(
  page: Page,
  lang: Lang,
  text: number,
  size: Size,
  cfg: PracticeTestConfig = { tier: 'below', timeScale: 4 },
  settings?: Record<string, unknown>,
) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await seed(page, lang, text);
  await openPractice(page, cfg, settings ? { settings } : {});
}

/** Resizes the window in place and lets the layout settle (two frames and the card's placement checks). */
async function resize(page: Page, size: Size) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  await page.waitForTimeout(300);
}

interface Numbers {
  vw: number;
  vh: number;
  scale: number;
  /** The screen's own flag (data-large-short) and the bars. */
  flag: string | null;
  headerPos: string | null;
  headerLeft: number | null;
  footerHeight: number | null;
  footerPos: string | null;
  /** Free height between the title bar (if it is still on screen) and the bottom bar, at the top and after scrolling a little. */
  freeTop: number;
  freeScrolled: number;
  /** Boxes of the named elements: in the first view wholly (`full`), partly (`part`). */
  keys: Record<string, { top: number; bottom: number; left: number; full: boolean; part: boolean } | null>;
  titleFull: boolean;
  regions: Array<{ id: string; client: number; scroll: number }>;
  broken: string[];
  small: string[];
  offscreen: string[];
}

/**
 * Runs in the page: measures the screen whose root is `rootId` from the top of its scroller. Nothing in it closes over the
 * test file. A word counts as broken when its characters sit on two lines and it holds no hyphen, dash or slash.
 */
function measureInPage(args: { rootId: string; keys: string[] }): Numbers | null {
  const root = document.querySelector<HTMLElement>(`[data-testid="${args.rootId}"]`);
  if (!root) return null;
  const vw = innerWidth;
  const vh = innerHeight;
  const rendered = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    for (let e: Element | null = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      if (e.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  };
  const scroller = (): HTMLElement | null => {
    const all = [
      document.scrollingElement as HTMLElement | null,
      ...Array.from(document.querySelectorAll<HTMLElement>('*')),
    ];
    return (
      all
        .filter((e): e is HTMLElement => Boolean(e) && /auto|scroll|visible/.test(getComputedStyle(e!).overflowY))
        .filter((e) => e.scrollHeight > e.clientHeight + 4)
        .sort((a, b) => b.scrollHeight - a.scrollHeight)[0] ?? null
    );
  };
  const bars = () => {
    const header = root.querySelector('header');
    const footer = root.querySelector('footer');
    const hr = header?.getBoundingClientRect();
    const fr = footer?.getBoundingClientRect();
    const top = hr && hr.bottom > 0 && hr.top < vh ? Math.max(0, hr.bottom) : 0;
    const bottom = fr && fr.top < vh && fr.bottom > 0 ? Math.min(vh, fr.top) : vh;
    return { header, footer, top, bottom };
  };
  const sc = scroller();
  if (sc) sc.scrollTop = 0;
  const b0 = bars();
  const keys: Numbers['keys'] = {};
  for (const k of args.keys) {
    const el = document.querySelector<HTMLElement>(`[data-testid="${k}"]`);
    if (!el) {
      keys[k] = null;
      continue;
    }
    const r = el.getBoundingClientRect();
    keys[k] = {
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      left: Math.round(r.left),
      full: r.top >= b0.top - 1 && r.bottom <= b0.bottom + 1 && r.left >= -1 && r.right <= vw + 1,
      part: r.bottom > b0.top + 1 && r.top < b0.bottom - 1,
    };
  }
  const h1 = root.querySelector('h1,h2');
  const h1r = h1?.getBoundingClientRect();
  const titleFull = Boolean(h1r && h1r.top >= 0 && h1r.bottom <= b0.bottom && h1r.right <= vw + 1);
  const freeTop = Math.round(b0.bottom - b0.top);
  if (sc) sc.scrollTop = 150;
  const b1 = bars();
  const freeScrolled = Math.round(b1.bottom - b1.top);
  if (sc) sc.scrollTop = 0;
  const regions: Numbers['regions'] = [];
  for (const e of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    const cs = getComputedStyle(e);
    if (/auto|scroll/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1 && rendered(e) && e !== sc) {
      regions.push({
        id: e.getAttribute('data-testid') ?? e.tagName.toLowerCase(),
        client: e.clientHeight,
        scroll: e.scrollHeight,
      });
    }
  }
  const broken = new Set<string>();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    const txt = n.textContent ?? '';
    if (!p || !txt.trim() || !rendered(p) || p.closest('svg,script,style')) continue;
    for (const m of txt.matchAll(/\S+/g)) {
      const word = m[0];
      if (word.length < 4 || /[-‐-―/]/.test(word)) continue;
      const rg = document.createRange();
      rg.setStart(n, m.index ?? 0);
      rg.setEnd(n, (m.index ?? 0) + word.length);
      const rects = Array.from(rg.getClientRects()).filter((x) => x.width > 0.5);
      if (rects.length > 1 && Math.max(...rects.map((x) => x.top)) - Math.min(...rects.map((x) => x.top)) > 4)
        broken.add(word);
    }
  }
  const small: string[] = [];
  const controls = root.querySelectorAll<HTMLElement>(
    'button, a[href], input:not([type=hidden]), select, summary, [role=button], [role=radio], [role=switch], [role=tab], [tabindex]:not([tabindex="-1"])',
  );
  for (const el of Array.from(controls)) {
    if (!rendered(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= vh) continue;
    if (r.width < 43.5 || r.height < 43.5) {
      small.push(
        `${el.getAttribute('data-testid') ?? el.tagName.toLowerCase()}:${Math.round(r.width)}x${Math.round(r.height)}`,
      );
    }
  }
  const offscreen: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('p,span,h1,h2,h3,li,button,a,label'))) {
    if (!Array.from(el.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim()) || !rendered(el))
      continue;
    const rg = document.createRange();
    rg.selectNodeContents(el);
    const tr = rg.getBoundingClientRect();
    if (tr.width > 0 && tr.top < vh && tr.bottom > 0 && (tr.right > vw + 1 || tr.left < -1)) {
      offscreen.push(`${(el.textContent ?? '').trim().slice(0, 24)}@${Math.round(tr.left)}-${Math.round(tr.right)}`);
    }
  }
  const flagEl = root.matches('[data-large-short]') ? root : root.querySelector('[data-large-short]');
  const fr = b0.footer?.getBoundingClientRect();
  return {
    vw,
    vh,
    scale: Math.round((parseFloat(getComputedStyle(document.documentElement).fontSize) / 16) * 100) / 100,
    flag: flagEl?.getAttribute('data-large-short') ?? null,
    headerPos: b0.header ? getComputedStyle(b0.header).position : null,
    headerLeft: h1r ? Math.round(h1r.left) : null,
    footerHeight: fr ? Math.round(fr.height) : null,
    footerPos: b0.footer ? getComputedStyle(b0.footer).position : null,
    freeTop,
    freeScrolled,
    keys,
    titleFull,
    regions,
    broken: Array.from(broken).slice(0, 10),
    small: small.slice(0, 10),
    offscreen: offscreen.slice(0, 6),
  };
}

const measure = (page: Page, rootId: string, keys: string[] = []) =>
  page.evaluate(measureInPage, { rootId, keys }).then((n) => {
    expect(n, `the screen ${rootId} is on the page`).not.toBeNull();
    return n as Numbers;
  });

/** What every screen must satisfy at 200% text on a phone (acceptance 1 to 4 of the common brief). */
function expectReadable(n: Numbers, what: string) {
  expect.soft(n.scale, `${what}: the text scale`).toBeGreaterThanOrEqual(1.99);
  expect.soft(n.flag, `${what}: the screen knows it is large text on a short screen`).toBe('true');
  expect.soft(n.headerPos, `${what}: the title bar scrolls with the page`).not.toBe('sticky');
  if (n.footerHeight !== null) {
    expect.soft(n.footerPos, `${what}: the bottom bar stays`).toBe('sticky');
    expect.soft(n.footerHeight, `${what}: the bottom bar is one slim bar`).toBeLessThanOrEqual(64);
  }
  expect.soft(n.freeScrolled, `${what}: room for the words between the bars`).toBeGreaterThanOrEqual(200);
  expect.soft(n.freeTop, `${what}: the first view holds words under the title`).toBeGreaterThanOrEqual(100);
  expect.soft(n.titleFull, `${what}: the title is in the first view`).toBe(true);
  for (const r of n.regions) expect.soft(r.client, `${what}: scroll region ${r.id}`).toBeGreaterThanOrEqual(120);
  expect.soft(n.broken, `${what}: words broken inside the word`).toEqual([]);
  expect.soft(n.small, `${what}: controls under 44 px`).toEqual([]);
  expect.soft(n.offscreen, `${what}: text past the screen edge`).toEqual([]);
}

/** Opens the setup, the chase briefing or the predefined over from the Practice home. */
async function goto(page: Page, where: 'setup' | 'chase' | 'predefined') {
  const id = { setup: 'practice-random', chase: 'practice-chase', predefined: 'practice-predefined' }[where];
  await page.getByTestId(id).scrollIntoViewIfNeeded();
  await page.getByTestId(id).click();
  await page
    .getByTestId(where === 'predefined' ? 'practice-build-screen' : 'practice-setup')
    .waitFor({ state: 'visible' });
  await page.waitForTimeout(400);
}
async function backHome(page: Page) {
  await page.getByTestId('practice-back').click();
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await page.waitForTimeout(300);
}

/** The field map's labels against the map's own drawing box (a label past it is cut: "Deep cov"). */
function fieldCuts(): Array<{ text: string; cut: number }> {
  const out: Array<{ text: string; cut: number }> = [];
  for (const svg of Array.from(document.querySelectorAll('[data-testid="practice-field-map"] svg'))) {
    const sr = svg.getBoundingClientRect();
    if (sr.width < 2) continue;
    for (const t of Array.from(svg.querySelectorAll('text'))) {
      const r = t.getBoundingClientRect();
      if (r.width < 1) continue;
      out.push({
        text: (t.textContent ?? '').trim(),
        cut: Math.round(Math.max(0, sr.left - r.left) + Math.max(0, r.right - sr.right)),
      });
    }
  }
  return out;
}

for (const lang of LANGS) {
  test(`200% text, ${lang}: Home, Setup, the Chase briefing and Predefined leave room for the words on every phone`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await open(page, lang, 2, PHONES[0]);
    for (const size of PHONES) {
      await resize(page, size);
      const tag = `${lang}-${size.name}-t2`;
      // Home: the first entry in full and the next one showing under it, so there is more to see and a reason to scroll.
      const home = await measure(page, 'practice-menu', ['practice-random', 'practice-predefined', 'practice-chase']);
      await note(page, `home-${tag}`, home);
      expect.soft(home.flag, 'home: large text on a short screen').toBe('true');
      expect.soft(home.headerPos, 'home: the title bar scrolls').not.toBe('sticky');
      expect.soft(home.keys['practice-random']?.full, 'home: Random Over is in the first view').toBe(true);
      expect.soft(home.keys['practice-predefined']?.part, 'home: the next entry shows under it').toBe(true);
      expect.soft(home.broken, 'home: broken words').toEqual([]);
      expect.soft(home.small, 'home: small controls').toEqual([]);
      // Setup (a Random Over): fresh device, so "How do you want to bat?" is on the screen.
      await goto(page, 'setup');
      const setup = await measure(page, 'practice-setup', [
        'practice-play-start',
        'practice-control-row',
        'practice-field-map',
      ]);
      await note(page, `setup-${tag}`, setup);
      expectReadable(setup, `setup ${tag}`);
      expect
        .soft(setup.keys['practice-play-start']?.bottom ?? 9999, `setup ${tag}: Play is on the screen`)
        .toBeLessThanOrEqual(size.height);
      const cuts = (await page.evaluate(fieldCuts)).filter((c) => c.cut > 0);
      expect.soft(cuts, `setup ${tag}: field labels cut by the map's edge`).toEqual([]);
      await backHome(page);
      // The Chase briefing: the target is in the first view.
      await goto(page, 'chase');
      const chase = await measure(page, 'practice-setup', [
        'practice-chase-brief-need',
        'practice-play-start',
        'practice-field-map',
      ]);
      await note(page, `chase-brief-${tag}`, chase);
      expectReadable(chase, `chase briefing ${tag}`);
      expect
        .soft(
          chase.keys['practice-chase-brief-need']?.full,
          `chase briefing ${tag}: "Need N off 12 balls" is in the first view`,
        )
        .toBe(true);
      expect
        .soft(chase.keys['practice-play-start']?.bottom ?? 9999, `chase briefing ${tag}: Play is on the screen`)
        .toBeLessThanOrEqual(size.height);
      const chaseCuts = (await page.evaluate(fieldCuts)).filter((c) => c.cut > 0);
      expect.soft(chaseCuts, `chase briefing ${tag}: field labels cut`).toEqual([]);
      await backHome(page);
      // Predefined Over.
      await goto(page, 'predefined');
      const pre = await measure(page, 'practice-build-screen', ['practice-build-start', 'practice-build-mode']);
      await note(page, `predefined-${tag}`, pre);
      expectReadable(pre, `predefined ${tag}`);
      expect
        .soft(pre.keys['practice-build-mode']?.part, `predefined ${tag}: the choice of over starts in the first view`)
        .toBe(true);
      expect
        .soft(pre.keys['practice-build-start']?.bottom ?? 9999, `predefined ${tag}: the action is on the screen`)
        .toBeLessThanOrEqual(size.height);
      await backHome(page);
    }
  });
}

test('100% text: the bars and the title stay where they were (no more than 2 px)', async ({ page }) => {
  test.setTimeout(180_000);
  await open(page, 'en', 1, PHONES[0]);
  for (const size of [PHONES[0], PHONES[2]]) {
    await resize(page, size);
    const home = await measure(page, 'practice-menu', ['practice-random']);
    expect.soft(home.scale).toBe(1);
    expect.soft(home.flag, `home ${size.name}: not large text`).toBe('false');
    expect.soft(home.headerPos, `home ${size.name}: the title bar is fixed`).toBe('sticky');
    expect.soft(Math.abs((home.headerLeft ?? 0) - 72), `home ${size.name}: the title's place`).toBeLessThanOrEqual(2);
    await goto(page, 'setup');
    const setup = await measure(page, 'practice-setup', ['practice-play-start']);
    expect.soft(setup.flag, `setup ${size.name}: not large text`).toBe('false');
    expect.soft(setup.headerPos, `setup ${size.name}: the title bar is fixed`).toBe('sticky');
    expect.soft(setup.footerPos, `setup ${size.name}: the bottom bar is fixed`).toBe('sticky');
    expect
      .soft(Math.abs((setup.footerHeight ?? 0) - 73), `setup ${size.name}: the bottom bar's height`)
      .toBeLessThanOrEqual(2);
    expect.soft(Math.abs((setup.headerLeft ?? 0) - 72), `setup ${size.name}: the title's place`).toBeLessThanOrEqual(2);
    expect.soft(setup.freeScrolled, `setup ${size.name}: room between the bars`).toBe(size.height - 57 - 73);
    expect
      .soft(
        (await page.evaluate(fieldCuts)).filter((c) => c.cut > 0),
        `setup ${size.name}: field labels cut`,
      )
      .toEqual([]);
    await backHome(page);
  }
});

/** A dead ball on the way to the card: a Random Over's caught-out ball, or the first ball of a chase. */
async function toDeadBall(page: Page, kind: 'practice' | 'chase') {
  if (kind === 'chase') {
    await page.getByTestId('practice-chase').scrollIntoViewIfNeeded();
    await page.getByTestId('practice-chase').click();
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await queue(page, ...LOSS_BALLS.swings);
  } else {
    await page.getByTestId('practice-random').scrollIntoViewIfNeeded();
    await page.getByTestId('practice-random').click();
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await queue(page, { kind: 'attack', contactErrorMs: -45, directionDeg: 20, power: 0.7, elevation: 0 });
  }
  await page.evaluate(() => {
    (window as unknown as { __w: Promise<boolean> }).__w = (
      window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }
    ).__vandePractice.waitFor(['dead', 'out', 'over_summary'], 120_000);
  });
  await page.getByTestId('practice-play-start').click();
  await page.evaluate(() => (window as unknown as { __w: Promise<boolean> }).__w);
  await expect(page.getByTestId('practice-result')).toBeVisible();
  await page.waitForTimeout(1500);
}

interface CardNumbers {
  large: string | null;
  card: { top: number; bottom: number; left: number; right: number };
  railBottom: number | null;
  vw: number;
  vh: number;
  body: { client: number; scroll: number } | null;
  nextInside: boolean;
  nextBox: { top: number; bottom: number; width: number; height: number } | null;
  wordShownPct: number;
  broken: string[];
  small: string[];
  cardScrolls: boolean;
}

function cardInPage(): CardNumbers | null {
  const card = document.querySelector<HTMLElement>('[data-testid="practice-result"]');
  if (!card) return null;
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const vw = innerWidth;
  const vh = innerHeight;
  const cr = card.getBoundingClientRect();
  // The rail's right corner (the conditions and the pause control): the card never covers it (EVAL-WORLD K5).
  const corner = q('practice-conditions')?.parentElement?.getBoundingClientRect();
  const body = q('practice-result-body');
  if (body) body.scrollTop = 0;
  const br = body?.getBoundingClientRect();
  const wr = document.getElementById('practice-result-outcome')?.getBoundingClientRect();
  const nr = q('practice-next-ball')?.getBoundingClientRect();
  const top = Math.max(0, cr.top, br?.top ?? 0);
  const bottom = Math.min(vh, cr.bottom, br?.bottom ?? vh);
  const shown = wr ? Math.max(0, Math.min(wr.bottom, bottom) - Math.max(wr.top, top)) / Math.max(1, wr.height) : 0;
  const rendered = (el: Element) => el.getBoundingClientRect().width > 0;
  const broken = new Set<string>();
  const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    const txt = n.textContent ?? '';
    if (!p || !txt.trim() || !rendered(p) || p.closest('svg')) continue;
    for (const m of txt.matchAll(/\S+/g)) {
      const word = m[0];
      if (word.length < 4 || /[-‐-―/]/.test(word)) continue;
      const rg = document.createRange();
      rg.setStart(n, m.index ?? 0);
      rg.setEnd(n, (m.index ?? 0) + word.length);
      const rects = Array.from(rg.getClientRects()).filter((x) => x.width > 0.5);
      if (rects.length > 1 && Math.max(...rects.map((x) => x.top)) - Math.min(...rects.map((x) => x.top)) > 4)
        broken.add(word);
    }
  }
  const small: string[] = [];
  for (const el of Array.from(card.querySelectorAll<HTMLElement>('button'))) {
    const r = el.getBoundingClientRect();
    if (r.width < 1) continue;
    if (r.width < 43.5 || r.height < 43.5)
      small.push(`${el.getAttribute('data-testid') ?? 'button'}:${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return {
    large: card.getAttribute('data-large-short'),
    card: {
      top: Math.round(cr.top),
      bottom: Math.round(cr.bottom),
      left: Math.round(cr.left),
      right: Math.round(cr.right),
    },
    railBottom: corner ? Math.round(corner.bottom) : null,
    vw,
    vh,
    body: body ? { client: body.clientHeight, scroll: body.scrollHeight } : null,
    nextInside: Boolean(
      nr &&
      nr.top >= cr.top - 0.5 &&
      nr.bottom <= cr.bottom + 0.5 &&
      nr.bottom <= vh + 0.5 &&
      nr.left >= -0.5 &&
      nr.right <= vw + 0.5,
    ),
    nextBox: nr
      ? {
          top: Math.round(nr.top),
          bottom: Math.round(nr.bottom),
          width: Math.round(nr.width),
          height: Math.round(nr.height),
        }
      : null,
    wordShownPct: Math.round(shown * 100),
    broken: Array.from(broken).slice(0, 10),
    small,
    cardScrolls: card.scrollHeight > card.clientHeight + 2,
  };
}

for (const kind of ['practice', 'chase'] as const) {
  for (const lang of LANGS) {
    test(`200% text, ${lang}: the ${kind === 'chase' ? 'first ball of a chase' : 'dead ball'} card shows its result, its words and both actions`, async ({
      page,
    }) => {
      test.setTimeout(300_000);
      const settings = { lessonSeen: true, controlChosen: true, control: 'mouse' };
      await open(
        page,
        lang,
        2,
        PHONES[0],
        { tier: 'below', timeScale: 4, seed: `t200a-${kind}`, chaseSeed: LOSS_WICKET.seed },
        settings,
      );
      await toDeadBall(page, kind);
      for (const size of [...PHONES, ...(lang === 'en' ? [DESKTOP] : [])]) {
        await resize(page, size);
        const c = await page.evaluate(cardInPage);
        expect(c, 'the card is on the screen').not.toBeNull();
        const n = c as CardNumbers;
        const tag = `dead-${kind}-${lang}-${size.name}-t2`;
        await note(page, tag, n);
        const phone = size.width < 1000;
        expect.soft(n.large, `${tag}: large text on a short screen`).toBe(phone ? 'true' : 'false');
        // The result word whole, "Next ball" wholly inside the card and the screen, the words in a window of 120 px or more.
        expect.soft(n.wordShownPct, `${tag}: the result word is in view`).toBe(100);
        expect
          .soft(
            n.nextInside,
            `${tag}: Next ball is wholly inside the card and the screen (${JSON.stringify(n.nextBox)})`,
          )
          .toBe(true);
        expect
          .soft(
            n.body?.client ?? 0,
            `${tag}: the card's words have a window of about 120 px or more (108 at the least)`,
          )
          .toBeGreaterThanOrEqual(108);
        expect.soft(n.broken, `${tag}: words broken inside the word`).toEqual([]);
        expect.soft(n.small, `${tag}: controls under 44 px`).toEqual([]);
        expect.soft(n.card.left, `${tag}: the card is on the screen (left)`).toBeGreaterThanOrEqual(0);
        expect.soft(n.card.right, `${tag}: the card is on the screen (right)`).toBeLessThanOrEqual(n.vw);
        expect.soft(n.card.bottom, `${tag}: the card is on the screen (bottom)`).toBeLessThanOrEqual(n.vh);
        if (phone) {
          // One sheet: the full width, from just under the rail's right corner to the bottom of the screen.
          expect.soft(n.railBottom, `${tag}: the rail's corner is measured`).not.toBeNull();
          expect
            .soft(n.card.top, `${tag}: the card starts below the rail's corner`)
            .toBeGreaterThanOrEqual((n.railBottom ?? 0) - 0.5);
          expect
            .soft(n.card.top - (n.railBottom ?? 0), `${tag}: the card uses the room under the corner`)
            .toBeLessThanOrEqual(12);
          expect
            .soft(n.card.bottom, `${tag}: the card reaches the bottom of the screen`)
            .toBeGreaterThanOrEqual(n.vh - 1);
          expect.soft(n.card.right - n.card.left, `${tag}: the card takes the width`).toBeGreaterThanOrEqual(n.vw - 2);
        }
      }
    });
  }
}

for (const lang of LANGS) {
  test(`200% text, ${lang}: the result screens start the title where the words start and keep room for them`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const settings = { lessonSeen: true, controlChosen: true, control: 'mouse' };
    await open(
      page,
      lang,
      2,
      PHONES[0],
      { tier: 'below', timeScale: 8, seed: 't200a-result', chaseSeed: LOSS_WICKET.seed, autoNext: false },
      settings,
    );
    // A lost chase: ball 1 blocked, ball 2 left and bowled; then "See the result" and the replay of the deciding ball.
    await page.getByTestId('practice-chase').click();
    await expect(page.getByTestId('practice-setup')).toBeVisible();
    await queue(page, ...LOSS_WICKET.swings);
    await page.getByTestId('practice-play-start').click();
    await waitFor(page, ['dead'], 120_000);
    await page.getByTestId('practice-next-ball').click();
    await page.waitForFunction(
      () => {
        const s = (
          window as unknown as { __vandePractice: { state(): { phase: string; chase?: { ballsFaced: number } } } }
        ).__vandePractice.state();
        return s.phase === 'dead' && (s.chase?.ballsFaced ?? 0) >= 2;
      },
      undefined,
      { timeout: 120_000 },
    );
    await page.getByTestId('practice-next-ball').click();
    await expect(page.getByTestId('practice-chase-result')).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(800);
    for (const size of [...PHONES, DESKTOP]) {
      await resize(page, size);
      const n = await measure(page, 'practice-chase-result', [
        'practice-chase-score',
        'practice-chase-line',
        'practice-chase-again',
      ]);
      const tag = `chase-result-${lang}-${size.name}-t2`;
      await note(page, tag, n);
      const contentLeft = n.keys['practice-chase-score']?.left ?? -1;
      expect
        .soft(Math.abs((n.headerLeft ?? -99) - contentLeft), `${tag}: the title starts where the score starts`)
        .toBeLessThanOrEqual(2);
      expect.soft(n.broken, `${tag}: broken words`).toEqual([]);
      expect.soft(n.small, `${tag}: small controls`).toEqual([]);
      if (size.width < 1000) {
        expectReadable(n, tag);
        expect.soft(n.keys['practice-chase-score']?.full, `${tag}: the score is in the first view`).toBe(true);
        expect
          .soft(n.keys['practice-chase-line']?.part, `${tag}: the sentence under the score starts in the first view`)
          .toBe(true);
        expect
          .soft(n.keys['practice-chase-again']?.bottom ?? 9999, `${tag}: Try again is on the screen`)
          .toBeLessThanOrEqual(size.height);
      }
    }
  });
}
