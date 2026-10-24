import { test, expect } from '@playwright/test';

/** Lite Chapter 1: a self-paced game with points, bars, missions and a best score to beat. */
test('lite chapter plays to a scored result and a replay starts from zero', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/lite');
  await expect(page.getByTestId('lite-screen')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('lite-start').click();

  const screen = page.getByTestId('lite-screen');
  let sawPoints = false;
  for (let i = 0; i < 90; i++) {
    const step = await screen.getAttribute('data-step');
    if (step === 'ended') break;
    if (step === 'begin' || step === 'feedback' || step === 'clue-result' || step === 'rights-result') await page.getByTestId('lite-next').click();
    else if (step === 'clue') await page.getByTestId('lite-check').click();
    else if (step === 'decision') await page.locator('[data-testid^="lite-option-"]').first().click();
    else if (step === 'rights') await page.locator('[data-testid^="lite-rights-"]').first().click();
    if (!sawPoints) sawPoints = Number(await page.getByTestId('lite-points').innerText().then((t) => t.replace(/\D/g, ''))) > 0;
  }
  await expect(page.getByTestId('lite-result')).toBeVisible();
  expect(sawPoints).toBe(true);
  const total = Number((await page.getByTestId('lite-score').innerText()).replace(/\D/g, ''));
  expect(total).toBeGreaterThan(0);
  await expect(page.getByTestId('lite-result')).toContainText(/missions/);

  // Replay resets points and shows the best to beat.
  await page.getByTestId('lite-again').click();
  await expect(screen).toHaveAttribute('data-step', 'begin');
  await expect(page.getByTestId('lite-points')).toContainText('0');
  await expect(screen).toContainText(`Beat your best: ${total}`);
});
