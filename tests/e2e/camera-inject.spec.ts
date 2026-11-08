/**
 * Camera swings driven by LANDMARK TRACES instead of video (DoD section 15, item 1: "a way to inject a synthetic pose trace besides the
 * fake-device video path"). The rendered clips stay the camera e2e video (ruling R-39); this is the deterministic companion: the
 * moment a delivery is live, a recorded trace of a stroke (tests/fixtures/camera/traces) is played into the same path a worker result
 * takes, so the swing's class never depends on where a looping video happens to be.
 *
 * Needs `window.__vandeCamera.inject(frames)` (test builds; request SYNTH-VIDEO-4 to CAMERA): `frames` is a list of
 * `{ dtMs, landmarks }` (flat 33 x [x, y, z, visibility], or null for nobody) played from now on the page's clock. Until that hook
 * exists the specs say so and stand aside; they are written to the proposed signature and will follow CAMERA's if it differs
 * (S/chase/requests/CAMERA-to-SYNTH-VIDEO-2.md). A fake device (the `still` clip) only starts the session and gets the person ready.
 * Automated fixtures, not player results.
 */
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { attachState, cameraState, fakeCamera, needVideo, startCameraGame } from './camera-helpers';
import { state, waitFor } from './practice-helpers';

interface Trace {
  width: number;
  height: number;
  fps: number;
  indices: number[];
  frames: Array<{ t: number; lm: number[] | null }>;
}

const TRACES = path.resolve(process.cwd(), 'tests/fixtures/camera/traces');

/** A trace as inject() takes it, starting `fromS` seconds in (the stance before that is left out). */
function framesOf(file: string, fromS: number) {
  const trace = JSON.parse(readFileSync(path.join(TRACES, file), 'utf8')) as Trace;
  const step = 1000 / trace.fps;
  const frames = trace.frames
    .filter((f) => f.t >= fromS * 1000)
    .map((f) => {
      let landmarks: number[] | null = null;
      if (f.lm) {
        landmarks = new Array(33 * 4).fill(0);
        trace.indices.forEach((k, j) => {
          for (let c = 0; c < 4; c++) landmarks![k * 4 + c] = f.lm![j * 4 + c];
        });
      }
      return { dtMs: step, landmarks };
    });
  return { frames, width: trace.width, height: trace.height };
}

const CASES = [
  { file: 'rh_drive.ideal.trace.json', what: 'a drive goes to the off side', check: 'drive' },
  { file: 'rh_pull.ideal.trace.json', what: 'a pull goes to the leg side', check: 'pull' },
  { file: 'rh_defence.ideal.trace.json', what: 'a defence is a defensive push', check: 'defence' },
  { file: 'rh_leave.ideal.trace.json', what: 'a leave is no swing', check: 'leave' },
  {
    file: 'rh_drive.trace.json',
    what: "the pose engine's own landmarks of the drive give the off side too",
    check: 'drive',
  },
  {
    file: 'rh_pull.trace.json',
    what: "the pose engine's own landmarks of the pull give the leg side too",
    check: 'pull',
  },
] as const;

const injectable = (page: Page) =>
  page.evaluate(
    () => typeof (window as unknown as { __vandeCamera?: { inject?: unknown } }).__vandeCamera?.inject === 'function',
  );

test.use({ ...fakeCamera('still'), viewport: { width: 1366, height: 768 } });

test.describe('landmark traces played into a live delivery', () => {
  for (const c of CASES) {
    test(`${c.what} (${c.file})`, async ({ page }, info) => {
      test.setTimeout(240_000);
      needVideo('still');
      // Slow motion (timeScale 0.5) widens the live window so the injected stroke lands inside it; the class never depends on the timing.
      await startCameraGame(page, `e2e-camera-inject-${c.file}`, 'right', { timeScale: 0.5 });
      const has = await injectable(page);
      test.skip(!has, 'window.__vandeCamera.inject is not in this build yet (request SYNTH-VIDEO-4 to CAMERA)');
      const { frames, width, height } = framesOf(c.file, 0.8);
      await waitFor(page, ['live'], 120_000);
      await page.evaluate(
        ([f, w, h]) =>
          (
            window as unknown as {
              __vandeCamera: { inject(frames: unknown, opts: { width: number; height: number }): Promise<void> };
            }
          ).__vandeCamera.inject(f, { width: w, height: h }),
        [frames, width, height] as const,
      );
      await waitFor(page, ['dead', 'out', 'over_summary'], 120_000);
      const swing = (await cameraState(page))?.lastSwing ?? null;
      await attachState(page, info, `camera-state-inject-${c.file}.json`);
      const last = (await state(page)).last;
      switch (c.check) {
        case 'drive':
          expect(swing?.kind).toBe('attack');
          expect(swing!.directionDeg).toBeGreaterThan(3);
          break;
        case 'pull':
          expect(swing?.kind).toBe('attack');
          expect(swing!.directionDeg).toBeLessThan(-15);
          break;
        case 'defence':
          expect(swing?.kind).toBe('defend');
          break;
        case 'leave':
          expect(swing, 'a held backlift that comes back slowly makes no swing').toBeNull();
          expect(last?.swing ?? null).toBeNull();
          break;
      }
    });
  }
});
