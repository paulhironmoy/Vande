/**
 * Haptics stay for the finger (owner's second brief, section 4; DoD CTR-06): in a real ball, with navigator.vibrate
 * recorded, a mouse player's contact makes no vibration call and a touch player's makes at least one, so the zero is
 * about the control and not about a build that never vibrates. The camera case (and the mastery confirmation) are in
 * tests/unit/practice/ui/controls/haptics-gate.test.ts, which drives the real sink for every control.
 */
import { expect, test, type Page } from '@playwright/test';
import { TOUCH_LAPTOP } from './controls-helpers';
import { openPractice, perfect, queue, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

const CFG = { tier: 'below' as const, timeScale: 1, seed: 'e2e-controls-haptics' };

async function vibrationsAfterContact(page: Page, control: 'mouse' | 'touch'): Promise<unknown[]> {
  await page.addInitScript(TOUCH_LAPTOP);
  await page.addInitScript(() => {
    const log: unknown[] = [];
    (window as unknown as { __vibrations: unknown[] }).__vibrations = log;
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (p: unknown) => (log.push(p), true) });
  });
  await openPractice(page, CFG, { settings: { control } });
  await page.getByTestId('practice-random').click();
  await queue(page, perfect(0, 0.6));
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['dead']);
  expect((await state(page)).last?.contact, 'the bat met the ball').not.toBe('none');
  await page.waitForTimeout(800);
  return page.evaluate(() => (window as unknown as { __vibrations: unknown[] }).__vibrations);
}

test("a mouse player's contact makes no vibration call", async ({ page }) => {
  test.setTimeout(150_000);
  expect(await vibrationsAfterContact(page, 'mouse')).toEqual([]);
});

test("a touch player's contact vibrates (so the zero above means something)", async ({ page }) => {
  test.setTimeout(150_000);
  expect((await vibrationsAfterContact(page, 'touch')).length).toBeGreaterThanOrEqual(1);
});
