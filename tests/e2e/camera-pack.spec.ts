/**
 * The camera pack (the pose engine and model, about 9 MB) on a header-faithful static server (DoD SYN-05, CAM-14):
 *  - nothing of it is fetched until the player picks Camera;
 *  - on a throttled 4G profile it downloads with a visible progress, and the numbers are written to the test's attachments;
 *  - the second start (after a reload) fetches 0 bytes: it comes from the device's own storage.
 * The server is scripts/camera-fixtures/serve-headers.mjs on the build that the `practice` project built (E2E_PRACTICE_DIST), so the
 * headers are the ones public/_headers sends in production. Automated fixtures, not player results.
 */
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { startHeaderServer, type HeaderServer } from '../../scripts/camera-fixtures/serve-headers.mjs';
import { attachState, cameraState, driveCameraSetup, fakeCamera, needVideo, waitForCamera } from './camera-helpers';
import { configure, waitFor } from './practice-helpers';

const DIST = path.resolve(process.env.E2E_PRACTICE_DIST ?? 'dist-practice');
const CAMERA_CHOSEN = { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true };
/** The throttled profile: Lighthouse's mobile "slow 4G" preset. Quoted in the evidence. */
const PROFILE = { name: 'Slow 4G (Lighthouse mobile preset)', downKbit: 1638.4, upKbit: 750, rttMs: 150 };

test.use({ ...fakeCamera('still'), viewport: { width: 1366, height: 768 } });

let server: HeaderServer;
test.beforeAll(async () => {
  server = await startHeaderServer({ dir: DIST, port: 0 });
});
test.afterAll(async () => {
  await server.close();
});

const isPack = (url: string) => /\/models\/pose\//.test(url);

async function openHome(page: Page, control: 'camera' | 'mouse') {
  await configure(
    page,
    { tier: 'below', seed: 'e2e-camera-pack', autoNext: true },
    { settings: { ...CAMERA_CHOSEN, control, controlChosen: true } },
  );
  await page.goto(server.origin + '/');
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
}

async function startFirstBall(page: Page) {
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
}

test('nothing of the pack is fetched until the player picks Camera', async ({ page }) => {
  test.setTimeout(120_000);
  needVideo('still');
  const fetched: string[] = [];
  page.on('request', (r) => isPack(r.url()) && fetched.push(r.url()));
  await openHome(page, 'mouse');
  await startFirstBall(page);
  await waitFor(page, ['runup', 'live', 'playing', 'dead']);
  expect(fetched, 'no pack file was requested with the mouse in charge').toEqual([]);
});

test('the pack downloads on a throttled 4G profile with progress, and the second start costs no bytes', async ({
  page,
  context,
}, info) => {
  test.setTimeout(420_000);
  needVideo('still');
  const files: Array<{ url: string; bytes: number }> = [];
  let packRequests = 0;
  page.on('request', (r) => isPack(r.url()) && packRequests++);
  page.on('response', async (res) => {
    if (!isPack(res.url())) return;
    const body = await res.body().catch(() => null);
    files.push({ url: path.basename(new URL(res.url()).pathname), bytes: body?.length ?? 0 });
  });

  await openHome(page, 'camera');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: (PROFILE.downKbit * 1000) / 8,
    uploadThroughput: (PROFILE.upKbit * 1000) / 8,
    latency: PROFILE.rttMs,
  });
  await startFirstBall(page);
  await waitFor(page, ['camera']);
  // The consent; then the download shows its progress while the player gets in position.
  const t0 = Date.now();
  await driveCameraSetup(page, ['camera-download', 'camera-ready-line', 'camera-guide-start']);
  const seenPct = new Set<string>();
  while ((await cameraState(page))?.status !== 'running' && Date.now() - t0 < 360_000) {
    const pct = await page
      .getByTestId('camera-download-pct')
      .textContent({ timeout: 500 })
      .catch(() => null);
    if (pct) seenPct.add(pct);
    await page.waitForTimeout(500);
  }
  const firstMs = Date.now() - t0;
  await waitForCamera(page, (s) => s.status === 'running', 'running after the download', 60_000);
  const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
  expect(totalBytes, 'the pack is about 9 MB').toBeGreaterThan(5_000_000);
  expect(totalBytes).toBeLessThan(12_000_000);
  expect(seenPct.size, 'the progress was shown while it came').toBeGreaterThan(2);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    downloadThroughput: -1,
    uploadThroughput: -1,
    latency: 0,
  });

  // The second start: reload, choose again, start. The pack comes from the device, so no pack request is made.
  // The first start's numbers are kept whatever happens next.
  await info.attach('camera-pack-first-start.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      { profile: PROFILE, files, totalBytes, firstStartToRunningMs: firstMs, progressValuesSeen: [...seenPct] },
      null,
      1,
    ),
  });
  // The over in progress is resumable after a reload; the second start is of the CAMERA, so the over is cleared (the pack, in the
  // device's own storage, and the settings stay).
  await page.evaluate(() => {
    localStorage.removeItem('vc:practice:innings');
    localStorage.removeItem('vc:practice:draft');
  });
  const before = packRequests;
  await page.reload();
  await expect(page.getByTestId('practice-menu')).toBeVisible({ timeout: 45_000 });
  const t1 = Date.now();
  await startFirstBall(page);
  await waitFor(page, ['camera']);
  await driveCameraSetup(page, ['camera-ready-line', 'camera-guide-start']);
  await waitForCamera(page, (s) => s.status === 'running', 'running again from the stored pack', 90_000);
  const secondMs = Date.now() - t1;
  expect(packRequests - before, 'the second start fetched no pack file').toBe(0);
  const state = await cameraState(page);
  await info.attach('camera-pack-metrics.json', {
    contentType: 'application/json',
    body: JSON.stringify(
      {
        profile: PROFILE,
        files,
        totalBytes,
        firstStartToRunningMs: firstMs,
        secondStartToRunningMs: secondMs,
        secondStartPackRequests: packRequests - before,
        progressValuesSeen: [...seenPct],
        packId: state?.packId ?? null,
        delegate: state?.delegate ?? null,
      },
      null,
      1,
    ),
  });
  await attachState(page, info, 'camera-state-after-second-start.json');
});
