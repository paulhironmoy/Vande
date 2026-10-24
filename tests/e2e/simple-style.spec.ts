import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { assertNoHorizontalOverflow, installClock, openEvidenceTray } from './helpers';

type Scenario = {
  decisions: { id: string; triggerAt?: number; simple?: { title: string; options: Record<string, { title: string }> } }[];
};
const scenario = JSON.parse(readFileSync(new URL('../../src/content/scenarios/examination-crisis.json', import.meta.url), 'utf8')) as Scenario;
const firstDecision = scenario.decisions.find((d) => d.id === 'd-first-response')!;

const timerSeconds = async (page: Page) => {
  const [m, s] = (await page.getByTestId('timer').innerText()).trim().split(':').map(Number);
  return m * 60 + s;
};

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

test('Simple style is the default: kid copy, the clock waits for each decision, clues and fair-play moments read plainly', async ({ page }) => {
  test.setTimeout(240_000);
  await installClock(page);
  await page.goto('/');
  await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('style-simple')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('style-full')).toHaveAttribute('aria-checked', 'false');
  await page.getByTestId('intro-begin').click();
  await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-start-campaign').click();

  const opponents = page.getByTestId('opponents-screen');
  await expect(opponents).toBeVisible();
  await expect(opponents).toContainText('Who is making trouble?');
  await expect(page.getByTestId('opponent-card-disinfo')).toContainText('The Rumour Bug');
  await expect(page.getByTestId('opponent-card-disinfo')).toContainText('Disinformation Cell');
  await page.getByTestId('opponents-confirm').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-style'))).toBe('simple');

  // The first decision arrives at tick 8 (12 s at the relaxed pace) and the clock waits for the answer.
  await page.clock.fastForward(15_000);
  const card = page.getByTestId(`decision-card-${firstDecision.id}`);
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('clock-waiting')).toBeVisible();
  await expect(page.getByTestId('clock-waiting')).toContainText('The clock is waiting for you');
  await expect(card).toContainText(firstDecision.simple!.title);
  await expect(page.getByTestId('decision-option-o-acknowledge')).toContainText(firstDecision.simple!.options['o-acknowledge'].title);
  // No strategist jargon on the card in Simple style.
  await expect(card).not.toContainText(/Article 19/);

  const held = await timerSeconds(page);
  await page.clock.fastForward(15_000);
  await page.waitForTimeout(300);
  expect(await timerSeconds(page)).toBe(held);

  await page.getByTestId('decision-option-o-acknowledge').click();
  await expect(page.getByTestId('clock-waiting')).toHaveCount(0);
  await page.clock.fastForward(10_000);
  await page.waitForTimeout(300);
  expect(held - (await timerSeconds(page))).toBeGreaterThanOrEqual(4);

  // Clues: plain headings and states.
  await openEvidenceTray(page);
  const tray = page.getByTestId('evidence-tray');
  await expect(tray).toContainText('Not checked yet');
  await expect(page.getByTestId('play-screen')).toContainText('Clues');
  if (await page.getByTestId('evidence-tray-toggle').isVisible().catch(() => false)) {
    const close = page.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible().catch(() => false)) await close.click();
  }

  // A fair-play moment appears in chapter 1 and keeps the exact disclaimer.
  const rights = page.getByTestId('rights-moment');
  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline && !(await rights.isVisible().catch(() => false))) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) break;
    const options = page.locator('[data-testid^="decision-option-"]:visible');
    if ((await options.count()) > 0) {
      await options.first().click();
      await page.waitForTimeout(50);
      continue;
    }
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(40);
  }
  await expect(rights).toBeVisible();
  await expect(rights).toContainText('Fair play moment');
  await rights.locator('[data-testid^="rights-option-"]').first().click();
  await expect(rights).toContainText('Educational content—not legal advice');
  await expect(rights).toContainText('Read the real rule (for grown-ups)');
  await page.getByTestId('rights-continue').click();
  await expect(page.getByTestId('rights-moment')).toHaveCount(0);
});

test('switching play style in Settings changes the document style, the clock speed and the wait-for-me switch', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  const style = page.getByTestId('setting-playStyle');
  const pace = page.getByTestId('setting-timerPace');
  const waitForMe = page.getByTestId('setting-autoPauseOnDecision').getByRole('switch');

  await expect(style.getByRole('radio', { name: /^simple$/i })).toHaveAttribute('aria-checked', 'true');
  await expect(waitForMe).toHaveAttribute('aria-checked', 'true');
  // Note: a fresh install starts on the Normal clock; "Slow" is applied by the style switch itself (see below).

  await style.getByRole('radio', { name: /^full$/i }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-style'))).toBe('full');
  await expect(pace.getByRole('radio', { checked: true })).toContainText('Standard');
  await expect(waitForMe).toHaveAttribute('aria-checked', 'false');

  await style.getByRole('radio', { name: /^simple$/i }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-style'))).toBe('simple');
  await expect(pace.getByRole('radio', { checked: true })).toContainText('Slow');
  await expect(waitForMe).toHaveAttribute('aria-checked', 'true');
});

test('Simple home, opponents and play screens pass axe WCAG 2.2 AA checks', async ({ page }) => {
  await installClock(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  const home = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(home.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(home.violations, null, 1)).toEqual([]);

  await page.getByTestId('home-start-campaign').click();
  await expect(page.getByTestId('opponents-screen')).toBeVisible();
  const opp = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(opp.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(opp.violations, null, 1)).toEqual([]);

  await page.getByTestId('opponents-confirm').click();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(15_000);
  await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('clock-waiting')).toBeVisible();
  const play = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('canvas').analyze();
  expect(play.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(play.violations, null, 1)).toEqual([]);
});

test.describe('Simple style on a 390×844 phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no horizontal overflow, big option buttons and no small text in the decision area', async ({ page }) => {
    await installClock(page);
    await page.goto('/');
    await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('intro-begin').click();
    await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
    await page.goto('/home');
    await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('home-start-campaign').click();
    await page.getByTestId('opponents-confirm').click();
    await page.getByTestId('briefing-start').click();
    await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
    await page.clock.fastForward(15_000);
    const card = page.locator('[data-testid^="decision-card-"]').first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await assertNoHorizontalOverflow(page);

    const options = page.locator('[data-testid^="decision-option-"]:visible');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await options.nth(i).boundingBox();
      expect(box, `option ${i} has a box`).not.toBeNull();
      expect(box!.height, `option ${i} height`).toBeGreaterThanOrEqual(56);
    }

    const smallText = await card.evaluate((root) => {
      const offenders: string[] = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node: Node | null = walker.nextNode();
      while (node) {
        const text = node.textContent?.trim() ?? '';
        const el = node.parentElement;
        if (text && el) {
          const size = parseFloat(getComputedStyle(el).fontSize);
          const visible = el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
          if (visible && size < 15) offenders.push(`${size.toFixed(1)}px: ${text.slice(0, 40)}`);
        }
        node = walker.nextNode();
      }
      return offenders;
    });
    expect(smallText, smallText.join('\n')).toEqual([]);
  });
});
