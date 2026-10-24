import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { enterGameplayFresh, installClock } from './helpers';

test('home, opponents and gameplay pass axe WCAG 2.2 AA checks', async ({ page }) => {
  await installClock(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  const home = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(home.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(home.violations, null, 1)).toEqual([]);

  await page.getByTestId('home-start-campaign').click();
  await expect(page.getByTestId('opponents-screen')).toBeVisible();
  const opp = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(opp.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(opp.violations, null, 1)).toEqual([]);

  await page.getByTestId('opponents-confirm').click();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(12_000);
  await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible();
  const play = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('canvas')
    .analyze();
  expect(play.violations.map((v) => `${v.id}: ${v.nodes.length}`), JSON.stringify(play.violations, null, 1)).toEqual([]);
});

test('keyboard navigation reaches and activates a decision option', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(12_000);
  const option = page.locator('[data-testid^="decision-option-"]:visible').first();
  await expect(option).toBeVisible();
  const targetId = await option.getAttribute('data-testid');

  // Tab until the first option is focused (bounded).
  let focused = '';
  for (let i = 0; i < 60 && focused !== targetId; i++) {
    await page.keyboard.press('Tab');
    focused = (await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? '')) || '';
  }
  expect(focused).toBe(targetId);
  // Visible focus indication
  const outline = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement;
    const cs = getComputedStyle(el);
    return { outline: cs.outlineStyle, shadow: cs.boxShadow };
  });
  expect(outline.outline !== 'none' || (outline.shadow && outline.shadow !== 'none')).toBeTruthy();
  await page.keyboard.press('Enter');
  await expect(page.locator(`[data-testid="${targetId}"]`)).toHaveCount(0);
});

test('text scaling to 200% keeps the play screen usable without horizontal overflow', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  const scale = page.getByTestId('setting-textScale');
  await scale.getByRole('button', { name: /200/ }).or(scale.getByRole('radio', { name: /200/ })).first().click();
  const fontSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  expect(fontSize).toBeGreaterThanOrEqual(31);
  await page.goto('/home');
  await page.getByTestId('home-start-campaign').click();
  await page.getByTestId('opponents-confirm').click();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(12_000);
  await expect(page.locator('[data-testid^="decision-option-"]:visible').first()).toBeVisible();
  const r = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(r.sw).toBeLessThanOrEqual(r.cw + 1);
});
