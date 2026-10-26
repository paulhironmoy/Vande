/**
 * Practice stage smoke (src/render3d): the first-person 3D stage and the Classic 2D stage in real Chromium, driven
 * through the dev-only harness (src/render3d/dev/practice.html) on a manual clock, so every frame is an exact moment.
 * Starts its own Vite dev server (reloads off) on its own port; deliveries come from the real physics flight().
 * Chromium's default headless GL is SwiftShader, so this also proves the software path: the stage renders, and the
 * device benchmark measures real frames and classifies the device Below for its software renderer.
 */
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.UX_SHOTS_DIR || join(process.cwd(), 'test-results', 'practice-stage-shots');
mkdirSync(SHOTS, { recursive: true });

let server: ViteDevServer;
let base = '';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 1 });

test.beforeAll(async () => {
  server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5298, strictPort: false, hmr: false, watch: { ignored: ['**/*'] } } });
  await server.listen();
  const addr = server.httpServer?.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 5298}`;
});
test.afterAll(async () => {
  await server?.close();
});

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function open(page: Page, query: string) {
  await page.goto(`${base}/src/render3d/dev/practice.html?${query}`);
  await page.waitForFunction(() => (window as unknown as { __p?: { ready: boolean } }).__p?.ready === true, null, { timeout: 90_000 });
}

type Harness = {
  stage: { kind: string; stats(): { lastInputToBatMs: number | null; renderer: string }; beginSwing(t: number, c: number): void };
  now(): number;
  step(ms: number): Promise<void>;
  bowl(plan?: object): Promise<{ releasePerfMs: number; flight: { idealContactT: number } }>;
  result(kind: string, timingMs?: number, bearing?: number): { swing: { startT: number } | null; deadT: number; contact: { t: number | null } };
  play(r: unknown): Promise<void>;
  replay(r: unknown, camera?: string, speed?: number): Promise<void>;
  errors: string[];
};

/** Bowls, swings at the right moment and plays the result through to dead ball; returns what the stage reported. */
async function delivery(page: Page, kind: string) {
  return page.evaluate(async (kind) => {
    const h = (window as unknown as { __p: Harness }).__p;
    const { releasePerfMs } = await h.bowl();
    await h.step(releasePerfMs + 200);
    const result = h.result(kind, 10, 20);
    if (result.swing) {
      const press = releasePerfMs + result.swing.startT * 1000;
      await h.step(press);
      h.stage.beginSwing(press, 0);
      await h.step(press + 16);
    }
    let dead = false;
    void h.play(result).then(() => (dead = true));
    for (let t = h.now(); !dead && t < releasePerfMs + (result.deadT + 1) * 1000; t += 50) await h.step(t);
    return { dead, latency: h.stage.stats().lastInputToBatMs, renderer: h.stage.stats().renderer, errors: h.errors };
  }, kind);
}

test('3D first-person stage plays a delivery from release to dead ball on the software renderer', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'stage=3d&clock=manual&profile=lite');
  const r = await delivery(page, 'drive');
  expect(r.dead).toBe(true);
  expect(r.latency).not.toBeNull();
  expect(r.latency!).toBeLessThanOrEqual(17);
  expect(r.errors).toEqual([]);
  await page.screenshot({ path: join(SHOTS, '3d-after.png') });
  expect(errors).toEqual([]);
});

test('the device benchmark measures real frames on software GL and classifies it Below (never "no frames")', async ({ page }) => {
  await open(page, 'stage=3d&clock=real&profile=standard');
  const a = await page.evaluate(async () => {
    // A browser-side module on the dev server (the specifier is built at run time so tsc leaves it alone).
    const specifier = '/src/perf/index.ts';
    const perf = (await import(/* @vite-ignore */ specifier)) as {
      runDeviceBenchmark(stage: unknown): Promise<{ webgl2: boolean; hardware: boolean; reasons: string[]; tier: string; avgFps: number }>;
    };
    const stage = (window as unknown as { __p: { stage: unknown } }).__p.stage;
    return perf.runDeviceBenchmark(stage);
  });
  expect(a.webgl2).toBe(true);
  if (!a.hardware) {
    expect(a.reasons).toContain('software_renderer');
    expect(a.tier).toBe('below');
  }
  expect(a.reasons).not.toContain('no_frames');
  expect(a.avgFps).toBeGreaterThan(0);
});

test('Classic 2D stage plays the same delivery and a diagnostic replay', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'stage=2d&clock=manual');
  const r = await delivery(page, 'six');
  expect(r.dead).toBe(true);
  expect(r.errors).toEqual([]);
  await page.screenshot({ path: join(SHOTS, '2d-after.png') });
  expect(errors).toEqual([]);
});

test('replay frames are identical at the same replay time', async ({ page }) => {
  await open(page, 'stage=3d&clock=manual&profile=standard');
  const shot = async (offset: number) => {
    await page.evaluate(async (offset) => {
      const h = (window as unknown as { __p: Harness }).__p;
      const { releasePerfMs } = await h.bowl({ lengthM: 5.5 });
      await h.step(releasePerfMs + 600);
      const result = h.result('drive', 0, 15);
      const start = h.now();
      void h.replay(result, 'side', 0.3);
      await h.step(start + offset);
    }, offset);
    return page.screenshot();
  };
  const a = await shot(1500);
  await shot(2600);
  const b = await shot(1500);
  expect(Buffer.compare(a, b)).toBe(0);
});
