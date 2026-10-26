/**
 * Without WebGL 2 the device is below the cutoff: no first-person express bowling. The device check says why, and
 * Classic practice (the stage's 2D implementation, the same physics and rules) plays instead.
 */
import { expect, test } from '@playwright/test';
import { block, configure, queue, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

test('a WebGL failure falls back to the compatibility message and Classic practice', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') return null;
      return (original as (...a: unknown[]) => RenderingContext | null).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });
  // No tier from the hooks: the real device check runs.
  await configure(page, { timeScale: 4, seed: 'e2e-webgl' });
  await page.goto('/practice');
  const compat = page.getByTestId('practice-compat');
  await expect(compat).toBeVisible({ timeout: 60_000 });
  await expect(compat).toHaveAttribute('data-reasons', /no_webgl2/);
  await expect(compat).toContainText('This browser has no WebGL 2 graphics.');
  // The Classic tap also warms audio, so no further tap is needed before the first ball.
  await page.getByTestId('practice-classic').click();
  await queue(page, block());
  await waitFor(page, ['warmup_explain']);
  const st = await state(page);
  expect(st).toMatchObject({ stage: '2d', tier: 'below' });
  await expect(page.getByTestId('practice-play')).toHaveAttribute('data-stage', '2d');
});
