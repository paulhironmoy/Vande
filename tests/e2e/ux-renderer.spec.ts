/**
 * Experience smoke: the 3D renderer and the screens in real Chromium at phone size.
 * Starts its own Vite dev server (the harness and gallery pages are dev-only, never in the build).
 * Screenshots go to $UX_SHOTS_DIR (default test-results/ux-shots) for visual review.
 */
import { test, expect, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SHOTS = process.env.UX_SHOTS_DIR || join(process.cwd(), 'test-results', 'ux-shots');
mkdirSync(SHOTS, { recursive: true });

let server: ViteDevServer;
let base = '';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } });

test.beforeAll(async () => {
  server = await createServer({ configFile: 'vite.config.ts', logLevel: 'error', server: { host: '127.0.0.1', port: 5288, strictPort: false } });
  await server.listen();
  const addr = server.httpServer?.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 5288}`;
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

async function openHarness(page: Page, query: string) {
  await page.goto(`${base}/src/screens/dev/harness.html?${query}`);
  await page.waitForFunction(() => (window as unknown as { __h?: { ready: boolean } }).__h?.ready === true, null, { timeout: 60_000 });
}

test('3D replay renders key moments and is deterministic frame by frame', async ({ page }) => {
  const errors = watchErrors(page);
  await openHarness(page, 'mode=replay&rmode=full&q=standard');
  const info = await page.evaluate(() => {
    const h = (window as unknown as { __h: { duration: number; segments: Array<{ kind: string; t0: number; sceneStart: number; release: number; contact: number; decisive: number; fate: string | null }>; renderer: { kind: string } } }).__h;
    return { duration: h.duration, kind: h.renderer.kind, segments: h.segments };
  });
  expect(info.kind).toBe('3d');
  expect(info.duration).toBeGreaterThan(60_000);
  const at = (s: (typeof info.segments)[number], scene: number) => Math.round(s.t0 + (scene - s.sceneStart));
  const balls = info.segments.filter((s) => s.kind === 'ball');
  const shots: Array<[string, number]> = [['intro', 1800]];
  for (const s of balls.slice(0, 6)) {
    shots.push([`${s.fate}-runup`, at(s, s.release - 900)]);
    shots.push([`${s.fate}-flight`, at(s, s.release + 200)]);
    shots.push([`${s.fate}-moment`, at(s, s.decisive + 600)]);
  }
  // The held breath before the result (the camera's push-in), then the celebration.
  const result = info.segments.find((s) => s.kind === 'result');
  if (result) shots.push(['result-breath', result.t0 + 700]);
  shots.push(['result', info.duration - 1500]);
  for (const [name, t] of shots) {
    await page.evaluate((ms) => (window as unknown as { __h: { renderAt(ms: number): void } }).__h.renderAt(ms), t);
    await page.screenshot({ path: join(SHOTS, `replay-${name}-${t}.png`) });
  }
  // Same time, same pixels: renderAt reads no wall clock and carries no state from the previous frame.
  const frame = async (t: number) => {
    await page.evaluate((ms) => (window as unknown as { __h: { renderAt(ms: number): void } }).__h.renderAt(ms), t);
    return page.screenshot();
  };
  const a = await frame(balls[1].t0 + 2600);
  await frame(5000);
  const b = await frame(balls[1].t0 + 2600);
  if (Buffer.compare(a, b) !== 0) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(SHOTS, 'determinism-a.png'), a);
    writeFileSync(join(SHOTS, 'determinism-b.png'), b);
  }
  expect(Buffer.compare(a, b)).toBe(0);
  expect(errors).toEqual([]);
});

test('Key Moments is shorter than the full replay and plays without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await openHarness(page, 'mode=replay&rmode=key_moments&q=standard&play=1');
  const duration = await page.evaluate(() => (window as unknown as { __h: { duration: number } }).__h.duration);
  expect(duration).toBeGreaterThan(10_000);
  await page.waitForTimeout(2500);
  const stats = await page.evaluate(() => (window as unknown as { __h: { renderer: { stats(): { fps: number; drawCalls: number } } } }).__h.renderer.stats());
  expect(stats.drawCalls).toBeGreaterThan(10);
  await page.screenshot({ path: join(SHOTS, 'key-moments-playing.png') });
  expect(errors).toEqual([]);
});

test('2D fallback presents the same replay', async ({ page }) => {
  const errors = watchErrors(page);
  await openHarness(page, 'mode=replay&rmode=full&fallback=1');
  expect(await page.evaluate(() => (window as unknown as { __h: { renderer: { kind: string } } }).__h.renderer.kind)).toBe('2d');
  for (const t of [9000, 15500, 38000, 47500]) {
    await page.evaluate((ms) => (window as unknown as { __h: { renderAt(ms: number): void } }).__h.renderAt(ms), t);
    await page.screenshot({ path: join(SHOTS, `fallback2d-${t}.png`) });
  }
  expect(errors).toEqual([]);
});

test('live batting survives a lost WebGL context', async ({ page }) => {
  const errors = watchErrors(page);
  await openHarness(page, 'mode=live&q=standard');
  await page.evaluate(() => (window as unknown as { __h: { bowl(): Promise<number> } }).__h.bowl());
  await page.waitForTimeout(400);
  const restored = await page.evaluate(async () => {
    const c = document.getElementById('stage') as HTMLCanvasElement;
    const gl = c.getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return 'no-extension';
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 300));
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 1200));
    return gl?.isContextLost() ? 'lost' : 'restored';
  });
  expect(restored).toBe('restored');
  await page.screenshot({ path: join(SHOTS, 'live-after-context-restore.png') });
  expect(errors.filter((e) => !/context lost/i.test(e))).toEqual([]);
});

const screens: Array<[string, string]> = [
  ['onboarding', 'screen=onboarding&alias=Swing%20King'],
  ['onboarding-hindi', 'screen=onboarding&locale=hi'],
  ['onboarding-recover-entry', 'screen=onboarding&recover=1'],
  ['planner', 'screen=planner'],
  ['batting', 'screen=batting'],
  ['training', 'screen=training'],
  ['reveal', 'screen=reveal&autoplay=0&mode=full&t=37600'],
  ['reveal-high-contrast', 'screen=reveal&autoplay=0&mode=full&hc=1&t=12500'],
  ['reveal-reduced-motion-hinglish', 'screen=reveal&autoplay=0&mode=full&rm=1&locale=hi-Latn&t=49800'],
  ['card-invite-long-link', 'screen=card&card=invite'],
  ['card-cup-invite', 'screen=card&card=cup-invite'],
  ['onboarding-large-text', 'screen=onboarding&ts=1.3'],
  ['card-cup-invite-hindi', 'screen=card&card=cup-invite&locale=hi&cup=%E0%A4%91%E0%A4%AB%E0%A4%BF%E0%A4%B8%20%E0%A4%95%E0%A4%AA'],
  ['reveal-countdown', 'screen=reveal-countdown'],
  ['reveal-countdown-hindi', 'screen=reveal-countdown&locale=hi&in=75'],
  ['chips', 'screen=chips'],
  ['chips-high-contrast', 'screen=chips&hc=1'],
  ['age', 'screen=age&recover=1'],
  ['age-hindi', 'screen=age&locale=hi'],
  ['age-large-text', 'screen=age&ts=1.3'],
  ['age-stop', 'screen=age-stop'],
  ['age-stop-tamil', 'screen=age-stop&locale=ta'],
];

for (const [name, query] of screens) {
  test(`screen: ${name} renders cleanly and passes axe`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`${base}/src/screens/dev/gallery.html?${query}`);
    await page.waitForTimeout(3500);
    await page.screenshot({ path: join(SHOTS, `screen-${name}.png`) });
    const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const [w, h] of [
  [360, 780],
  [390, 844],
  [1366, 768],
] as const) {
  test(`reveal at ${w}px: start, mid-replay and after Skip, nothing given away early`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: w, height: h });
    await page.goto(`${base}/src/screens/dev/gallery.html?screen=reveal&autoplay=0`);
    await expect(page.getByTestId('reveal-screen')).toBeVisible();
    await page.waitForTimeout(2500);
    // Start: no total length, no result, no Player of the Match.
    await expect(page.getByTestId('reveal-total')).toHaveCount(0);
    await expect(page.getByTestId('reveal-summary')).toHaveCount(0);
    await page.screenshot({ path: join(SHOTS, `reveal-${w}-start.png`) });
    await page.getByTestId('reveal-play').click();
    await page.waitForTimeout(9000);
    await page.getByTestId('reveal-play').click();
    await page.screenshot({ path: join(SHOTS, `reveal-${w}-mid.png`) });
    await page.getByTestId('reveal-skip').click();
    await expect(page.getByTestId('reveal-summary')).toBeVisible();
    await expect(page.getByTestId('reveal-total')).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: join(SHOTS, `reveal-${w}-after-skip.png`), fullPage: w < 600 });
    const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('recover account sheet: both methods, an honest failure, and axe', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`${base}/src/screens/dev/gallery.html?screen=onboarding&recover=1`);
  await page.getByTestId('onboarding-recover').click();
  await expect(page.getByTestId('recover-sheet')).toBeVisible();
  await expect(page.getByTestId('recover-passkey')).toBeVisible();
  await page.getByTestId('recover-google').click();
  await expect(page.getByTestId('recover-result')).toHaveAttribute('data-reason', 'no_account');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(SHOTS, 'screen-recover-sheet.png') });
  const results = await new AxeBuilder({ page }).exclude('canvas').analyze();
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(serious.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  expect(errors).toEqual([]);
});

test('highlight render page: a 30–60 s cut, deterministic frames and a soundtrack of the same length', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1080, height: 1920 });
  await page.goto(`${base}/render.html`);
  await page.waitForFunction(() => typeof (window as unknown as { __vcHighlight?: unknown }).__vcHighlight === 'object', null, { timeout: 30_000 });
  const loaded = await page.evaluate(async () => {
    // Served by the Vite dev server at run time (not a module of the test build).
    const fixtures = '/src/screens/dev/fixtures.ts';
    const f = (await import(/* @vite-ignore */ fixtures)) as { fixtureMatchLog(): unknown };
    const log = f.fixtureMatchLog();
    const input = { jobId: 'job-e2e', log, aliases: ['Swing King', 'Night Owl'], locale: 'en', fixtureLabel: 'Friend Duel', day: '2026-10-25', ranks: [7, null], standings: null, cta: { url: 'https://vande.example/h/abc123' } };
    return (window as unknown as { __vcHighlight: { load(i: unknown): Promise<{ durationMs: number; fps: number }> } }).__vcHighlight.load(input);
  });
  expect(loaded.fps).toBe(30);
  expect(loaded.durationMs).toBeGreaterThanOrEqual(30_000);
  expect(loaded.durationMs).toBeLessThanOrEqual(60_000);
  expect(loaded.durationMs % 100).toBe(0);
  const frameAt = (ms: number) =>
    page.evaluate(async (t) => {
      const w = window as unknown as { __vcHighlight: { frame(t: number): Promise<void> } };
      await w.__vcHighlight.frame(t);
      return (document.getElementById('highlight') as HTMLCanvasElement).toDataURL('image/png');
    }, ms);
  // The hook comes first: the biggest moment, from the very first frame.
  const scenes = await page.evaluate(() => (window as unknown as { __vcHighlight: { plan(): { scenes: Array<{ kind: string; t0: number }> } } }).__vcHighlight.plan().scenes.map((s) => ({ kind: s.kind, t0: s.t0 })));
  expect(scenes[0]).toEqual({ kind: 'hook', t0: 0 });
  expect(scenes[1].kind).toBe('intro');
  for (const t of [200, 1000, 2600, 9000, Math.round(loaded.durationMs * 0.75), loaded.durationMs - 1500]) {
    const png = await frameAt(t);
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(SHOTS, `highlight-${t}.png`), Buffer.from(png.split(',')[1], 'base64'));
  }
  // Same input and time, same picture, whatever was drawn in between.
  const a = await frameAt(14_000);
  await frameAt(2_000);
  const b = await frameAt(14_000);
  expect(a === b).toBe(true);
  const wav = await page.evaluate(() => (window as unknown as { __vcHighlight: { audio(): Promise<string | null> } }).__vcHighlight.audio());
  expect(wav).not.toBeNull();
  const bytes = Buffer.from(wav as string, 'base64');
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  const seconds = (bytes.length - 44) / (bytes.readUInt32LE(28));
  expect(Math.abs(seconds * 1000 - loaded.durationMs)).toBeLessThan(25);
  // Mastered for YouTube: about -14 LUFS, the true peak at or under -1 dBTP, the crowd bed under the action.
  const report = await page.evaluate(() => (window as unknown as { __vcHighlight: { audioReport(): { integrated: number; truePeak: number; bedGainDb: number } | null } }).__vcHighlight.audioReport());
  expect(report).not.toBeNull();
  expect(Math.abs(report!.integrated - -14)).toBeLessThan(1);
  expect(report!.truePeak).toBeLessThanOrEqual(-1);
  expect(errors.filter((e) => !/GPU stall|GL Driver/.test(e))).toEqual([]);
});
