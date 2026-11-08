/**
 * The work thread's side of the protocol (./protocol.ts), free of any worker global so it runs in tests as it runs in
 * the worker (./practice.worker.ts only connects it to `self`).
 *
 * Priority is the live ball's. A prepared ball holds every coach reading at its next simulation boundary until the ball
 * is resolved or released, so a swing never waits behind the coach for more than the one simulation that was already
 * running when the ball was prepared (and that was during the run-up). A reading yields to the event loop after every
 * simulation for the same reason, and so that an abort is seen at once.
 */
import type { DeliveryResult } from '@/contracts';
import { KEPT_RESULTS, WORK_PROTOCOL, type BallJob, type FromWorker, type ToWorker } from './protocol';
import { readRecord, resolveBall, warmSwing, type BallKit, type ReadKit } from './work';

export type WorkKit = BallKit & ReadKit;

export interface WorkHostEnv {
  build: string;
  sim: number;
  now?: () => number;
  /** One turn of the event loop (a message on a fresh channel; the default). */
  yieldTask?: () => Promise<void>;
  /** The longest a reading waits for a live ball (ms); a ball cannot stay live longer, so it never waits for ever. */
  liveHoldMaxMs?: number;
}

export interface WorkHost {
  handle(msg: ToWorker): void;
}

function channelYield(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel !== 'function') {
      setTimeout(resolve, 0);
      return;
    }
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

const message = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

export function createWorkHost(kit: WorkKit, post: (m: FromWorker) => void, env: WorkHostEnv): WorkHost {
  const now = env.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const yieldTask = env.yieldTask ?? channelYield;
  const liveHoldMaxMs = env.liveHoldMaxMs ?? 30_000;
  const live = new Map<number, BallJob>();
  const kept = new Map<number, DeliveryResult>();
  /** Each prepared ball's no-swing result, resolved while its run-up plays (the same function and inputs as a leave). */
  const leaves = new Map<number, DeliveryResult>();
  const readings = new Map<number, AbortController>();
  let warmed = false;
  let waiters: Array<() => void> = [];

  const liveChanged = () => {
    const w = waiters;
    waiters = [];
    for (const f of w) f();
  };

  /** Waits (bounded) while a ball is live: the next simulation starts only when the ball has been resolved. */
  async function yieldTo(): Promise<void> {
    await yieldTask();
    const since = now();
    while (live.size > 0) {
      const left = liveHoldMaxMs - (now() - since);
      if (left <= 0) return;
      await new Promise<void>((resolve) => {
        const id = setTimeout(resolve, left);
        waiters.push(() => {
          clearTimeout(id);
          resolve();
        });
      });
    }
  }

  function warm(job: BallJob): number | null {
    if (warmed) return null;
    warmed = true;
    const t0 = now();
    try {
      resolveBall(kit, job, warmSwing(job));
    } catch {
      /* warming is best effort */
    }
    return now() - t0;
  }

  function keep(ball: number, result: DeliveryResult): void {
    kept.set(ball, result);
    while (kept.size > KEPT_RESULTS) kept.delete(kept.keys().next().value as number);
  }

  async function read(msg: Extract<ToWorker, { t: 'analyze' }>): Promise<void> {
    const ctl = new AbortController();
    readings.set(msg.job, ctl);
    const t0 = now();
    try {
      const result = msg.result ?? (msg.ball !== null ? kept.get(msg.ball) : undefined);
      if (!result) throw new Error('worker: the result to read is not here');
      // The reading starts at a simulation boundary too: a ball prepared before it arrived is served first.
      await yieldTo();
      if (ctl.signal.aborted) {
        post({ t: 'aborted', job: msg.job });
        return;
      }
      const out = await readRecord(kit, msg.record, result, msg.want, { sliceMs: 0, signal: ctl.signal, yieldTo });
      if (ctl.signal.aborted) post({ t: 'aborted', job: msg.job });
      else post({ t: 'analyzed', job: msg.job, out, ms: now() - t0 });
    } catch (e) {
      if (ctl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) post({ t: 'aborted', job: msg.job });
      else post({ t: 'failed', ball: null, job: msg.job, error: message(e) });
    } finally {
      readings.delete(msg.job);
    }
  }

  function handle(msg: ToWorker): void {
    switch (msg.t) {
      case 'hello':
        post({ t: 'hello', build: env.build, sim: env.sim, protocol: WORK_PROTOCOL });
        return;
      case 'warm': {
        const ms = warm(msg.job);
        post({ t: 'warmed', ms: ms ?? 0 });
        return;
      }
      case 'prepare': {
        live.set(msg.ball, msg.job);
        post({ t: 'prepared', ball: msg.ball, warmMs: warm(msg.job) });
        // The leave, ahead of time: the run-up lasts seconds and nothing can be swung before release, so a ball left
        // alone is answered the moment its window closes. A swing is resolved as before; this result is then dropped.
        try {
          leaves.set(msg.ball, resolveBall(kit, msg.job, null));
        } catch {
          /* resolved on demand instead */
        }
        return;
      }
      case 'resolve': {
        const job = live.get(msg.ball);
        if (!job) {
          post({ t: 'failed', ball: msg.ball, job: null, error: 'worker: ball not prepared' });
          return;
        }
        const t0 = now();
        try {
          const ahead = msg.swing === null ? leaves.get(msg.ball) : undefined;
          const result = ahead ?? resolveBall(kit, job, msg.swing);
          const ms = now() - t0;
          keep(msg.ball, result);
          post({ t: 'resolved', ball: msg.ball, result, ms });
        } catch (e) {
          post({ t: 'failed', ball: msg.ball, job: null, error: message(e) });
        } finally {
          live.delete(msg.ball);
          leaves.delete(msg.ball);
          liveChanged();
        }
        return;
      }
      case 'release':
        leaves.delete(msg.ball);
        if (live.delete(msg.ball)) liveChanged();
        return;
      case 'analyze':
        void read(msg);
        return;
      case 'abort':
        readings.get(msg.job)?.abort();
        return;
    }
  }

  return { handle };
}
