/**
 * Cloud Run job entry: claim → render → upload → complete, until no job is left, MAX_JOBS were done or the time
 * budget is spent. A failed render is reported (retried by the Worker with backoff, then dead_letter). Exit code 0
 * unless the configuration is wrong. No network beyond the Worker (and the page's own loopback server).
 */
import { readFile, rm } from 'node:fs/promises';
import { readConfig } from './config.ts';
import { renderHighlight } from './renderer.ts';
import { serveStatic } from './staticServer.ts';
import { WorkerClient } from './workerClient.ts';

export async function runJobs(env: Record<string, string | undefined>, log: (msg: Record<string, unknown>) => void = (m) => console.log(JSON.stringify(m))): Promise<number> {
  const cfg = readConfig(env);
  const worker = new WorkerClient(cfg.workerUrl, cfg.key);
  const started = Date.now();
  const site = await serveStatic(cfg.pageDir);
  let done = 0;
  try {
    while (done < cfg.maxJobs && Date.now() - started < cfg.budgetMs) {
      const claim = await worker.claim();
      if (!claim) break;
      log({ evt: 'render_start', job: claim.jobId, attempt: claim.attempt });
      let path: string | null = null;
      try {
        const result = await renderHighlight(claim.input, { origin: site.origin, ffmpeg: cfg.ffmpeg, capture: cfg.capture, jpegQuality: cfg.jpegQuality, outDir: cfg.tmpDir });
        path = result.path;
        const video = new Uint8Array(await readFile(path));
        const sha256 = await worker.upload(claim, video);
        await worker.complete(claim.jobId, { sha256, bytes: video.byteLength, durationMs: result.timeline.durationMs, frames: result.timeline.frames });
        log({ evt: 'render_done', job: claim.jobId, bytes: video.byteLength, frames: result.timeline.frames });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // An input the page refuses (bad duration, fps) will not render on a retry either.
        const retryable = !/30–60 s|fps/.test(message);
        log({ evt: 'render_failed', job: claim.jobId, retryable, error: message.slice(0, 200) });
        await worker.fail(claim.jobId, message.replace(/[^\w .:-]/g, ' ').slice(0, 120), retryable).catch(() => undefined);
      } finally {
        if (path) await rm(path, { force: true }).catch(() => undefined);
        await rm(`${cfg.tmpDir}/${claim.jobId}.wav`, { force: true }).catch(() => undefined);
      }
      done++;
    }
  } finally {
    await site.close();
  }
  log({ evt: 'render_exit', jobs: done });
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runJobs(process.env).catch((e) => {
    console.error(JSON.stringify({ evt: 'render_config_error', error: e instanceof Error ? e.message : String(e) }));
    process.exit(1);
  });
}
