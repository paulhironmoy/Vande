/**
 * Bindings, variables and secrets of the Worker (wrangler.toml), typed as the minimal "Like" slices the code uses so
 * the in-process harness (backend/local) can implement them in memory and the same code runs in both places.
 */
import type { MaintenanceMessage, MediaMessage, NotifyMessage } from './ops/messages';

// ---- D1 ---------------------------------------------------------------------------------------------------------
export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}
export interface D1Like {
  prepare(sql: string): D1StatementLike;
  /** Runs the statements in one transaction (all or nothing). */
  batch(statements: D1StatementLike[]): Promise<Array<{ results?: unknown[]; meta?: { changes?: number } }>>;
}

// ---- Durable Objects ----------------------------------------------------------------------------------------------
export interface DOIdLike {
  toString(): string;
}
export interface DOStubLike {
  fetch(request: Request): Promise<Response>;
}
export interface DONamespaceLike {
  idFromName(name: string): DOIdLike;
  get(id: DOIdLike, options?: { locationHint?: string }): DOStubLike;
}
export interface DOStorageLike {
  get<T = unknown>(keys: string[]): Promise<Map<string, T>>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T = unknown>(options?: { prefix?: string; limit?: number }): Promise<Map<string, T>>;
  deleteAll(): Promise<void>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number): Promise<void>;
  deleteAlarm(): Promise<void>;
}
export interface DOStateLike {
  readonly id: DOIdLike;
  readonly storage: DOStorageLike;
  waitUntil?(promise: Promise<unknown>): void;
}

// ---- R2, Queues, Rate Limiting, Analytics Engine --------------------------------------------------------------
export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string; contentEncoding?: string };
}
export interface R2ObjectBodyLike extends R2ObjectLike {
  /** The (range of the) object as a stream. */
  body: ReadableStream<Uint8Array>;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2PutOptions {
  httpMetadata?: { contentType?: string; contentEncoding?: string };
  customMetadata?: Record<string, string>;
  /** Hex SHA-256 the stored bytes must have: R2 refuses the upload otherwise. */
  sha256?: string;
}
export interface R2Like {
  put(key: string, value: string | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>, options?: R2PutOptions): Promise<unknown>;
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ objects: R2ObjectLike[]; truncated: boolean; cursor?: string }>;
}

export interface QueueLike<T> {
  send(body: T, options?: { delaySeconds?: number }): Promise<unknown>;
}
export interface MessageLike<T> {
  readonly id: string;
  readonly body: T;
  readonly attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}
export interface MessageBatchLike<T> {
  readonly queue: string;
  readonly messages: readonly MessageLike<T>[];
}

/** Workers Rate Limiting binding (`[[ratelimits]]`). */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Workers Analytics Engine dataset binding. */
export interface AnalyticsEngineLike {
  writeDataPoint(point: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledEventLike {
  cron: string;
  scheduledTime: number;
}

// ---- Env --------------------------------------------------------------------------------------------------------
export interface Env {
  DB: D1Like;
  MATCH: DONamespaceLike;
  /** One object per Group Cup. */
  CUP?: DONamespaceLike;
  /** One object per Cricket Room (every duel and every cup). */
  ROOM?: DONamespaceLike;
  /** R2: data exports now; temporary highlight videos later. */
  FILES?: R2Like;
  NOTIFY_QUEUE?: QueueLike<NotifyMessage>;
  MAINT_QUEUE?: QueueLike<MaintenanceMessage>;
  /** Highlight uploads, removals and privacy changes (retried with backoff, then vande-media-dlq → dead_letter). */
  MEDIA_QUEUE?: QueueLike<MediaMessage>;
  METRICS?: AnalyticsEngineLike;
  /** Per-network limits for authenticated reads and writes (keys separate the scopes). */
  RL_NET?: RateLimitBinding;
  /** Per-network limits for guest sign-up and refresh. */
  RL_AUTH?: RateLimitBinding;
  /** Per-network limits for invite lookups (enumeration resistance). */
  RL_INVITE?: RateLimitBinding;
  /** Per-player limits (keys separate read, write and batting). */
  RL_PLAYER?: RateLimitBinding;
  /** Global ceilings for signed-in traffic (checked after authentication), keys "all-writes" and "all-reads". */
  RL_GLOBAL?: RateLimitBinding;
  /** Smaller global ceilings for anonymous traffic and failed sign-ins, keys "anon-writes" and "anon-reads". */
  RL_GLOBAL_ANON?: RateLimitBinding;

  // Variables (wrangler.toml [vars]).
  ENVIRONMENT?: string;
  VERSION?: string;
  ALLOWED_ORIGINS?: string;
  PUBLIC_WEB_ORIGIN?: string;
  PUBLIC_API_ORIGIN?: string;
  GOOGLE_CLIENT_IDS?: string;
  PASSKEYS_ENABLED?: string;
  DO_LOCATION_HINT?: string;
  DUEL_LOCK_HOURS?: string;
  DUEL_BAT_HOURS?: string;
  BALL_LIVE_MS?: string;
  BALL_LATE_MS?: string;
  RATE_NET_PER_MINUTE?: string;
  RATE_AUTH_PER_MINUTE?: string;
  RATE_INVITE_PER_MINUTE?: string;
  RATE_PLAYER_PER_MINUTE?: string;
  RATE_GLOBAL_WRITES_PER_MINUTE?: string;
  RATE_GLOBAL_READS_PER_MINUTE?: string;
  RATE_ANON_GLOBAL_WRITES_PER_MINUTE?: string;
  RATE_ANON_GLOBAL_READS_PER_MINUTE?: string;
  /** IPv6 prefix counted as one network on anonymous routes: "48", "56" (default) or "64". */
  ANON_IPV6_PREFIX?: string;
  /** Activity jitter in seconds, "60-600" by default; "0" turns it off (the local harness and dev server). */
  ACTIVITY_JITTER_S?: string;
  /** Duel reveal slot in seconds (default 300): a duel reveals at the next whole slot at least 60 s after both innings end. */
  DUEL_REVEAL_SLOT_S?: string;
  GUESTS_PER_NETWORK_PER_DAY?: string;
  DUELS_PER_PLAYER_PER_DAY?: string;
  GROUP_JOINS_PER_PLAYER_PER_DAY?: string;
  CLEANUP_MAX_QUERIES?: string;
  /** Public keys (uncompressed hex, comma separated) of retired commit-signing keys, still published by GET /v1/keys. */
  RETIRED_SIGNING_KEYS?: string;
  /** "1": local development only; accept writes without RATE_SALT (logged once per isolate). Refused in production. */
  ALLOW_UNLIMITED_WRITES?: string;
  /** "1": re-run every revealed log through engine.verifyMatchLog before publishing it (CPU cost; on by default in tests). */
  VERIFY_REVEALS?: string;
  /** "1": also archive Daily Six replays to R2 (duel and cup replays are always archived). */
  ARCHIVE_DAILY_LOGS?: string;
  /** Highlights: "1" skips the human approval after the automatic checks (default off). */
  HIGHLIGHT_AUTO_APPROVE?: string;
  /** YouTube Data API quota per day (default 10,000), units per upload (1,600) and the reserved headroom (≥ 0.2). */
  YT_DAILY_QUOTA?: string;
  YT_UNITS_PER_UPLOAD?: string;
  YT_HEADROOM?: string;
  /** YouTube category of the Shorts (default 20, Gaming). */
  YT_CATEGORY_ID?: string;
  /** Admin console: the origin admin.html is served from (allowed for /v1/admin/* only). */
  ADMIN_ORIGIN?: string;
  /** Cloudflare Access in front of the admin console: team domain (e.g. vande.cloudflareaccess.com) and audience tag. */
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
  /** "1" lets room members post short moderated free text (off by default: predefined banter only). */
  ROOM_FREE_TEXT?: string;
  /** Push frequency caps per player per IST day: routine and total (defaults 4 and 8). */
  NOTIFY_ROUTINE_PER_DAY?: string;
  NOTIFY_MAX_PER_DAY?: string;
  /** Default quiet hours (IST, HH:MM-HH:MM), when routine pushes are dropped and important ones wait. */
  NOTIFY_QUIET_HOURS?: string;

  // Secrets (`wrangler secret put`); see docs/INFRASTRUCTURE.md. Missing secrets make the routes that need them fail closed.
  RATE_SALT?: string;
  TOKEN_KEYS?: string;
  DATA_KEYS?: string;
  SIGNING_KEY?: string;
  IDENTITY_PEPPER?: string;
  /** Daily Six: HMAC key for the server salt passed to engine.dailyChallenge, so the overs cannot be computed from the client. */
  DAILY_SALT_KEY?: string;
  /** Firebase service-account JSON for FCM HTTP v1 (push stays off without it). */
  FCM_SERVICE_ACCOUNT?: string;
  /** Render service request signing: keyring "kid:base64url" (≥ 32 bytes), the same entry as a Cloud Run secret. */
  RENDER_KEYS?: string;
  /** YouTube OAuth client and refresh token of the official channel (server only; the mock is used without them). */
  YT_CLIENT_ID?: string;
  YT_CLIENT_SECRET?: string;
  YT_REFRESH_TOKEN?: string;
  /** Local and development admin access only (refused when ENVIRONMENT is production): ≥ 32 characters. */
  ADMIN_TOKEN?: string;
}
