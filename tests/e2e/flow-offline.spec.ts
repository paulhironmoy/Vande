import { expect, test } from '@playwright/test';
import { batInnings, newPhone, onboard } from './flow-helpers';

/**
 * Losing the connection mid-innings never loses the ball: the shot is saved, the screen says so plainly, and it is
 * delivered when the connection returns, after which the innings carries on to a normal, counted result.
 */
test('a shot played offline is saved, sent on reconnect, and the attempt completes normally', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { context, page } = await newPhone(browser);
  await onboard(page, 'Patchy Signal');
  await page.goto('/daily');
  await page.getByTestId('daily-start').click();

  const screen = page.getByTestId('batting-screen');
  await expect(screen).toHaveAttribute('data-phase', /ready|live/, { timeout: 30_000 });
  if ((await screen.getAttribute('data-phase')) === 'ready') await page.getByTestId('bat-next').click();
  await expect(screen).toHaveAttribute('data-phase', 'live', { timeout: 30_000 });

  // The signal drops just as the batter plays.
  await context.setOffline(true);
  await page.waitForTimeout(300);
  await page.getByTestId('bat-hit').click();
  await expect(page.getByText('Shot saved. It will be sent when you reconnect.')).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2_000);

  // Back online: the queued shot lands and the innings continues.
  await context.setOffline(false);
  await expect(screen).toHaveAttribute('data-phase', /feedback|done/, { timeout: 30_000 });
  await batInnings(page);
  await expect(page.getByTestId('daily-result-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('daily-proof-line')).toHaveAttribute('data-ok', 'true', { timeout: 20_000 });
  await context.close();
});
