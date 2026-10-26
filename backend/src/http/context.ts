/** Per-request context handed to every route handler. */
import type { Config } from '../config';
import type { EngineHelpers, EngineRegistry } from '../engines';
import type { Env } from '../env';
import type { Metrics } from '../ops/metrics';
import type { Logger } from './log';
import type { RouteDef } from './router';
import type { GoogleVerifier } from '../auth/google';
import type { PasskeyVerifier } from '../auth/passkey';
import type { PushSender } from '../ops/push';
import type { YouTubePublisher } from '../highlights/youtube';

export interface Actor {
  uid: string;
  playerId: string;
  /** Session family of the access token. */
  sid: string;
}

/** Injected dependencies (production defaults in app.ts; tests and the harness replace them). */
export interface WorkerDeps {
  engines: EngineRegistry;
  /** Stable engine helpers beside the contract (missing ones switch their feature off). */
  helpers: Partial<EngineHelpers>;
  now(): number;
  /** Outbound fetch (Google JWKS, FCM). */
  fetch(input: string, init?: RequestInit): Promise<Response>;
  logger: Logger;
  metrics: Metrics;
  google?: GoogleVerifier;
  passkeys?: PasskeyVerifier;
  push?: PushSender;
  /** The YouTube adapter (tests inject a MockYouTube; otherwise the real one when the OAuth secrets exist). */
  youtube?: YouTubePublisher;
}

export interface RequestContext {
  request: Request;
  url: URL;
  env: Env;
  deps: WorkerDeps;
  cfg: Config;
  reqId: string;
  now: number;
  ip: string;
  params: Record<string, string>;
  route: RouteDef;
  actor: Actor | null;
  /** The admin behind an admin route (Cloudflare Access identity, or "dev-token" locally). */
  admin: { id: string; via: 'access' | 'token' } | null;
  /** Parsed JSON body of a mutation (undefined when empty). */
  body: unknown;
  rawBody: string;
  idemKey: string | null;
  salt: string | null;
  waitUntil(promise: Promise<unknown>): void;
}

export function requireActor(ctx: RequestContext): Actor {
  if (!ctx.actor) throw new Error('route declared auth: required but has no actor');
  return ctx.actor;
}
