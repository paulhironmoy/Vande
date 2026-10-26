/**
 * Durable outbox. A mutation that must not be lost (a shot, a locked over, a deadline-sensitive accept) is written
 * to IndexedDB with its Idempotency-Key BEFORE it is sent, then sent; on a network failure, a timeout, 429/5xx or a
 * "request in progress" 409 it stays queued and is retried with full-jitter exponential backoff, on reconnect and on
 * app resume, across app restarts, until the server answers. The server's idempotency makes every retry safe.
 *
 * Ordering: entries share a lane (`group`, e.g. "match:<id>") and a lane is strictly FIFO: a later entry is never
 * sent while an earlier one is waiting, so a queued shot always reaches the server before the next ball is asked for.
 * A definitive answer (any other 4xx) removes the entry and reports it; nothing else ever drops an entry except its
 * age (OUTBOX_MAX_AGE_MS, long after every match deadline).
 */
import { ApiClientError, isApiClientError } from './errors';
import { openNetDb } from './idb';
import { newIdempotencyKey } from './routes';

export const OUTBOX_MAX_AGE_MS = 7 * 24 * 3_600_000;

export interface OutboxEntry {
  /** Equal to the Idempotency-Key. */
  id: string;
  route: string;
  params: Record<string, string>;
  body: unknown;
  group: string;
  seq: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
}

export interface OutboxStorage {
  list(): Promise<OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  remove(id: string): Promise<void>;
}

export type OutboxResult = { id: string; group: string; route: string; ok: true; response: unknown } | { id: string; group: string; route: string; ok: false; error: ApiClientError };

export function memoryOutboxStorage(): OutboxStorage {
  const m = new Map<string, OutboxEntry>();
  return {
    list: async () => [...m.values()].map((e) => structuredClone(e)),
    put: async (e) => void m.set(e.id, structuredClone(e)),
    remove: async (id) => void m.delete(id),
  };
}

export function idbOutboxStorage(dbName?: string): OutboxStorage {
  const fallback = memoryOutboxStorage();
  return {
    async list() {
      const db = await openNetDb(dbName);
      return db ? ((await db.getAll('outbox')) as OutboxEntry[]) : fallback.list();
    },
    async put(e) {
      const db = await openNetDb(dbName);
      if (db) await db.put('outbox', e);
      else await fallback.put(e);
    },
    async remove(id) {
      const db = await openNetDb(dbName);
      if (db) await db.delete('outbox', id);
      else await fallback.remove(id);
    },
  };
}

/** Full-jitter exponential backoff: uniform in [0, min(max, base · 2^attempt)), at least 250 ms. */
export function backoffDelay(attempt: number, random: () => number = Math.random, baseMs = 1_000, maxMs = 60_000): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.max(250, Math.floor(random() * cap));
}

export interface OutboxOptions {
  storage: OutboxStorage;
  /** Sends one entry; resolves with the server's response or throws an ApiClientError. */
  send(entry: OutboxEntry): Promise<unknown>;
  now?: () => number;
  random?: () => number;
  /** Timer hook (tests replace it). Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  maxAgeMs?: number;
}

export interface EnqueueInput {
  route: string;
  params?: Record<string, string>;
  body?: unknown;
  group: string;
  idempotencyKey?: string;
}

export type SubmitResult<T> = { status: 'sent'; response: T } | { status: 'queued'; entry: OutboxEntry; delivered: Promise<T> };

export class Outbox {
  private readonly o: Required<Omit<OutboxOptions, 'storage' | 'send'>> & Pick<OutboxOptions, 'storage' | 'send'>;
  private listeners = new Set<(r: OutboxResult) => void>();
  private waiters = new Map<string, Array<{ resolve(v: unknown): void; reject(e: unknown): void }>>();
  private flushing: Promise<{ sent: number; failed: number; waiting: number }> | null = null;
  private again = false;
  private cancelTimer: (() => void) | null = null;
  private seq = 0;
  private running = false;

  constructor(options: OutboxOptions) {
    // Field by field: an option passed as undefined (createNet forwards optional NetOptions) keeps its default.
    this.o = {
      storage: options.storage,
      send: options.send,
      now: options.now ?? (() => Date.now()),
      random: options.random ?? Math.random,
      schedule:
        options.schedule ??
        ((fn, ms) => {
          const t = setTimeout(fn, ms);
          return () => clearTimeout(t);
        }),
      maxAgeMs: options.maxAgeMs ?? OUTBOX_MAX_AGE_MS,
    };
  }

  onResult(cb: (r: OutboxResult) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Persists the entry (nothing is sent yet). */
  async enqueue(input: EnqueueInput): Promise<OutboxEntry> {
    const now = this.o.now();
    const id = input.idempotencyKey ?? newIdempotencyKey();
    const entry: OutboxEntry = {
      id,
      route: input.route,
      params: input.params ?? {},
      body: input.body ?? null,
      group: input.group,
      seq: now * 1000 + (this.seq++ % 1000),
      createdAt: now,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
    };
    await this.o.storage.put(entry);
    return entry;
  }

  /** Resolves with the server's answer once the entry is delivered (or rejects when the server refuses it). */
  waitFor<T = unknown>(id: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const list = this.waiters.get(id) ?? [];
      list.push({ resolve: resolve as (v: unknown) => void, reject });
      this.waiters.set(id, list);
    });
  }

  /** Persists, tries to deliver now, and tells the caller whether it went through or is queued for later. */
  async submit<T = unknown>(input: EnqueueInput): Promise<SubmitResult<T>> {
    const entry = await this.enqueue(input);
    const delivered = this.waitFor<T>(entry.id);
    delivered.catch(() => undefined);
    await this.flush();
    const still = (await this.o.storage.list()).some((e) => e.id === entry.id);
    if (!still) return { status: 'sent', response: await delivered };
    return { status: 'queued', entry, delivered };
  }

  async pending(group?: string): Promise<OutboxEntry[]> {
    const all = await this.o.storage.list();
    return all.filter((e) => !group || e.group === group).sort((a, b) => a.seq - b.seq);
  }

  /** Sends whatever is due, lane by lane in order. Concurrent calls share one run (and trigger one more after it). */
  flush(): Promise<{ sent: number; failed: number; waiting: number }> {
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      let total = { sent: 0, failed: 0, waiting: 0 };
      do {
        this.again = false;
        total = await this.runOnce();
      } while (this.again);
      return total;
    })().finally(() => {
      this.flushing = null;
      this.reschedule();
    });
    return this.flushing;
  }

  /** Delivers pending entries (due or not) of one lane right away; used before asking for the next ball. */
  async drainGroup(group: string): Promise<boolean> {
    for (const e of await this.pending(group)) {
      e.nextAttemptAt = Math.min(e.nextAttemptAt, this.o.now());
      await this.o.storage.put(e);
    }
    await this.flush();
    return (await this.pending(group)).length === 0;
  }

  start(): void {
    this.running = true;
    void this.flush();
  }

  /**
   * Forgets every queued request, after any delivery in progress (sign-out: nothing queued for one account may ever
   * replay under another). Waiting callers are told it was dropped. Resolves with how many were dropped.
   */
  async clear(): Promise<number> {
    const wasRunning = this.running;
    this.stop();
    await this.flushing?.catch(() => undefined);
    const all = await this.o.storage.list();
    for (const e of all) {
      await this.o.storage.remove(e.id);
      this.emit({ id: e.id, group: e.group, route: e.route, ok: false, error: new ApiClientError('unauthorized', 'signed out on this device') });
    }
    if (wasRunning) this.start();
    return all.length;
  }

  stop(): void {
    this.running = false;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private emit(r: OutboxResult): void {
    for (const l of this.listeners) {
      try {
        l(r);
      } catch {
        /* listeners never break delivery */
      }
    }
    const waiters = this.waiters.get(r.id) ?? [];
    this.waiters.delete(r.id);
    for (const w of waiters) (r.ok ? w.resolve(r.response) : w.reject(r.error));
  }

  private async runOnce(): Promise<{ sent: number; failed: number; waiting: number }> {
    const now = this.o.now();
    const entries = (await this.o.storage.list()).sort((a, b) => a.seq - b.seq);
    const lanes = new Map<string, OutboxEntry[]>();
    for (const e of entries) lanes.set(e.group, [...(lanes.get(e.group) ?? []), e]);
    let sent = 0;
    let failed = 0;
    let waiting = 0;
    for (const lane of lanes.values()) {
      for (let i = 0; i < lane.length; i++) {
        const e = lane[i];
        if (now - e.createdAt > this.o.maxAgeMs) {
          await this.o.storage.remove(e.id);
          failed++;
          this.emit({ id: e.id, group: e.group, route: e.route, ok: false, error: new ApiClientError('deadline_passed', 'queued too long') });
          continue;
        }
        if (e.nextAttemptAt > now) {
          waiting += lane.length - i;
          break;
        }
        try {
          const response = await this.o.send(e);
          await this.o.storage.remove(e.id);
          sent++;
          this.emit({ id: e.id, group: e.group, route: e.route, ok: true, response });
        } catch (err) {
          const error = isApiClientError(err) ? err : new ApiClientError('network', err instanceof Error ? err.message : 'send failed');
          if (error.retryable) {
            e.attempts += 1;
            e.lastError = error.code;
            e.nextAttemptAt = now + Math.max(error.retryAfterMs ?? 0, backoffDelay(e.attempts - 1, this.o.random));
            await this.o.storage.put(e);
            waiting += lane.length - i;
            break;
          }
          await this.o.storage.remove(e.id);
          failed++;
          this.emit({ id: e.id, group: e.group, route: e.route, ok: false, error });
        }
      }
    }
    return { sent, failed, waiting };
  }

  private reschedule(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    if (!this.running) return;
    void this.o.storage.list().then((entries) => {
      if (!this.running || entries.length === 0) return;
      const next = Math.min(...entries.map((e) => e.nextAttemptAt));
      this.cancelTimer = this.o.schedule(() => void this.flush(), Math.max(250, next - this.o.now()));
    });
  }
}
