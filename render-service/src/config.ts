/** Render service configuration (Cloud Run job environment). No defaults for secrets; the job refuses to start without them. */
import { parseRenderKey, type RenderKey } from './signing.ts';

export interface RenderConfig {
  /** The Worker's origin (https://api.example), the only network destination besides the page's own loopback server. */
  workerUrl: URL;
  key: RenderKey;
  /** Built web app with render.html (vite build), served on 127.0.0.1 inside the container. */
  pageDir: string;
  ffmpeg: string;
  /** Frame capture format piped to ffmpeg. */
  capture: 'jpeg' | 'png';
  jpegQuality: number;
  /** Jobs per execution and the wall-clock budget (the Cloud Run task timeout minus a margin). */
  maxJobs: number;
  budgetMs: number;
  tmpDir: string;
}

function int(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  return raw === undefined || raw === '' || !Number.isFinite(n) ? fallback : Math.min(max, Math.max(min, Math.floor(n)));
}

export function readConfig(env: Record<string, string | undefined>): RenderConfig {
  const raw = env.WORKER_URL ?? '';
  let workerUrl: URL;
  try {
    workerUrl = new URL(raw);
  } catch {
    throw new Error('WORKER_URL must be the Worker origin, e.g. https://api.vande.cricket');
  }
  const local = workerUrl.hostname === '127.0.0.1' || workerUrl.hostname === 'localhost';
  if (workerUrl.protocol !== 'https:' && !(local && workerUrl.protocol === 'http:')) throw new Error('WORKER_URL must use https');
  if (workerUrl.pathname !== '/' || workerUrl.search || workerUrl.username) throw new Error('WORKER_URL must be a bare origin');
  return {
    workerUrl,
    key: parseRenderKey(env.RENDER_KEY),
    pageDir: env.RENDER_PAGE_DIR ?? '/app/dist',
    ffmpeg: env.FFMPEG_PATH ?? 'ffmpeg',
    capture: env.CAPTURE_FORMAT === 'png' ? 'png' : 'jpeg',
    jpegQuality: int(env.JPEG_QUALITY, 92, 50, 100),
    maxJobs: int(env.MAX_JOBS, 20, 1, 200),
    budgetMs: int(env.TIME_BUDGET_MS, 50 * 60_000, 60_000, 24 * 3_600_000),
    tmpDir: env.TMPDIR ?? '/tmp',
  };
}
