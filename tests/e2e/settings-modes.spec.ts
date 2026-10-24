import { test, expect } from '@playwright/test';
import { assertNoHorizontalOverflow, installClock } from './helpers';

async function startPlayFromHome(page: import('@playwright/test').Page) {
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-start-campaign').click();
  await page.getByTestId('opponents-confirm').click();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
}

test('high contrast applies to the document and gameplay still renders', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('setting-highContrast').getByRole('switch').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-contrast'))).toBe('high');
  await page.waitForTimeout(400); // let the IndexedDB write commit before a full navigation
  await startPlayFromHome(page);
  await expect(page.getByTestId('timer')).toBeVisible();
  await assertNoHorizontalOverflow(page);
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-contrast'))).toBe('high');
});

test('colour-blind-safe indicators set the palette variant', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('setting-colourBlindSafe').getByRole('switch').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-cb'))).toBe('1');
  await page.waitForTimeout(400); // let the IndexedDB write commit before a full navigation
  await page.reload();
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.getAttribute('data-cb'))).toBe('1');
});

test('150% text keeps gameplay free of horizontal overflow', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('setting-textScale').getByRole('radio', { name: /150/ }).click();
  await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(23);
  await page.waitForTimeout(400);
  await startPlayFromHome(page);
  await page.clock.fastForward(12_000);
  await expect(page.locator('[data-testid^="decision-option-"]:visible').first()).toBeVisible();
  await assertNoHorizontalOverflow(page);
});

test('captions can be turned off; the screen-reader live region remains', async ({ page }) => {
  await installClock(page);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  const sw = page.getByTestId('setting-captions').getByRole('switch');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await page.waitForTimeout(400);
  await startPlayFromHome(page);
  await page.clock.fastForward(20_000);
  await page.waitForTimeout(300);
  await expect(page.locator('[data-testid="map"] [class*="caption"]:visible')).toHaveCount(0);
  await expect(page.locator('[data-testid="map"] [role="status"]')).toHaveCount(1);
});
