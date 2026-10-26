/**
 * The launch choice: Practice ("Experience batting") or Skip ("Continue to VANDE") on a normal start, never on a
 * deep link; Practice needs no account, no age answer and no network and reaches the first ball quickly.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { GPU_ARGS, configure, play, seen, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

test('a normal start offers Practice or Skip; Skip continues to VANDE', async ({ page }) => {
  await page.goto('/');
  const choice = page.getByTestId('launch-choice');
  await expect(choice).toBeVisible();
  await expect(page.getByTestId('launch-practice')).toContainText('Practice');
  await expect(page.getByTestId('launch-practice')).toContainText('Experience batting');
  await expect(page.getByTestId('launch-skip')).toContainText('Continue to VANDE');
  await page.getByTestId('launch-skip').click();
  await expect(choice).toHaveCount(0);
  // A new device continues to the existing first run (the age question), exactly as before.
  await expect(page.getByTestId('age-screen')).toBeVisible();
});

test('Practice goes straight to the first ball: no account, no age screen, no settings', async ({ page }) => {
  await configure(page, { tier: 'full', timeScale: 1 });
  await page.goto('/');
  await expect(page.getByTestId('launch-choice')).toBeVisible();
  await page.getByTestId('launch-practice').click();
  await expect(page).toHaveURL(/\/practice$/);
  // A software-rendered first-person stage keeps this page busy while it compiles: allow for it.
  await expect(play(page)).toBeVisible({ timeout: 45_000 });
  // The warm-up ball is bowled and explained without a menu, a field or any setting in between (and the Practice tap
  // already warmed audio, so no extra tap is asked for).
  await waitFor(page, ['warmup_explain']);
  await expect(page.getByTestId('practice-warmup-explain')).toBeVisible();
  expect(await seen(page, 'practice-tap-gate')).toBeNull();
  expect(await seen(page, 'practice-instruction')).toBe('Watch the ball. Tap to defend. Flick to hit.');
  // Practice chosen → the first ball released, measured on the performance clock. This is a software-rendered
  // headless browser on a laptop; phones are measured separately (docs/PRACTICE.md, section 9).
  const st = await state(page);
  expect(st.ttfdMs).not.toBeNull();
  expect(st.ttfdMs!).toBeLessThan(10_000);
  expect(await seen(page, 'age-screen')).toBeNull();
  expect(await seen(page, 'practice-menu')).toBeNull();
  expect(await seen(page, 'practice-radar')).toBeNull();
});

test('deep links never show the launch choice', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('launch-choice')).toHaveCount(0);
  await configure(page, { tier: 'full' }, { guidedDone: true });
  await page.goto('/practice');
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  await expect(page.getByTestId('launch-choice')).toHaveCount(0);
});

test('the launch choice and the Practice menu pass axe (no serious or critical issues)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('launch-choice')).toBeVisible();
  const launch = await new AxeBuilder({ page }).analyze();
  expect(launch.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await configure(page, { tier: 'full' }, { guidedDone: true });
  await page.goto('/practice');
  await expect(page.getByTestId('practice-menu')).toBeVisible();
  const menu = await new AxeBuilder({ page }).analyze();
  expect(menu.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
