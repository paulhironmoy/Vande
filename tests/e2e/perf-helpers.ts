/**
 * Helpers for the performance and robustness specs (perf-practice-*.spec.ts, the `practice` project): the passive
 * recorder (scripts/perf/observer.js: frame timestamps, phases, long tasks, WebGL program links and allocations),
 * walking the real UI to the next delivery, and reading the recorder back per delivery.
 */
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { DeliveryRecord } from '../../src/contracts/practice';
import type { HookState } from './practice-helpers';

export const OBSERVER = fileURLToPath(new URL('../../scripts/perf/observer.js', import.meta.url));

export async function record(page: Page) {
  await page.addInitScript({ path: OBSERVER });
}

/** Buttons that move Practice on towards a bowled ball (the current UI and the one being built). */
const FORWARD = [
  'launch-practice',
  'practice-resume',
  'practice-continue',
  'practice-quick',
  'practice-random',
  'practice-play-start',
  'practice-radar-go',
  'practice-tap-go',
  'practice-next-ball',
  'practice-next-over',
  'practice-new-innings',
  'practice-start-over',
  'practice-classic',
  'practice-turn-continue',
];

type Phase = [number, string, string, string, string];

export interface DeliveryCheckpoint {
  atMs: number;
  phaseCount: number;
  released: number;
  pending: number;
  inningsId: string | null;
  records: DeliveryRecord[];
  state: HookState | null;
}

/** Release count and persisted records are different facts: the former advances before the latter is committed. */
export async function deliveryCheckpoint(page: Page): Promise<DeliveryCheckpoint> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __perf: { phases: Phase[] };
      __vandePractice?: { delivered(): { innings: number }; pending(): number; state(): HookState | null };
    };
    const saved = JSON.parse(localStorage.getItem('vc:practice:innings') ?? 'null')?.state;
    return {
      atMs: performance.now(),
      phaseCount: w.__perf.phases.length,
      released: w.__vandePractice?.delivered().innings ?? 0,
      pending: w.__vandePractice?.pending() ?? 0,
      inningsId: saved?.id ?? null,
      records: [
        ...(saved?.overs ?? []).flatMap((o: { deliveries: DeliveryRecord[] }) => o.deliveries),
        ...(saved?.current?.deliveries ?? []),
      ],
      state: w.__vandePractice?.state() ?? null,
    };
  });
}

/**
 * Taps through the real UI until exactly one delivery begins. A loaded renderer can finish run-up/live between
 * driver polls: historical phases and the monotonic release counter prevent the helper from bowling another ball.
 */
export async function toDelivery(page: Page, timeoutMs = 120_000, checkpoint?: DeliveryCheckpoint): Promise<string[]> {
  const pressed: string[] = [];
  const before = checkpoint ?? (await deliveryCheckpoint(page));
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const begun = await page.evaluate(({ released, phaseCount }) => {
      const w = window as unknown as {
        __perf: { phases: Phase[] };
        __vandePractice?: { delivered(): { innings: number }; state(): HookState | null };
      };
      const phase = w.__vandePractice?.state()?.phase;
      return (
        (w.__vandePractice?.delivered().innings ?? 0) > released ||
        ['runup', 'live', 'playing'].includes(phase ?? '') ||
        w.__perf.phases.slice(phaseCount).some((p) => ['runup', 'live', 'playing'].includes(p[2]))
      );
    }, before);
    if (begun) return pressed;
    const id = await page
      .evaluate((ids) => {
        for (const id of ids) {
          const el = document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement | null;
          if (el && !el.disabled && el.getClientRects().length) return id;
        }
        return null;
      }, FORWARD)
      .catch(() => null);
    if (id && !pressed.includes(id)) {
      pressed.push(id);
      // These controls change app state, not documents. Do not couple successful input dispatch to Chromium's
      // post-click Page.enable/hit-target cleanup roundtrip while the 3D stage is warming. The transaction's phase,
      // release counter and immutable record assertions below still prove the action completed; errors propagate.
      await page.getByTestId(id).first().click({ timeout: 10_000, noWaitAfter: true });
      await page.waitForTimeout(250);
    } else await page.waitForTimeout(150);
  }
  throw new Error(`no delivery within ${timeoutMs} ms (pressed ${pressed.join(', ')})`);
}

/**
 * Wait for the one requested queued input to be committed AND its presentation to finish. Capture its record now,
 * before a legitimate wicket restart replaces localStorage. Never use final-innings ball count as a session count.
 */
export async function completedDelivery(
  page: Page,
  before: DeliveryCheckpoint,
  pressed: string[],
  timeoutMs = 120_000,
) {
  if (before.pending < 1) throw new Error('a recorded delivery requires an explicitly queued input');
  await page.waitForFunction(
    ({ released }) => {
      const api = (
        window as unknown as { __vandePractice?: { delivered(): { innings: number }; state(): HookState | null } }
      ).__vandePractice;
      const count = api?.delivered().innings ?? 0;
      if (count > released + 1) throw new Error(`helper advanced more than one delivery (${released} → ${count})`);
      const st = api?.state();
      return count === released + 1 && st?.phase === 'dead' && st.last?.kind === 'innings' && st.inFlight === null;
    },
    before,
    { timeout: timeoutMs, polling: 20 },
  );
  const after = await deliveryCheckpoint(page);
  if (after.released !== before.released + 1) throw new Error('expected exactly one released delivery');
  if (after.pending !== before.pending - 1)
    throw new Error(`expected one queued input consumed (${before.pending} → ${after.pending})`);
  if (before.inningsId !== null && after.inningsId !== before.inningsId) {
    const ended = before.state?.status === 'out' || before.state?.status === 'complete';
    const restarted = pressed.some((id) => id === 'practice-new-innings' || id === 'practice-start-over');
    if (!ended || !restarted)
      throw new Error('innings identity changed without an explicit restart of a completed innings');
  }
  const expected = after.inningsId === before.inningsId ? before.records.length + 1 : 1;
  if (after.records.length !== expected)
    throw new Error(`expected ${expected} persisted records, got ${after.records.length}`);
  const delivery = after.records.at(-1)!;
  if (
    after.inningsId === before.inningsId &&
    JSON.stringify(after.records.slice(0, -1)) !== JSON.stringify(before.records)
  )
    throw new Error('a prior delivery record changed');
  return {
    ...after,
    delivery,
    pressed,
    key: `${after.inningsId}:${delivery.overIndex}:${delivery.ballIndex}:${delivery.seed}`,
  };
}

/** Resolves once the phase is one of `want` (now, if it already is). */
export async function untilPhase(page: Page, want: string[], timeoutMs = 90_000): Promise<number | null> {
  return page.evaluate(
    ([w, ms]) =>
      new Promise<number | null>((resolve) => {
        const P = (window as unknown as { __perf: { phases: Phase[] } }).__perf;
        const start = P.phases.length;
        const t0 = performance.now();
        const tick = () => {
          const cur = P.phases.at(-1);
          if (start > 0 && cur === P.phases[start - 1] && w.includes(cur[2])) return resolve(cur[0]);
          for (let i = start; i < P.phases.length; i++) if (w.includes(P.phases[i][2])) return resolve(P.phases[i][0]);
          if (performance.now() - t0 > ms) return resolve(null);
          setTimeout(tick, 10);
        };
        tick();
      }),
    [want, timeoutMs] as const,
  );
}

/** Dead ball: the phase after a delivery (current UI: dead or a close-up; the committed UI: coaching). */
export const DEAD = ['dead', 'closeup', 'coaching', 'paused', 'idle', 'warmup_explain', 'replay'];

export interface DeliveryWindow {
  runup: number;
  release: number | null;
  dead: number | null;
  stage: string;
  tier: string;
  links: number;
  compiles: number;
  longTasks: number;
}

/** Each delivery's window (run-up to dead ball) with the program links, shader compiles and long tasks inside it. */
export async function deliveryWindows(
  page: Page,
): Promise<{ windows: DeliveryWindow[]; linksBefore: number; linksTotal: number }> {
  return page.evaluate(() => {
    const P = (
      window as unknown as {
        __perf: {
          phases: Phase[];
          gl: { links: Array<[number, number]>; compiles: Array<[number, number]> };
          longTasks: Array<[number, number]>;
        };
      }
    ).__perf;
    const out: DeliveryWindow[] = [];
    let cur: DeliveryWindow | null = null;
    for (const [t, , phase, stage, tier] of P.phases) {
      if (phase === 'runup' && (!cur || cur.dead !== null)) {
        cur = { runup: t, release: null, dead: null, stage, tier, links: 0, compiles: 0, longTasks: 0 };
        out.push(cur);
      } else if (!cur || cur.dead !== null) continue;
      else if (phase === 'live' && cur.release === null) cur.release = t;
      else if (phase !== 'runup' && phase !== 'live' && phase !== 'playing') cur.dead = t;
    }
    const inside = (t: number, w: DeliveryWindow) => t >= w.runup && t < (w.dead ?? Infinity);
    for (const w of out) {
      w.links = P.gl.links.filter(([t]) => inside(t, w)).length;
      w.compiles = P.gl.compiles.filter(([t]) => inside(t, w)).length;
      w.longTasks = P.longTasks.filter(([t]) => inside(t, w)).length;
    }
    return {
      windows: out,
      linksBefore: P.gl.links.filter(([t]) => !out.length || t < out[0].runup).length,
      linksTotal: P.gl.links.length,
    };
  });
}

/** JS heap (after a full GC), DOM nodes, listeners and the WebGL bytes the app holds. */
export async function memory(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  await cdp.send('Performance.enable');
  const { metrics } = await cdp.send('Performance.getMetrics');
  const m = Object.fromEntries(metrics.map((x) => [x.name, x.value]));
  const gl = await page.evaluate(() =>
    (
      window as unknown as { __perf: { glSnapshot(): { tex: number; buf: number; rb: number; programs: number } } }
    ).__perf.glSnapshot(),
  );
  await cdp.detach();
  return {
    heapMb: m.JSHeapUsedSize / 2 ** 20,
    nodes: m.Nodes,
    listeners: m.JSEventListeners,
    glMb: (gl.tex + gl.buf + gl.rb) / 2 ** 20,
    programs: gl.programs,
  };
}

/** Loses (and optionally restores) the WebGL context of the stage's live canvas, as a GPU reset would. */
export async function loseContext(page: Page, restoreAfterMs: number | null): Promise<boolean> {
  return page.evaluate((ms) => {
    const P = (
      window as unknown as {
        __perf: { gl: { contexts: Array<{ ref: WeakRef<HTMLCanvasElement>; type: string; lost: boolean }> } };
      }
    ).__perf;
    const c = P.gl.contexts.filter((x) => !x.lost && x.ref.deref()?.isConnected).at(-1);
    const gl = c ? (c.ref.deref()?.getContext(c.type as 'webgl2') as WebGL2RenderingContext | null) : null;
    const ext = gl?.getExtension('WEBGL_lose_context');
    if (!ext) return false;
    ext.loseContext();
    if (ms !== null) setTimeout(() => ext.restoreContext(), ms);
    return true;
  }, restoreAfterMs);
}
