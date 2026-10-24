import { test, expect } from '@playwright/test';
import { installClock } from './helpers';

test('browser/hardware back returns to the previous screen and does not break the stack', async ({ page }) => {
  await installClock(page);
  await page.goto('/home');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('home-settings').click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('home-daily').click();
  await expect(page.getByTestId('daily-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await page.getByTestId('home-republic').click();
  await expect(page.getByTestId('republic-screen')).toBeVisible();
  await page.goBack();
  await expect(page.getByTestId('home-screen')).toBeVisible();
});

test('about pages exist and disclose independence', async ({ page }) => {
  await page.goto('/about/disclosure');
  await expect(page.getByTestId('about-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('about-screen')).toContainText(/not affiliated/i);
  await page.goto('/about/privacy');
  await expect(page.getByTestId('about-screen')).toBeVisible();
  await page.goto('/about/accessibility');
  await expect(page.getByTestId('about-screen')).toBeVisible();
  await page.goto('/about/attribution');
  await expect(page.getByTestId('about-screen')).toBeVisible();
  await page.goto('/about/support');
  await expect(page.getByTestId('about-screen')).toBeVisible();
  await page.goto('/about/version');
  await expect(page.getByTestId('about-screen')).toBeVisible();
});
