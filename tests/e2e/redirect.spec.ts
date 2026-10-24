import { test, expect } from '@playwright/test';

test('static-host fallback redirect reopens the requested in-app path', async ({ page }) => {
  await page.addInitScript(() => {
    try {
      if (!sessionStorage.getItem('__vandeRedirectSeeded')) {
        sessionStorage.setItem('vandeRedirect', '/settings');
        sessionStorage.setItem('__vandeRedirectSeeded', '1');
      }
    } catch {
      /* ignore */
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('settings-screen')).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => new URL(page.url()).pathname).toBe('/settings');
  expect(await page.evaluate(() => sessionStorage.getItem('vandeRedirect'))).toBeNull();
});

test('a challenge query survives the fallback even without storage', async ({ page }) => {
  await page.goto('/?c=V1-INVALID');
  await expect(page.getByTestId('challenge-screen')).toBeVisible({ timeout: 15_000 });
});
