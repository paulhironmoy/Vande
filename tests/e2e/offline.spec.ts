import { test, expect } from '@playwright/test';

test('app loads offline after the first visit (service worker precache)', async ({ page, context }) => {
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  // Wait for the service worker to activate and finish precaching.
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    if (!reg.active) throw new Error('no active SW');
  });
  await page.waitForTimeout(2500);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('home-start-campaign').click();
  await expect(page.getByTestId('opponents-screen')).toBeVisible();
  await page.getByTestId('opponents-confirm').click();
  await expect(page.getByTestId('briefing-screen')).toBeVisible();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await context.setOffline(false);
});
