/**
 * The Practice work thread, as the flow sees it: the live ball's physics and the coach's readings computed off the
 * main thread (src/practice/worker), so neither ever stalls a frame, with the main thread's own computation as the
 * fallback whenever the worker is missing, still starting, busy, failed, silent or of another build.
 *
 * Same input, same result (anti-fake rule 3): the worker runs the very functions the main thread binds, on the same
 * inputs, and its answers cross as structured clones of plain data; a fallback calls the main thread's functions on
 * the same inputs. Which thread answered decides only when an answer arrives, never what it is
 * (tests/unit/practice/ui/offthread-*.test.ts; release/product-sequence/stage-1-practice/wedge/worker/).
 *
 * No stuck states: every request ends in an answer, a local computation or an AbortError, within a bounded time.
 */
import type { DeliveryRecord, DeliveryResult, NormalizedSwing } from '@/contracts';
import {
  KEPT_RESULTS,
  WORK_PROTOCOL,
  type AnalyzeOutput,
  type AnalyzeWant,
  type BallJob,
  type FromWorker,
  type ToWorker,
} from '@/practice/worker/protocol';

export type { AnalyzeOutput, AnalyzeWant, BallJob } from '@/practice/worker/protocol';

/** A dedicated worker, as much of one as this needs (a real Worker, or a test double). */
export interface WorkerPort {
  postMessage(msg: ToWorker): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: unknown) => void) | null;
  onmessageerror: ((e: unknown) => void) | null;
}

type WorkMode = 'idle' | 'starting' | 'ready' | 'failed';

/** Why a ball or a reading was computed on the main thread. */
type LocalReason = 'no_worker' | 'failed' | 'not_ready' | 'timeout' | 'worker_error' | 'interrupted';

interface BallStat {
  ball: number;
  path: 'worker' | 'local';
  reason: LocalReason | null;
  /** performance.now() when the swing was known (the request), and when its result was in hand. */
  requestedAt: number;
  settledAt: number;
  /** The worker's own compute time (ms), when it answered. */
  computeMs: number | null;
  /** Main-thread time handling the answer (receiving the result included), or computing it locally (ms). */
  mainMs: number;
}

interface ReadStat {
  job: number;
  /** 'worker', or 'failed'/'aborted' (the flow then reads locally, or not at all). */
  path: 'worker' | 'failed' | 'aborted';
  requestedAt: number;
  settledAt: number;
  computeMs: number | null;
  mainMs: number;
  /** The result was the worker's own (not sent again). */
  reused: boolean;
}

export interface OffThreadStats {
  mode: WorkMode;
  failure: string | null;
  warmMs: number | null;
  balls: BallStat[];
  reads: ReadStat[];
}

export interface BallTicket {
  readonly id: number;
  /** The worker has this ball and nothing ahead of it: a swing now is resolved there. */
  ready(): boolean;
  /** The result for this swing: the worker's when it has the ball and is idle, else computed here at once. */
  resolve(swing: NormalizedSwing | null): Promise<DeliveryResult>;
  /** Computed here, now (the app is going away), unless already in hand; settles a pending resolve with it. */
  resolveNow(swing: NormalizedSwing | null): DeliveryResult;
  /** This ball will not be resolved (the delivery was abandoned before its swing). */
  release(): void;
}

export interface OffThreadWork {
  /** False once the worker is known to be unusable (the flow then reads locally, with its main-thread pacing). */
  canWork(): boolean;
  /** Starts the worker (once) and warms its physics on a coming ball; never needed for correctness. */
  warm(job?: BallJob): void;
  /** The ball about to be bowled; `local` is the flow's own computation of it (the fallback). */
  prepare(job: BallJob, local: (swing: NormalizedSwing | null) => DeliveryResult): BallTicket;
  /** A reading off the main thread. Rejects with an AbortError when aborted, or another error when the worker cannot read it (read locally then). */
  read(record: DeliveryRecord, result: DeliveryResult, want: AnalyzeWant, signal?: AbortSignal): Promise<AnalyzeOutput>;
  stats(): OffThreadStats;
  dispose(): void;
}

export interface OffThreadOptions {
  /** A new worker, or null where there is none; may throw. */
  spawn: () => WorkerPort | null;
  /** This build and simulation: a worker of any other is not used. */
  build: string;
  sim: number;
  now?: () => number;
  helloTimeoutMs?: number;
  resolveTimeoutMs?: number;
  readTimeoutMs?: number;
}

/** Bounds, not tuning: the worker answers well inside them, and a silent one is replaced by the main thread. */
const WORK_HELLO_TIMEOUT_MS = 15_000;
const WORK_RESOLVE_TIMEOUT_MS = 2_000;
const WORK_READ_TIMEOUT_MS = 60_000;
const STATS_KEPT = 64;

function abortError(): Error {
  const e = new Error('work: reading cancelled');
  e.name = 'AbortError';
  return e;
}

interface BallEntry {
  id: number;
  prepared: boolean;
  /** The pending worker request, when one was made. */
  waiting: {
    requestedAt: number;
    settle: (r: DeliveryResult | null, stat: Omit<BallStat, 'ball' | 'requestedAt' | 'settledAt'>) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null;
  done: boolean;
}

interface ReadEntry {
  job: number;
  requestedAt: number;
  reused: boolean;
  resolve: (out: AnalyzeOutput, computeMs: number, mainStart: number) => void;
  reject: (e: Error, path: 'failed' | 'aborted') => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createOffThread(opts: OffThreadOptions): OffThreadWork {
  const now = opts.now ?? (() => performance.now());
  const helloTimeoutMs = opts.helloTimeoutMs ?? WORK_HELLO_TIMEOUT_MS;
  const resolveTimeoutMs = opts.resolveTimeoutMs ?? WORK_RESOLVE_TIMEOUT_MS;
  const readTimeoutMs = opts.readTimeoutMs ?? WORK_READ_TIMEOUT_MS;
  let mode: WorkMode = 'idle';
  let failure: string | null = null;
  let worker: WorkerPort | null = null;
  let helloTimer: ReturnType<typeof setTimeout> | null = null;
  let warmMs: number | null = null;
  let seq = 0;
  let readSeq = 0;
  const balls = new Map<number, BallEntry>();
  const reads = new Map<number, ReadEntry>();
  /** Resolve requests in the order sent: the worker keeps the last KEPT_RESULTS of the ones it answered. */
  const sentOrder: number[] = [];
  /** Results that came from the worker, by object, so a reading of one can name it instead of sending it back. */
  const fromWorker = new WeakMap<DeliveryResult, number>();
  const ballStats: BallStat[] = [];
  const readStats: ReadStat[] = [];

  const push = <T>(list: T[], v: T) => {
    list.push(v);
    if (list.length > STATS_KEPT) list.shift();
  };

  const send = (msg: ToWorker): boolean => {
    if (!worker || mode === 'failed') return false;
    try {
      worker.postMessage(msg);
      return true;
    } catch (e) {
      fail(`post: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  function fail(why: string): void {
    if (mode === 'failed') return;
    mode = 'failed';
    failure = why;
    if (helloTimer !== null) clearTimeout(helloTimer);
    helloTimer = null;
    const w = worker;
    worker = null;
    try {
      if (w) {
        w.onmessage = null;
        w.onerror = null;
        w.onmessageerror = null;
        w.terminate();
      }
    } catch {
      /* already gone */
    }
    // Everything in flight is answered on the main thread now.
    for (const b of balls.values())
      if (b.waiting) b.waiting.settle(null, { path: 'local', reason: 'worker_error', computeMs: null, mainMs: 0 });
    for (const r of [...reads.values()]) r.reject(new Error(`work: ${why}`), 'failed');
  }

  function start(): boolean {
    if (mode === 'ready' || mode === 'starting') return true;
    if (mode === 'failed') return false;
    let w: WorkerPort | null;
    try {
      w = opts.spawn();
    } catch (e) {
      fail(`spawn: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
    if (!w) {
      fail('no_worker');
      return false;
    }
    worker = w;
    mode = 'starting';
    w.onmessage = (e) => onMessage(e);
    w.onerror = () => fail('worker_error');
    w.onmessageerror = () => fail('message_error');
    helloTimer = setTimeout(() => fail('hello_timeout'), helloTimeoutMs);
    send({ t: 'hello', build: opts.build, sim: opts.sim, protocol: WORK_PROTOCOL });
    return mode === 'starting';
  }

  function onMessage(e: MessageEvent<FromWorker>): void {
    const mainStart = now();
    const msg = e.data;
    switch (msg.t) {
      case 'hello':
        if (helloTimer !== null) clearTimeout(helloTimer);
        helloTimer = null;
        if (msg.build !== opts.build || msg.sim !== opts.sim || msg.protocol !== WORK_PROTOCOL) fail('version');
        else if (mode === 'starting') mode = 'ready';
        return;
      case 'warmed':
        warmMs = msg.ms;
        return;
      case 'prepared': {
        const b = balls.get(msg.ball);
        if (b) b.prepared = true;
        if (msg.warmMs !== null) warmMs = msg.warmMs;
        return;
      }
      case 'resolved': {
        const b = balls.get(msg.ball);
        if (b?.waiting) {
          fromWorker.set(msg.result, msg.ball);
          b.waiting.settle(msg.result, { path: 'worker', reason: null, computeMs: msg.ms, mainMs: now() - mainStart });
        }
        return;
      }
      case 'analyzed': {
        reads.get(msg.job)?.resolve(msg.out, msg.ms, mainStart);
        return;
      }
      case 'aborted':
        reads.get(msg.job)?.reject(abortError(), 'aborted');
        return;
      case 'failed':
        if (msg.ball !== null) {
          const b = balls.get(msg.ball);
          if (b?.waiting) b.waiting.settle(null, { path: 'local', reason: 'worker_error', computeMs: null, mainMs: 0 });
        }
        if (msg.job !== null) reads.get(msg.job)?.reject(new Error(`work: ${msg.error}`), 'failed');
        return;
    }
  }

  function prepare(job: BallJob, local: (swing: NormalizedSwing | null) => DeliveryResult): BallTicket {
    const id = ++seq;
    const entry: BallEntry = { id, prepared: false, waiting: null, done: false };
    balls.set(id, entry);
    const posted = start() && send({ t: 'prepare', ball: id, job });
    let result: DeliveryResult | null = null;
    const finish = () => {
      entry.done = true;
      balls.delete(id);
    };
    const computeHere = (swing: NormalizedSwing | null, reason: LocalReason, requestedAt: number): DeliveryResult => {
      const t0 = now();
      const r = local(swing);
      const t1 = now();
      push(ballStats, {
        ball: id,
        path: 'local',
        reason,
        requestedAt,
        settledAt: t1,
        computeMs: null,
        mainMs: t1 - t0,
      });
      return r;
    };
    const releaseWorker = () => {
      if (posted) send({ t: 'release', ball: id });
    };
    return {
      id,
      ready: () => posted && mode === 'ready' && entry.prepared && !entry.done,
      resolve(swing) {
        if (result) return Promise.resolve(result);
        const requestedAt = now();
        const canAsk = posted && mode === 'ready' && entry.prepared && !entry.done;
        if (!canAsk || !send({ t: 'resolve', ball: id, swing })) {
          releaseWorker();
          try {
            result = computeHere(
              swing,
              mode === 'failed' ? (failure === 'no_worker' ? 'no_worker' : 'failed') : 'not_ready',
              requestedAt,
            );
          } finally {
            finish();
          }
          return Promise.resolve(result);
        }
        sentOrder.push(id);
        while (sentOrder.length > KEPT_RESULTS) sentOrder.shift();
        return new Promise<DeliveryResult>((resolve, reject) => {
          const settle = (r: DeliveryResult | null, stat: Omit<BallStat, 'ball' | 'requestedAt' | 'settledAt'>) => {
            if (!entry.waiting) return;
            clearTimeout(entry.waiting.timer);
            entry.waiting = null;
            try {
              if (r) {
                result = r;
                push(ballStats, { ball: id, requestedAt, settledAt: now(), ...stat });
              } else result = computeHere(swing, stat.reason ?? 'worker_error', requestedAt);
              resolve(result);
            } catch (e) {
              reject(e);
            } finally {
              finish();
            }
          };
          const timer = setTimeout(
            () => settle(null, { path: 'local', reason: 'timeout', computeMs: null, mainMs: 0 }),
            resolveTimeoutMs,
          );
          entry.waiting = { requestedAt, settle, timer };
        });
      },
      resolveNow(swing) {
        if (result) return result;
        if (entry.waiting) {
          entry.waiting.settle(null, { path: 'local', reason: 'interrupted', computeMs: null, mainMs: 0 });
          return result!;
        }
        releaseWorker();
        try {
          result = computeHere(swing, 'interrupted', now());
        } finally {
          finish();
        }
        return result;
      },
      release() {
        if (entry.done || entry.waiting) return;
        releaseWorker();
        finish();
      },
    };
  }

  function read(
    record: DeliveryRecord,
    result: DeliveryResult,
    want: AnalyzeWant,
    signal?: AbortSignal,
  ): Promise<AnalyzeOutput> {
    if (signal?.aborted) return Promise.reject(abortError());
    if (!start()) return Promise.reject(new Error(`work: ${failure ?? 'unavailable'}`));
    const job = ++readSeq;
    const ball = fromWorker.get(result);
    const reused = ball !== undefined && sentOrder.includes(ball);
    const requestedAt = now();
    return new Promise<AnalyzeOutput>((resolve, reject) => {
      const done = () => {
        clearTimeout(entry.timer);
        reads.delete(job);
        signal?.removeEventListener('abort', onAbort);
      };
      const entry: ReadEntry = {
        job,
        requestedAt,
        reused,
        resolve: (out, computeMs, mainStart) => {
          done();
          push(readStats, {
            job,
            path: 'worker',
            requestedAt,
            settledAt: now(),
            computeMs,
            mainMs: now() - mainStart,
            reused,
          });
          resolve(out);
        },
        reject: (e, path) => {
          done();
          push(readStats, { job, path, requestedAt, settledAt: now(), computeMs: null, mainMs: 0, reused });
          reject(e);
        },
        timer: setTimeout(() => {
          send({ t: 'abort', job });
          entry.reject(new Error('work: reading timed out'), 'failed');
        }, readTimeoutMs),
      };
      const onAbort = () => {
        send({ t: 'abort', job });
        entry.reject(abortError(), 'aborted');
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      reads.set(job, entry);
      if (!send({ t: 'analyze', job, record, result: reused ? null : result, ball: reused ? ball! : null, want }))
        entry.reject(new Error(`work: ${failure ?? 'unavailable'}`), 'failed');
    });
  }

  return {
    canWork: () => mode !== 'failed',
    warm(job) {
      if (start() && job) send({ t: 'warm', job });
    },
    prepare,
    read,
    stats: () => ({ mode, failure, warmMs, balls: ballStats.slice(), reads: readStats.slice() }),
    dispose() {
      for (const r of [...reads.values()]) r.reject(abortError(), 'aborted');
      fail('disposed');
    },
  };
}
