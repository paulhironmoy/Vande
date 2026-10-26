import { expect, test } from '@playwright/test';
import { batInnings, newPhone, onboard } from './flow-helpers';

/**
 * The app is killed mid-innings with a ball already bowled (the page is reloaded, like Android reclaiming the app):
 * reopening resumes the same attempt at the same ball from durable storage, never a lost or free ball, and the
 * attempt finishes with a normal result.
 */
test('killing the app mid-innings resumes the same ball and the attempt completes', async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const { context, page } = await newPhone(browser);
  await onboard(page, 'Comeback Kid');
  await page.goto('/daily');
  await page.getByTestId('daily-start').click();

  const screen = page.getByTestId('batting-screen');
  // Play the first ball normally.
  await expect(screen).toHaveAttribute('data-phase', /ready|live/, { timeout: 30_000 });
  if ((await screen.getAttribute('data-phase')) === 'ready') await page.getByTestId('bat-next').click();
  await expect(screen).toHaveAttribute('data-phase', 'live', { timeout: 30_000 });
  await page.getByTestId('bat-hit').click({ timeout: 3_000 }).catch(() => undefined);
  await expect(screen).toHaveAttribute('data-phase', /feedback|done/, { timeout: 30_000 });

  // The second ball is bowled, and the app dies before the batter answers.
  await page.getByTestId('bat-next').click();
  await expect(screen).toHaveAttribute('data-phase', /runup|live/, { timeout: 30_000 });
  await page.reload();

  // Reopened: the same attempt resumes (not a new one), and the innings carries on to a counted result.
  await expect(page.getByTestId('daily-resume')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('daily-attempts')).toBeVisible();
  await page.getByTestId('daily-resume').click();
  await batInnings(page);
  await expect(page.getByTestId('daily-result-screen')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('daily-proof-line')).toHaveAttribute('data-ok', 'true', { timeout: 20_000 });
  await context.close();
});
