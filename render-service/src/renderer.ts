/**
 * Renders one HighlightRenderInput to an MP4: headless Chromium (Playwright) with SwiftShader WebGL loads render.html
 * from the loopback server at 1080×1920, `__vcHighlight.load(input)`, then for every frame `frame(t)` and a CDP
 * screenshot piped into ffmpeg. The page may reach only the loopback server (everything else is aborted), so a
 * replay cannot make the container fetch anything.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HighlightRenderInput } from '../../src/contracts/highlights.ts';
import { ffmpegArgs } from './ffmpeg.ts';
import { HEIGHT, WIDTH, frameTimes, timeline, type Timeline } from './schedule.ts';
import { JOB_ID_RE } from './workerClient.ts';

export const CHROMIUM_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox', '--no-first-run', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'];

export interface RenderOptions {
  origin: string;
  page?: string;
  ffmpeg: string;
  capture: 'jpeg' | 'png';
  jpegQuality: number;
  outDir: string;
  /** Called after each frame (progress, lease keeping). */
  onFrame?: (index: number, total: number) => void;
}

export interface RenderResult {
  path: string;
  timeline: Timeline;
}

export async function renderHighlight(input: HighlightRenderInput, o: RenderOptions): Promise<RenderResult> {
  // The job id names the output files: only the Worker's id format, never a path.
  if (!JOB_ID_RE.test(input.jobId)) throw new Error('bad job id');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS });
  try {
    const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' });
    await context.route('**/*', (route) => (route.request().url().startsWith(`${o.origin}/`) ? route.continue() : route.abort('blockedbyclient')));
    const page = await context.newPage();
    await page.goto(`${o.origin}/${o.page ?? 'render.html'}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof (window as unknown as { __vcHighlight?: unknown }).__vcHighlight === 'object', undefined, { timeout: 30_000 });
    const loaded = await page.evaluate((i) => (window as unknown as { __vcHighlight: { load(x: unknown): Promise<{ durationMs: number; fps: number }> } }).__vcHighlight.load(i), input as unknown);
    const t = timeline(loaded);
    // Optional: the composer's own generated audio, as base64 WAV (silent when absent).
    const wav = await page.evaluate(async () => {
      const host = (window as unknown as { __vcHighlight: { audio?: () => Promise<string | null> } }).__vcHighlight;
      return typeof host.audio === 'function' ? await host.audio() : null;
    });
    const audio = wav ? join(o.outDir, `${input.jobId}.wav`) : null;
    if (audio && wav) await writeFile(audio, Buffer.from(wav, 'base64'));
    const output = join(o.outDir, `${input.jobId}.mp4`);
    const ff = spawn(o.ffmpeg, ffmpegArgs({ output, durationMs: t.durationMs, capture: o.capture, audio }), { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    ff.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    const exited = once(ff, 'close') as Promise<[number | null]>;
    const cdp = await context.newCDPSession(page);
    for (const { index, tMs } of frameTimes(t)) {
      await page.evaluate((ms) => (window as unknown as { __vcHighlight: { frame(t: number): Promise<void> } }).__vcHighlight.frame(ms), tMs);
      const shot = (await cdp.send('Page.captureScreenshot', { format: o.capture, ...(o.capture === 'jpeg' ? { quality: o.jpegQuality } : {}), fromSurface: true, captureBeyondViewport: false })) as { data: string };
      if (!ff.stdin.write(Buffer.from(shot.data, 'base64'))) await once(ff.stdin, 'drain');
      o.onFrame?.(index, t.frames);
    }
    ff.stdin.end();
    const [code] = await exited;
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}: ${stderr.trim().split('\n').pop() ?? ''}`);
    return { path: output, timeline: t };
  } finally {
    await browser.close();
  }
}
