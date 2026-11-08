/**
 * Touch batting, as far as a browser can show it (owner's second brief, section 4; DoD CTR-05, CTR-01 for Touch): a
 * touch-first device is asked with Touch selected; a stroke is never a scroll, a pull-to-refresh, a history swipe or a
 * long-press menu, and arrives even when it starts at the very edge of the screen; the interface keeps inside the safe
 * area when a notch or a gesture bar takes the corners; the timing check records a touch offset.
 *
 * NOT shown here (and so UNPROVEN until an Android emulator or phone runs it): the system Back swipe and the bottom
 * home swipe. Those are native; the exact spec and the emulator test are S/chase/requests/CONTROLS-3-to-ANDROID.md.
 * Builder checks only, on an emulated phone in headless Chromium.
 */
import { expect, test, type Page } from '@playwright/test';
import { words } from './controls-helpers';
import { GPU_ARGS, openPractice, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, ...GPU_ARGS });

const CFG = { tier: 'below' as const, timeScale: 0.5, seed: 'e2e-controls-touch' };
const surface = (page: Page) => page.locator('[role="application"]');

async function firstBallLive(page: Page, settings: Record<string, unknown> = { control: 'touch' }) {
  await page.addInitScript(() => {
    (window as unknown as { __cancelled: number }).__cancelled = 0;
    window.addEventListener(
      'pointercancel',
      () => ((window as unknown as { __cancelled: number }).__cancelled += 1),
      true,
    );
  });
  await openPractice(page, CFG, { settings });
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['live']);
  await expect(page.locator('[role="application"][data-armed="true"]')).toBeVisible();
  await page.waitForTimeout(80);
}

/** A touch stroke by CDP touch events: down, then each move 10 ms apart, then up. */
async function stroke(page: Page, points: Array<{ x: number; y: number }>) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [points[0]] });
  for (const p of points.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
    await page.waitForTimeout(10);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const line = (from: { x: number; y: number }, to: { x: number; y: number }, n: number) =>
  Array.from({ length: n + 1 }, (_, i) => ({
    x: from.x + ((to.x - from.x) * i) / n,
    y: from.y + ((to.y - from.y) * i) / n,
  }));

test('a touch-first device is asked with Touch selected, and the first ball keeps it', async ({ page }) => {
  await openPractice(page, CFG, { settings: { demoSeen: false } });
  await page.getByTestId('practice-random').click();
  const row = page.getByTestId('practice-control-row');
  await expect(row).toBeVisible();
  await expect(page.getByTestId('practice-control-row-touch')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('practice-control-row-mouse')).toHaveCount(0);
  await expect(row).toContainText(words('practice.controls.keyboard'));
  // Every target is at least 48 CSS px (the design system's control height).
  for (const id of ['practice-control-row-touch', 'practice-play-start']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.height, id).toBeGreaterThanOrEqual(47.5);
  }
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = JSON.parse(localStorage.getItem('vc:practice:settings') ?? 'null') as Record<
          string,
          unknown
        > | null;
        return [raw?.control ?? null, raw?.controlChosen ?? null];
      }),
    )
    .toEqual(['touch', true]);
});

test('a stroke is never a scroll, a refresh, a history swipe or a menu: the page is locked and nothing is cancelled', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  await expect(surface(page)).toHaveCSS('touch-action', 'none');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-x', 'none');
  await expect(page.locator('html')).toHaveCSS('overscroll-behavior-y', 'none');
  await expect(page.locator('body')).toHaveCSS('overscroll-behavior-y', 'none');
  const box = (await surface(page).boundingBox())!;
  const a = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.3 };
  const down = { x: a.x, y: a.y + 90 };
  // Pull back (down), then push forward (up): the vertical drag a browser would take for a scroll or a refresh.
  await stroke(page, [...line(a, down, 8), ...line(down, { x: a.x + 30, y: a.y - 50 }, 8)]);
  await waitFor(page, ['dead']);
  expect((await state(page)).last?.swing).toBe('attack');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __cancelled: number }).__cancelled)).toBe(0);
});

test('a stroke that starts at the very edge of the screen still arrives', async ({ page }) => {
  test.setTimeout(150_000);
  await firstBallLive(page);
  const box = (await surface(page).boundingBox())!;
  // The first and the last CSS pixel: where the system's Back swipe would begin on a phone.
  for (const x of [1, box.x + box.width - 2]) {
    const down = await page.evaluate(
      (px) => document.elementFromPoint(px, 340)?.closest('[role="application"]') !== null,
      x,
    );
    expect(down, `the surface reaches x=${x}`).toBe(true);
  }
  const a = { x: 2, y: box.y + box.height * 0.3 };
  await stroke(page, [...line(a, { x: 2, y: a.y + 90 }, 8), ...line({ x: 2, y: a.y + 90 }, { x: 40, y: a.y - 50 }, 8)]);
  await waitFor(page, ['dead']);
  expect((await state(page)).last?.swing).toBe('attack');
});

test('the interface keeps inside the safe area when a notch and a gesture bar take the corners', async ({ page }) => {
  test.setTimeout(150_000);
  const INSET = { left: 48, right: 48, top: 24, bottom: 24 };
  await page.addInitScript((i) => {
    document.addEventListener('DOMContentLoaded', () => {
      const root = document.documentElement.style;
      root.setProperty('--safe-left', `${i.left}px`);
      root.setProperty('--safe-right', `${i.right}px`);
      root.setProperty('--safe-top', `${i.top}px`);
      root.setProperty('--safe-bottom', `${i.bottom}px`);
    });
  }, INSET);
  await openPractice(page, CFG, { settings: { control: 'touch' } });
  const inside = async (id: string) => {
    const b = (await page.getByTestId(id).first().boundingBox())!;
    return { id, left: b.x, right: 915 - (b.x + b.width), top: b.y, bottom: 412 - (b.y + b.height) };
  };
  const home = await inside('practice-random');
  expect(home.left).toBeGreaterThanOrEqual(INSET.left);
  expect(home.right).toBeGreaterThanOrEqual(INSET.right);
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  const play = await inside('practice-play-start');
  expect(play.left).toBeGreaterThanOrEqual(INSET.left);
  expect(play.right).toBeGreaterThanOrEqual(INSET.right);
  expect(play.bottom).toBeGreaterThanOrEqual(INSET.bottom);
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['dead'], 120_000);
  const status = await inside('practice-status');
  expect(status.left).toBeGreaterThanOrEqual(INSET.left);
  expect(status.top).toBeGreaterThanOrEqual(INSET.top);
  const conditions = await inside('practice-conditions');
  expect(conditions.right).toBeGreaterThanOrEqual(INSET.right);
  expect(conditions.top).toBeGreaterThanOrEqual(INSET.top);
  const card = await inside('practice-result');
  expect(card.left).toBeGreaterThanOrEqual(INSET.left);
  expect(card.bottom).toBeGreaterThanOrEqual(INSET.bottom);
});

test('the timing check records a touch offset, and only a touch offset', async ({ page }) => {
  test.setTimeout(150_000);
  await openPractice(page, { ...CFG, timeScale: 1 }, { settings: { control: 'touch' } });
  await page.getByTestId('practice-settings-open').click();
  await page.getByTestId('practice-settings-calibrate').click();
  await page.getByTestId('practice-cal-start').click();
  const track = page.getByTestId('practice-cal-track');
  await expect(track).toBeEnabled({ timeout: 10_000 });
  for (let n = 0; n < 8; n++) {
    if (await page.getByTestId('practice-cal-result').count()) break;
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
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(450);
  }
  await expect(page.getByTestId('practice-cal-result')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('practice-cal-result')).toContainText('touch');
  const set = await page.evaluate(() => JSON.parse(localStorage.getItem('vc:practice:calibration') ?? 'null'));
  expect(set.touch.attempts).toBeGreaterThanOrEqual(3);
  expect(set.mouse).toBeUndefined();
});
