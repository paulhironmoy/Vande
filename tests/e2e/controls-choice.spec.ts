/**
 * "How do you want to bat?" (the owner's second brief, section 4; R-20; DoD CTR-01, CTR-02, CTR-07, CTR-09), in a real
 * browser against the hooks build.
 *
 * A device that has not answered meets one compact row on the setup screen (never a screen of its own), with the
 * platform default already selected, so Play alone keeps it. A tap answers at once. The answer is remembered per device.
 * It can be changed from Settings and, between balls, from the over's setup; never during a ball. A returning player (the
 * demonstration seen) never meets the row. A whole ball can be played from the keyboard alone, starting at Home.
 *
 * Builder checks only; they say nothing about whether a new player understands the row.
 */
import { networkInterfaces } from 'node:os';
import { expect, test } from '@playwright/test';
import { TOUCH_LAPTOP, stored, tabTo, words } from './controls-helpers';
import { delivered, openPractice, perfect, queue, state, waitFor, type PracticeTestConfig } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

const CFG: PracticeTestConfig = { tier: 'below', timeScale: 0.5, seed: 'e2e-controls-choice' };
/** A device that has never answered, with the teaching off so the first ball comes straight after Play. */
const FRESH = { settings: { demoSeen: false } };
test('a fresh device is asked on the setup screen, with the default selected, and Play keeps it', async ({ page }) => {
  await openPractice(page, CFG, FRESH);
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  const row = page.getByTestId('practice-control-row');
  await expect(row).toBeVisible();
  await expect(row).toContainText(words('practice.controls.title'));
  await expect(row).toContainText(words('practice.controls.keyboard'));
  await expect(row).toContainText(words('practice.controls.remembered'));
  // Mouse is the web's default; there is no Touch on a mouse-only desktop; the camera is never the selected one.
  await expect(page.getByTestId('practice-control-row-mouse')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('practice-control-row-touch')).toHaveCount(0);
  const camera = page.getByTestId('practice-control-row-camera');
  if (await camera.count()) await expect(camera).toHaveAttribute('aria-pressed', 'false');
  // Looking at the row stores nothing; Play (the first ball bowled) is the answer.
  expect(await stored(page)).toEqual({ control: null, controlChosen: null });
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
  await expect.poll(() => stored(page)).toEqual({ control: 'mouse', controlChosen: true });
});

test('a tap answers at once, and a reload remembers it (the row is gone)', async ({ page }) => {
  await openPractice(page, CFG, FRESH);
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-control-row-mouse').click();
  await expect(page.getByTestId('practice-control-row-status')).toHaveText(
    words('practice.controls.switched', { control: 'Mouse' }),
  );
  expect(await stored(page)).toEqual({ control: 'mouse', controlChosen: true });
  // The row stays for the rest of this visit to the setup (so a slip can be put right)...
  await expect(page.getByTestId('practice-control-row')).toBeVisible();
  // ...and a reload keeps the answer, so the next setup does not ask.
  await page.reload();
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  expect(await stored(page)).toEqual({ control: 'mouse', controlChosen: true });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await expect(page.getByTestId('practice-control-row')).toHaveCount(0);
});

test('a returning player (the demonstration seen) is never asked', async ({ page }) => {
  await openPractice(page, CFG);
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await expect(page.getByTestId('practice-control-row')).toHaveCount(0);
  expect(await stored(page)).toEqual({ control: null, controlChosen: null });
});

test('clearing the site data resets the answer: the row asks again', async ({ page }) => {
  await openPractice(page, CFG, FRESH);
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-control-row-mouse').click();
  await page.evaluate(() => localStorage.removeItem('vc:practice:settings'));
  await page.reload();
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('practice-random').click();
  await expect(page.getByTestId('practice-control-row')).toBeVisible();
  expect(await stored(page)).toEqual({ control: null, controlChosen: null });
});

test('Settings changes how you bat on a device with a finger and a mouse, and says so', async ({ page }) => {
  await page.addInitScript(TOUCH_LAPTOP);
  await openPractice(page, CFG, { settings: { control: 'mouse' } });
  await page.getByTestId('practice-settings-open').click();
  const group = page.getByTestId('practice-settings-control');
  await expect(group).toBeVisible();
  await expect(group).toHaveAttribute('role', 'radiogroup');
  await expect(page.getByTestId('practice-settings-control-mouse')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('practice-settings-control-touch').click();
  await expect(page.getByTestId('practice-settings-control-status')).toHaveText(
    words('practice.controls.switched', { control: 'Touch' }),
  );
  expect((await stored(page)).control).toBe('touch');
  await page.getByTestId('practice-settings-control-mouse').click();
  expect((await stored(page)).control).toBe('mouse');
  // The camera, where this build offers it, is never the one selected, and a pending pick is not a stored one.
  const camera = page.getByTestId('practice-settings-control-camera');
  if (await camera.count()) {
    await expect(camera).toHaveAttribute('aria-checked', 'false');
    await camera.click();
    expect((await stored(page)).control).toBe('mouse');
  }
});

test("between balls the over's setup changes it, and during a ball there is nothing to change", async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(TOUCH_LAPTOP);
  await openPractice(page, CFG, { settings: { control: 'mouse' } });
  await page.getByTestId('practice-random').click();
  await queue(page, { kind: 'defend', contactErrorMs: 0 });
  await page.getByTestId('practice-play-start').click();
  // While the ball is under way the rail is out of the picture: no setup, no chip.
  await waitFor(page, ['live']);
  await expect(page.getByTestId('practice-brief')).toHaveCount(0);
  await expect(page.getByTestId('practice-control-chip-toggle')).toHaveCount(0);
  await waitFor(page, ['dead']);
  // At the dead ball the conditions button opens the complete setup, with the quiet chip in it.
  await page.getByTestId('practice-conditions').click();
  const chip = page.getByTestId('practice-control-chip-toggle');
  await expect(chip).toContainText(words('practice.controls.chip', { control: 'Mouse' }));
  await chip.click();
  await page.getByTestId('practice-control-chip-group-touch').click();
  await expect(chip).toContainText(words('practice.controls.chip', { control: 'Touch' }));
  expect((await stored(page)).control).toBe('touch');
  await page.getByTestId('practice-brief-close').click();
  // Nothing about the next ball changed.
  expect((await delivered(page)).innings).toBe(1);
});

test('a whole ball can be played from the keyboard alone, starting at Home', async ({ page }) => {
  test.setTimeout(180_000);
  await openPractice(page, CFG, FRESH);
  await tabTo(page, 'practice-random');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  // The row: Tab to the default and press Space; its answer is read out politely.
  await tabTo(page, 'practice-control-row-mouse');
  await page.keyboard.press('Space');
  await expect(page.getByTestId('practice-control-row-status')).toHaveText(
    words('practice.controls.switched', { control: 'Mouse' }),
  );
  await tabTo(page, 'practice-play-start');
  await page.keyboard.press('Enter');
  await waitFor(page, ['live']);
  await expect(page.locator('[role="application"][data-armed="true"]')).toBeVisible();
  await page.waitForTimeout(100);
  await page.keyboard.press('Space');
  await waitFor(page, ['dead']);
  expect((await state(page)).last?.swing).toBe('defend');
  expect((await stored(page)).control).toBe('mouse');
});

test('the first ball is the same ball whatever was chosen: a perfect drive reads the same under both answers', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const result = async (control: 'mouse' | 'touch') => {
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await context.newPage();
    await page.addInitScript(TOUCH_LAPTOP);
    await openPractice(page, { ...CFG, seed: 'e2e-controls-same' }, { settings: { control } });
    await page.getByTestId('practice-random').click();
    await queue(page, perfect(0, 0.6));
    await page.getByTestId('practice-play-start').click();
    await waitFor(page, ['dead']);
    const out = { last: (await state(page)).last, runs: (await state(page)).runs };
    await context.close();
    return out;
  };
  const [mouse, touch] = [await result('mouse'), await result('touch')];
  expect(touch).toEqual(mouse);
});

test('a Chase setup asks the same row, once, with the same default', async ({ page }) => {
  test.setTimeout(150_000);
  await openPractice(page, { ...CFG, chaseSeed: 'c000' }, FRESH);
  await page.getByTestId('practice-chase').click();
  await expect(page.getByTestId('practice-setup')).toBeVisible();
  await expect(page.getByTestId('practice-control-row')).toBeVisible();
  await expect(page.getByTestId('practice-control-row-mouse')).toHaveAttribute('aria-pressed', 'true');
  expect(await stored(page)).toEqual({ control: null, controlChosen: null });
});

/** This Mac's address on the local network (not localhost): an insecure origin, as a phone on Wi-Fi would reach it. */
const LAN = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal)?.address;

test.describe('an insecure origin (a LAN address, as a phone on Wi-Fi would open it)', () => {
  test.skip(!LAN, 'this Mac has no address on a local network');
  test.use({ baseURL: `http://${LAN}:${process.env.E2E_PRACTICE_PORT ?? 4313}` });
  // The default practice project serves the build on localhost only, so this LAN address refuses the connection there.
  // The check needs the preview server bound to the LAN (decision CT-12; run this file through its runner, which does that):
  // when the address is not reachable the test is skipped with that reason instead of failing on the environment.
  test.beforeAll(async () => {
    const reachable = await fetch(`http://${LAN}:${process.env.E2E_PRACTICE_PORT ?? 4313}/`, {
      signal: AbortSignal.timeout(4000),
    }).then(
      () => true,
      () => false,
    );
    test.skip(
      !reachable,
      `the preview server is not reachable on ${LAN}: it is bound to localhost (see CT-12 and playwright.controls.config.ts)`,
    );
  });

  test('the camera is switched off with a plain reason, the mouse is still there, and the first ball is not blocked', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await openPractice(page, CFG, FRESH);
    expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
    expect(await page.evaluate(() => typeof navigator.mediaDevices?.getUserMedia)).toBe('undefined');
    await page.getByTestId('practice-random').click();
    const camera = page.getByTestId('practice-control-row-camera');
    await expect(camera).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('practice-control-row-note')).toHaveText(
      words('practice.controls.unavailable.secure'),
    );
    // Playwright treats aria-disabled as disabled and would wait for it to become enabled: a real press is simulated by force.
    await camera.click({ force: true });
    await expect(page.locator('[data-testid="practice-camera-setup-layer"]')).toHaveCount(0);
    await expect(page.getByTestId('practice-control-row-mouse')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('practice-play-start').click();
    await waitFor(page, ['runup', 'live', 'playing', 'dead']);
    expect((await stored(page)).control).toBe('mouse');
  });
});
