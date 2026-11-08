/**
 * Practice works offline once installed: with the service worker in control and the network gone, the app opens on
 * the Practice home, and a whole predefined over is set up and played, all on the device. The wide-stock/leave
 * fixture isolates uninterrupted offline navigation from legitimate dismissals; it is not batting-quality evidence.
 */
import { expect, test } from '@playwright/test';
import {
  GPU_ARGS,
  block,
  buildBall,
  configure,
  playFromSetup,
  queue,
  state,
  toOverSummary,
  waitFor,
} from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

for (const exercise of ['wide-stock continuity', 'original random dismissal'] as const) {
  test(`Practice plays fully offline after the first visit (first-person stage; ${exercise})`, async ({
    page,
    context,
  }) => {
    test.setTimeout(300_000);
    // Seed for the random dismissal: was 'e2e-offline'. Now 'e2e-offline-v3-91' (lead-approved reseed, 2026-11-03, for
    // the frozen sim v3 5d physics): under 5d all six blocks of 'e2e-offline' survive, so it never reaches 'out'.
    // 'e2e-offline-v3-91' is the first seed of the ordered search 'e2e-offline-v3-<k>' (release/.../wedge/worker/seeds/)
    // whose blocks survive balls 1-3 and edge ball 4 to the keeper. The continuity fixture keeps 'e2e-offline'.
    await configure(page, {
      tier: 'full',
      timeScale: 6,
      seed: exercise === 'original random dismissal' ? 'e2e-offline-v3-91' : 'e2e-offline',
      autoNext: true,
    });
    await page.goto('/');
    await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
    // Installed: the service worker has precached the app (including the stage, physics and coach chunks).
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await context.setOffline(true);
    await page.reload();
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText('You are offline', { exact: true })).toHaveCount(0);
    if (exercise === 'wide-stock continuity') {
      await page.getByTestId('practice-predefined').click();
      await page.getByTestId('practice-build-mode-own').click();
      for (let i = 0; i < 6; i++) await buildBall(page, 0.45, 5.5, 'stock');
      await page.getByTestId('practice-build-start').click();
      await queue(page, ...Array.from({ length: 6 }, () => 'leave' as const));
    } else {
      // Six requested blocks: on the seed above, 5d legitimately edges ball four to the keeper (v2 did so on 'e2e-offline').
      await queue(page, ...Array.from({ length: 6 }, () => block()));
      await page.getByTestId('practice-random').click();
      expect((await state(page)).over).toMatchObject({ source: 'random' });
      expect((await state(page)).over?.variations).toHaveLength(6);
    }
    await playFromSetup(page);
    expect((await state(page)).stage).toBe('3d');
    if (exercise === 'original random dismissal') {
      await waitFor(page, ['out'], 120_000);
      expect(await state(page)).toMatchObject({
        status: 'out',
        balls: 4,
        last: { dismissal: 'caught_behind', swing: 'defend' },
      });
      await expect(page.getByTestId('practice-out-summary')).toBeVisible();
      return;
    }
    await toOverSummary(page, 120_000);
    // (A software rasteriser cannot hold the frame rate, so the session monitor may step down to Classic between balls.)
    expect(await state(page)).toMatchObject({ status: 'over_complete', balls: 6 });
  });
}
