/**
 * `public/_headers` sends `Permissions-Policy: camera=(self)` (DoD SYN-05, R-4): proved on a header-faithful static server, because
 * `vite preview` ignores `_headers`. With that header the camera works on the page's own origin; with the old `camera=()` the
 * browser itself refuses it (the negative control: the test can fail). Automated fixtures, not player results.
 */
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { headersFor, parseHeaders, startHeaderServer } from '../../scripts/camera-fixtures/serve-headers.mjs';
import { cameraState, driveCameraSetup, fakeCamera, needVideo, waitForCamera } from './camera-helpers';
import { configure, waitFor } from './practice-helpers';

const DIST = path.resolve(process.env.E2E_PRACTICE_DIST ?? 'dist-practice');
const CAMERA_CHOSEN = { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true };

test.use({ ...fakeCamera('still'), viewport: { width: 1366, height: 768 } });

const allowed = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const d = document as unknown as {
      permissionsPolicy?: { allowsFeature(f: string): boolean };
      featurePolicy?: { allowsFeature(f: string): boolean };
    };
    return (d.permissionsPolicy ?? d.featurePolicy)?.allowsFeature('camera') ?? null;
  });

test("the shipped header file allows the camera on the page's own origin, and only there", () => {
  const text = readFileSync(path.join(DIST, '_headers'), 'utf8');
  const policy = headersFor(parseHeaders(text), '/').get('permissions-policy')?.value ?? '';
  expect(policy).toMatch(/camera=\(self\)/);
  // The other powers stay closed.
  expect(policy).toMatch(/microphone=\(\)/);
});

test('with the production header the camera starts', async ({ page }) => {
  test.setTimeout(240_000);
  needVideo('still');
  const server = await startHeaderServer({ dir: DIST, port: 0 });
  try {
    await configure(page, { tier: 'below', seed: 'e2e-camera-header', autoNext: true }, { settings: CAMERA_CHOSEN });
    const res = await page.goto(server.origin + '/');
    expect(res?.headers()['permissions-policy']).toMatch(/camera=\(self\)/);
    expect(await allowed(page)).toBe(true);
    await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('practice-random').click();
    await page.getByTestId('practice-play-start').click();
    await waitFor(page, ['camera']);
    await driveCameraSetup(page, ['camera-ready-line', 'camera-guide-start']);
    await waitForCamera(page, (s) => s.status === 'running', 'the camera running under camera=(self)', 120_000);
  } finally {
    await server.close();
  }
});

test('negative control: with the old camera=() the browser refuses the camera', async ({ page }) => {
  test.setTimeout(240_000);
  needVideo('still');
  const server = await startHeaderServer({ dir: DIST, port: 0, overrides: ['Permissions-Policy: camera=()'] });
  try {
    await configure(
      page,
      { tier: 'below', seed: 'e2e-camera-header-old', autoNext: true },
      { settings: CAMERA_CHOSEN },
    );
    const res = await page.goto(server.origin + '/');
    expect(res?.headers()['permissions-policy']).toBe('camera=()');
    expect(await allowed(page)).toBe(false);
    await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
    await page.getByTestId('practice-random').click();
    await page.getByTestId('practice-play-start').click();
    await waitFor(page, ['camera']);
    await driveCameraSetup(page, ['camera-trouble']);
    expect((await cameraState(page))?.problem).toBe('blocked');
  } finally {
    await server.close();
  }
});
