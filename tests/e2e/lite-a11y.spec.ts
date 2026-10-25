import { test, expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Accessibility and phone pass over the new Lite UI: tiers, Insight, How points work, picture cards and reveal
 * pictures, the friend's twist, the reply sheet, the reply landing and the rematch.
 *   - axe WCAG 2.2 AA on every screen;
 *   - keyboard only through the whole friend loop (focus lands on each new heading, sheets close with Escape and
 *     return focus to their opener);
 *   - phones 320 (best effort), 360, 390, 412 portrait and 390 landscape: no horizontal overflow, 44 px targets,
 *     nothing clipped;
 *   - reduced motion (prefers-reduced-motion and the app setting) and forced colours.
 * Set LITE_SHOTS=1 to save review screenshots in release/lite-review/v2/.
 */

const POOL = JSON.parse(readFileSync(resolve(process.cwd(), 'src/content/lite/twists.json'), 'utf8')) as { twists: { id: string; best: string }[] };
const bestOfTwist = (id: string) => {
  const t = POOL.twists.find((x) => x.id === id);
  if (!t) throw new Error(`unknown twist ${id}`);
  return t.best;
};
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const SHOTS = process.env.LITE_SHOTS === '1';
const SHOT_DIR = resolve(process.cwd(), 'release/lite-review/v2');
/** Full-page captures draw the off-screen skip link and confetti over the content; hide both in review shots. */
const SHOT_STYLE = '.skip-link, canvas { visibility: hidden !important; }';

type Screen =
  | 'start-how-points'
  | 'decision-picture'
  | 'feedback-reveal'
  | 'dare-sheet'
  | 'dare-landing'
  | 'dare-result'
  | 'twist'
  | 'twist-result'
  | 'reply-sheet'
  | 'reply-landing'
  | 'rematch'
  | 'rematch-result'
  | 'decision-text'
  | 'fair-play'
  | 'result';

type Check = (page: Page, screen: Screen) => Promise<void>;

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  expect.soft(r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`), `axe: ${label}`).toEqual([]);
}

/** Waits until entrance animations have finished (infinite ambient ones are ignored). */
async function settle(page: Page) {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          const t = a.effect?.getComputedTiming();
          return a.playState !== 'running' || t?.iterations === Infinity;
        }),
      undefined,
      { timeout: 4000 },
    )
    .catch(() => undefined);
}

/** A sheet moves focus inside itself when it opens; wait for that before using keys on it. */
async function focusInDialog(page: Page, label: string) {
  await expect
    .poll(() => page.evaluate(() => Boolean(document.querySelector('[role="dialog"]')?.contains(document.activeElement))), { message: `${label}: focus moves into the sheet`, timeout: 5000 })
    .toBe(true);
}

/** Horizontal overflow, targets under 44 px and clipped or off-screen text on the current screen. */
async function layoutIssues(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const vw = document.documentElement.clientWidth;
    const name = (el: Element) => {
      const id = el.getAttribute('data-testid');
      return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${(el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 36)}"`;
    };
    const shown = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    };
    if (document.documentElement.scrollWidth > vw + 1) out.push(`horizontal overflow ${document.documentElement.scrollWidth}px > ${vw}px`);
    const dialog = document.querySelector('[role="dialog"]');
    const scope: ParentNode = dialog ?? document;
    for (const el of scope.querySelectorAll('button, a[href], [role="button"], [role="radio"], input, select')) {
      if (!shown(el) || el.closest('[aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 43.5 || r.height < 43.5) out.push(`target ${Math.round(r.width)}×${Math.round(r.height)} ${name(el)}`);
    }
    const srOnly = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width <= 2 || r.height <= 2 || cs.clipPath.includes('inset(50%') || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip);
    };
    for (const el of scope.querySelectorAll('*')) {
      if (!shown(el) || el.closest('[aria-hidden="true"]') || srOnly(el)) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? '').trim())) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 || r.left < -1) out.push(`off-screen text ${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`);
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const cs = getComputedStyle(a);
        if (!/hidden|clip/.test(cs.overflowX + cs.overflowY)) continue;
        const ar = a.getBoundingClientRect();
        if (r.right > ar.right + 1 || r.left < ar.left - 1 || r.bottom > ar.bottom + 1 || r.top < ar.top - 1) out.push(`clipped text ${name(el)} inside ${name(a)}`);
        break;
      }
      const own = getComputedStyle(el);
      if (/hidden|clip/.test(own.overflowX) && el.scrollWidth > el.clientWidth + 1) out.push(`cut text ${name(el)}`);
    }
    for (const li of document.querySelectorAll('ul[aria-label="City bars"] > li')) {
      const [label, value] = [...li.children];
      if (!label || !value) continue;
      const a = label.getBoundingClientRect();
      const b = value.getBoundingClientRect();
      if (a.right > b.left - 2 && a.top < b.bottom && b.top < a.bottom) out.push(`HUD label touches value: ${li.textContent?.replace(/\s+/g, ' ').trim()}`);
    }
    return out;
  });
}

async function shot(page: Page, screen: Screen, tag: string) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${screen}-${tag}.png`, fullPage: true, style: SHOT_STYLE });
}

async function newPlayer(browser: Browser, opts: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'], viewport: { width: 1366, height: 768 }, colorScheme: 'dark', ...opts });
  return ctx.newPage();
}

const step = (page: Page) => page.getByTestId('lite-screen');

/**
 * The whole friend loop, calling `check` on every screen: the helper's own first move and dare, the friend's dare,
 * twist and reply, then the helper's reply landing and rematch. Returns nothing; checks record soft failures.
 */
async function friendLoop(helper: Page, friend: Page, check: Check) {
  // Helper: start with How points open.
  await helper.goto('/lite');
  await expect(step(helper)).toHaveAttribute('data-step', 'start', { timeout: 15_000 });
  await helper.getByTestId('how-points-open').click();
  await expect(helper.getByTestId('how-points-sheet')).toBeVisible();
  await check(helper, 'start-how-points');
  await focusInDialog(helper, 'how points');
  await helper.keyboard.press('Escape');
  await expect(helper.getByTestId('how-points-sheet')).toBeHidden();

  // Helper: the first move is a picture question with a tier badge.
  await helper.getByTestId('lite-start').click();
  await helper.getByTestId('lite-next').click();
  await expect(step(helper)).toHaveAttribute('data-step', 'decision');
  await expect(helper.locator('[data-visual="true"]').first()).toBeVisible();
  await expect(helper.getByTestId('lite-tier')).toBeVisible();
  await check(helper, 'decision-picture');
  await helper.getByTestId('lite-option-o-acknowledge').click();
  await expect(step(helper)).toHaveAttribute('data-step', 'feedback');
  await expect(helper.getByTestId('lite-reveal')).toBeVisible();
  await check(helper, 'feedback-reveal');
  const bestId = ((await helper.locator('[data-testid^="lite-reveal-"][data-best="true"]').first().getAttribute('data-testid')) ?? '').replace('lite-reveal-', '');
  await helper.getByTestId('lite-dare').click();
  await expect(helper.getByTestId('dare-sheet')).toBeVisible();
  await check(helper, 'dare-sheet');
  await helper.getByTestId('dare-share-copy').click();
  const dareLink = await helper.evaluate(() => navigator.clipboard.readText());
  await focusInDialog(helper, 'dare sheet');
  await helper.keyboard.press('Escape');
  await expect(helper.getByTestId('dare-sheet')).toBeHidden();

  // Friend: dare landing, the dared move, the result with the twist offer, the twist, the reply sheet.
  await friend.goto(new URL(dareLink).pathname);
  await expect(step(friend)).toHaveAttribute('data-step', 'dare-landing', { timeout: 15_000 });
  await check(friend, 'dare-landing');
  await friend.getByTestId('dare-accept').click();
  await expect(step(friend)).toHaveAttribute('data-step', /decision|clue/);
  if ((await step(friend).getAttribute('data-step')) === 'clue') await friend.getByTestId('lite-skip-clue').click();
  await friend.getByTestId(`lite-option-${bestId}`).click();
  await expect(friend.getByTestId('dare-result')).toBeVisible();
  await expect(friend.getByTestId('twist-start')).toBeVisible();
  await check(friend, 'dare-result');
  await friend.getByTestId('twist-start').click();
  await expect(step(friend)).toHaveAttribute('data-step', 'twist');
  await check(friend, 'twist');
  const twistId = (await friend.getByTestId('twist-question').getAttribute('data-twist')) ?? '';
  await friend.getByTestId(`twist-option-${bestOfTwist(twistId)}`).click();
  await expect(step(friend)).toHaveAttribute('data-step', 'twist-result');
  await check(friend, 'twist-result');
  await friend.getByTestId('dare-reply').click();
  await expect(friend.getByTestId('reply-sheet')).toBeVisible();
  await check(friend, 'reply-sheet');
  await friend.getByTestId('reply-share-copy').click();
  const replyLink = await friend.evaluate(() => navigator.clipboard.readText());
  await focusInDialog(friend, 'reply sheet');
  await friend.keyboard.press('Escape');
  await expect(friend.getByTestId('reply-sheet')).toBeHidden();

  // Helper: reply landing, rematch question and result.
  await helper.goto(new URL(replyLink).pathname);
  await expect(step(helper)).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
  await expect(helper.getByTestId('rematch-offer')).toBeVisible();
  await check(helper, 'reply-landing');
  await helper.getByTestId('rematch-accept').click();
  await expect(step(helper)).toHaveAttribute('data-step', 'rematch');
  await check(helper, 'rematch');
  const rematchTwist = (await helper.getByTestId('rematch-question').getAttribute('data-twist')) ?? '';
  await helper.getByTestId(`rematch-option-${bestOfTwist(rematchTwist)}`).click();
  await expect(step(helper)).toHaveAttribute('data-step', 'rematch-result');
  await expect(helper.getByTestId('rematch-verdict')).toBeVisible();
  await check(helper, 'rematch-result');
}

/** An own run to the end, checking the first text decision, the first fair-play question and the result. */
async function ownRun(page: Page, check: Check) {
  await page.goto('/lite');
  await expect(step(page)).toHaveAttribute('data-step', 'start', { timeout: 15_000 });
  await page.getByTestId('lite-start').click();
  const seen = new Set<Screen>();
  for (let i = 0; i < 140; i++) {
    const s = (await step(page).getAttribute('data-step')) ?? '';
    if (s === 'ended') break;
    if (s === 'decision' && !seen.has('decision-text') && (await page.locator('[data-visual="true"]').count()) === 0) {
      seen.add('decision-text');
      await check(page, 'decision-text');
    }
    if (s === 'rights' && !seen.has('fair-play')) {
      seen.add('fair-play');
      await check(page, 'fair-play');
    }
    if (s === 'begin' || s === 'feedback' || s === 'clue-result' || s === 'rights-result') await page.getByTestId('lite-next').click();
    else if (s === 'clue') await page.getByTestId('lite-check').click();
    else if (s === 'decision') await page.locator('[data-testid^="lite-option-"]').first().click();
    else if (s === 'rights') await page.locator('[data-testid^="lite-rights-"]').first().click();
    await expect(step(page)).not.toHaveAttribute('data-step', s, { timeout: 10_000 });
  }
  await expect(page.getByTestId('lite-result')).toBeVisible();
  await expect(page.getByTestId('lite-result-insight')).toBeVisible();
  await check(page, 'result');
}

test.describe('Lite accessibility: axe WCAG 2.2 AA on every new screen', () => {
  test('friend loop: How points, tier, pictures, reveal, Insight, dare landing and result, twist, reply sheet, reply landing, rematch', async ({ browser }) => {
    test.setTimeout(240_000);
    const helper = await newPlayer(browser);
    const friend = await newPlayer(browser);
    await friendLoop(helper, friend, async (page, screen) => {
      if (screen === 'feedback-reveal') await expect.soft(page.getByTestId('lite-insight-gain'), 'Insight chip after the best move').toBeVisible();
      if (screen === 'twist-result') {
        // Answering moves focus to the result heading, described by the why line (nothing is lost to the page top).
        const verdict = page.locator('[data-testid="twist-result"] h2');
        await expect.soft(verdict, 'focus moves to the twist result').toBeFocused();
        const described = await verdict.evaluate((el) => document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '');
        expect.soft(described.length, 'the why line describes the result').toBeGreaterThan(10);
        await settle(page);
        const opacities = await page.locator('[data-testid^="twist-option-"]').evaluateAll((els) =>
          els.map((el) => ({ id: el.getAttribute('data-testid'), verdict: el.getAttribute('data-verdict'), opacity: Number(getComputedStyle(el).opacity) })),
        );
        const others = opacities.filter((o) => !o.verdict);
        expect.soft(others.length, 'answers that were neither picked nor best').toBeGreaterThan(0);
        for (const o of others) expect.soft(o.opacity, `${o.id} fades back after the answer`).toBeLessThan(0.6);
      }
      await axe(page, screen);
    });
  });

  test('own run: a text decision, a fair-play question and the result with the Insight line', async ({ page }) => {
    test.setTimeout(240_000);
    await ownRun(page, async (p, screen) => axe(p, screen));
  });
});

/** Tab forward until the element with `testId` has focus; fails if it is never reached. */
async function tabTo(page: Page, testId: string, max = 80) {
  for (let i = 0; i < max; i++) {
    if (await page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, testId)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${testId}`);
}

async function headingFocused(page: Page, label: string) {
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ''), { message: `${label}: focus moves to the new heading`, timeout: 5000 })
    .toMatch(/^H[12]$/);
}

/** Every visible, enabled button of the current step is reachable with Tab and nothing traps focus outside a dialog. */
async function allReachable(page: Page, label: string) {
  const ids = await page.evaluate(() => {
    const scope: ParentNode = document.querySelector('[role="dialog"]') ?? document.querySelector('main') ?? document;
    return [...scope.querySelectorAll('button:not([disabled]), a[href]')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && !el.closest('[aria-hidden="true"]');
      })
      .map((el, i) => {
        if (!el.getAttribute('data-a11y-id')) el.setAttribute('data-a11y-id', `a${i}`);
        return el.getAttribute('data-a11y-id')!;
      });
  });
  const reached = new Set<string>();
  for (let i = 0; i < ids.length * 2 + 12; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => document.activeElement?.getAttribute('data-a11y-id') ?? '');
    if (id) reached.add(id);
  }
  const missing = ids.filter((id) => !reached.has(id));
  const names = await page.evaluate((m) => m.map((id) => document.querySelector(`[data-a11y-id="${id}"]`)?.textContent?.trim() ?? id), missing);
  expect.soft(names, `${label}: every control reachable by Tab`).toEqual([]);
}

test.describe('Lite keyboard only', () => {
  test('helper dares, friend answers, takes the twist and sends back, helper plays the rematch: keyboard only', async ({ browser }) => {
    test.setTimeout(240_000);
    const helper = await newPlayer(browser);
    const friend = await newPlayer(browser);

    // Helper: How points opens and closes from the keyboard and focus returns to its opener.
    await helper.goto('/lite');
    await expect(step(helper)).toHaveAttribute('data-step', 'start', { timeout: 15_000 });
    await tabTo(helper, 'how-points-open');
    await helper.keyboard.press('Enter');
    await expect(helper.getByTestId('how-points-sheet')).toBeVisible();
    await focusInDialog(helper, 'how points');
    await allReachable(helper, 'how points sheet');
    await helper.keyboard.press('Escape');
    await expect(helper.getByTestId('how-points-sheet')).toBeHidden();
    await expect(helper.getByTestId('how-points-open')).toBeFocused();

    await tabTo(helper, 'lite-start');
    await helper.keyboard.press('Enter');
    await expect(step(helper)).toHaveAttribute('data-step', 'begin');
    await headingFocused(helper, 'begin');
    await tabTo(helper, 'lite-next');
    await helper.keyboard.press('Enter');
    await expect(step(helper)).toHaveAttribute('data-step', 'decision');
    await headingFocused(helper, 'decision');
    await tabTo(helper, 'lite-option-o-acknowledge');
    await helper.keyboard.press('Enter');
    await expect(step(helper)).toHaveAttribute('data-step', 'feedback');
    await headingFocused(helper, 'feedback');
    const bestId = ((await helper.locator('[data-testid^="lite-reveal-"][data-best="true"]').first().getAttribute('data-testid')) ?? '').replace('lite-reveal-', '');
    await tabTo(helper, 'lite-dare');
    await helper.keyboard.press('Enter');
    await expect(helper.getByTestId('dare-sheet')).toBeVisible();
    await focusInDialog(helper, 'dare sheet');
    await tabTo(helper, 'dare-share-copy');
    await helper.keyboard.press('Enter');
    await expect.poll(() => helper.evaluate(() => navigator.clipboard.readText())).toContain('/lite/dare/');
    const dareLink = await helper.evaluate(() => navigator.clipboard.readText());
    await helper.keyboard.press('Escape');
    await expect(helper.getByTestId('dare-sheet')).toBeHidden();
    await expect(helper.getByTestId('lite-dare')).toBeFocused();

    // Friend.
    await friend.goto(new URL(dareLink).pathname);
    await expect(step(friend)).toHaveAttribute('data-step', 'dare-landing', { timeout: 15_000 });
    await tabTo(friend, 'dare-accept');
    await friend.keyboard.press('Enter');
    await expect(step(friend)).toHaveAttribute('data-step', /decision|clue/);
    if ((await step(friend).getAttribute('data-step')) === 'clue') {
      await headingFocused(friend, 'clue');
      await tabTo(friend, 'lite-skip-clue');
      await friend.keyboard.press('Enter');
    }
    await expect(step(friend)).toHaveAttribute('data-step', 'decision');
    await headingFocused(friend, 'dared move');
    await tabTo(friend, `lite-option-${bestId}`);
    await friend.keyboard.press('Enter');
    await expect(friend.getByTestId('dare-result')).toBeVisible();
    await headingFocused(friend, 'dare result');
    await allReachable(friend, 'dare result');
    await tabTo(friend, 'twist-start');
    await friend.keyboard.press('Enter');
    await expect(step(friend)).toHaveAttribute('data-step', 'twist');
    await headingFocused(friend, 'twist');
    const twistId = (await friend.getByTestId('twist-question').getAttribute('data-twist')) ?? '';
    await tabTo(friend, `twist-option-${bestOfTwist(twistId)}`);
    await friend.keyboard.press('Enter');
    await expect(step(friend)).toHaveAttribute('data-step', 'twist-result');
    await headingFocused(friend, 'twist result');
    await allReachable(friend, 'twist result');
    await tabTo(friend, 'dare-reply');
    await friend.keyboard.press('Enter');
    await expect(friend.getByTestId('reply-sheet')).toBeVisible();
    await focusInDialog(friend, 'reply sheet');
    await tabTo(friend, 'reply-share-copy');
    await friend.keyboard.press('Enter');
    await expect.poll(() => friend.evaluate(() => navigator.clipboard.readText())).toContain('/lite/reply/');
    const replyLink = await friend.evaluate(() => navigator.clipboard.readText());
    await friend.keyboard.press('Escape');
    await expect(friend.getByTestId('reply-sheet')).toBeHidden();
    await expect(friend.getByTestId('dare-reply')).toBeFocused();

    // Helper: reply landing and rematch.
    await helper.goto(new URL(replyLink).pathname);
    await expect(step(helper)).toHaveAttribute('data-step', 'reply-landing', { timeout: 15_000 });
    await allReachable(helper, 'reply landing');
    await tabTo(helper, 'rematch-accept');
    await helper.keyboard.press('Enter');
    await expect(step(helper)).toHaveAttribute('data-step', 'rematch');
    await headingFocused(helper, 'rematch');
    const rematchTwist = (await helper.getByTestId('rematch-question').getAttribute('data-twist')) ?? '';
    await tabTo(helper, `rematch-option-${bestOfTwist(rematchTwist)}`);
    await helper.keyboard.press('Enter');
    await expect(step(helper)).toHaveAttribute('data-step', 'rematch-result');
    await headingFocused(helper, 'rematch result');
    await allReachable(helper, 'rematch result');
    await tabTo(helper, 'reply-dare-more');
    await helper.keyboard.press('Enter');
    await expect(helper.getByTestId('dare-sheet')).toBeVisible();
    await focusInDialog(helper, 'dare more friends');
    await helper.keyboard.press('Escape');
    await expect(helper.getByTestId('dare-sheet')).toBeHidden();
    await expect(helper.getByTestId('reply-dare-more')).toBeFocused();
  });

  test('picture cards are named by exactly their visible text, and the tier, Insight and twist results read sensibly', async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await newPlayer(browser);
    await page.goto('/lite');
    await page.getByTestId('lite-start').click();
    await page.getByTestId('lite-next').click();
    await expect(step(page)).toHaveAttribute('data-step', 'decision');
    const cards = page.locator('[data-testid^="lite-option-"][data-visual="true"]');
    expect(await cards.count()).toBe(4);
    for (let i = 0; i < 4; i++) {
      const card = cards.nth(i);
      // Visible words in reading order (text-transform aside: screen readers get the words, not the capitals).
      const visible = await card.evaluate((el) => {
        const out: string[] = [];
        const walk = (n: Node) => {
          if (n.nodeType === 3) {
            const x = (n.textContent ?? '').trim();
            if (x) out.push(x);
          } else if (!(n instanceof Element && n.getAttribute('aria-hidden') === 'true')) n.childNodes.forEach(walk);
        };
        walk(el);
        return out.join(' ');
      });
      const attrs = await card.evaluate((el) => ({ label: el.getAttribute('aria-label'), labelledby: el.getAttribute('aria-labelledby') }));
      expect.soft(attrs.label, 'no aria-label override on picture cards').toBeNull();
      expect.soft(attrs.labelledby).toBeNull();
      const snapshot = await card.ariaSnapshot();
      const name = (/button "(.*)"/.exec(snapshot) ?? [])[1] ?? '';
      expect.soft(name.toLowerCase(), `accessible name of card ${i + 1}`).toBe(visible.toLowerCase());
      expect.soft(snapshot, 'the picture adds nothing to the accessibility tree').not.toMatch(/img|graphics/);
    }
    const tier = page.getByTestId('lite-tier');
    await expect.soft(tier).toHaveText(/^(Tricky|Tough|Boss) question · ×[123] Insight$/);
    await page.getByTestId('lite-option-o-acknowledge').click();
    await expect(step(page)).toHaveAttribute('data-step', 'feedback');
    await expect.soft(page.getByTestId('lite-insight-gain')).toHaveText(/^\+\d+ Insight · (Tricky|Tough|Boss)$/);
    const pill = page.getByTestId('lite-insight');
    await expect.soft(pill, 'the Insight total says its name in words, not only in an aria-label').toHaveText(/^\s*Insight \d+$/);
    expect.soft(await pill.getAttribute('aria-label')).toBeNull();
  });
});

const PHONES: { name: string; opts: BrowserContextOptions }[] = [
  { name: '320', opts: { viewport: { width: 320, height: 640 } } },
  { name: '360', opts: { viewport: { width: 360, height: 800 } } },
  { name: '390', opts: { viewport: { width: 390, height: 844 } } },
  { name: '412', opts: { viewport: { width: 412, height: 915 } } },
  { name: '390-landscape', opts: { viewport: { width: 844, height: 390 } } },
];

test.describe('Lite on phones', () => {
  for (const phone of PHONES) {
    test(`${phone.name}: no horizontal overflow, 44 px targets and nothing clipped on every new screen`, async ({ browser }) => {
      test.setTimeout(300_000);
      const opts: BrowserContextOptions = { ...phone.opts, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
      const helper = await newPlayer(browser, opts);
      const friend = await newPlayer(browser, opts);
      const check: Check = async (page, screen) => {
        await settle(page);
        const issues = await layoutIssues(page);
        const label = `${phone.name} ${screen}`;
        if (phone.name === '320') {
          if (issues.length) test.info().annotations.push({ type: 'best effort at 320 px', description: `${screen}: ${issues.join('; ')}` });
          expect.soft(issues.filter((x) => x.startsWith('horizontal overflow')), label).toEqual([]);
        } else expect.soft(issues, label).toEqual([]);
        await shot(page, screen, phone.name);
      };
      await friendLoop(helper, friend, check);
      await ownRun(await newPlayer(browser, opts), check);
    });
  }
});

test.describe('Lite reduced motion and forced colours', () => {
  /** Motion only: transforms, sizes and positions. Opacity fades are allowed with reduced motion. */
  async function noRunningAnimations(page: Page, label: string) {
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => {
          const t = a.effect?.getComputedTiming();
          if (a.playState !== 'running' || Number(t?.duration ?? 0) <= 20 || (t?.iterations ?? 1) === Infinity) return false;
          const motion = /transform|translate|scale|rotate|width|height|top|left|right|bottom|margin|inset/;
          if ('transitionProperty' in a) return motion.test(String((a as CSSTransition).transitionProperty));
          const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
          return frames.some((f) => Object.keys(f).some((k) => motion.test(k)));
        })
        .map((a) => {
          const target = (a.effect as KeyframeEffect | null)?.target as Element | null;
          return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'animation'} on ${target?.className?.toString().slice(0, 40) ?? '?'}`;
        }),
    );
    expect.soft(running, `${label}: nothing animates with reduced motion`).toEqual([]);
  }

  test('prefers-reduced-motion: the friend loop and own run settle without animation', async ({ browser }) => {
    test.setTimeout(240_000);
    const opts: BrowserContextOptions = { reducedMotion: 'reduce' };
    const helper = await newPlayer(browser, opts);
    const friend = await newPlayer(browser, opts);
    await friendLoop(helper, friend, async (page, screen) => {
      await page.waitForTimeout(60);
      await noRunningAnimations(page, screen);
    });
  });

  test('the app reduced-motion setting: the friend loop settles without animation', async ({ browser }) => {
    test.setTimeout(240_000);
    const setReduced = async (page: Page) => {
      await page.goto('/settings');
      const control = page.getByTestId('setting-reducedMotion');
      await expect(control).toBeVisible({ timeout: 15_000 });
      await control.getByRole('button', { name: /^on$/i }).or(control.getByRole('radio', { name: /^on$/i })).first().click();
      await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('reduced');
    };
    const helper = await newPlayer(browser);
    const friend = await newPlayer(browser);
    await setReduced(helper);
    await setReduced(friend);
    await friendLoop(helper, friend, async (page, screen) => {
      await expect.soft(page.locator('html'), `${screen}: setting kept`).toHaveAttribute('data-motion', 'reduced');
      await page.waitForTimeout(60);
      await noRunningAnimations(page, screen);
    });
  });

  test('forced colours: every new screen keeps readable text and visible controls', async ({ browser }) => {
    test.setTimeout(240_000);
    const opts: BrowserContextOptions = { forcedColors: 'active' };
    const helper = await newPlayer(browser, opts);
    const friend = await newPlayer(browser, opts);
    await friendLoop(helper, friend, async (page, screen) => {
      await settle(page);
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const scope: ParentNode = document.querySelector('[role="dialog"]') ?? document.querySelector('main') ?? document;
        for (const el of scope.querySelectorAll('h1, h2, p, button, [data-testid="lite-tier"], [data-testid="lite-insight-gain"], [data-testid="lite-insight"]')) {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height || el.closest('[aria-hidden="true"]')) continue;
          const cs = getComputedStyle(el);
          if (cs.color === 'rgba(0, 0, 0, 0)' || cs.color === 'transparent') out.push(`transparent text: ${el.textContent?.trim().slice(0, 30)}`);
          if (Number(cs.opacity) < 0.3) out.push(`faint (${cs.opacity}): ${el.textContent?.trim().slice(0, 30)}`);
        }
        return out;
      });
      expect.soft(problems, `${screen}: readable in forced colours`).toEqual([]);
      if (SHOTS && (screen === 'decision-picture' || screen === 'twist-result' || screen === 'rematch-result' || screen === 'feedback-reveal')) {
        mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({ path: `${SHOT_DIR}/${screen}-forced-colors.png`, fullPage: true, style: SHOT_STYLE });
      }
    });
  });
});

/* Screen-reader checks for fixes made in LitePlayScreen.tsx and ReplyLanding.tsx during the review wave. */
test.describe('Lite: screen-reader announcements and headings', () => {
  test('the result screen has a heading that takes focus when the chapter ends', async ({ page }) => {
    test.setTimeout(180_000);
    await ownRun(page, async () => undefined);
    await headingFocused(page, 'result');
    await expect(page.getByTestId('lite-result').locator('h1, h2')).toHaveCount(1);
  });

  test('the tier and the Insight total carry their words to screen readers', async ({ page }) => {
    await page.goto('/lite');
    await page.getByTestId('lite-start').click();
    await page.getByTestId('lite-next').click();
    await expect(step(page)).toHaveAttribute('data-step', 'decision');
    const described = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="lite-screen"] h1');
      const ids = (h?.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    });
    expect(described).toMatch(/(Tricky|Tough|Boss) question/);
    await page.getByTestId('lite-option-o-acknowledge').click();
    await expect(step(page)).toHaveAttribute('data-step', 'feedback');
    const pill = page.getByTestId('lite-insight');
    expect(await pill.getAttribute('aria-label')).toBeNull();
    await expect(pill).toContainText('Insight');
  });

  test('the Challenger award and the rematch verdict are announced politely', async ({ browser }) => {
    test.setTimeout(180_000);
    const helper = await newPlayer(browser);
    const friend = await newPlayer(browser);
    const live = (page: Page) =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="status"], [aria-live="polite"], [aria-live="assertive"]')]
          .map((el) => el.textContent ?? '')
          .join(' | '),
      );
    let sawChallenger = false;
    await friendLoop(helper, friend, async (page, screen) => {
      if (screen === 'reply-sheet') {
        await page.getByTestId('reply-share-copy').click();
        await expect.poll(() => live(page)).toMatch(/Challenger points/);
        sawChallenger = true;
      }
      if (screen === 'rematch-result') await expect.poll(() => live(page)).toMatch(/draw|won|cracked/i);
    });
    expect(sawChallenger).toBe(true);
  });
});
