#!/usr/bin/env node
/**
 * Stills and a frame-cost number for the venue (ASSETS-VENUE; a dev tool for the hero plates and the evaluators' captures).
 * It drives the dev gallery (`src/render3d/dev/assets.html`, served by a Vite dev server you start on your own port and stop
 * yourself) in headless Chromium and writes one PNG per shot plus `captures.json` beside them.
 *
 *   npx vite --port 4320 --strictPort &            # then, from the repository root:
 *   node scripts/venue/capture.mjs --port 4320 --out DIR --shots '[{"name":"hero-evening","view":"venue-hero","light":"evening","profile":"high","venue":"baked","width":2048,"height":683,"dpr":2}]'
 *   node scripts/venue/capture.mjs --port 4320 --out DIR --preset tiers      # the live-frame set: every tier, venue off and on
 *
 * A shot is { name, page?: 'practice' (the real stage), stage?: 3d|2d, view, light?, sky?, profile?: lite|standard|high, venue?: off|baked, width, height, dpr?, excite?, bench?, contextLoss? }.
 * `bench` renders the view that many times and records the mean ms per frame (GPU and CPU together; on this Mac's Metal GPU
 * that is not a phone, and on SwiftShader it is indicative only). `--gpu metal|swiftshader` picks the renderer.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));
const GPUS = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};

/** The live batter's-eye frame at a 20:9 phone shape and the hero frame, on every tier, venue off and on. */
const PRESETS = {
  tiers: ['lite', 'standard', 'high'].flatMap((profile) =>
    ['off', 'baked'].map((venue) => ({
      name: `eye-${profile}-venue-${venue}`,
      view: 'venue-eye',
      light: 'evening',
      profile,
      venue,
      width: 915,
      height: 412,
      dpr: 1,
      bench: 60,
    })),
  ),
  // The real Practice stage, live frame just before release, at the three review viewports, every tier, venue off and on; Classic has no venue switch.
  live: [
    [844, 390],
    [915, 412],
    [1280, 800],
  ].flatMap(([width, height]) => [
    ...['lite', 'standard', 'high'].flatMap((profile) =>
      ['off', 'baked'].map((venue) => ({
        page: 'practice',
        stage: '3d',
        name: `live-${profile}-venue-${venue}-${width}x${height}`,
        profile,
        venue,
        width,
        height,
        dpr: 1,
      })),
    ),
    { page: 'practice', stage: '2d', name: `live-classic-${width}x${height}`, profile: 'lite', venue: 'off', width, height, dpr: 1 },
  ]),
  // Textures and buffers at the first ball (the observer's counters), 915x412: the live set without the other sizes.
  memory: ['lite', 'standard', 'high'].flatMap((profile) =>
    ['off', 'baked'].map((venue) => ({ page: 'practice', stage: '3d', name: `mem-${profile}-venue-${venue}`, profile, venue, width: 915, height: 412, dpr: 1 })),
  ),
  establishing: ['lite', 'standard', 'high'].flatMap((profile) =>
    ['off', 'baked'].flatMap((venue) =>
      ['venue-hero', 'venue-rope'].map((view) => ({
        name: `${view}-${profile}-venue-${venue}`,
        view,
        light: 'evening',
        profile,
        venue,
        width: 1280,
        height: 427,
        dpr: 1,
        bench: 30,
      })),
    ),
  ),
};

async function main() {
  const port = Number(arg('port', 4320));
  const out = resolve(arg('out', 'test-results-venue/captures'));
  const gpu = arg('gpu', 'metal');
  const shots = arg('shots') ? JSON.parse(arg('shots')) : PRESETS[arg('preset', 'tiers')];
  if (!shots) throw new Error('unknown preset');
  mkdirSync(out, { recursive: true });
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: GPUS[gpu] ?? GPUS.metal });
  const buildId = execFileSync('sh', [join(root, 'scripts/build-id.sh')], { cwd: root, encoding: 'utf8' }).trim();
  const log = [];
  try {
    for (const s of shots) {
      const ctx = await browser.newContext({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: s.dpr ?? 1 });
      const page = await ctx.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
      if (s.page === 'practice') {
        // The perf harness's observer (it counts the bytes the app allocates in textures, buffers and renderbuffers).
        await ctx.addInitScript({ path: join(root, 'scripts/perf/observer.js') });
        // The real Practice stage in the dev harness on a manual clock: wait for the venue, bowl one ball, stop before release.
        const url = `http://127.0.0.1:${port}/src/render3d/dev/practice.html?stage=${s.stage ?? '3d'}&profile=${s.profile ?? 'high'}&clock=manual&venue=${s.venue ?? 'off'}`;
        await page.goto(url);
        await page.waitForFunction(() => window.__p?.ready || window.__p?.errors?.length, null, { timeout: 120000 });
        const t0 = new Date().toISOString();
        const load = os.loadavg()[0];
        let venueState = null;
        for (let i = 0; i < 600; i++) {
          venueState = await page.evaluate(() => window.__p.stage.inspectVenue?.() ?? null);
          if (!venueState || ['shown', 'failed', 'off'].includes(venueState.state)) break;
          await page.evaluate(() => window.__p.step(window.__p.now() + 16));
          await page.waitForTimeout(40);
        }
        const bowled = await page.evaluate(() => window.__p.bowl());
        await page.evaluate((t) => window.__p.step(t), bowled.releasePerfMs - (s.beforeReleaseMs ?? 350));
        const file = join(out, `${s.name}.png`);
        await page.locator('#stage').screenshot({ path: file });
        const stats = await page.evaluate(() => ({
          drawCalls: window.__p.stage.stats?.().drawCalls ?? null,
          venue: window.__p.stage.inspectVenue?.() ?? null,
          errors: window.__p.errors,
          gl: window.__perf ? { textureBytes: window.__perf.gl.tex, texturePeakBytes: window.__perf.gl.texPeak, bufferBytes: window.__perf.gl.buf, renderbufferBytes: window.__perf.gl.rb, programs: window.__perf.gl.programs } : null,
        }));
        log.push({ ...s, utc: t0, uptimeLoad1m: Number(load.toFixed(2)), gpu, buildId, file, calls: stats.drawCalls, venue: stats.venue, gl: stats.gl, errors: stats.errors, pageProblems: problems });
        await ctx.close();
        console.log(`${s.name}: calls ${stats.drawCalls} venue ${stats.venue?.state ?? '-'} tex ${stats.gl ? (stats.gl.textureBytes / 1048576).toFixed(1) : '-'} MB buf ${stats.gl ? (stats.gl.bufferBytes / 1048576).toFixed(1) : '-'} MB ${problems.length ? `PROBLEMS ${problems.length}` : ''}`);
        continue;
      }
      const url = `http://127.0.0.1:${port}/src/render3d/dev/assets.html?profile=${s.profile ?? 'high'}&venue=${s.venue ?? 'off'}`;
      await page.goto(url);
      await page.waitForFunction(() => window.__a?.ready || window.__a?.errors?.length, null, { timeout: 120000 });
      const t0 = new Date().toISOString();
      const load = os.loadavg()[0];
      await page.evaluate(([name, o]) => window.__a.view(name, o), [s.view, { light: s.light ?? 'evening', sky: s.sky ?? 'clear', excite: s.excite ?? 0.45 }]);
      // The gallery's own text (view name, draw calls) is not part of any capture.
      await page.evaluate(() => {
        const hud = document.getElementById('hud');
        if (hud) hud.style.display = 'none';
      });
      const info = await page.evaluate((frames) => ({
        calls: window.__a.stage.drawCalls(),
        venue: window.__a.venue?.() ?? null,
        benchMs: frames ? window.__a.bench(frames) : null,
        errors: window.__a.errors,
      }), s.bench ?? 0);
      const file = join(out, `${s.name}.png`);
      await page.locator('#stage').screenshot({ path: file });
      let contextLoss = null;
      if (s.contextLoss) {
        // Forced WebGL context loss and restore with the venue loaded: the same view must come back the same (VEN-08).
        const lost = await page.evaluate(async () => {
          const canvas = window.__a.stage.renderer.domElement;
          const ext = window.__a.stage.renderer.getContext().getExtension('WEBGL_lose_context');
          if (!ext) return { ok: false, reason: 'no WEBGL_lose_context' };
          const restored = new Promise((r) => canvas.addEventListener('webglcontextrestored', () => r(true), { once: true }));
          ext.loseContext();
          await new Promise((r) => setTimeout(r, 300));
          ext.restoreContext();
          return { ok: await Promise.race([restored, new Promise((r) => setTimeout(() => r(false), 8000))]) };
        });
        await page.evaluate(([name, o]) => window.__a.view(name, o), [s.view, { light: s.light ?? 'evening', sky: s.sky ?? 'clear', excite: s.excite ?? 0.45 }]);
        const after = join(out, `${s.name}-after-context-loss.png`);
        await page.locator('#stage').screenshot({ path: after });
        const { default: sharp } = await import('sharp');
        const [a, b] = await Promise.all([sharp(file).raw().toBuffer(), sharp(after).raw().toBuffer()]);
        let sum = 0;
        let max = 0;
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i] - b[i]);
          sum += d;
          if (d > max) max = d;
        }
        contextLoss = { restored: lost.ok, reason: lost.reason ?? null, meanAbsDiff: Number((sum / a.length).toFixed(4)), maxDiff: max, venueAfter: await page.evaluate(() => window.__a.venue?.() ?? null) };
      }
      log.push({ ...s, contextLoss, utc: t0, uptimeLoad1m: Number(load.toFixed(2)), gpu, buildId, file, ...info, pageProblems: problems });
      await ctx.close();
      console.log(`${s.name}: calls ${info.calls} bench ${info.benchMs?.toFixed?.(2) ?? '-'} ms venue ${info.venue?.state ?? '-'} ${problems.length ? `PROBLEMS ${problems.length}` : ''}`);
    }
  } finally {
    await browser.close();
  }
  writeFileSync(join(out, 'captures.json'), JSON.stringify(log, null, 2));
}

await main();
