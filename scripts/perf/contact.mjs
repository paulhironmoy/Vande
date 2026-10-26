/**
 * The moment of contact in live batting under SwiftShader (the slowest GPU path): long tasks after the shot and the
 * hottest functions of a second contact under the CPU profiler. Starts its own Vite dev server for the dev harness.
 *
 *   node scripts/perf/contact.mjs [runs]
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, chromium } from './serve.mjs';

const req = createRequire(join(ROOT, 'package.json'));
const viteMod = await import(pathToFileURL(req.resolve('vite')).href);
const createServer = viteMod.createServer ?? viteMod.default.createServer;
const runs = Number(process.argv[2] ?? 3);
const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', cacheDir: join(ROOT, 'node_modules/.vite-perf'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const browser = await (await chromium()).launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
try {
  for (let r = 0; r < runs; r++) {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    await page.addInitScript(() => {
      window.__lt = [];
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) window.__lt.push([Math.round(e.startTime), Math.round(e.duration)]);
      }).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(`http://127.0.0.1:${port}/src/screens/dev/harness.html?mode=live&q=standard`);
    await page.waitForFunction(() => window.__h?.ready === true, null, { timeout: 90_000 });
    await page.waitForTimeout(1500);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    const res = await page.evaluate(async () => {
      const h = window.__h;
      const released = await h.bowl();
      const t0 = performance.now();
      window.__lt = [];
      await new Promise((r) => setTimeout(r, 450));
      const shotAt = performance.now();
      const done = h.shot('drive', 'middle', 'perfect', 'cover');
      await new Promise((r) => setTimeout(r, 1800));
      await done;
      return { released: Math.round(released), shotAt: Math.round(shotAt - t0), lt: window.__lt.filter(([s]) => s >= shotAt - 50).map(([s, d]) => [Math.round(s - shotAt), d]) };
    });
    await cdp.send('Profiler.start');
    await page.evaluate(async () => {
      const h = window.__h;
      await h.bowl();
      await new Promise((r) => setTimeout(r, 450));
      const done = h.shot('loft', 'thick_edge', 'early', 'long_on');
      await new Promise((r) => setTimeout(r, 1500));
      await done;
    });
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
    });
    const top = [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)|\(garbage collector\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, ms]) => `${ms.toFixed(1)}ms ${k}`);
    out.push({ run: r, ...res, top });
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(JSON.stringify(out, null, 1));
