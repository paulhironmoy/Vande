/**
 * Without WebGL 2 the device is below the cutoff: no first-person express bowling, and no dead end either. The setup
 * says so in product words ("switching to Classic graphics for smoother batting"), and Play is still the one action:
 * Classic practice (the same physics, deliveries and scoring) bowls at once.
 */
import { expect, test } from '@playwright/test';
import { block, configure, playFromSetup, queue, state } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

test('a WebGL failure becomes Classic practice, said plainly, with Play as the one action', async ({ page }) => {
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
  await page.goto('/');
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-panel-notice')).toHaveText('This device is switching to Classic graphics for smoother batting.', { timeout: 60_000 });
  // No technical words on the player's screen.
  await expect(page.getByTestId('practice-setup')).not.toContainText(/WebGL|GPU|fps|frame/i);
  await queue(page, block());
  await playFromSetup(page);
  expect(await state(page)).toMatchObject({ stage: '2d', tier: 'below' });
  await expect(page.getByTestId('practice-play')).toHaveAttribute('data-stage', '2d');
});
