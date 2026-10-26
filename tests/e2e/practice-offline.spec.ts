/**
 * Practice works offline once installed: with the service worker in control and the network gone, the app loads,
 * the first-time warm-up is bowled and explained, and the guided over is played, all on the device.
 */
import { expect, test } from '@playwright/test';
import { GPU_ARGS, block, configure, queue, startBatting, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

test('Practice plays fully offline after the first visit (first-person stage)', async ({ page, context }) => {
  test.setTimeout(300_000);
  await configure(page, { tier: 'full', timeScale: 6, seed: 'e2e-offline' });
  await page.goto('/practice');
  // Installed: the service worker has precached the app (including the stage and physics chunks).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await context.setOffline(true);
  await page.reload();
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  await expect(page.getByTestId('practice-play')).toBeVisible();
  // Opened directly (no press yet): one tap first, so the audio unlock never lands on a swing.
  await startBatting(page);
  await queue(page, block());
  expect((await state(page)).stage).toBe('3d');
  await waitFor(page, ['warmup_explain'], 120_000);
  await expect(page.getByTestId('practice-warmup-explain')).toContainText('What happened');
  await expect(page.getByTestId('practice-why')).toBeVisible();
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await page.getByTestId('practice-start-over').click();
  await waitFor(page, ['over_summary', 'out'], 240_000);
  const st = await state(page);
  expect(st.over?.source).toBe('guided');
  // (A software rasteriser cannot hold the frame rate, so the session monitor may step down to Classic between balls.)
  expect(st).toMatchObject({ status: 'over_complete', balls: 6 });
});
