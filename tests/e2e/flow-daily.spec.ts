import { expect, test } from '@playwright/test';
import { batInnings, newPhone, onboard } from './flow-helpers';

test('Daily Six: one attempt against the sealed over, a counted score and the "sealed before you batted" proof', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { context, page } = await newPhone(browser);
  await onboard(page, 'Daily Dasher');
  await page.goto('/daily');
  await expect(page.getByTestId('daily-screen')).toBeVisible({ timeout: 20_000 });
  // The three over commits are published before anyone bats.
  await expect(page.getByTestId('daily-proof')).toBeVisible();
  await page.getByTestId('daily-start').click();
  // Six balls and no Super Ball: the server ends the attempt.
  const balls = await batInnings(page);
  expect(balls).toBeGreaterThanOrEqual(1);
  expect(balls).toBeLessThanOrEqual(6);
  await expect(page.getByTestId('daily-result-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('daily-result')).toBeVisible();
  // The replay's over matches the commit published when the day opened, and the replay verifies.
  await expect(page.getByTestId('daily-proof-line')).toHaveAttribute('data-ok', 'true', { timeout: 20_000 });
  await expect(page.getByTestId('daily-again')).toBeVisible();
  await context.close();
});
