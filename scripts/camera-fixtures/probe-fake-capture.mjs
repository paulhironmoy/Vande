/**
 * Probe: what does the installed Chromium do with a file given to --use-file-for-fake-video-capture?
 *
 * Builds two tiny test clips with ffmpeg (a grey level that rises with the frame number, so the frame index can be read
 * back from the picture), one as .mjpeg (concatenated JPEG frames) and one as .y4m, opens each as the fake camera in
 * headless Chromium and records, per delivered frame, the frame index read from the picture and the
 * requestVideoFrameCallback metadata. It reports: accepted or not, picture size, frames per second, loop length, dropped
 * frames, and whether captureTime is present.
 *
 *   node scripts/camera-fixtures/probe-fake-capture.mjs <work-dir> [seconds]
 *
 * Builder tool: it measures the browser, not a player. Run it through `sh S/heavy.sh` (it starts Chromium and ffmpeg).
 */
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const work = resolve(process.argv[2] ?? 'test-results-camera-fixtures/probe');
const seconds = Number(process.argv[3] ?? 10);
const FRAMES = 120; // 4 s at 30 fps
mkdirSync(work, { recursive: true });

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
}

// The grey level of every pixel = 255 * N / (FRAMES - 1), N = frame number.
const src = ['-f', 'lavfi', '-i', `color=c=black:s=640x480:r=30:d=${FRAMES / 30}`, '-vf', `geq=lum='255*N/${FRAMES - 1}':cb=128:cr=128`, '-frames:v', String(FRAMES)];
const files = {
  mjpeg: join(work, 'probe.mjpeg'),
  y4m: join(work, 'probe.y4m'),
};
ffmpeg([...src, '-c:v', 'mjpeg', '-q:v', '3', '-pix_fmt', 'yuvj420p', '-f', 'mjpeg', files.mjpeg]);
ffmpeg([...src, '-pix_fmt', 'yuv420p', '-f', 'yuv4mpegpipe', files.y4m]);
for (const [k, f] of Object.entries(files)) console.log(`built ${k}: ${f} ${statSync(f).size} bytes`);

const page = `<!doctype html><meta charset=utf-8><title>probe</title><video id=v autoplay muted playsinline></video><canvas id=c width=8 height=8></canvas>`;
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(page);
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://localhost:${server.address().port}/`;

async function probe(kind, file) {
  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${file}`,
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ['camera'] });
    const p = await context.newPage();
    await p.goto(origin);
    const out = await p.evaluate(
      async ([secs, frames]) => {
        const info = { ok: false };
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 30 }, audio: false });
          const track = stream.getVideoTracks()[0];
          info.label = track.label;
          info.settings = track.getSettings();
          const devices = await navigator.mediaDevices.enumerateDevices();
          info.devices = devices.map((d) => ({ kind: d.kind, label: d.label }));
          const v = document.getElementById('v');
          v.srcObject = stream;
          await v.play();
          const cv = document.getElementById('c');
          const g = cv.getContext('2d', { willReadFrequently: true });
          const rows = [];
          const t0 = performance.now();
          await new Promise((done) => {
            const tick = (now, meta) => {
              g.drawImage(v, 0, 0, 8, 8);
              const px = g.getImageData(0, 0, 8, 8).data;
              let s = 0;
              for (let i = 0; i < 64; i++) s += px[i * 4];
              const grey = s / 64;
              rows.push({
                idx: Math.round((grey / 255) * (frames - 1)),
                grey: Math.round(grey * 10) / 10,
                now: Math.round(now * 100) / 100,
                media: meta.mediaTime,
                presented: meta.presentedFrames,
                capture: meta.captureTime ?? null,
                receive: meta.receiveTime ?? null,
                w: meta.width,
                h: meta.height,
              });
              if (performance.now() - t0 < secs * 1000) v.requestVideoFrameCallback(tick);
              else done();
            };
            v.requestVideoFrameCallback(tick);
          });
          stream.getTracks().forEach((t) => t.stop());
          info.ok = true;
          info.rows = rows;
        } catch (e) {
          info.error = String(e && e.name) + ': ' + String(e && e.message);
        }
        return info;
      },
      [seconds, FRAMES],
    );
    return out;
  } finally {
    await browser.close();
  }
}

function summarise(kind, r) {
  if (!r.ok) return { kind, ok: false, error: r.error };
  const rows = r.rows;
  const n = rows.length;
  const span = rows[n - 1].now - rows[0].now;
  const wraps = [];
  for (let i = 1; i < n; i++) if (rows[i].idx < rows[i - 1].idx - FRAMES / 2) wraps.push(i);
  const steps = [];
  for (let i = 1; i < n; i++) {
    const d = rows[i].idx - rows[i - 1].idx;
    steps.push(d < -FRAMES / 2 ? d + FRAMES : d);
  }
  const hist = {};
  for (const s of steps) hist[s] = (hist[s] ?? 0) + 1;
  const loopMs = wraps.length >= 2 ? (rows[wraps[wraps.length - 1]].now - rows[wraps[0]].now) / (wraps.length - 1) : null;
  const captureDeltas = rows.filter((x) => x.capture != null).map((x) => x.now - x.capture);
  const firstIdx = rows.slice(0, 5).map((x) => x.idx);
  return {
    kind,
    ok: true,
    label: r.label,
    settings: r.settings,
    devices: r.devices,
    callbacks: n,
    callbacksPerSecond: Math.round(((n - 1) / (span / 1000)) * 100) / 100,
    pictureSize: `${rows[0].w}x${rows[0].h}`,
    loopsSeen: wraps.length,
    loopMs: loopMs && Math.round(loopMs),
    framesPerLoopFromIdx: FRAMES,
    effectiveFps: loopMs ? Math.round((FRAMES / (loopMs / 1000)) * 100) / 100 : null,
    indexStepHistogram: hist,
    firstIndices: firstIdx,
    captureTimePresent: captureDeltas.length > 0,
    nowMinusCaptureMs: captureDeltas.length
      ? { min: Math.min(...captureDeltas).toFixed(1), median: captureDeltas.sort((a, b) => a - b)[captureDeltas.length >> 1].toFixed(1), max: Math.max(...captureDeltas).toFixed(1) }
      : null,
  };
}

const results = [];
for (const [kind, file] of Object.entries(files)) {
  const r = await probe(kind, file);
  results.push(summarise(kind, r));
}
server.close();
console.log(JSON.stringify({ utc: new Date().toISOString(), chromium: (await chromium.executablePath?.()) ?? null, seconds, results }, null, 1));
