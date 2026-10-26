/**
 * Real desktop input, not the hooks: a mouse flick, a click and Space through the GestureSurface, mapped to the same
 * normalized swing as touch (the keyboard has no immediate-contact advantage). Classic (2D) stage in slow motion, so
 * the live window is wide enough for a headless browser's input.
 */
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, configure, startBatting, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });

const surface = (page: Page) => page.locator('[role="application"]');

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

test('a mouse flick is an attacking swing', async ({ page }) => {
  test.setTimeout(150_000);
  await warmupLive(page);
  const box = (await surface(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.7;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y - 110, { steps: 6 });
  await page.mouse.up();
  await swungAs(page, 'attack');
});

test('a click defends', async ({ page }) => {
  test.setTimeout(150_000);
  await warmupLive(page);
  const box = (await surface(page).boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.7);
  await swungAs(page, 'defend');
});

test('Space defends from the keyboard, with no head start over a tap', async ({ page }) => {
  test.setTimeout(150_000);
  await warmupLive(page);
  await page.keyboard.press('Space');
  await swungAs(page, 'defend');
});
