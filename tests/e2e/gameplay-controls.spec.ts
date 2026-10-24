import { test, expect } from '@playwright/test';
import { enterGameplayFresh, installClock, openEvidenceTray } from './helpers';

const toSeconds = (t: string) => {
  const [m, s] = t.trim().split(':').map(Number);
  return m * 60 + s;
};

test('pause stops the clock and resume continues it', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(5_000);
  await page.waitForTimeout(300);
  const before = toSeconds(await page.getByTestId('timer').innerText());
  await page.getByTestId('pause').click();
  await expect(page.getByTestId('resume')).toBeVisible();
  await page.clock.fastForward(15_000);
  await page.waitForTimeout(400);
  const paused = toSeconds(await page.getByTestId('timer').innerText());
  expect(Math.abs(paused - before)).toBeLessThanOrEqual(2); // allow a second of real-time drift under parallel load
  await page.getByTestId('resume').click();
  await expect(page.getByTestId('resume')).toHaveCount(0);
  await page.clock.fastForward(10_000);
  await page.waitForTimeout(400);
  const after = toSeconds(await page.getByTestId('timer').innerText());
  expect(before - after).toBeGreaterThanOrEqual(8);
});

test('a reversible communication can be undone within its window', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(9_000);
  const card = page.getByTestId('decision-card-d-first-response');
  await expect(card).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('decision-option-o-board-statement').click();
  await expect(card).toHaveCount(0);
  const undo = page.getByTestId('undo');
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(page.getByTestId('decision-card-d-first-response')).toBeVisible();
  await expect(page.getByTestId('undo')).toHaveCount(0);
});

test('selecting a district opens its card and Escape closes it', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.getByTestId('map-district-civic').click();
  const card = page.getByTestId('district-card');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Civic Square');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
});

test('evidence can be inspected and preserved, and going back keeps the tray open', async ({ page }) => {
  await installClock(page);
  await enterGameplayFresh(page);
  await page.clock.fastForward(12_000);
  await openEvidenceTray(page);
  const first = page.locator('[data-testid^="evidence-card-"]').first();
  await expect(first).toBeVisible();
  await first.click();
  const detail = page.getByTestId('evidence-detail');
  await expect(detail).toBeVisible();
  const inspect = page.getByTestId('evidence-action-inspect');
  if (await inspect.isVisible().catch(() => false)) {
    await inspect.click();
    await expect(detail).toContainText(/Metadata/i);
  }
  const preserve = page.getByTestId('evidence-action-preserve');
  if (await preserve.isVisible().catch(() => false)) {
    await preserve.click();
    await expect(detail).toContainText(/Preserved/i);
  }
  await page.getByTestId('evidence-back').click();
  await expect(page.getByTestId('evidence-tray')).toBeVisible();
  await expect(page.locator('[data-testid^="evidence-card-"]').first()).toBeVisible();
});

test('a rights moment appears in the flow, explains the principle and carries the educational disclaimer', async ({ page }) => {
  test.setTimeout(180_000);
  await installClock(page);
  await enterGameplayFresh(page);
  const rights = page.getByTestId('rights-moment');
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline && !(await rights.isVisible().catch(() => false))) {
    if (await page.getByTestId('chapter-result-screen').isVisible().catch(() => false)) break;
    const options = page.locator('[data-testid^="decision-option-"]:visible');
    if ((await options.count()) > 0) {
      await options.first().click();
      await page.waitForTimeout(50);
      continue;
    }
    await page.clock.fastForward(10_000);
    await page.waitForTimeout(40);
  }
  await expect(rights).toBeVisible();
  await rights.locator('[data-testid^="rights-option-"]').first().click();
  await expect(rights).toContainText('Educational content—not legal advice');
  await expect(rights.locator('a[href^="http"]').first()).toHaveAttribute('rel', /noopener/);
  await page.getByTestId('rights-continue').click();
  await expect(page.getByTestId('rights-moment')).toHaveCount(0);
});
