/**
 * In-memory implementations of the Cloudflare bindings the Worker uses (Durable Objects with storage and alarms, R2,
 * Queues with retries and dead-letter queues, Rate Limiting, Analytics Engine), for tests, the local dev server and
 * end-to-end runs. Values are structured-cloned on the way in and out, like real storage.
 */
import type {
  AnalyticsEngineLike,
  DOIdLike,
  DONamespaceLike,
  DOStateLike,
  DOStorageLike,
  DOStubLike,
  Env,
  MessageBatchLike,
  MessageLike,
  QueueLike,
  R2Like,
  R2ObjectBodyLike,
  R2ObjectLike,
  R2PutOptions,
  RateLimitBinding,
} from '../src/env';

export interface Clock {
  now(): number;
  set(ms: number): void;
  advance(ms: number): void;
}

/** The real time (advance() shifts it, for trying deadlines in local development). */
export function realClock(): Clock {
  let offset = 0;
  return {
    now: () => Date.now() + offset,
    set: (ms) => (offset = ms - Date.now()),
    advance: (ms) => (offset += ms),
  };
}

export function manualClock(start: number): Clock {
  let t = start;
  return {
    now: () => t,
    set: (ms) => (t = ms),
    advance: (ms) => (t += ms),
  };
}

// ---- Durable Objects --------------------------------------------------------------------------------------------

export class MemoryDOStorage implements DOStorageLike {
  data = new Map<string, unknown>();
  alarm: number | null = null;
  /** Number of put() calls and keys written (cost notes in docs/COST_MODEL.md). */
  writes = { calls: 0, keys: 0 };

  async get<T = unknown>(keys: string[]): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const k of keys) if (this.data.has(k)) out.set(k, structuredClone(this.data.get(k)) as T);
    return out;
  }
  async put(entries: Record<string, unknown>): Promise<void> {
    this.writes.calls++;
    for (const [k, v] of Object.entries(entries)) {
      this.writes.keys++;
      this.data.set(k, structuredClone(v));
    }
  }
  async delete(keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.data.delete(k)) n++;
    return n;
  }
  async list<T = unknown>(options: { prefix?: string; limit?: number } = {}): Promise<Map<string, T>> {
    const keys = [...this.data.keys()].filter((k) => !options.prefix || k.startsWith(options.prefix)).sort();
    const out = new Map<string, T>();
    for (const k of keys.slice(0, options.limit ?? keys.length)) out.set(k, structuredClone(this.data.get(k)) as T);
    return out;
  }
  async deleteAll(): Promise<void> {
    this.data.clear();
  }
  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }
  async setAlarm(time: number): Promise<void> {
    this.alarm = time;
  }
  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }
}

interface DurableObjectLike {
  fetch(request: Request): Promise<Response>;
  alarm?(): Promise<void>;
}

interface Slot {
  name: string;
  storage: MemoryDOStorage;
  object: DurableObjectLike | null;
}

/** Background work started with `state.waitUntil` (tests await it with `idle()`). */
export class BackgroundWork {
  private pending = new Set<Promise<unknown>>();
  add(p: Promise<unknown>): void {
    const tracked = p.catch(() => undefined).finally(() => this.pending.delete(tracked));
    this.pending.add(tracked);
  }
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }
}

export class MemoryDONamespace implements DONamespaceLike {
  private slots = new Map<string, Slot>();
  alarmErrors: unknown[] = [];
  /** Requests and alarms delivered to objects (Durable Object request billing). */
  requests = 0;
  alarmsFired = 0;

  constructor(
    private readonly cls: new (state: DOStateLike, env: Env) => DurableObjectLike,
    private readonly env: () => Env,
    private readonly background: BackgroundWork = new BackgroundWork(),
  ) {}

  idFromName(name: string): DOIdLike {
    return { toString: () => name };
  }

  get(id: DOIdLike): DOStubLike {
    return {
      fetch: (request: Request) => {
        this.requests++;
        return this.object(id.toString()).fetch(request);
      },
    };
  }

  private slot(name: string): Slot {
    let s = this.slots.get(name);
    if (!s) {
      s = { name, storage: new MemoryDOStorage(), object: null };
      this.slots.set(name, s);
    }
    return s;
  }

  private object(name: string): DurableObjectLike {
    const s = this.slot(name);
    if (!s.object) {
      const state: DOStateLike = { id: this.idFromName(name), storage: s.storage, waitUntil: (p) => this.background.add(p) };
      s.object = new this.cls(state, this.env());
    }
    return s.object;
  }

  /** The storage behind one object (tests inspect what is stored at rest). */
  storage(name: string): MemoryDOStorage {
    return this.slot(name).storage;
  }

  names(): string[] {
    return [...this.slots.keys()];
  }

  /** Drops the live object but keeps its storage, like a runtime eviction; the next request rebuilds it. */
  evict(name?: string): void {
    for (const s of this.slots.values()) if (!name || s.name === name) s.object = null;
  }

  /** Fires every alarm due at `now` (an alarm that throws is re-armed one second later, like the runtime's retries). */
  async runDueAlarms(now: number): Promise<number> {
    let fired = 0;
    for (const s of this.slots.values()) {
      if (s.storage.alarm === null || s.storage.alarm > now) continue;
      s.storage.alarm = null;
      fired++;
      this.alarmsFired++;
      try {
        await this.object(s.name).alarm?.();
      } catch (e) {
        this.alarmErrors.push(e);
        s.storage.alarm = now + 1000;
      }
    }
    return fired;
  }

  nextAlarm(): number | null {
    let next: number | null = null;
    for (const s of this.slots.values()) if (s.storage.alarm !== null) next = next === null ? s.storage.alarm : Math.min(next, s.storage.alarm);
    return next;
  }
}

// ---- R2 ---------------------------------------------------------------------------------------------------------

export class MemoryR2 implements R2Like {
  objects = new Map<string, { data: Uint8Array; uploaded: Date; contentType?: string; contentEncoding?: string; customMetadata?: Record<string, string> }>();
  /** Class A (writes, lists) and B (reads) operations, as R2 bills them. */
  ops = { a: 0, b: 0 };

  async put(key: string, value: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, options?: R2PutOptions): Promise<unknown> {
    this.ops.a++;
    let data: Uint8Array;
    if (typeof value === 'string') data = new TextEncoder().encode(value);
    else if (value instanceof Uint8Array) data = value.slice();
    else if (value instanceof ArrayBuffer) data = new Uint8Array(value.slice(0));
    else data = new Uint8Array(await new Response(value).arrayBuffer());
    if (options?.sha256) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)), (b) => b.toString(16).padStart(2, '0')).join('');
      if (digest !== options.sha256.toLowerCase()) throw new Error('R2: the SHA-256 of the body does not match');
    }
    this.objects.set(key, { data, uploaded: new Date(), contentType: options?.httpMetadata?.contentType, contentEncoding: options?.httpMetadata?.contentEncoding, customMetadata: options?.customMetadata });
    return { key, size: data.byteLength };
  }
  private meta(key: string, o: { data: Uint8Array; uploaded: Date; contentType?: string; contentEncoding?: string; customMetadata?: Record<string, string> }): R2ObjectLike {
    return { key, size: o.data.byteLength, uploaded: o.uploaded, customMetadata: o.customMetadata, httpMetadata: { contentType: o.contentType, contentEncoding: o.contentEncoding } };
  }
  async head(key: string): Promise<R2ObjectLike | null> {
    this.ops.b++;
    const o = this.objects.get(key);
    return o ? this.meta(key, o) : null;
  }
  async get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectBodyLike | null> {
    this.ops.b++;
    const o = this.objects.get(key);
    if (!o) return null;
    const start = options?.range?.offset ?? 0;
    const end = options?.range?.length === undefined ? o.data.byteLength : Math.min(o.data.byteLength, start + options.range.length);
    const data = o.data.slice(start, end);
    return {
      ...this.meta(key, o),
      body: new Response(data as Uint8Array<ArrayBuffer>).body as ReadableStream<Uint8Array>,
      text: async () => new TextDecoder().decode(data),
      arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
    };
  }
  async delete(keys: string | string[]): Promise<void> {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k);
  }
  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }> {
    const keys = [...this.objects.keys()].filter((k) => !options.prefix || k.startsWith(options.prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = keys.slice(start, start + limit);
    const truncated = start + limit < keys.length;
    return { objects: page.map((key) => ({ key, size: this.objects.get(key)!.data.byteLength, uploaded: this.objects.get(key)!.uploaded })), truncated, cursor: truncated ? String(start + limit) : undefined };
  }
}

// ---- Queues -----------------------------------------------------------------------------------------------------

interface QueuedMessage<T> {
  id: string;
  body: T;
  attempts: number;
  notBefore: number;
}

export class MemoryQueue<T> implements QueueLike<T> {
  messages: Array<QueuedMessage<T>> = [];
  /** Every body ever sent (tests read what was enqueued after it was delivered). */
  readonly sent: T[] = [];
  private seq = 0;

  constructor(
    readonly name: string,
    private readonly clock: Clock,
    readonly maxRetries = 5,
    readonly deadLetter: MemoryQueue<T> | null = null,
  ) {}

  async send(body: T, options?: { delaySeconds?: number }): Promise<unknown> {
    this.messages.push({ id: `${this.name}-${++this.seq}`, body: structuredClone(body), attempts: 0, notBefore: this.clock.now() + (options?.delaySeconds ?? 0) * 1000 });
    this.sent.push(structuredClone(body));
    return {};
  }

  /** Delivers the due messages as one batch; retried messages stay (with a delay) until max_retries, then go to the DLQ. */
  async drain(consume: (batch: MessageBatchLike<T>) => Promise<void>): Promise<number> {
    const now = this.clock.now();
    const due = this.messages.filter((m) => m.notBefore <= now);
    if (due.length === 0) return 0;
    this.messages = this.messages.filter((m) => m.notBefore > now);
    const outcome = new Map<string, { retry: boolean; delay: number }>();
    const messages: MessageLike<T>[] = due.map((m) => ({
      id: m.id,
      body: structuredClone(m.body),
      attempts: m.attempts + 1,
      ack: () => outcome.set(m.id, { retry: false, delay: 0 }),
      retry: (o?: { delaySeconds?: number }) => outcome.set(m.id, { retry: true, delay: o?.delaySeconds ?? 0 }),
    }));
    try {
      await consume({ queue: this.name, messages });
    } catch {
      for (const m of due) if (!outcome.has(m.id)) outcome.set(m.id, { retry: true, delay: 0 });
    }
    for (const m of due) {
      const o = outcome.get(m.id) ?? { retry: false, delay: 0 };
      if (!o.retry) continue;
      const attempts = m.attempts + 1;
      if (attempts > this.maxRetries) {
        if (this.deadLetter) await this.deadLetter.send(m.body);
      } else {
        this.messages.push({ ...m, attempts, notBefore: now + o.delay * 1000 });
      }
    }
    return due.length;
  }
}

// ---- Rate Limiting and Analytics Engine -------------------------------------------------------------------------

/** Fixed 60-second windows per key, like a `[[ratelimits]]` binding with `simple = { limit, period = 60 }`. */
export class MemoryRateLimiter implements RateLimitBinding {
  private windows = new Map<string, { start: number; count: number }>();
  calls = 0;

  constructor(
    readonly limitPerMinute: number,
    private readonly clock: Clock,
  ) {}

  async limit(options: { key: string }): Promise<{ success: boolean }> {
    this.calls++;
    const start = Math.floor(this.clock.now() / 60_000) * 60_000;
    const w = this.windows.get(options.key);
    const count = w && w.start === start ? w.count + 1 : 1;
    this.windows.set(options.key, { start, count });
    return { success: count <= this.limitPerMinute };
  }
}

export class MemoryAnalyticsEngine implements AnalyticsEngineLike {
  points: Array<{ blobs?: string[]; doubles?: number[]; indexes?: string[] }> = [];
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void {
    this.points.push(point);
  }
}
