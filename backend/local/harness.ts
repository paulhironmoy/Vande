/**
 * In-process VANDE Cricket backend: the real Worker and MatchDO code over in-memory bindings and an in-memory SQLite
 * D1 with the real migrations. Used by backend tests, the app's network tests, the local dev server
 * (backend/local/serve.mjs) and end-to-end runs. Time is a manual clock, so deadlines can be tested precisely.
 *
 *   const backend = await createLocalBackend({ engine });
 *   const res = await backend.fetch('http://api.local/v1/auth/guest', { method: 'POST', … });
 *   await backend.advance(25 * 3600_000); // moves the clock and fires due alarms
 */
import type { SealedSixEngineApi } from '@/contracts';
import { autoXiSeed, dailyCommits, timingAudit } from '@/engine';
import { unlocksEarned } from '@/engine/advice';
import { matchEligibility, rankTop100, updateRatings } from '@/engine/ranking';
import { createWorker, type Worker } from '../src/app';
import type { EngineHelpers } from '../src/engines';
import type { Env } from '../src/env';
import type { GoogleVerifier } from '../src/auth/google';
import { mockPasskeyVerifier, type PasskeyVerifier } from '../src/auth/passkey';
import { MemoryLogger, __resetWarnOnceForTests, type Logger } from '../src/http/log';
import { CLEANUP_CRON } from '../src/ops/cron';
import type { MaintenanceMessage, MediaMessage, NotifyMessage } from '../src/ops/messages';
import { MockYouTube, type YouTubePublisher } from '../src/highlights/youtube';
import { __resetAccessKeysForTests } from '../src/admin/access';
import { MemoryMetrics } from '../src/ops/metrics';
import { MockPushSender, type PushSender } from '../src/ops/push';
import { toBase64Url } from '../src/security/encoding';
import { __resetSigningKeyForTests } from '../src/security/signing';
import { BackgroundWork, MemoryAnalyticsEngine, MemoryDONamespace, MemoryQueue, MemoryR2, MemoryRateLimiter, manualClock, type Clock } from './memory';
import { SqliteD1 } from './sqlite-d1';

export const LOCAL_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173', 'https://localhost', 'capacitor://localhost'];

export interface LocalSecrets {
  TOKEN_KEYS: string;
  DATA_KEYS: string;
  SIGNING_KEY: string;
  RATE_SALT: string;
  IDENTITY_PEPPER: string;
  DAILY_SALT_KEY: string;
  /** Render service signing keyring (the render-service tests sign with the same entry). */
  RENDER_KEYS: string;
  /** Local admin console access (development only). */
  ADMIN_TOKEN: string;
}

/** Fresh random development secrets (never written anywhere; a new set per backend). */
export async function generateSecrets(): Promise<LocalSecrets> {
  const random = (n: number) => toBase64Url(crypto.getRandomValues(new Uint8Array(n)));
  const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  return {
    TOKEN_KEYS: `dev1:${random(32)}`,
    DATA_KEYS: `dev1:${random(32)}`,
    SIGNING_KEY: JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey)),
    RATE_SALT: random(24),
    IDENTITY_PEPPER: random(32),
    DAILY_SALT_KEY: random(32),
    RENDER_KEYS: `r1:${random(32)}`,
    ADMIN_TOKEN: random(32),
  };
}

export interface LocalBackendOptions {
  engine?: SealedSixEngineApi;
  engines?: SealedSixEngineApi[];
  /** Initial clock (ms since the epoch) of the manual clock. */
  now?: number;
  /** A clock to use instead of the manual one (the dev server passes the real time). */
  clock?: Clock;
  /** Variable and secret overrides (set a secret to '' or undefined to test fail-closed behaviour). */
  vars?: Partial<Env>;
  /** 'bindings' (default): in-memory Rate Limiting bindings; 'd1': the D1 bucket fallback; 'off': no limits (dev). */
  rateLimits?: 'bindings' | 'd1' | 'off';
  /** Per-minute limits of the in-memory bindings. */
  bindingLimits?: Partial<Record<'RL_NET' | 'RL_AUTH' | 'RL_INVITE' | 'RL_PLAYER' | 'RL_GLOBAL' | 'RL_GLOBAL_ANON', number>>;
  google?: GoogleVerifier;
  passkeys?: PasskeyVerifier;
  push?: PushSender;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: Logger;
  /** Engine helpers paired with the engine; defaults to the real engine's (a fake engine brings its own). */
  helpers?: Partial<EngineHelpers>;
  /** The web app under test: PUBLIC_WEB_ORIGIN (invite and highlight links) and an extra allowed origin. */
  webOrigin?: string;
  /**
   * The YouTube adapter (default: a fresh MockYouTube per backend). null injects none, so the Worker chooses as in
   * production: the real adapter when YT_* secrets exist (through `fetch`), the mock in development, none otherwise.
   */
  youtube?: YouTubePublisher | null;
}

export interface LocalBackend {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>;
  worker: Worker;
  env: Env;
  db: SqliteD1;
  clock: Clock;
  metrics: MemoryMetrics;
  logger: Logger;
  matches: MemoryDONamespace;
  cups: MemoryDONamespace;
  rooms: MemoryDONamespace;
  files: MemoryR2;
  notify: MemoryQueue<NotifyMessage>;
  notifyDlq: MemoryQueue<NotifyMessage>;
  maint: MemoryQueue<MaintenanceMessage>;
  media: MemoryQueue<MediaMessage>;
  mediaDlq: MemoryQueue<MediaMessage>;
  /** The injected adapter (null when the Worker chooses its own: `youtube: null`). */
  youtube: YouTubePublisher | null;
  push: PushSender;
  analytics: MemoryAnalyticsEngine;
  secrets: LocalSecrets;
  /** Fires due Durable Object alarms. */
  runAlarms(): Promise<number>;
  /** Waits for background work (objects reporting to each other with waitUntil). */
  idle(): Promise<void>;
  /** Moves the clock forward and fires every alarm that became due. */
  advance(ms: number): Promise<void>;
  /** Delivers due queue messages (notify, maint and their dead-letter queues). */
  drainQueues(): Promise<number>;
  /** Runs a cron trigger (the cleanup by default). */
  scheduled(cron?: string): Promise<void>;
  close(): void;
}

export async function createLocalBackend(opts: LocalBackendOptions = {}): Promise<LocalBackend> {
  __resetSigningKeyForTests();
  __resetWarnOnceForTests();
  const engines = opts.engines ?? (opts.engine ? [opts.engine] : null);
  if (!engines) throw new Error('createLocalBackend needs an engine (the real one, or backend/test/fakeEngine.ts)');
  const clock = opts.clock ?? manualClock(opts.now ?? Date.UTC(2026, 9, 26, 6, 30));
  const metrics = new MemoryMetrics();
  const logger = opts.logger ?? new MemoryLogger();
  const push = opts.push ?? new MockPushSender();
  const youtube = opts.youtube === null ? null : (opts.youtube ?? new MockYouTube());
  __resetAccessKeysForTests();
  const app = createWorker({
    engines,
    now: clock.now,
    fetch: opts.fetch ?? (() => Promise.reject(new Error('no outbound network in the local backend'))),
    logger,
    metrics,
    google: opts.google,
    passkeys: opts.passkeys ?? mockPasskeyVerifier,
    push,
    helpers: opts.helpers ?? { timingAudit, dailyCommits, updateRatings, rankTop100, matchEligibility, autoXiSeed, unlocksEarned },
    youtube: youtube ?? undefined,
  });
  const db = await SqliteD1.create();
  const secrets = await generateSecrets();
  const files = new MemoryR2();
  const notifyDlq = new MemoryQueue<NotifyMessage>('vande-notify-dlq', clock);
  const notify = new MemoryQueue<NotifyMessage>('vande-notify', clock, 5, notifyDlq);
  const maintDlq = new MemoryQueue<MaintenanceMessage>('vande-maint-dlq', clock);
  const maint = new MemoryQueue<MaintenanceMessage>('vande-maint', clock, 5, maintDlq);
  const mediaDlq = new MemoryQueue<MediaMessage>('vande-media-dlq', clock);
  const media = new MemoryQueue<MediaMessage>('vande-media', clock, 6, mediaDlq);
  const analytics = new MemoryAnalyticsEngine();
  const mode = opts.rateLimits ?? 'bindings';
  const limits = { RL_NET: 600, RL_AUTH: 30, RL_INVITE: 60, RL_PLAYER: 120, RL_GLOBAL: 100_000, RL_GLOBAL_ANON: 100_000, ...opts.bindingLimits };
  const bindings =
    mode === 'bindings'
      ? Object.fromEntries(Object.entries(limits).map(([name, limit]) => [name, new MemoryRateLimiter(limit, clock)]))
      : {};
  let env: Env;
  const background = new BackgroundWork();
  const matches = new MemoryDONamespace(app.MatchDO, () => env, background);
  const cups = new MemoryDONamespace(app.CupDO, () => env, background);
  const rooms = new MemoryDONamespace(app.RoomDO, () => env, background);
  env = {
    DB: db,
    MATCH: matches,
    CUP: cups,
    ROOM: rooms,
    FILES: files,
    NOTIFY_QUEUE: notify,
    MAINT_QUEUE: maint,
    MEDIA_QUEUE: media,
    METRICS: analytics,
    ...bindings,
    ENVIRONMENT: 'development',
    VERSION: 'local',
    ALLOWED_ORIGINS: [...new Set([...LOCAL_ORIGINS, ...(opts.webOrigin ? [new URL(opts.webOrigin).origin] : [])])].join(','),
    PUBLIC_WEB_ORIGIN: opts.webOrigin ?? 'http://localhost:5173',
    PUBLIC_API_ORIGIN: 'http://127.0.0.1:8787',
    VERIFY_REVEALS: '1',
    // Activity jitter off locally (end-to-end flows bat right after both locks); production uses 60–600 s, and tests
    // that check it set ACTIVITY_JITTER_S themselves.
    ACTIVITY_JITTER_S: '0',
    // Duels reveal at once locally (production: the next 5-minute slot at least 60 s after both innings end).
    DUEL_REVEAL_SLOT_S: '0',
    ...secrets,
    ...(mode === 'off' ? { RATE_SALT: undefined, ALLOW_UNLIMITED_WRITES: '1' } : {}),
    ...opts.vars,
  };
  const runAlarms = async () => {
    let n = 0;
    for (const ns of [matches, cups, rooms]) n += await ns.runDueAlarms(clock.now());
    await background.idle();
    return n;
  };
  const nextAlarm = () => {
    const all = [matches.nextAlarm(), cups.nextAlarm(), rooms.nextAlarm()].filter((x): x is number => x !== null);
    return all.length ? Math.min(...all) : null;
  };
  return {
    fetch: (input, init) => app.worker.fetch(typeof input === 'string' ? new Request(input, init) : input, env),
    worker: app.worker,
    env,
    db,
    clock,
    metrics,
    logger,
    matches,
    cups,
    rooms,
    files,
    notify,
    notifyDlq,
    maint,
    media,
    mediaDlq,
    youtube,
    push,
    analytics,
    secrets,
    runAlarms,
    idle: () => background.idle(),
    async advance(ms) {
      const target = clock.now() + ms;
      // Step through every alarm on the way, in time order, so deadlines fire when they would.
      for (let i = 0; i < 5000; i++) {
        const next = nextAlarm();
        if (next === null || next > target) break;
        clock.set(Math.max(clock.now(), next));
        await runAlarms();
      }
      clock.set(target);
      await runAlarms();
    },
    async drainQueues() {
      let n = 0;
      for (const q of [notify, maint, media, notifyDlq, maintDlq, mediaDlq] as MemoryQueue<unknown>[]) n += await q.drain((batch) => app.worker.queue(batch, env));
      return n;
    },
    async scheduled(cron = CLEANUP_CRON) {
      await app.worker.scheduled({ cron, scheduledTime: clock.now() }, env);
    },
    close: () => db.close(),
  };
}
