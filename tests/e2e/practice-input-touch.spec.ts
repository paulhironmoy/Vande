/**
 * Real touch input on a phone, not the hooks: a flick and a tap through the GestureSurface in the lower part of the
 * landscape screen (the finger never covers the delivery). Landscape itself: in portrait the "turn your phone" overlay
 * holds the delivery until the phone is turned. And the first swing never pays for the audio unlock. Classic (2D)
 * stage in slow motion, so the live window is wide enough for a headless browser's input.
 */
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, configure, delivered, seen, startBatting, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, ...GPU_ARGS });

const surface = (page: Page) => page.locator('[role="application"]');

/** The first-time warm-up ball, up to its release (the surface is armed then). */
async function warmupLive(page: Page) {
  await configure(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-input' });
  await page.goto('/practice');
  await startBatting(page);
  await waitFor(page, ['live']);
  // The surface arms when React has rendered the release; give it a moment (a real reaction takes far longer).
  await expect(page.locator('[role="application"][data-armed="true"]')).toBeVisible();
  await page.waitForTimeout(100);
}

async function swungAs(page: Page, kind: 'attack' | 'defend') {
  await waitFor(page, ['warmup_explain']);
  const st = await state(page);
  expect(st.last?.kind).toBe('warmup');
  expect(st.last?.swing).toBe(kind);
}

test('a touch flick in the lower area is an attacking swing', async ({ page }) => {
  test.setTimeout(150_000);
  await warmupLive(page);
  const box = (await surface(page).boundingBox())!;
  // The surface covers the lower part of the screen only: the delivery stays visible above the finger.
  expect(box.y).toBeGreaterThan(412 * 0.4);
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.75;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  // A real flick moves at once (a press held still for 50 ms is a tap) and keeps travelling for a moment.
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + i * 10, y: y - i * 16 }] });
  await page.waitForTimeout(40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await swungAs(page, 'attack');
});

test('a tap is the defensive straight bat', async ({ page }) => {
  test.setTimeout(150_000);
  await warmupLive(page);
  const box = (await surface(page).boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height * 0.7);
  await swungAs(page, 'defend');
});

test('the first swing never pays for the audio unlock: opened directly, one tap comes first', async ({ page }) => {
  test.setTimeout(120_000);
  await configure(page, { tier: 'below', timeScale: 1, seed: 'e2e-input' });
  await page.goto('/practice');
  await waitFor(page, ['tap_gate']);
  await expect(page.getByTestId('practice-tap-gate')).toBeVisible();
  await expect(page.getByTestId('practice-tap-go')).toHaveText('Start batting');
  // Nothing is bowled while it waits.
  await page.waitForTimeout(1500);
  expect((await delivered(page)).warmup).toBe(0);
  expect((await state(page)).phase).toBe('idle');
  await page.getByTestId('practice-tap-go').click();
  await waitFor(page, ['live']);
  expect(await seen(page, 'practice-tap-gate')).not.toBeNull();
});

test('portrait holds the delivery behind "Turn your phone sideways" until landscape', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 412, height: 915 });
  await configure(page, { tier: 'below', timeScale: 2, seed: 'e2e-turn' });
  await page.goto('/practice');
  await waitFor(page, ['turn']);
  await expect(page.getByTestId('practice-turn')).toContainText('Turn your phone sideways');
  await page.waitForTimeout(1500);
  expect((await state(page)).phase).toBe('idle');
  expect((await delivered(page)).warmup).toBe(0);
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByTestId('practice-turn')).toHaveCount(0);
  await startBatting(page);
  await waitFor(page, ['runup', 'live', 'playing', 'coaching', 'warmup_explain']);
});
