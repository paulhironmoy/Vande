/**
 * UNDERSTAND and MASTER with the real coach: the dead ball's compact results layer (the outcome, what the game read,
 * one reason, one recommendation), its disclosures (Why?, Alternative shots), and exact-ball Coach Mode: one tap
 * replays the identical ball, the attempt is compared with the previous one in plain words, and the innings is never
 * touched.
 */
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { GPU_ARGS, block, openPractice, queue, startRandom, state, waitFor } from './practice-helpers';
import { loseContext, record } from './perf-helpers';

test.use({ viewport: { width: 1366, height: 768 }, ...GPU_ARGS });
// This file's first-person Coach journeys deliberately exercise software WebGL
// readback, interruption and context restoration. Running two of those GPU-heavy
// cases concurrently starves Chromium's SwiftShader main threads on the shared
// test host. Keep the cases independent, but order this file even when the
// project enables fullyParallel; the second worker remains free for other files.
test.describe.configure({ mode: 'default' });

const STAGE_PROBE = fileURLToPath(new URL('../../scripts/eval/lib/probe-stage.js', import.meta.url));
type GlCounts = { links: number; compiles: number; contexts: number; liveContexts: number };
type CloseUpCapture = {
  error: string | null;
  png: string | null;
  restored: boolean;
  utc: string | null;
  performanceMs: number | null;
  mode: string | null;
  sceneMs: number | null;
  phase: string | null;
  stage: string | null;
  sourceFlightSeed: string | null;
  scriptFlightSeed: string | null;
  camera: { fov: number; aspect: number; position: number[]; quaternion: number[] } | null;
  ball: {
    visible: boolean;
    depth: number;
    diameterCss: number;
    centerCss: { x: number; y: number };
    boundsCss: { sphere: { left: number; right: number; top: number; bottom: number }; surround: { left: number; right: number; top: number; bottom: number }; union: { left: number; right: number; top: number; bottom: number } };
    viewportContained: boolean;
    matrix: number[];
  } | null;
  canvas: { backingWidth: number; backingHeight: number; cssWidth: number; cssHeight: number } | null;
};
const observedRuntimeErrors = new WeakMap<Page, { label: string; errors: string[] }>();

async function glCounts(page: Page): Promise<GlCounts> {
  return page.evaluate(() => {
    const gl = (window as unknown as { __perf: { gl: { links: unknown[]; compiles: unknown[]; contexts: Array<{ lost: boolean; ref: WeakRef<HTMLCanvasElement> }> } } }).__perf.gl;
    return {
      links: gl.links.length,
      compiles: gl.compiles.length,
      contexts: gl.contexts.length,
      liveContexts: gl.contexts.filter((context) => !context.lost && Boolean(context.ref.deref()?.isConnected)).length,
    };
  });
}

function runtimeErrors(page: Page, label: string): string[] {
  const errors: string[] = [];
  observedRuntimeErrors.set(page, { label, errors });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('crash', () => errors.push('page crash'));
  return errors;
}

test.afterEach(async ({ page }) => {
  const observation = observedRuntimeErrors.get(page);
  if (!observation) return;
  try {
    await page.context().close();
  } catch (error) {
    observation.errors.push(`cleanup: ${String(error)}`);
  }
  expect.soft(observation.errors, `${observation.label}: runtime or cleanup error`).toEqual([]);
});

function expectNoNewShaders(before: GlCounts, after: GlCounts, label: string) {
  expect(after.links, `${label}: linked a program after active-profile warm-up`).toBe(before.links);
  expect(after.compiles, `${label}: compiled a shader after active-profile warm-up`).toBe(before.compiles);
  expect(after.liveContexts, `${label}: lost the live WebGL context`).toBe(before.liveContexts);
}

/**
 * Copies the actual WebGL backing canvas immediately after the original stage draws one real close-up frame. This is
 * canvas-only evidence, not a DOM-composited screenshot and not timing evidence: readback itself can be expensive.
 */
async function arm3dCloseUpCapture(page: Page) {
  await page.evaluate(() => {
    type Frame = { mode?: string; scene?: number; closeUpFlight?: { seed?: string } | null; script?: { practice?: { flight?: { seed?: string } | null } } };
    type SceneObject = {
      visible: boolean;
      matrixWorld: { elements: number[] };
      geometry?: { parameters?: { radius?: number }; attributes?: { position?: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
      getObjectByName(name: string): SceneObject | undefined;
    };
    type Stage = {
      drawFrame: (...args: unknown[]) => unknown;
      stage?: {
        camera?: { fov: number; aspect: number; position: { toArray(): number[] }; quaternion: { toArray(): number[] }; matrixWorldInverse: { elements: number[] }; projectionMatrix: { elements: number[] } };
        ballFx?: { group: SceneObject };
      };
    };
    const w = window as unknown as {
      __eval?: { stage(): Stage | null };
      __vandePractice?: { state(): { phase: string; stage: string } };
      __coachCloseUpCapture?: Promise<CloseUpCapture>;
    };
    const stage = w.__eval?.stage();
    const canvas = document.querySelector('[data-testid="practice-canvas"]') as HTMLCanvasElement | null;
    if (!stage || stage.stage?.camera === undefined || !canvas) throw new Error('actual 3D stage unavailable for close-up capture');
    const own = Object.getOwnPropertyDescriptor(stage, 'drawFrame');
    const original = stage.drawFrame;
    let settled = false;
    let resolveCapture: (capture: CloseUpCapture) => void = () => undefined;
    const restore = () => {
      if (own) Object.defineProperty(stage, 'drawFrame', own);
      else delete (stage as unknown as { drawFrame?: Stage['drawFrame'] }).drawFrame;
      return stage.drawFrame === original;
    };
    const finish = (capture: Omit<CloseUpCapture, 'restored'>) => {
      if (settled) return;
      settled = true;
      resolveCapture({ ...capture, restored: restore() });
    };
    w.__coachCloseUpCapture = new Promise<CloseUpCapture>((resolve) => {
      resolveCapture = resolve;
      window.setTimeout(() => finish({
        error: 'no qualifying close-up frame was drawn before timeout', png: null, utc: null, performanceMs: null,
        mode: null, sceneMs: null, phase: null, stage: null, sourceFlightSeed: null, scriptFlightSeed: null,
        camera: null, ball: null, canvas: null,
      }), 30_000);
    });
    stage.drawFrame = function (this: unknown, ...args: unknown[]) {
      const frame = args[0] as Frame | undefined;
      let value: unknown;
      try {
        value = Reflect.apply(original, this, args);
      } catch (error) {
        finish({
          error: `original close-up draw failed: ${String(error)}`, png: null, utc: new Date().toISOString(), performanceMs: performance.now(),
          mode: frame?.mode ?? null, sceneMs: frame?.scene ?? null, phase: w.__vandePractice?.state().phase ?? null,
          stage: w.__vandePractice?.state().stage ?? null, sourceFlightSeed: frame?.closeUpFlight?.seed ?? null,
          scriptFlightSeed: frame?.script?.practice?.flight?.seed ?? null, camera: null, ball: null, canvas: null,
        });
        throw error;
      }
      if (settled || frame?.mode !== 'closeup' || !frame.closeUpFlight) return value;
      try {
        const scene = stage.stage!;
        const camera = scene.camera!;
        const ballGroup = scene.ballFx?.group;
        const ball = ballGroup?.getObjectByName('cricket-ball');
        const sphere = ball?.getObjectByName('ball-polished-half');
        const surround = ballGroup?.getObjectByName('practice-ball-surround');
        const radius = sphere?.geometry?.parameters?.radius;
        const surroundPosition = surround?.geometry?.attributes?.position;
        if (!ballGroup || !ball || !sphere || !surround || !surroundPosition || !Number.isFinite(radius)) throw new Error('actual close-up ball/surround geometry unavailable');
        const bitmap = document.createElement('canvas');
        bitmap.width = canvas.width;
        bitmap.height = canvas.height;
        const context = bitmap.getContext('2d');
        if (!context) throw new Error('2D capture canvas unavailable');
        context.drawImage(canvas, 0, 0);
        const rect = canvas.getBoundingClientRect();
        const matrix = [...ball.matrixWorld.elements];
        const sphereMatrix = sphere.matrixWorld.elements;
        const inverse = camera.matrixWorldInverse.elements;
        const transform = (m: number[], x: number, y: number, z: number) => ({
          x: m[0] * x + m[4] * y + m[8] * z + m[12],
          y: m[1] * x + m[5] * y + m[9] * z + m[13],
          z: m[2] * x + m[6] * y + m[10] * z + m[14],
        });
        const centreWorld = { x: matrix[12], y: matrix[13], z: matrix[14] };
        const centreView = transform(inverse, centreWorld.x, centreWorld.y, centreWorld.z);
        const vx = centreView.x, vy = centreView.y, vz = centreView.z;
        const depth = -vz;
        const worldRadius = radius! * Math.max(
          Math.hypot(sphereMatrix[0], sphereMatrix[1], sphereMatrix[2]),
          Math.hypot(sphereMatrix[4], sphereMatrix[5], sphereMatrix[6]),
          Math.hypot(sphereMatrix[8], sphereMatrix[9], sphereMatrix[10]),
        );
        if (!(depth > worldRadius && depth * depth > worldRadius * worldRadius)) throw new Error('actual close-up sphere intersects the camera');
        const projection = camera.projectionMatrix.elements;
        const clipX = projection[0] * vx + projection[4] * vy + projection[8] * vz + projection[12];
        const clipY = projection[1] * vx + projection[5] * vy + projection[9] * vz + projection[13];
        const clipW = projection[3] * vx + projection[7] * vy + projection[11] * vz + projection[15];
        const centerCss = { x: ((clipX / clipW + 1) / 2) * rect.width, y: ((1 - clipY / clipW) / 2) * rect.height };
        const tangent = (c: number) => {
          const root = Math.sqrt(c * c + depth * depth - worldRadius * worldRadius);
          const denominator = depth * depth - worldRadius * worldRadius;
          return [(c * depth - worldRadius * root) / denominator, (c * depth + worldRadius * root) / denominator] as const;
        };
        const [sx0, sx1] = tangent(vx);
        const [sy0, sy1] = tangent(vy);
        const sphereBounds = {
          left: ((projection[0] * sx0 - projection[8] + 1) / 2) * rect.width,
          right: ((projection[0] * sx1 - projection[8] + 1) / 2) * rect.width,
          top: ((1 - (projection[5] * sy1 - projection[9])) / 2) * rect.height,
          bottom: ((1 - (projection[5] * sy0 - projection[9])) / 2) * rect.height,
        };
        const surroundBounds = { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, top: Number.POSITIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY };
        const surroundMatrix = surround.matrixWorld.elements;
        for (let i = 0; i < surroundPosition.count; i++) {
          const world = transform(surroundMatrix, surroundPosition.getX(i), surroundPosition.getY(i), surroundPosition.getZ(i));
          const view = transform(inverse, world.x, world.y, world.z);
          const cx = projection[0] * view.x + projection[4] * view.y + projection[8] * view.z + projection[12];
          const cy = projection[1] * view.x + projection[5] * view.y + projection[9] * view.z + projection[13];
          const cw = projection[3] * view.x + projection[7] * view.y + projection[11] * view.z + projection[15];
          if (!(cw > 0)) throw new Error('actual close-up surround crosses the camera plane');
          const x = ((cx / cw + 1) / 2) * rect.width;
          const y = ((1 - cy / cw) / 2) * rect.height;
          surroundBounds.left = Math.min(surroundBounds.left, x);
          surroundBounds.right = Math.max(surroundBounds.right, x);
          surroundBounds.top = Math.min(surroundBounds.top, y);
          surroundBounds.bottom = Math.max(surroundBounds.bottom, y);
        }
        const union = {
          left: Math.min(sphereBounds.left, surroundBounds.left), right: Math.max(sphereBounds.right, surroundBounds.right),
          top: Math.min(sphereBounds.top, surroundBounds.top), bottom: Math.max(sphereBounds.bottom, surroundBounds.bottom),
        };
        const diameterCss = Math.max(sphereBounds.right - sphereBounds.left, sphereBounds.bottom - sphereBounds.top);
        const viewportContained = union.left >= 0 && union.right <= rect.width && union.top >= 0 && union.bottom <= rect.height;
        const current = w.__vandePractice?.state();
        finish({
          error: null,
          png: bitmap.toDataURL('image/png'),
          utc: new Date().toISOString(),
          performanceMs: performance.now(),
          mode: frame.mode,
          sceneMs: frame.scene ?? null,
          phase: current?.phase ?? null,
          stage: current?.stage ?? null,
          sourceFlightSeed: frame.closeUpFlight.seed ?? null,
          scriptFlightSeed: frame.script?.practice?.flight?.seed ?? null,
          camera: { fov: camera.fov, aspect: camera.aspect, position: camera.position.toArray(), quaternion: camera.quaternion.toArray() },
          ball: { visible: ballGroup.visible && ball.visible, depth, diameterCss, centerCss, boundsCss: { sphere: sphereBounds, surround: surroundBounds, union }, viewportContained, matrix },
          canvas: { backingWidth: canvas.width, backingHeight: canvas.height, cssWidth: rect.width, cssHeight: rect.height },
        });
      } catch (error) {
        finish({
          error: String(error), png: null, utc: new Date().toISOString(), performanceMs: performance.now(),
          mode: frame.mode ?? null, sceneMs: frame.scene ?? null, phase: w.__vandePractice?.state().phase ?? null,
          stage: w.__vandePractice?.state().stage ?? null, sourceFlightSeed: frame.closeUpFlight.seed ?? null,
          scriptFlightSeed: frame.script?.practice?.flight?.seed ?? null, camera: null, ball: null, canvas: null,
        });
      }
      return value;
    };
  });
}

async function closeUpCapture(page: Page): Promise<CloseUpCapture> {
  return page.evaluate(() => (window as unknown as { __coachCloseUpCapture: Promise<CloseUpCapture> }).__coachCloseUpCapture);
}

async function armEscapePhaseObservation(page: Page) {
  await page.evaluate(() => {
    type Observation = { phase: string | null; stage: string | null; performanceMs: number | null };
    const w = window as unknown as {
      __vandePractice?: { state(): { phase: string; stage: string } };
      __coachEscapeObservation?: Observation;
    };
    w.__coachEscapeObservation = { phase: null, stage: null, performanceMs: null };
    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const current = w.__vandePractice?.state();
      w.__coachEscapeObservation = {
        phase: current?.phase ?? null,
        stage: current?.stage ?? null,
        performanceMs: performance.now(),
      };
    }, { capture: true, once: true });
  });
}

async function escapePhaseObservation(page: Page) {
  return page.evaluate(() => (window as unknown as {
    __coachEscapeObservation?: { phase: string | null; stage: string | null; performanceMs: number | null };
  }).__coachEscapeObservation ?? null);
}

test('the dead ball explains itself, and "Practice this ball" replays the exact ball at once', async ({ page }) => {
  test.setTimeout(180_000);
  await openPractice(page, { tier: 'below', timeScale: 4, seed: 'e2e-coach' });
  await queue(page, { kind: 'attack', contactErrorMs: 60, directionDeg: 20, power: 0.6 });
  await startRandom(page);
  await waitFor(page, ['dead']);
  const result = page.getByTestId('practice-result');
  await expect(result).toBeVisible();
  await expect(page.getByTestId('practice-result-read')).toContainText('You played:');
  await expect(page.getByTestId('practice-result-recommendation')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('practice-result-reason')).not.toHaveText('');
  // The full explanation and the alternatives only when asked.
  await expect(page.getByTestId('practice-why')).toHaveCount(0);
  await page.getByTestId('practice-why-toggle').click();
  await expect(page.getByTestId('practice-why')).toContainText('What the ball did');
  await page.getByTestId('practice-alternatives-toggle').click();
  await expect(page.getByTestId('practice-alternatives')).toContainText('Recommended');
  const before = await state(page);
  await queue(page, block());
  await page.getByTestId('practice-practice-ball').click();
  await page.waitForFunction(() => ((window as unknown as { __vandePractice: { state(): { coach: { attempts: number } | null } } }).__vandePractice.state().coach?.attempts ?? 0) >= 1, undefined, { timeout: 60_000 });
  await expect(page.getByTestId('practice-coach')).toBeVisible();
  await expect(page.getByTestId('practice-compare')).toBeVisible();
  await expect(page.getByTestId('practice-mastery')).toHaveAttribute('data-stage', /[1-4]/);
  const after = await state(page);
  expect(after.balls).toBe(before.balls);
  expect(after.runs).toBe(before.runs);
  await page.getByTestId('practice-coach-back').click();
  await expect(page.getByTestId('practice-result')).toBeVisible();
});

const PRESENTATIONS = [
  { name: 'first-person 3D', tier: 'full' as const, quality: 'standard', stage: '3d' as const },
  { name: 'Classic', tier: 'below' as const, quality: 'classic', stage: '2d' as const },
];

for (const mode of PRESENTATIONS) {
  test(`${mode.name}: visible Coach demonstration and ball close-up preserve the exact innings and restore after interruption`, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    runtimeErrors(page, `${mode.stage} presentation`);
    if (mode.stage === '3d') {
      await record(page);
      await page.addInitScript({ path: STAGE_PROBE });
    }
    await openPractice(page, { tier: mode.tier, seed: `e2e-presentation-${mode.stage}` }, { settings: { quality: mode.quality } });
    await queue(page, { kind: 'attack', contactErrorMs: 60, directionDeg: 20, power: 0.6 });
    await startRandom(page);
    await waitFor(page, ['dead'], 120_000);
    await expect(page.getByTestId('practice-result')).toBeVisible();
    expect((await state(page)).stage).toBe(mode.stage);

    const before = await state(page);
    const saved = await page.evaluate(() => localStorage.getItem('vc:practice:innings'));
    expect(saved, 'the exact source delivery is durably present before presentation').not.toBeNull();
    const sourceDeliverySeed = await page.evaluate(() => {
      const innings = JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null')?.state;
      const records = [...(innings?.overs ?? []).flatMap((over: { deliveries?: Array<{ seed?: unknown }> }) => over.deliveries ?? []), ...(innings?.current?.deliveries ?? [])];
      const seed = records.at(-1)?.seed;
      return typeof seed === 'string' && seed.length > 0 ? seed : null;
    });
    expect(sourceDeliverySeed, 'the persisted source delivery has a nonempty replay seed').not.toBeNull();
    const warmed = mode.stage === '3d' ? await glCounts(page) : null;
    if (warmed) {
      expect(warmed.links, 'the mounted active profile linked real WebGL programs').toBeGreaterThan(0);
      expect(warmed.compiles, 'the mounted active profile compiled real WebGL shaders').toBeGreaterThan(0);
      expect(warmed.liveContexts).toBe(1);
    }

    const beforeDemoShaders = warmed ? await glCounts(page) : null;
    // "Watch demonstration" appears with the coach's reading. The reading starts once the dead ball's consequence has
    // been shown and yields so every frame is drawn (CODEX-REQUESTS item 15), so on a loaded software-GL runner it can
    // take longer than the 10 s default; wait for it, and record how long it took.
    const readingFrom = Date.now();
    await page.waitForFunction(() => (window as unknown as { __vandePractice: { state(): { insight: string | null } } }).__vandePractice.state().insight === 'ready', undefined, { timeout: 90_000 });
    testInfo.annotations.push({ type: 'coach-reading-ms', description: String(Date.now() - readingFrom) });
    console.log(`coach-reading-ms ${mode.stage} ${Date.now() - readingFrom}`);
    const enteredDemo = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['demo'], 30_000));
    await expect(page.getByTestId('practice-demo')).toBeVisible();
    await page.getByTestId('practice-demo').click();
    expect(await enteredDemo, 'the visible Show me action entered the real demonstration phase').toBe(true);
    expect((await state(page)).phase).toBe('demo');
    await testInfo.attach(`${mode.stage}-coach-demonstration.png`, { body: await page.screenshot(), contentType: 'image/png' });

    await waitFor(page, ['dead'], 120_000);
    await expect(page.getByTestId('practice-result')).toBeVisible();
    if (beforeDemoShaders) expectNoNewShaders(beforeDemoShaders, await glCounts(page), 'Coach demonstration');
    await testInfo.attach(`${mode.stage}-coach-restored.png`, { body: await page.screenshot(), contentType: 'image/png' });
    const afterDemo = await state(page);
    expect(afterDemo).toMatchObject({ phase: 'dead', status: before.status, runs: before.runs, balls: before.balls, overs: before.overs, last: before.last });
    expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);

    await page.getByTestId('practice-why-toggle').click();
    await expect(page.getByTestId('practice-closeup')).toBeVisible();
    const beforeCloseUpShaders = warmed ? await glCounts(page) : null;
    if (mode.stage === '3d') {
      // Readback is intentionally its own complete invocation: transferring a full canvas can consume this short
      // presentation on a loaded host, so it must never be counted as time available for the interruption below.
      await arm3dCloseUpCapture(page);
      const enteredObservedCloseUp = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['closeup'], 30_000));
      await page.getByTestId('practice-closeup').click();
      expect(await enteredObservedCloseUp, 'the visible See the ball action entered the observed close-up').toBe(true);
      const capture = await closeUpCapture(page);
      const png = capture.png ? Buffer.from(capture.png.replace(/^data:image\/png;base64,/, ''), 'base64') : null;
      const metadata = { ...capture, png: { present: capture.png !== null, bytes: png?.length ?? 0, source: 'actual canvas backing bitmap immediately after the original close-up draw; not DOM-composited and not timing evidence' } };
      const closeUpEvidence: { capture: CloseUpCapture; png: Buffer | null; metadata: object } = { capture, png, metadata };
      try {
        const { capture, png } = closeUpEvidence;
        expect(capture.error).toBeNull();
        expect(capture).toMatchObject({ restored: true, mode: 'closeup', phase: 'closeup', stage: '3d' });
        expect(capture.sourceFlightSeed, 'the captured close-up flight has a nonempty seed').not.toBeNull();
        expect(capture.scriptFlightSeed, 'the captured close-up script has a nonempty seed').not.toBeNull();
        expect(capture.sourceFlightSeed).toBe(capture.scriptFlightSeed);
        expect(capture.sourceFlightSeed).toBe(sourceDeliverySeed);
        expect(capture.ball?.visible).toBe(true);
        expect(capture.ball?.depth).toBeGreaterThan(0);
        expect(capture.ball?.diameterCss).toBeGreaterThanOrEqual(92 - 1e-3);
        expect(capture.ball?.diameterCss).toBeLessThanOrEqual(260 + 1e-3);
        expect(capture.ball?.viewportContained, 'the actual ball and its surround are fully inside the drawn canvas').toBe(true);
        expect(png, 'the qualifying drawn frame produced a readable canvas bitmap').not.toBeNull();
      } finally {
        await testInfo.attach('3d-ball-closeup-drawn-frame.json', { body: Buffer.from(JSON.stringify(closeUpEvidence.metadata, null, 2)), contentType: 'application/json' });
        if (closeUpEvidence.png) await testInfo.attach('3d-ball-closeup-canvas-only.png', { body: closeUpEvidence.png, contentType: 'image/png' });
      }
      await waitFor(page, ['dead'], 120_000);
      await expect(page.getByTestId('practice-result')).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);
      if (beforeCloseUpShaders) expectNoNewShaders(beforeCloseUpShaders, await glCounts(page), 'observed ball close-up');
    }

    // A second explicit invocation proves interruption of the same source ball. Arm before clicking, then put no
    // screenshot, state query or canvas readback between the visible action and the real key event.
    // The natural return remounts the result layer with its disclosures collapsed, so reopen Why? through the same
    // visible UI a player uses. Classic has no first capture invocation and may already be open.
    if (!(await page.getByTestId('practice-closeup').isVisible())) {
      await expect(page.getByTestId('practice-why-toggle')).toBeVisible();
      await page.getByTestId('practice-why-toggle').click();
    }
    await expect(page.getByTestId('practice-closeup')).toBeVisible();
    await armEscapePhaseObservation(page);
    const enteredInterruptedCloseUp = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['closeup'], 30_000));
    await page.getByTestId('practice-closeup').click();
    await page.keyboard.press('Escape');
    expect(await enteredInterruptedCloseUp, 'the second visible See the ball action entered the interrupted close-up').toBe(true);
    expect(await escapePhaseObservation(page), 'the real Escape keydown reached the product while the close-up was active').toMatchObject({
      phase: 'closeup',
      stage: mode.stage,
    });
    await waitFor(page, ['paused']);
    await expect(page.getByTestId('practice-resume')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);
    await page.waitForTimeout(3_400);
    await page.getByTestId('practice-resume').click();
    await waitFor(page, ['dead']);
    await expect(page.getByTestId('practice-result')).toBeVisible();
    if (beforeCloseUpShaders) expectNoNewShaders(beforeCloseUpShaders, await glCounts(page), 'ball close-up');
    await testInfo.attach(`${mode.stage}-closeup-interrupted-restored.png`, { body: await page.screenshot(), contentType: 'image/png' });

    const restored = await state(page);
    expect(restored).toMatchObject({ stage: mode.stage, phase: 'dead', status: before.status, runs: before.runs, balls: before.balls, overs: before.overs, last: before.last });
    expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);
  });
}

test('restored 3D context rewarms both Coach presentation variants without changing the innings', async ({ page }) => {
  test.setTimeout(300_000);
  runtimeErrors(page, '3D context recovery');
  await record(page);
  await openPractice(page, { tier: 'full', timeScale: 4, seed: 'e2e-presentation-context' }, { settings: { quality: 'standard' } });
  await queue(page, { kind: 'attack', contactErrorMs: 60, directionDeg: 20, power: 0.6 });
  await startRandom(page);
  await waitFor(page, ['dead'], 120_000);
  await expect(page.getByTestId('practice-result')).toBeVisible();
  const before = await state(page);
  expect(before).toMatchObject({ stage: '3d', stageReady: true, phase: 'dead' });
  const saved = await page.evaluate(() => localStorage.getItem('vc:practice:innings'));
  expect(saved).not.toBeNull();
  const initial = await glCounts(page);
  expect(initial.links).toBeGreaterThan(0);
  expect(initial.compiles).toBeGreaterThan(0);
  expect(initial.liveContexts).toBe(1);

  const enteredDemo = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['demo'], 30_000));
  await page.getByTestId('practice-demo').click();
  expect(await enteredDemo).toBe(true);
  await page.evaluate(() => {
    type Recovery = { sawLost: boolean; restored: boolean; phaseAtLoss: string | null; stageAtLoss: string | null; links: number; compiles: number };
    const w = window as unknown as {
      __perf: { gl: { links: unknown[]; compiles: unknown[]; contexts: Array<{ lost: boolean; ref: WeakRef<HTMLCanvasElement> }> } };
      __coachContextRecovery?: Promise<Recovery>;
    };
    const current = w.__perf.gl.contexts.filter((context) => !context.lost && context.ref.deref()?.isConnected).at(-1);
    const canvas = current?.ref.deref();
    if (!canvas) throw new Error('no live WebGL canvas for context recovery');
    w.__coachContextRecovery = new Promise<Recovery>((resolve) => {
      let sawLost = false;
      let phaseAtLoss: string | null = null;
      let stageAtLoss: string | null = null;
      const timeout = window.setTimeout(() => resolve({ sawLost, restored: false, phaseAtLoss, stageAtLoss, links: w.__perf.gl.links.length, compiles: w.__perf.gl.compiles.length }), 30_000);
      // Capture runs before the stage's existing target/bubble listener, so this is the phase at native loss rather
      // than a state the renderer may synchronously publish while handling that loss.
      canvas.addEventListener('webglcontextlost', () => {
        sawLost = true;
        const current = (window as unknown as { __vandePractice?: { state(): { phase: string; stage: string } } }).__vandePractice?.state();
        phaseAtLoss = current?.phase ?? null;
        stageAtLoss = current?.stage ?? null;
      }, { once: true, capture: true });
      canvas.addEventListener('webglcontextrestored', () => {
        window.clearTimeout(timeout);
        resolve({ sawLost, restored: true, phaseAtLoss, stageAtLoss, links: w.__perf.gl.links.length, compiles: w.__perf.gl.compiles.length });
      }, { once: true });
    });
  });
  expect(await loseContext(page, 500), 'WEBGL_lose_context is available').toBe(true);
  const recovery = await page.evaluate(() => (window as unknown as { __coachContextRecovery: Promise<{ sawLost: boolean; restored: boolean; phaseAtLoss: string | null; stageAtLoss: string | null; links: number; compiles: number }> }).__coachContextRecovery);
  expect(recovery).toMatchObject({ sawLost: true, restored: true, phaseAtLoss: 'demo', stageAtLoss: '3d' });
  // Restore-time compilation is expected and intentionally outside the user-action baselines below.
  expect(recovery.links).toBeGreaterThanOrEqual(initial.links);
  expect(recovery.compiles).toBeGreaterThanOrEqual(initial.compiles);
  await waitFor(page, ['dead'], 120_000);
  expect(await state(page)).toMatchObject({ stage: '3d', stageReady: true, phase: 'dead', status: before.status, runs: before.runs, balls: before.balls, overs: before.overs, last: before.last });
  expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);

  const postRestore = await glCounts(page);
  expect(postRestore.liveContexts).toBe(1);
  const replayedDemo = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['demo'], 30_000));
  await page.getByTestId('practice-demo').click();
  expect(await replayedDemo).toBe(true);
  await waitFor(page, ['dead'], 120_000);
  expectNoNewShaders(postRestore, await glCounts(page), 'post-restore Coach demonstration');

  await page.getByTestId('practice-why-toggle').click();
  await expect(page.getByTestId('practice-closeup')).toBeVisible();
  const beforeCloseUp = await glCounts(page);
  const enteredCloseUp = page.evaluate(() => (window as unknown as { __vandePractice: { waitFor(s: string[], ms: number): Promise<boolean> } }).__vandePractice.waitFor(['closeup'], 30_000));
  await page.getByTestId('practice-closeup').click();
  expect(await enteredCloseUp).toBe(true);
  await waitFor(page, ['dead'], 120_000);
  expectNoNewShaders(beforeCloseUp, await glCounts(page), 'post-restore ball close-up');
  expect(await page.evaluate(() => localStorage.getItem('vc:practice:innings'))).toBe(saved);
});
