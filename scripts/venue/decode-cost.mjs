#!/usr/bin/env node
/**
 * What loading a venue pack costs in the browser, per step, measured in Chromium on this Mac (a desktop, not a phone; record uptime):
 * parse the GLB (strict reader), decode the WebP atlas (createImageBitmap), build the instanced meshes, and warm (compile the
 * program against the scene and upload the atlas). Needs a Vite dev server on --port. Prints JSON: median of 7 runs per step.
 *   node scripts/venue/decode-cost.mjs --port 4320 [--gpu metal|swiftshader]
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
const page = await browser.newPage({ viewport: { width: 915, height: 412 } });
await page.goto(`http://127.0.0.1:${arg('port', 4320)}/src/render3d/dev/assets.html?profile=high&venue=off`);
await page.waitForFunction(() => window.__a?.ready || window.__a?.errors?.length, null, { timeout: 120000 });
const result = await page.evaluate(async () => {
  const baked = await import('/src/render3d/three/venueBaked.ts');
  const glb = await import('/src/render3d/three/venueGlb.ts');
  const packs = await import('/src/render3d/three/venuePacks.ts');
  const stage = window.__a.stage;
  const stadium = stage.stadium;
  const uniforms = stadium.group.userData.venue.uniforms;
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const out = {};
  for (const [name, url] of Object.entries(packs.PACK_URLS)) {
    const t = { fetch: [], parse: [], bitmap: [], build: [], warm: [] };
    let bytes = 0;
    for (let i = 0; i < 7; i++) {
      let t0 = performance.now();
      const buf = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
      t.fetch.push(performance.now() - t0);
      bytes = buf.byteLength;
      t0 = performance.now();
      const pack = glb.parseVenuePack(buf);
      t.parse.push(performance.now() - t0);
      t0 = performance.now();
      const bmp = await createImageBitmap(new Blob([pack.image.bytes], { type: pack.image.mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      t.bitmap.push(performance.now() - t0);
      t0 = performance.now();
      const venue = baked.buildBakedVenue(pack, bmp, uniforms);
      t.build.push(performance.now() - t0);
      t0 = performance.now();
      venue.warm(stage.renderer, stage.camera, stage.scene);
      t.warm.push(performance.now() - t0);
      venue.dispose();
    }
    out[name] = { bytes, medianMs: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(median(v).toFixed(2))])), firstRunMs: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Number(v[0].toFixed(2))])) };
  }
  return out;
});
console.log(JSON.stringify({ ...result, utc: new Date().toISOString(), load1m: Number(os.loadavg()[0].toFixed(2)), gpu: arg('gpu', 'metal'), note: 'fetch is from the local dev server (no network); warm = compile + atlas upload, first run includes the program compile, later runs hit the program cache' }, null, 1));
await browser.close();
