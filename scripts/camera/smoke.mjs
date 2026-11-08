#!/usr/bin/env node
/**
 * Model smoke test (CAM-06, CAM-14): loads the REAL pose engine and model from the camera pack into headless Chromium with a
 * FAKE camera device (a looped video made from a public-domain photograph), under the production Content-Security-Policy and
 * a server that sends the production Permissions-Policy, and measures what comes out: bytes downloaded (first start, and the
 * cached second start), the delegate chosen, inference time per frame, frame pacing and the landmarks themselves.
 * It proves the engine runs and returns landmarks; it does NOT prove anyone can bat with it (human work).
 *
 *   node scripts/camera/smoke.mjs --video <file.mjpeg> --out <dir> [--delegate auto|GPU|CPU] [--seconds 8] [--port 4314]
 *                                 [--throttle down_kbps,up_kbps,rtt_ms] [--second-start] [--headed]
 */
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCameraPack } from './pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const arg = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const video = arg('video');
const out = arg('out', path.join(ROOT, 'test-results-camera'));
const port = Number(arg('port', '4314'));
const delegate = arg('delegate', 'auto');
const seconds = arg('seconds', '8');
const throttle = arg('throttle', '');
if (!video) throw new Error('--video <fake camera file (.mjpeg or .y4m)> is required');
mkdirSync(out, { recursive: true });

const { build } = await import('vite');
const { chromium } = await import('playwright');
const pack = await buildCameraPack();

// The page's bundle (this script's entry plus the real session code), in memory.
const built = await build({
  configFile: false,
  root: ROOT,
  logLevel: 'warn',
  resolve: { alias: { '@': path.join(ROOT, 'src') } },
  define: { __CAMERA_PACK__: 'null', __CAMERA_BUNDLED__: 'false', __CAMERA_BASE_URL__: '""' },
  build: { write: false, minify: true, target: 'es2022', lib: { entry: path.join(ROOT, 'scripts/camera/smoke-entry.ts'), formats: ['es'], fileName: () => 'smoke.js' }, rollupOptions: { output: { codeSplitting: false } } },
});
const pageJs = (Array.isArray(built) ? built : [built]).flatMap((o) => o.output).find((o) => o.type === 'chunk').code;

// The production policy of vite.config.ts contentSecurityPolicy() with no API, analytics or Google origins.
const CSP = ["default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "worker-src 'self' blob:", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "frame-src 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"].join('; ');
const permissionsPolicy = readFileSync(path.join(ROOT, 'public/_headers'), 'utf8').match(/^\s*Permissions-Policy:\s*(.+)$/m)?.[1];
const requests = [];
const server = createServer((req, res) => {
  const url = (req.url ?? '/').split('?')[0];
  const common = { 'Permissions-Policy': permissionsPolicy, 'Cache-Control': 'no-store' };
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { ...common, 'Content-Type': 'text/html' });
    return res.end(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><title>camera smoke</title><script type="module" src="/smoke.js"></script>`);
  }
  if (url === '/smoke.js') {
    res.writeHead(200, { ...common, 'Content-Type': 'text/javascript' });
    return res.end(pageJs);
  }
  if (url === '/pack-info.json') {
    res.writeHead(200, { ...common, 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(pack.info));
  }
  const f = pack.files.find((x) => url === `/${pack.info.dir}${x.file}`);
  if (f) {
    requests.push({ url, bytes: f.data.length });
    res.writeHead(200, { ...common, 'Content-Type': 'application/octet-stream', 'Content-Length': f.data.length });
    return res.end(f.data);
  }
  res.writeHead(404).end();
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-video-capture=${path.resolve(video)}`],
});
const ctx = await browser.newContext({ permissions: ['camera'] });
const results = { when: new Date().toISOString(), delegate, seconds, video: path.basename(video), pack: pack.info, runs: [], uptime: null };
async function run(label) {
  const page = await ctx.newPage();
  const violations = [];
  page.on('console', (m) => m.type() === 'error' && violations.push(m.text()));
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
  if (throttle) {
    const [down, up, rtt] = throttle.split(',').map(Number);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: (down * 1000) / 8, uploadThroughput: (up * 1000) / 8, latency: rtt });
  }
  requests.length = 0;
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${port}/?delegate=${delegate}&seconds=${seconds}${args.includes('--off') ? '&off=1' : ''}`);
  await page.waitForFunction(() => window.__smoke !== undefined, null, { timeout: 240_000 });
  const smoke = await page.evaluate(() => window.__smoke);
  results.runs.push({ label, wallMs: Date.now() - t0, packRequests: requests.slice(), packBytesFetched: requests.reduce((n, r) => n + r.bytes, 0), violations, smoke });
  await page.close();
}
await run('first start');
if (args.includes('--second-start')) await run('second start (pack cached in IndexedDB)');
await browser.close();
server.close();
results.uptime = (await import('node:child_process')).execSync('uptime').toString().trim();
writeFileSync(path.join(out, `smoke-${delegate}${args.includes('--off') ? '-off' : ''}-${path.basename(video)}.json`), `${JSON.stringify(results, null, 1)}\n`);
for (const r of results.runs) {
  const s = r.smoke;
  console.log(`${r.label}: error=${s.error} stage=${s.stage} delegate=${s.stats?.delegate} processed=${s.stats?.processed} dropped=${s.stats?.dropped} inferMs p50/p95/p99=${s.stats?.inferenceMs.p50?.toFixed(1)}/${s.stats?.inferenceMs.p95?.toFixed(1)}/${s.stats?.inferenceMs.p99?.toFixed(1)} fps=${s.stats?.fps?.toFixed(1)} pipeline p50/p95=${s.stats?.pipelineMs.p50?.toFixed(1)}/${s.stats?.pipelineMs.p95?.toFixed(1)} packBytesFetched=${r.packBytesFetched} wall=${r.wallMs}ms violations=${r.violations.length}`);
  const p = s.pacing;
  console.log(`  pacing (rAF, ${s.cameraOff ? 'camera OFF' : 'camera ON'}): frames=${p.frames} p50/p95/p99=${p.p50.toFixed(1)}/${p.p95.toFixed(1)}/${p.p99.toFixed(1)} ms over16.7=${p.over16} over33=${p.over33} over50=${p.over50} longTasks>50ms=${p.longTasks}`);
}
console.log(results.uptime);
