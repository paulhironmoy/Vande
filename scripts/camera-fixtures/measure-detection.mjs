/**
 * Runs the real pose engine over every frame of the fixture clips in headless Chromium and writes, per clip, how often a person
 * was found, how far the landmarks are from the renderer's ground truth, the frame-to-frame jitter, the landmark lag during the
 * strike, and the inference time. Also exports the small landmark traces CAMERA's tests read and a measured noise model.
 *
 *   node scripts/camera-fixtures/measure-detection.mjs --videos DIR [--gt DIR] [--out DIR] [--clips a,b]
 *        [--engine node_modules/@mediapipe/tasks-vision] [--model assets-src/camera/pose_landmarker_lite.task]
 *        [--delegate CPU|GPU] [--model-width 384] [--quality low] [--traces tests/fixtures/camera/traces] [--write-noise FILE]
 *
 * The engine and model must be the pinned ones (hashes below, CAMERA-DESIGN section 1.1); anything else is refused, so a trace always
 * says which engine made it. Run through `sh S/heavy.sh <label> node ...` (it starts Chromium). Builder tool: it measures a model on
 * synthetic pictures; it says nothing about real people.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { analyseClip, makeTrace, mean } from './analyse.mjs';
import { splitMjpeg } from './mjpeg.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PINS = {
  'vision_bundle.mjs': '55d7ab624fbb70dcc5adc4ae6d7ea9cfcb569139d3dbfbf2b1deafcb966bc0fe',
  'pose_landmarker_lite.task': '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
};
const GT_ALIAS = { rh_drive_dim: 'rh_drive', rh_drive_noisy: 'rh_drive' };
const MIME = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.task': 'application/octet-stream', '.mjpeg': 'application/octet-stream' };

function args(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
  return a;
}

const sha256 = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function uptime() {
  return (spawnSync('uptime', { encoding: 'utf8' }).stdout ?? '').trim();
}

async function main() {
  const a = args(process.argv.slice(2));
  const videos = resolve(a.videos ?? join(REPO, 'test-results-camera-fixtures', 'videos'));
  const gtDir = resolve(a.gt ?? join(videos, '..', 'work', 'render', 'gt'));
  const out = resolve(a.out ?? join(videos, '..', 'detection'));
  const engine = resolve(a.engine ?? join(REPO, 'node_modules', '@mediapipe', 'tasks-vision'));
  const model = resolve(a.model ?? join(REPO, 'assets-src', 'camera', 'pose_landmarker_lite.task'));
  const delegate = a.delegate ?? 'CPU';
  const modelWidth = Number(a['model-width'] ?? 384);
  const quality = a.quality ?? 'low';
  const manifestFile = join(REPO, 'tests', 'fixtures', 'camera', 'manifest.json');
  const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { clips: [] };
  const ids = a.clips ? a.clips.split(',') : manifest.clips.map((c) => c.id);

  for (const [file, want] of [[join(engine, 'vision_bundle.mjs'), PINS['vision_bundle.mjs']], [model, PINS['pose_landmarker_lite.task']]]) {
    const got = sha256(file);
    if (got !== want) throw new Error(`${file} is not the pinned file (sha256 ${got}, pinned ${want})`);
  }
  const engineVersion = JSON.parse(readFileSync(join(engine, 'package.json'), 'utf8')).version;
  mkdirSync(join(out, 'raw'), { recursive: true });
  mkdirSync(join(out, 'metrics'), { recursive: true });

  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let file = null;
    if (url.pathname === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><meta charset=utf-8><title>detect</title><script type="module" src="/page.mjs"></script>');
      return;
    }
    if (url.pathname === '/page.mjs') file = join(HERE, 'detect-page.mjs');
    else if (url.pathname === '/model.task') file = model;
    else if (url.pathname.startsWith('/engine/')) file = join(engine, url.pathname.slice(8));
    else if (url.pathname.startsWith('/videos/')) file = join(videos, url.pathname.slice(8));
    if (!file || file.includes('..') || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size });
    createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const origin = `http://localhost:${server.address().port}/`;

  const upBefore = uptime();
  const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  const summary = {
    utc: new Date().toISOString(),
    buildId: spawnSync('bash', [join(REPO, 'scripts', 'build-id.sh')], { encoding: 'utf8' }).stdout.trim(),
    browser: `Chromium ${browser.version()} (headless, Playwright)`,
    engine: `@mediapipe/tasks-vision ${engineVersion}`,
    model: 'pose_landmarker_lite.task',
    pins: PINS,
    settings: { delegate, runningMode: 'VIDEO', numPoses: 1, confidence: 0.55, modelWidth, resizeQuality: quality },
    uptimeBefore: upBefore,
    clips: {},
  };
  try {
    const page = await (await browser.newContext()).newPage();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    await page.goto(origin);
    await page.waitForFunction(() => window.__detectReady === true, undefined, { timeout: 60_000 });
    for (const id of ids) {
      const file = join(videos, id + '.mjpeg');
      if (!existsSync(file)) {
        console.log(`[measure] ${id}: no video, skipped`);
        continue;
      }
      const buf = readFileSync(file);
      const ranges = splitMjpeg(buf);
      const clip = manifest.clips.find((c) => c.id === id);
      const t0 = Date.now();
      const run = await page.evaluate((o) => window.detectClip(o), { clip: id, ranges, fps: 30, modelWidth, delegate, quality });
      run.width = clip?.width ?? 640;
      run.height = clip?.height ?? 480;
      run.fps = 30;
      writeFileSync(join(out, 'raw', id + '.landmarks.json'), JSON.stringify(run));
      // Clips made from another clip's frames (darkened, noisy) have that clip's ground truth.
      const gtFile = join(gtDir, (GT_ALIAS[id] ?? id) + '.gt.json');
      const gt = existsSync(gtFile) ? JSON.parse(readFileSync(gtFile, 'utf8')) : null;
      const mk = clip?.markers ?? {};
      const marks = { stanceEnd: mk.stanceEnd ?? 1.0, strikeFrom: mk.holdEnd, strikeTo: mk.followEnd ?? mk.returnEnd };
      const metrics = analyseClip(run, gt, marks);
      metrics.seconds = (Date.now() - t0) / 1000;
      writeFileSync(join(out, 'metrics', id + '.metrics.json'), JSON.stringify(metrics, null, 1));
      summary.clips[id] = metrics;
      if (a.traces) {
        mkdirSync(resolve(a.traces), { recursive: true });
        writeFileSync(join(resolve(a.traces), id + '.trace.json'), JSON.stringify(makeTrace(id, run)) + '\n');
      }
      console.log(`[measure] ${id}: valid ${metrics.validRate}, longest gap ${metrics.longestGapFrames}, inference p50 ${metrics.inferenceMs?.p50} ms`);
    }
  } finally {
    await browser.close();
    server.close();
  }
  summary.uptimeAfter = uptime();
  writeFileSync(join(out, 'detection-summary.json'), JSON.stringify(summary, null, 1));
  if (a['write-noise']) {
    const core = Object.entries(summary.clips).filter(([id, m]) => m.landmarks && /^(rh|lh)_(drive|pull|loft|defence|leave)$/.test(id));
    const names = ['shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'wristL', 'wristR'];
    const noise = {
      format: 'VANDE-NOISEMODEL1',
      measuredFrom: `${core.length} rendered clips, ${summary.engine}, ${summary.settings.delegate}, model width ${modelWidth}`,
      note: 'Synthetic renders only. Jitter is the frame-to-frame error noise on the ready stance in shoulder widths (u); real cameras and people will differ.',
      stanceJitterU: Object.fromEntries(names.map((n) => [n, Math.round(mean(core.map(([, m]) => m.landmarks[n]?.stanceJitterU).filter((v) => Number.isFinite(v))) * 1e4) / 1e4])),
      validRate: Math.round(mean(core.map(([, m]) => m.validRate)) * 1e4) / 1e4,
      longestGapFrames: Math.max(...core.map(([, m]) => m.longestGapFrames)),
      lagMs: Object.fromEntries(core.map(([id, m]) => [id, m.lag?.yMs ?? null])),
    };
    mkdirSync(dirname(resolve(a['write-noise'])), { recursive: true });
    writeFileSync(resolve(a['write-noise']), JSON.stringify(noise, null, 1) + '\n');
  }
  console.log('[measure] done');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
