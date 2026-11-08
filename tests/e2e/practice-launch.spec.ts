/**
 * The first run (Stage 1): a start at the root opens the Practice home, with no account, age question or network.
 * Random Over (the balanced defaults) → its setup (the field, the conditions, "each delivery stays unknown until
 * release") → Play bowls at once. A first run gets one short, skippable demonstration first. Deep links still open
 * their own screens.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { GPU_ARGS, configure, openPractice, play, playFromSetup, seen, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

test('a start at the root is Practice: two choices, Random Over first, then the setup and the first ball', async ({ page }) => {
  // Seeded at the longest run-up (owner decision 2026-11-04), so the budget is met in the worst case, not by luck: the
  // first Random Over's bowler sets the run-up, and over 600 seeds it is one of 1.72, 1.74, 2.30, 2.40 or 2.42 s of
  // scene time to release; this seed's pace bowler takes the longest, 2.42 s (practiceReleaseScene; found with
  // S/worker/vt/runup.scratch.test.ts, release/product-sequence/stage-1-practice/wedge/worker/fix-round/). Before this,
  // the test was unseeded and its run-up was 1.7 s or 2.4 s at random. The 10 s budget is unchanged.
  await openPractice(page, { tier: 'full', timeScale: 1, seed: 'e2e-launch-0' });
  await expect(page.getByTestId('practice-random')).toContainText('Random Over');
  await expect(page.getByTestId('practice-predefined')).toContainText('Predefined Over');
  // Nothing of the legacy app, and no Chase teaser, on the way in.
  expect(await seen(page, 'age-screen')).toBeNull();
  expect(await seen(page, 'launch-chase')).toBeNull();
  await page.getByTestId('practice-random').click();
  const setup = page.getByTestId('practice-setup');
  await expect(setup).toBeVisible();
  await expect(page.getByTestId('practice-unknown-line')).toHaveText('Each delivery stays unknown until release.');
  await expect(page.getByTestId('practice-field-map')).toBeVisible();
  await expect(page.getByTestId('practice-random-choices-toggle')).toContainText('Club');
  await playFromSetup(page);
  await expect(play(page)).toHaveAttribute('data-screen', 'live');
  await page.waitForFunction(() => (window as unknown as { __vandePractice: { state(): { ttfdMs: number | null } } }).__vandePractice.state().ttfdMs !== null);
  // Practice opening → the first ball released, on the performance clock (a software-rendered headless browser on a
  // laptop: phones are measured separately, docs/PRACTICE.md).
  const st = await state(page);
  test.info().annotations.push({ type: 'launch', description: JSON.stringify({ ttfdMs: st.ttfdMs, stage: st.stage, profile: st.profile, unreadyBowls: st.unreadyBowls, family: st.over?.family }) });
  expect(st.over?.family, 'the seeded over is bowled by the longest run-up (pace)').toBe('pace');
  expect(st.ttfdMs).not.toBeNull();
  expect(st.ttfdMs!).toBeLessThan(10_000);
});

test('a first run gets one short demonstration before the first ball; one tap skips all teaching for good', async ({ page }) => {
  await configure(page, { tier: 'below', timeScale: 1 }, { teach: true });
  await page.goto('/');
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['intro']);
  await expect(page.getByTestId('practice-intro')).toBeVisible();
  await page.getByTestId('practice-intro-skip-all').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:settings') ?? '{}'));
  expect(saved).toMatchObject({ teach: false, demoSeen: true });
  // Taught nothing more: no pre-delivery hint on the next ball either.
  expect(await seen(page, 'practice-hint')).toBeNull();
});

test('deep links still open their own screens', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await expect(page.getByTestId('practice-menu')).toHaveCount(0);
});

test('the Practice home and the setup screen pass axe (no serious or critical issues)', async ({ page }) => {
  await openPractice(page, { tier: 'below' });
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  const setup = await new AxeBuilder({ page }).include('[data-testid="practice-setup"]').analyze();
  expect(setup.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
