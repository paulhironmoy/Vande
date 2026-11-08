#!/usr/bin/env node
/**
 * What Classic's painted venue costs, measured in Chromium on this Mac (a desktop, not a phone; a loaded shared Mac: record uptime):
 * the one-off paint of the strip (done at mount, never inside a delivery) and the per-frame slice draw through the camera.
 * Needs a Vite dev server (`npx vite --port 4320`); prints JSON.
 *   node scripts/venue/classic-cost.mjs --port 4320 [--gpu metal|swiftshader]
 */
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(join(root, 'package.json'));
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const GPUS = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
};
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true, args: GPUS[arg('gpu', 'metal')] ?? GPUS.metal });
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${arg('port', 4320)}/src/render3d/dev/practice.html?stage=2d&clock=manual`);
await page.waitForFunction(() => window.__p?.ready || window.__p?.errors?.length, null, { timeout: 120000 });
const result = await page.evaluate(async () => {
  const paint = await import('/src/render3d/fallback2d/venuePaint.ts');
  const view = await import('/src/render3d/fallback2d/batterView.ts');
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const strip = new OffscreenCanvas(paint.STRIP_W, paint.STRIP_H);
  const g = strip.getContext('2d');
  const stripMs = [];
  for (let i = 0; i < 9; i++) {
    const t0 = performance.now();
    paint.paintVenueStrip(g);
    stripMs.push(performance.now() - t0);
  }
  const canvas = new OffscreenCanvas(915, 412);
  const ctx = canvas.getContext('2d');
  const painter = new view.BatterViewPainter(ctx);
  painter.resize(915, 412, 1);
  const venue = new paint.ClassicVenue();
  const cam = { pos: { x: -0.2, y: 1.68, z: 8.86 }, target: { x: -0.2, y: -20.7, z: -88.6 }, fov: 38 };
  painter.useCamera(cam);
  venue.prepare(ctx);
  const frameMs = [];
  let calls = 0;
  for (let i = 0; i < 400; i++) {
    const t0 = performance.now();
    calls = venue.paint(painter, cam);
    ctx.getImageData(0, 0, 1, 1); // wait for the draw
    frameMs.push(performance.now() - t0);
  }
  return {
    stripSize: [paint.STRIP_W, paint.STRIP_H],
    stripPaintMsMedian: Number(median(stripMs).toFixed(2)),
    stripPaintMsAll: stripMs.map((v) => Number(v.toFixed(2))),
    frameMsMedian: Number(median(frameMs).toFixed(3)),
    frameMsP95: Number([...frameMs].sort((x, y) => x - y)[Math.floor(frameMs.length * 0.95)].toFixed(3)),
    drawImageCallsPerFrame: calls,
  };
});
console.log(JSON.stringify({ ...result, utc: new Date().toISOString(), load1m: Number(os.loadavg()[0].toFixed(2)), gpu: arg('gpu', 'metal') }, null, 1));
await browser.close();
