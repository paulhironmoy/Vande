/**
 * Model smoke test, page side (scripts/camera/smoke.mjs bundles and serves this): start the real session with the real pack in
 * a real browser under the production Content-Security-Policy, let the (fake) camera run, and report numbers. It reads no
 * picture and keeps none: the session returns landmarks and durations only.
 */
import { createCameraSession } from '@/input/camera/session';
import type { CameraPackInfo } from '@/input/camera/pack';

declare global {
  interface Window {
    __smoke?: unknown;
  }
}

const q = new URLSearchParams(location.search);
const delegate = (q.get('delegate') ?? 'auto') as 'auto' | 'GPU' | 'CPU';
const seconds = Number(q.get('seconds') ?? '8');
const off = q.get('off') === '1';
const info = (await (await fetch('/pack-info.json')).json()) as CameraPackInfo;
const poses: Array<{ lm: number[] | null; inferMs: number }> = [];
const session = createCameraSession({
  info,
  base: '/',
  delegate,
  onPose: (lm, inferMs) => {
    if (poses.length < 400) poses.push({ lm: lm ? Array.from(lm) : null, inferMs });
  },
});
const marks: Record<string, number> = { t0: performance.now() };
session.subscribe(() => {
  const s = session.status();
  marks[`stage_${s.stage}`] ??= performance.now();
});
let error: string | null = null;
// Frame pacing of this page while the camera pipeline runs (or with the camera off, for comparison): requestAnimationFrame
// intervals and long tasks. An empty page, so it shows what the camera costs the main thread, not what the game costs.
const deltas: number[] = [];
let longTasks = 0;
try {
  new PerformanceObserver((l) => {
    longTasks += l.getEntries().filter((e) => e.duration > 50).length;
  }).observe({ entryTypes: ['longtask'] });
} catch {
  /* long tasks are not reported by every browser */
}
try {
  if (!off) await session.start();
  marks.running = performance.now();
  let last = performance.now();
  let live = true;
  const loop = () => {
    const n = performance.now();
    deltas.push(n - last);
    last = n;
    if (live) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, seconds * 1000));
  live = false;
} catch (e) {
  error = `${(e as Error).name}: ${(e as Error).message} [${(e as { problem?: string }).problem ?? ''}]`;
}
const stats = session.stats();
const st = session.status();
window.__smoke = {
  error,
  stage: st.stage,
  problem: st.problem,
  pack: st.pack,
  readiness: st.readiness,
  stats,
  marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, Math.round((v - marks.t0) * 10) / 10])),
  poses: poses.slice(0, 200),
  poseCount: poses.length,
  pacing: (() => {
    const d = [...deltas.slice(2)].sort((a, b) => a - b);
    const at = (p: number) => d[Math.min(d.length - 1, Math.floor((p / 100) * d.length))] ?? 0;
    return { frames: d.length, p50: at(50), p95: at(95), p99: at(99), over16: d.filter((x) => x > 16.7).length, over33: d.filter((x) => x > 33.4).length, over50: d.filter((x) => x > 50).length, longTasks };
  })(),
  cameraOff: off,
  secure: window.isSecureContext,
  csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? null,
};
session.stop();
