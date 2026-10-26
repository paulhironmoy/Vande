/**
 * Renders a highlight Short the way the render service does (render.html, 1080 x 1920) from the Vite dev server:
 * a contact sheet of frames (the first 2 s hook, each scene's start and middle) and the mastered soundtrack, with
 * its loudness (integrated LUFS, true peak) measured by src/audio/loudness.ts.
 *
 *   node scripts/perf/highlight.mjs [replay-log.json] [out-dir]
 * Without a log it uses the dev fixture match. Writes <out-dir>/sheet.png, frame PNGs and highlight.wav.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, chromium } from './serve.mjs';

const logPath = process.argv[2] && process.argv[2] !== '-' ? resolve(process.argv[2]) : null;
const out = resolve(process.argv[3] ?? join(ROOT, 'test-results-exp', 'highlight'));
mkdirSync(out, { recursive: true });
const req = createRequire(join(ROOT, 'package.json'));
const viteMod = await import(pathToFileURL(req.resolve('vite')).href);
const createServer = viteMod.createServer ?? viteMod.default.createServer;
const sharp = (await import(pathToFileURL(req.resolve('sharp')).href)).default;
const loudness = await import(pathToFileURL(join(ROOT, 'src/audio/loudness.ts')).href);

const server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), logLevel: 'error', cacheDir: join(ROOT, 'node_modules/.vite-perf'), server: { host: '127.0.0.1', port: 0, hmr: false, watch: null } });
await server.listen();
const port = server.httpServer.address().port;
const args = process.platform === 'darwin' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'];
const browser = await (await chromium()).launch({ args });
try {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/render.html`);
  await page.waitForFunction(() => typeof window.__vcHighlight === 'object', null, { timeout: 60_000 });
  const log = logPath ? JSON.parse(readFileSync(logPath, 'utf8')) : null;
  const loaded = await page.evaluate(async (given) => {
    const log = given ?? (await import('/src/screens/dev/fixtures.ts')).fixtureMatchLog();
    const input = { jobId: 'job-perf', log, aliases: [log.players[0].alias, log.players[1].alias], locale: 'en', fixtureLabel: 'Friend Duel', day: '2026-10-25', ranks: [7, 42], standings: null, cta: { url: 'https://vande.example/h/abc123' } };
    const r = await window.__vcHighlight.load(input);
    return { ...r, scenes: window.__vcHighlight.plan().scenes.map((s) => ({ kind: s.kind, t0: s.t0, t1: s.t1, tags: s.tags ?? null })) };
  }, log);
  console.log('plan', loaded.durationMs, 'ms:', loaded.scenes.map((s) => `${s.kind}${s.tags ? `[${s.tags.join(',')}]` : ''}@${s.t0}`).join(' '));
  const times = [300, 1000, 1700];
  for (const s of loaded.scenes) times.push(s.t0 + 400, Math.round((s.t0 + s.t1) / 2));
  // SHOT=crowd (for example) samples the frames where that camera shot is on screen instead.
  if (process.env.SHOT) {
    times.length = 0;
    const found = await page.evaluate(
      async ({ given, shot, duration }) => {
        const log = given ?? (await import('/src/screens/dev/fixtures.ts')).fixtureMatchLog();
        const { buildTimeline, locate } = await import('/src/render3d/core/timeline.ts');
        const { planFor, cueAt } = await import('/src/render3d/core/camera.ts');
        const { sceneAt } = await import('/src/highlight/plan.ts');
        const tl = buildTimeline(log, 'full');
        const plan = window.__vcHighlight.plan();
        const hits = [];
        for (let t = 0; t < duration && hits.length < 12; t += 250) {
          const at = sceneAt(plan, t);
          const loc = locate(tl, at.replay);
          if (cueAt(planFor(loc.seg.script, false), loc.scene)?.shot === shot) hits.push(t);
        }
        return hits;
      },
      { given: log, shot: process.env.SHOT, duration: loaded.durationMs },
    );
    times.push(...found);
  }
  const picked = [...new Set(times.filter((t) => t < loaded.durationMs).sort((a, b) => a - b))].slice(0, 24);
  const tiles = [];
  for (const t of picked) {
    const png = await page.evaluate(async (t) => {
      await window.__vcHighlight.frame(t);
      return document.getElementById('highlight').toDataURL('image/png');
    }, t);
    const buf = Buffer.from(png.split(',')[1], 'base64');
    writeFileSync(join(out, `hl-${String(t).padStart(6, '0')}.png`), buf);
    tiles.push(await sharp(buf).resize(270, 480).png().toBuffer());
  }
  const cols = 6;
  const rows = Math.ceil(tiles.length / cols);
  const sheet = sharp({ create: { width: cols * 270, height: rows * 480, channels: 3, background: '#06051f' } }).composite(tiles.map((input, i) => ({ input, left: (i % cols) * 270, top: Math.floor(i / cols) * 480 })));
  await sheet.png().toFile(join(out, 'sheet.png'));
  console.log('frames', picked.join(' '));
  // Which camera shot each frame used (portrait framing checks).
  const shots = await page.evaluate(
    async ({ given, picked }) => {
      const log = given ?? (await import('/src/screens/dev/fixtures.ts')).fixtureMatchLog();
      const { buildTimeline, locate } = await import('/src/render3d/core/timeline.ts');
      const { planFor, cueAt } = await import('/src/render3d/core/camera.ts');
      const { sceneAt } = await import('/src/highlight/plan.ts');
      const tl = buildTimeline(log, 'full');
      const plan = window.__vcHighlight.plan();
      return picked.map((t) => {
        const at = sceneAt(plan, t);
        const loc = locate(tl, at.replay);
        const cue = cueAt(planFor(loc.seg.script, false), loc.scene);
        return `${t}:${at.scene.kind}/${loc.seg.kind}/${cue?.shot ?? '-'}`;
      });
    },
    { given: log, picked },
  );
  console.log('shots', shots.join(' '));
  const wav = await page.evaluate(() => window.__vcHighlight.audio());
  if (wav) {
    const bytes = Buffer.from(wav, 'base64');
    writeFileSync(join(out, 'highlight.wav'), bytes);
    const sr = bytes.readUInt32LE(24);
    const ch = bytes.readUInt16LE(22);
    const n = (bytes.length - 44) / 2 / ch;
    const chans = Array.from({ length: ch }, () => new Float32Array(n));
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) chans[c][i] = bytes.readInt16LE(44 + (i * ch + c) * 2) / 32768;
    const m = loudness.measure(chans, sr);
    console.log('audio', JSON.stringify({ sampleRate: sr, channels: ch, seconds: +(n / sr).toFixed(2), integratedLufs: +m.integrated.toFixed(2), truePeakDbtp: +m.truePeak.toFixed(2), samplePeakDbfs: +m.samplePeak.toFixed(2) }));
    console.log('mastering', JSON.stringify(await page.evaluate(() => window.__vcHighlight.audioReport?.())));
  }
  if (errors.length) console.log('page errors', JSON.stringify(errors.slice(0, 5)));
  console.log('wrote', out);
} finally {
  await browser.close();
  await server.close();
}
