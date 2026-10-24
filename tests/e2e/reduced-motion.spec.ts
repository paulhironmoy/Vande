import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

test('reduced motion: launch shows a static mark, durations collapse, and the game still plays', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-23T10:00:00') });
  await page.goto('/');
  // With reduced motion the launch continues immediately (no 1.2 s wait).
  await expect(page.getByTestId('intro-screen')).toBeVisible({ timeout: 15_000 });
  const dur = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--dur-panel').trim());
  expect(parseFloat(dur)).toBeLessThan(1);
  const motion = await page.evaluate(() => document.documentElement.getAttribute('data-motion'));
  expect(motion === 'reduced' || motion === null).toBeTruthy();
  await page.getByTestId('intro-begin').click();
  await expect(page.getByTestId('daily-open-screen')).toBeVisible({ timeout: 15_000 });
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-start-campaign').click();
  await page.getByTestId('opponents-confirm').click();
  await page.getByTestId('briefing-start').click();
  await expect(page.getByTestId('play-screen')).toBeVisible({ timeout: 20_000 });
  await page.clock.fastForward(12_000);
  await expect(page.locator('[data-testid^="decision-card-"]').first()).toBeVisible();
});

test('reduced-motion setting can be forced on from settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  const control = page.getByTestId('setting-reducedMotion');
  await control.getByRole('button', { name: /^on$/i }).or(control.getByRole('radio', { name: /^on$/i })).first().click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-motion'))).toBe('reduced');
});
