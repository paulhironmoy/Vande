/**
 * Captions for the essential audio cues (docs/PERFORMANCE.md, "Accessibility verification"): with the Practice setting
 * on, the cues of a delivery (release, bounce, bat contact, the outcome's sound) appear as words in the status strip
 * area, never over the play; with it off, nothing is captioned.
 */
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, configure, perfect, queue, seen, waitFor } from './practice-helpers';
import { settings } from './a11y-helpers';

test.use({ viewport: { width: 915, height: 412 }, hasTouch: true, ...GPU_ARGS });

/** Every caption line shown during the session, in order (recorded in the page as they appear). */
async function recordCaptions(page: Page) {
  await page.addInitScript(() => {
    const lines: Array<{ text: string; top: number; bottom: number; inStrip: boolean }> = [];
    (window as unknown as { __captions: typeof lines }).__captions = lines;
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="practice-captions"]');
      const text = (el?.textContent ?? '').trim();
      if (!el || !text || lines.at(-1)?.text === text) return;
      const r = el.getBoundingClientRect();
      lines.push({ text, top: r.top, bottom: r.bottom, inStrip: Boolean(el.closest('[data-testid="practice-status"]')) });
    }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });
}

async function playOne(page: Page, captions: boolean) {
  await recordCaptions(page);
  await settings(page, {});
  await configure(page, { tier: 'below', seed: 'captions' });
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  // The real switch in Practice settings (src/audio keeps the setting under its own key).
  await page.getByTestId('practice-settings-open').click();
  const sw = page.getByTestId('practice-settings-captions');
  await expect(sw).toBeVisible({ timeout: 20_000 });
  const on = async () => (await sw.getAttribute('aria-checked')) === 'true' || (await sw.isChecked().catch(() => false));
  if ((await on()) !== captions) await sw.click();
  expect(await on(), 'the captions switch').toBe(captions);
  await page.goto('/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  await queue(page, perfect(0));
  await page.getByTestId('practice-quick').or(page.getByTestId('practice-random')).first().click();
  await expect(page.getByTestId('practice-play-start')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
  await waitFor(page, ['dead'], 120_000);
  await page.waitForTimeout(1500);
  return page.evaluate(() => (window as unknown as { __captions: Array<{ text: string; top: number; bottom: number; inStrip: boolean }> }).__captions);
}

test('[A11Y5] captions on: the delivery’s essential sounds are captioned in the status strip, never over the play', async ({ page }) => {
  test.setTimeout(240_000);
  const lines = await playOne(page, true);
  expect(lines.length, 'caption lines during one delivery').toBeGreaterThan(0);
  const vh = page.viewportSize()!.height;
  for (const l of lines) expect(l.inStrip || l.bottom <= vh * 0.2 || l.top >= vh * 0.8, `caption "${l.text}" sits in the strip, not over the play`).toBe(true);
});

test('[A11Y5] captions off: nothing is captioned', async ({ page }) => {
  test.setTimeout(240_000);
  const lines = await playOne(page, false);
  expect(lines).toEqual([]);
  expect(await seen(page, 'practice-captions')).toBeFalsy();
});
