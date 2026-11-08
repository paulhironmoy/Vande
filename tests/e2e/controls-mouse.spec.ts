/**
 * Mouse batting on the web, through the real GestureSurface and the real tracker (owner's second brief, section 4;
 * DoD CTR-04): press, pull back, push forward with a mouse-like and a trackpad-like pointer (fast steps; slow, smooth,
 * small deltas); the pointer is captured, so a stroke that leaves the surface, even the window, still arrives; the
 * right button never starts a stroke and no context menu opens over a ball; the cursor stays visible and the same
 * everywhere over the surface; the page refuses the browser's own sideways swipe; the timing check records a mouse offset.
 *
 * Runs in Chromium with the hooks build (the `practice` project) and, with `playwright.controls.config.ts`, in Firefox and
 * WebKit when their browsers are installed. It uses the Classic 2D stage in slow motion, so the live window is wide enough
 * for a headless browser's input. Real mice, real trackpads, Edge and Safari are not covered (UNPROVEN).
 */
import { expect, test, type Page } from '@playwright/test';
import { openPractice, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

const CFG = { tier: 'below' as const, timeScale: 0.25, seed: 'e2e-controls-mouse' };
const surface = (page: Page) => page.locator('[role="application"]');
const SETTINGS = { settings: { control: 'mouse' } };

async function firstBallLive(page: Page) {
  await openPractice(page, CFG, SETTINGS);
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['live']);
  await expect(page.locator('[role="application"][data-armed="true"]')).toBeVisible();
  await page.waitForTimeout(60);
}

/** Moves the mouse along a straight line in `steps` equal moves, `gapMs` apart (a browser's own timestamps time the stroke). */
async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps: number,
  gapMs: number,
) {
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
    if (gapMs) await page.waitForTimeout(gapMs);
  }
}

async function swung(page: Page): Promise<string | null | undefined> {
  await waitFor(page, ['dead']);
  return (await state(page)).last?.swing;
}

test('a mouse stroke: press, pull back, push forward is an attacking shot', async ({ page }) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const p0 = { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await drag(page, p0, { x: p0.x, y: p0.y + 120 }, 10, 8); // pull back (down)
  await page.waitForTimeout(50); // hold: reading the ball
  await drag(page, { x: p0.x, y: p0.y + 120 }, { x: p0.x + 40, y: p0.y - 40 }, 12, 6); // push forward (up)
  await page.mouse.up();
  expect(await swung(page)).toBe('attack');
});

test('a trackpad-like stroke: slow, smooth, one-pixel steps, is the same kind of shot', async ({ page }) => {
  test.setTimeout(180_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const p0 = { x: box.x + box.width / 2, y: box.y + box.height * 0.3 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await drag(page, p0, { x: p0.x, y: p0.y + 110 }, 110, 3); // a slow pull, 1 px at a time
  await page.waitForTimeout(40);
  await drag(page, { x: p0.x, y: p0.y + 110 }, { x: p0.x + 30, y: p0.y - 50 }, 60, 3); // a smooth push, ~3 px at a time
  await page.mouse.up();
  expect(await swung(page)).toBe('attack');
});

test('pointer capture: a stroke that leaves the top of the surface is still read, and released outside', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const p0 = { x: box.x + box.width / 2, y: box.y + 70 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await drag(page, p0, { x: p0.x, y: p0.y + 100 }, 10, 8);
  await drag(page, { x: p0.x, y: p0.y + 100 }, { x: p0.x + 30, y: box.y - 90 }, 14, 6); // well above the surface's top edge
  const top = await page.evaluate(
    (y) => document.elementFromPoint(400, y)?.closest('[role="application"]') === null,
    box.y - 90,
  );
  expect(top, 'the pointer really is outside the batting surface').toBe(true);
  await page.mouse.up();
  expect(await swung(page)).toBe('attack');
});

test('pointer capture: a stroke that leaves the window itself and is released outside is still read', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const p0 = { x: box.x + box.width / 2, y: box.y + 60 };
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  await drag(page, p0, { x: p0.x, y: p0.y + 100 }, 10, 8);
  await drag(page, { x: p0.x, y: p0.y + 100 }, { x: p0.x + 20, y: -40 }, 16, 6); // above the top of the page
  await page.mouse.up();
  expect(await swung(page)).toBe('attack');
});

test('the right button starts no stroke and opens no menu over a ball', async ({ page }) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const at = { x: box.x + box.width / 2, y: box.y + box.height * 0.5 };
  const menu = await page.evaluate(
    ([x, y]) => {
      const el = document.querySelector('[role="application"]')!;
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y });
      el.dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    [at.x, at.y],
  );
  expect(menu, 'the browser menu is refused while the ball is armed').toBe(true);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  // No stroke began: the ball is still live and nothing was swung.
  expect((await state(page)).phase).toBe('live');
  // The ball then passes: a leave.
  expect(await swung(page)).toBe(null);
});

test("the cursor is visible and the same everywhere over the batting surface; the page keeps the browser's sideways swipe", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  const cursors = await page.evaluate(
    ([x, y, w, h]) =>
      [0.05, 0.5, 0.95].flatMap((fx) =>
        [0.1, 0.5, 0.9].map((fy) => {
          const el = document.elementFromPoint(x + w * fx, y + h * fy)!;
          return `${el.closest('[role="application"]') ? 'surface' : 'other'}:${getComputedStyle(el).cursor}`;
        }),
      ),
    [box.x, box.y, box.width, box.height],
  );
  expect(new Set(cursors)).toEqual(new Set(['surface:crosshair']));
  await expect(surface(page)).toHaveCSS('touch-action', 'none');
  await expect(surface(page)).toHaveCSS('user-select', 'none');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-x', 'none');
  await expect(page.locator('body')).toHaveCSS('overscroll-behavior-x', 'none');
  expect(await page.evaluate(() => getComputedStyle(document.body).cursor)).not.toBe('none');
  await swung(page);
});

test('the timing check records a mouse offset, and only a mouse offset', async ({ page }) => {
  test.setTimeout(150_000);
  await openPractice(page, { ...CFG, timeScale: 1 }, SETTINGS);
  await page.getByTestId('practice-settings-open').click();
  await page.getByTestId('practice-settings-calibrate').click();
  await page.getByTestId('practice-cal-start').click();
  const track = page.getByTestId('practice-cal-track');
  await expect(track).toBeEnabled({ timeout: 10_000 });
  for (let n = 0; n < 8; n++) {
    if (await page.getByTestId('practice-cal-result').count()) break;
    // The ball starts moving after a random 0.5 to 1.4 s; it crosses the line 884 ms (1300 ms x 0.68) after that.
    const startedAt = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const ball = document.querySelector('[class*="calBall"]') as HTMLElement;
          const timer = setInterval(() => {
            const t = ball.style.transform;
            if (t && t !== 'translateX(0px)') {
              clearInterval(timer);
              resolve(performance.now());
            }
          }, 3);
        }),
    );
    const wait = 884 - (await page.evaluate((t0) => performance.now() - t0, startedAt));
    if (wait > 0) await page.waitForTimeout(wait);
    const box = (await track.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
  }
  await expect(page.getByTestId('practice-cal-result')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('practice-cal-result')).toContainText('mouse');
  const set = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:calibration') ?? 'null'));
  expect(set.v).toBe(2);
  expect(set.mouse.attempts).toBeGreaterThanOrEqual(3);
  expect(Math.abs(set.mouse.offsetMs)).toBeLessThan(150);
  expect(set.touch).toBeUndefined();
  expect(set.pen).toBeUndefined();
});
