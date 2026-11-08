/**
 * The camera cannot start, three ways (DoD SYN-05): the browser says no (permission denied), there is no camera, another app has
 * it (`NotReadableError`). In each the player meets the matching help panel, and ONE tap on "Bat with mouse" puts the mouse in
 * charge and the game goes on. No video is needed and no real camera is ever opened: each error is injected into `getUserMedia`
 * before any page script runs (the camera's own mapping of the three errors is what is under test).
 */
import { expect, test, type Page } from '@playwright/test';
import { cameraState, failCamera } from './camera-helpers';
import { openPractice, play, state, waitFor } from './practice-helpers';

test.use({ viewport: { width: 1366, height: 768 } });

const CAMERA_CHOSEN = { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true };

/** Camera is the control on this device; start the first ball; walk the screens to the first help panel. */
async function startAndMeetHelp(page: Page): Promise<string> {
  await openPractice(page, { tier: 'below', timeScale: 0.5, seed: 'e2e-camera' }, { settings: CAMERA_CHOSEN });
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['camera']);
  // The consent first (its one primary button), then the system's answer decides what the player meets.
  const consent = page.getByTestId('camera-consent-allow');
  const start = page.getByTestId('camera-start-button');
  await expect(consent.or(start)).toBeVisible({ timeout: 30_000 });
  await ((await consent.isVisible()) ? consent : start).click();
  const help = page.getByTestId('camera-trouble');
  await expect(help).toBeVisible({ timeout: 30_000 });
  return (await help.getAttribute('data-case')) ?? '';
}

async function oneTapToMouse(page: Page) {
  await page.getByTestId('camera-trouble-fallback').click();
  // The camera screens go, the ball is bowled with the mouse in charge, and the game never stalled.
  await expect(page.getByTestId('camera-trouble')).toHaveCount(0);
  await waitFor(page, ['runup', 'live', 'playing', 'dead'], 60_000);
  expect((await state(page)).error).toBeNull();
  const control = await page.evaluate(
    () => (JSON.parse(localStorage.getItem('vc:practice:settings') ?? 'null') as { control?: string } | null)?.control,
  );
  expect(control, 'one tap on "Bat with mouse" makes the mouse the control on this device').toBe('mouse');
  await expect(play(page)).toBeVisible();
}

test('permission denied by the browser: the blocked help, then one tap to the mouse', async ({ page }) => {
  test.setTimeout(150_000);
  // The browser's "no" is a NotAllowedError from getUserMedia, injected before any page script runs. (A headless browser started with a
  // fake device and \`--deny-permission-prompts\` answers with an error the camera cannot name and shows "not available here" instead:
  // found by the first runs, 10:34Z and 10:59Z. The mapping of a real NotAllowedError is CAMERA's unit-tested part.)
  await failCamera(page, { name: 'NotAllowedError', message: 'Permission denied' });
  expect(await startAndMeetHelp(page)).toBe('blocked');
  expect((await cameraState(page))?.problem).toBe('blocked');
  await oneTapToMouse(page);
});

test('no camera at all: the "no camera" help, then one tap to the mouse', async ({ page }) => {
  test.setTimeout(150_000);
  await failCamera(page, { name: 'NotFoundError', message: 'Requested device not found' });
  expect(await startAndMeetHelp(page)).toBe('none');
  expect((await cameraState(page))?.problem).toBe('none');
  await oneTapToMouse(page);
});

test('another app is using the camera: the busy help, then one tap to the mouse', async ({ page }) => {
  test.setTimeout(150_000);
  await failCamera(page, { name: 'NotReadableError', message: 'Could not start video source' });
  expect(await startAndMeetHelp(page)).toBe('busy');
  expect((await cameraState(page))?.problem).toBe('busy');
  await oneTapToMouse(page);
});
