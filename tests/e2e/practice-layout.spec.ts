/**
 * Layout: a notice never sits under a panel. With a panel open (pause, the field radar), the notice is shown inside it
 * and nothing in the HUD is half-covered; checked at a phone's landscape (915×412) and a large landscape screen
 * (2400×1080), in the two situations found on Android: the pause after an interrupted ball, and the radar after a
 * resumed leave.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, block, configure, queue, startRandom, toOverSummary, waitFor, whileInFlight } from './practice-helpers';

test.use({ ...GPU_ARGS });

const PANELS = ['practice-paused', 'practice-radar', 'practice-warmup-explain', 'practice-tap-gate', 'practice-coaching', 'practice-replay', 'practice-diagnostics-panel', 'practice-turn'];

/** Visible panels intersecting the HUD's notice (a notice inside a panel is that panel's own). */
async function noticeOverlaps(page: Page): Promise<string[]> {
  return page.evaluate((panels) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' ? r : null;
    };
    const hits: string[] = [];
    for (const n of Array.from(document.querySelectorAll('[data-testid="practice-notice"]'))) {
      const a = box(n);
      if (!a) continue;
      for (const id of panels) {
        for (const p of Array.from(document.querySelectorAll(`[data-testid="${id}"]`))) {
          if (p.contains(n)) continue;
          const b = box(p);
          if (b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) hits.push(id);
        }
      }
    }
    return hits;
  }, PANELS);
}

async function panelNoticeInside(page: Page, panel: string) {
  const inside = page.getByTestId(panel).getByTestId('practice-panel-notice');
  await expect(inside).toBeVisible();
  // Fully inside the panel's box.
  const [n, p] = await Promise.all([inside.boundingBox(), page.getByTestId(panel).boundingBox()]);
  expect(n && p && n.x >= p.x && n.y >= p.y && n.x + n.width <= p.x + p.width + 0.5 && n.y + n.height <= p.y + p.height + 0.5).toBe(true);
}

for (const viewport of [
  { width: 915, height: 412 },
  { width: 2400, height: 1080 },
]) {
  test(`${viewport.width}×${viewport.height}: the pause after an interrupted ball carries its notice`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await configure(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-replay' }, { guidedDone: true });
    await page.goto('/practice');
    await startRandom(page);
    await whileInFlight(page, 'background');
    await waitFor(page, ['paused']);
    await expect(page.getByTestId('practice-paused')).toBeVisible();
    expect(await noticeOverlaps(page)).toEqual([]);
    await panelNoticeInside(page, 'practice-paused');
    await expect(page.getByTestId('practice-panel-notice')).toHaveText('The app was interrupted during that delivery, so it counted as a leave.');
  });

  test(`${viewport.width}×${viewport.height}: the field radar after a resumed leave carries its notice`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    await configure(page, { tier: 'below', timeScale: 0.25, seed: 'e2e-replay' }, { guidedDone: true });
    await page.goto('/practice');
    await startRandom(page);
    await whileInFlight(page, 'reload');
    await page.getByTestId('practice-continue').click();
    await waitFor(page, ['radar']);
    expect(await noticeOverlaps(page)).toEqual([]);
    await panelNoticeInside(page, 'practice-radar');
    await expect(page.getByTestId('practice-panel-notice')).toHaveText('The ball in play when the app closed counted as a leave.');
  });
}

test('the over summary passes axe, and every control on it is at least 44 px', async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 915, height: 412 });
  await configure(page, { tier: 'below', timeScale: 8, seed: 'e2e-replay' }, { guidedDone: true });
  await page.goto('/practice');
  await queue(page, ...Array.from({ length: 6 }, () => block()));
  await startRandom(page);
  await toOverSummary(page);
  const axe = await new AxeBuilder({ page }).include('[data-testid="practice-over-summary"]').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="practice-over-summary"] button'))
      .map((b) => ({ name: (b.textContent ?? '').trim(), r: b.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && (r.width < 44 || r.height < 44))
      .map(({ name, r }) => `${name}: ${Math.round(r.width)}×${Math.round(r.height)}`),
  );
  expect(small).toEqual([]);
});
