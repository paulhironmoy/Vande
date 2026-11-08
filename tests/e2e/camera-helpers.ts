/**
 * Shared by the camera-*.spec.ts files (DoD SYN-05). Not a spec: its name does not match the Playwright project.
 *
 * The fake camera is Chromium's own: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream
 * --use-file-for-fake-video-capture=<file>` plays one of the MJPEG files that scripts/camera-fixtures/generate.mjs renders from the
 * owner-made character (tests/fixtures/camera/manifest.json). The file is a LAUNCH flag, so each clip needs its own browser: use
 * `test.use(fakeCamera('rh_drive'))` at the TOP of a spec file (Playwright refuses `launchOptions` inside a describe block). The file repeats for ever and restarts at frame 0
 * each time the camera is opened, so a spec never relies on WHEN in a delivery the stroke happens: it bats several deliveries
 * and checks the first swing the camera produced (`window.__vandeCamera.lastSwing`).
 *
 * Never opens a real camera: a spec without a fake device (denied, no camera, busy) replaces `getUserMedia` or the permission
 * before any page script runs.
 */
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { openPractice, waitFor, type PracticeTestConfig } from './practice-helpers';

export const FIXTURES = process.env.CAMERA_FIXTURES_DIR ?? path.join(process.cwd(), 'test-results-camera-fixtures');
export const videoFile = (clip: string) => path.join(FIXTURES, 'videos', `${clip}.mjpeg`);

export const hasVideo = (clip: string) => existsSync(videoFile(clip));

/**
 * Call first in a test that plays `clip`. A missing file on a developer machine is a failure that says how to make it. In CI the
 * videos do not exist (they need Blender and MPFB, which a runner does not have), so the test says so and stands aside; that
 * can never hide a local failure, because locally the same call throws.
 */
export function needVideo(clip: string): string {
  const file = videoFile(clip);
  if (existsSync(file)) return file;
  if (process.env.CI) test.skip(true, `camera fixtures are rendered locally and are not in CI (${clip}.mjpeg)`);
  throw new Error(
    `camera fixture missing: ${file}\nGenerate it (needs Blender and ffmpeg): node scripts/camera-fixtures/generate.mjs all` +
      `\nor point CAMERA_FIXTURES_DIR at a folder that has videos/${clip}.mjpeg`,
  );
}

/** Chromium launch options and context permission for a fake camera playing `clip`. Use with `test.use(...)`. */
export function fakeCamera(clip: string) {
  return {
    launchOptions: {
      args: [
        '--use-fake-device-for-media-stream',
        '--use-fake-ui-for-media-stream',
        `--use-file-for-fake-video-capture=${videoFile(clip)}`,
      ],
    },
    permissions: ['camera' as const],
  };
}

/** What the camera pipeline publishes in test builds (src/input/camera/session.ts, `window.__vandeCamera`). */
export interface CameraHooks {
  status: 'idle' | 'opening' | 'loading_pack' | 'starting' | 'running' | 'lost' | 'error';
  problem: string | null;
  readiness: Record<string, boolean | number | string>;
  frames: Record<string, number>;
  delegate: string | null;
  inferenceMs: number | null;
  lastSwing: null | {
    kind?: string;
    directionDeg?: number;
    power?: number;
    elevation?: number;
    startT?: number;
    [k: string]: unknown;
  };
  packId: string | null;
}

export async function cameraState(page: Page): Promise<CameraHooks | null> {
  return page.evaluate(() => {
    const h = (window as unknown as { __vandeCamera?: Record<string, unknown> }).__vandeCamera;
    return h ? (JSON.parse(JSON.stringify(h)) as never) : null;
  });
}

/** Polls the camera hooks (the page may be busy rendering; every call is a short evaluate) until `ok` holds. */
export async function waitForCamera(
  page: Page,
  ok: (s: CameraHooks) => boolean,
  what: string,
  timeoutMs = 60_000,
): Promise<CameraHooks> {
  const t0 = Date.now();
  let last: CameraHooks | null = null;
  while (Date.now() - t0 < timeoutMs) {
    last = await cameraState(page);
    if (last && ok(last)) return last;
    await page.waitForTimeout(150);
  }
  throw new Error(`camera never reached: ${what}\nlast state: ${JSON.stringify(last)}`);
}

/**
 * Walks the camera screens until a stop condition holds: taps the primary button of whichever step is on screen (the consent,
 * the card's start, the guide's "Start batting"). Returns the id of the step it stopped at.
 */
export async function driveCameraSetup(
  page: Page,
  stopAt: string[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const t0 = Date.now();
  const steps: Array<[string, string | null]> = [
    ['camera-trouble', null],
    ['camera-lost-banner', null],
    ['camera-consent-allow', 'camera-consent-allow'],
    ['camera-start-button', 'camera-start-button'],
    ['camera-guide-start', 'camera-guide-start'],
  ];
  while (Date.now() - t0 < (opts.timeoutMs ?? 60_000)) {
    for (const id of stopAt)
      if (
        await page
          .getByTestId(id)
          .first()
          .isVisible()
          .catch(() => false)
      )
        return id;
    // A card that goes away quickly (the ball starts at once) must not be missed: the session itself says it is under way.
    const under = await cameraState(page);
    if (under && ['running', 'lost', 'error'].includes(under.status)) return 'camera-running';
    for (const [id, click] of steps) {
      if (stopAt.includes(id) || !click) continue;
      const el = page.getByTestId(click).first();
      if (await el.isVisible().catch(() => false)) {
        await el.click().catch(() => undefined);
        break;
      }
    }
    await page.waitForTimeout(150);
  }
  throw new Error(`the camera screens never reached ${stopAt.join(' or ')}`);
}

/** Replaces `getUserMedia` before any page script runs, so no real camera is ever opened. */
export async function failCamera(page: Page, error: { name: string; message: string }) {
  await page.addInitScript((e) => {
    const md = navigator.mediaDevices;
    if (!md) return;
    md.getUserMedia = () => Promise.reject(new DOMException(e.message, e.name));
    md.enumerateDevices = () => Promise.resolve([]);
  }, error);
}

/** The evidence a camera spec attaches: what the hooks said (a JSON file in the test's results, nothing from the picture). */
export async function attachState(page: Page, info: TestInfo, name: string) {
  const s = await cameraState(page);
  await info.attach(name, { body: JSON.stringify(s, null, 1), contentType: 'application/json' });
  expect(s === null || typeof s === 'object').toBe(true);
}

/** The guide (a fresh device) has its own "Start batting"; the card before a ball (a device that chose Camera earlier) starts the ball by itself. */
async function startIfGuide(page: Page) {
  const start = page.getByTestId('camera-guide-start');
  if (await start.isVisible()) await start.click();
}

/**
 * A device that already chose Camera: Practice home, a Random Over, the camera's card, the camera started and a steady person in
 * the picture. Afterwards the first ball is under way (or about to be); the flow starts it by itself.
 */
export async function startCameraGame(
  page: Page,
  seed: string,
  hand: 'right' | 'left' = 'right',
  config: Partial<PracticeTestConfig> = {},
) {
  await openPractice(
    page,
    { tier: 'below', seed, autoNext: true, ...config },
    { settings: { v: 1, teach: false, demoSeen: true, control: 'camera', controlChosen: true, handedness: hand } },
  );
  await page.getByTestId('practice-random').click();
  await page.getByTestId('practice-play-start').click();
  await waitFor(page, ['camera']);
  await driveCameraSetup(page, ['camera-ready-line', 'camera-guide-start']);
  await waitForCamera(
    page,
    (s) => s.status === 'running' && s.readiness.ready === true,
    'running with a person in frame',
    120_000,
  );
  await startIfGuide(page);
}
