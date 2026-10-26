/**
 * The VANDE Cricket API Worker, assembled from injected dependencies (the engine above all). `src/index.ts` is the
 * production entry; tests and the local harness call `createWorker` with a fake engine and in-memory bindings.
 *
 * Request pipeline: request id → CORS / origin → version (/v1 only) → route → rate-limit salt (fail closed) → bearer
 * auth → per-network, per-player and global limits → body size and JSON → Idempotency-Key (required on every
 * mutation) → handler (D1-replayed for Worker mutations, forwarded for match mutations) → one structured log line.
 */
import type { ApiRoutes, SealedSixEngineApi } from '@/contracts';
import { IDEMPOTENCY_KEY_RE } from '@/net/shared/ids';
import { BODY_LIMITS, readConfig } from './config';
import { engineRegistry, type EngineHelpers, type EngineRegistry } from './engines';
import type { Env, ExecutionContextLike, MessageBatchLike, ScheduledEventLike } from './env';
import type { RequestContext, WorkerDeps } from './http/context';
import { corsHeaders, originAllowed, parseList } from './http/cors';
import { errorResponse, fail, failureResponse, isApiFailure } from './http/errors';
import { clientAddress, hourIso, json, readBody } from './http/http';
import { consoleLogger, requestIdFrom, scrub, type Logger } from './http/log';
import { Router, type Reply, type RouteDef } from './http/router';
import { chargeAnonymous, enforceGlobal, enforceNetworkLimit, enforcePlayerLimit, type Caller } from './guards/limits';
import { withIdempotency } from './guards/idempotency';
import { authenticate, guestSignup, linkGoogle, linkPasskey, logout, refresh, revokeOthers, signInGoogle, signInPasskey } from './auth/routes';
import type { GoogleVerifier } from './auth/google';
import type { PasskeyVerifier } from './auth/passkey';
import { block, createGroup, deleteMe, downloadExport, exportMe, getMe, joinGroup, patchMe, registerPush, report } from './profile/routes';
import { acceptInvite, batNext, batShot, createDuel, getMatch, invitePreview, listMatches, lockOver, rematch, revealMatch } from './match/routes';
import { getTop100 } from './top100/routes';
import { decideConsent, myHighlights, previewHighlight, withdrawConsent } from './highlights/consent';
import { highlightLanding, highlightReplay, postAttribution } from './highlights/public';
import { shareMatch, sharedMatch } from './match/share';
import { claimShareMoment } from './match/moments';
import { claimRender, completeRender, failRender, putRenderedVideo } from './highlights/render';
import type { YouTubePublisher } from './highlights/youtube';
import { authenticateAdmin } from './admin/access';
import * as admin from './admin/routes';
import * as reports from './admin/reports';
import { createMatchObjectClass, type MatchObjectClass } from './match/matchDO';
import { createCupObjectClass, type CupObjectClass } from './cup/cupDO';
import { createCup, getCup } from './cup/routes';
import { createRoomObjectClass, type RoomObjectClass } from './room/roomDO';
import { banter, getRoom, react, settings as roomSettings, text as roomText } from './room/routes';
import { attemptResult, getDaily, startAttempt } from './daily/routes';
import { getLeaderboard } from './daily/leaderboards';
import { getPushSettings, setPushSettings } from './ops/notifyRoutes';
import { runScheduled } from './ops/cron';
import { analyticsEngineMetrics, MemoryMetrics, type Metrics } from './ops/metrics';
import type { PushSender } from './ops/push';
import { handleQueue } from './ops/queues';
import { dataKeys, rateSalt } from './security/secrets';
import { publishedKeys, signingKey } from './security/signing';
import { parseRefreshToken } from './security/tokens';

export interface WorkerOptions {
  engines: readonly SealedSixEngineApi[] | EngineRegistry;
  now?: () => number;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  logger?: Logger;
  metrics?: Metrics;
  google?: GoogleVerifier;
  passkeys?: PasskeyVerifier;
  push?: PushSender;
  /** Stable engine helpers beside the contract (`timingAudit`, `dailyCommits` from @/engine), paired with the engines. */
  helpers?: Partial<EngineHelpers>;
  /** YouTube adapter override (tests); otherwise the real one with OAuth secrets, else the mock. */
  youtube?: YouTubePublisher;
}

export interface Worker {
  fetch(request: Request, env: Env, ctx?: ExecutionContextLike): Promise<Response>;
  scheduled(event: ScheduledEventLike, env: Env, ctx?: ExecutionContextLike): Promise<void>;
  queue(batch: MessageBatchLike<unknown>, env: Env, ctx?: ExecutionContextLike): Promise<void>;
}

/** Every contract route, exactly once (the `satisfies` makes a missing or unknown key a compile error). */
const CONTRACT_ROUTES = {
  'GET /v1/health': { auth: 'none', limit: 'none', idempotency: 'none', handler: health },
  'GET /v1/keys': { auth: 'none', limit: 'read', idempotency: 'none', handler: keys },
  'POST /v1/auth/guest': { auth: 'none', limit: 'auth', idempotency: 'worker', handler: guestSignup },
  'POST /v1/auth/google': { auth: 'none', limit: 'auth', idempotency: 'worker', handler: signInGoogle },
  'POST /v1/auth/link/passkey': { auth: 'required', limit: 'write', idempotency: 'worker', handler: linkPasskey },
  'POST /v1/auth/passkey': { auth: 'none', limit: 'auth', idempotency: 'worker', handler: signInPasskey },
  'GET /v1/exports/:id': { auth: 'none', limit: 'invite', idempotency: 'none', handler: downloadExport },
  'POST /v1/auth/refresh': { auth: 'none', limit: 'auth', idempotency: 'worker', handler: refresh },
  'POST /v1/auth/link/google': { auth: 'required', limit: 'write', idempotency: 'worker', handler: linkGoogle },
  'POST /v1/auth/logout': { auth: 'required', limit: 'write', idempotency: 'worker', handler: logout },
  'POST /v1/auth/revoke-others': { auth: 'required', limit: 'write', idempotency: 'worker', handler: revokeOthers },
  'GET /v1/me': { auth: 'required', limit: 'read', idempotency: 'none', handler: getMe },
  'PATCH /v1/me': { auth: 'required', limit: 'write', idempotency: 'worker', handler: patchMe },
  'POST /v1/me/export': { auth: 'required', limit: 'write', idempotency: 'worker', handler: exportMe },
  'DELETE /v1/me': { auth: 'required', limit: 'write', idempotency: 'worker', handler: deleteMe },
  'POST /v1/groups': { auth: 'required', limit: 'write', idempotency: 'worker', handler: createGroup },
  'POST /v1/groups/join': { auth: 'required', limit: 'write', idempotency: 'worker', handler: joinGroup },
  'POST /v1/duels': { auth: 'required', limit: 'write', idempotency: 'worker', handler: createDuel },
  'GET /v1/invites/:token': { auth: 'none', limit: 'invite', idempotency: 'none', handler: invitePreview },
  'POST /v1/invites/:token/accept': { auth: 'required', limit: 'write', idempotency: 'match', handler: acceptInvite },
  'GET /v1/matches': { auth: 'required', limit: 'read', idempotency: 'none', handler: listMatches },
  'GET /v1/matches/:id': { auth: 'required', limit: 'read', idempotency: 'none', handler: getMatch },
  'POST /v1/matches/:id/lock': { auth: 'required', limit: 'write', idempotency: 'match', maxBody: BODY_LIMITS.lock, handler: lockOver },
  'POST /v1/matches/:id/bat/next': { auth: 'required', limit: 'bat', idempotency: 'match', handler: batNext },
  'POST /v1/matches/:id/bat/shot': { auth: 'required', limit: 'bat', idempotency: 'match', maxBody: BODY_LIMITS.shot, handler: batShot },
  'GET /v1/matches/:id/reveal': { auth: 'required', limit: 'read', idempotency: 'none', handler: revealMatch },
  'POST /v1/matches/:id/rematch': { auth: 'required', limit: 'write', idempotency: 'match', handler: rematch },
  'POST /v1/cups': { auth: 'required', limit: 'write', idempotency: 'worker', handler: createCup },
  'GET /v1/cups/:id': { auth: 'required', limit: 'read', idempotency: 'none', handler: getCup },
  'GET /v1/rooms/:id': { auth: 'required', limit: 'read', idempotency: 'none', handler: getRoom },
  'POST /v1/rooms/:id/react': { auth: 'required', limit: 'write', idempotency: 'worker', handler: react },
  'POST /v1/rooms/:id/banter': { auth: 'required', limit: 'write', idempotency: 'worker', handler: banter },
  'POST /v1/rooms/:id/settings': { auth: 'required', limit: 'write', idempotency: 'worker', handler: roomSettings },
  'POST /v1/report': { auth: 'required', limit: 'write', idempotency: 'worker', handler: report },
  'POST /v1/blocks/:playerId': { auth: 'required', limit: 'write', idempotency: 'worker', handler: block },
  'GET /v1/daily': { auth: 'required', limit: 'read', idempotency: 'none', handler: getDaily },
  'POST /v1/daily/attempts': { auth: 'required', limit: 'write', idempotency: 'worker', handler: startAttempt },
  'POST /v1/daily/attempts/:id/next': { auth: 'required', limit: 'bat', idempotency: 'match', handler: batNext },
  'POST /v1/daily/attempts/:id/shot': { auth: 'required', limit: 'bat', idempotency: 'match', maxBody: BODY_LIMITS.shot, handler: batShot },
  'GET /v1/daily/attempts/:id/result': { auth: 'required', limit: 'read', idempotency: 'none', handler: attemptResult },
  'GET /v1/leaderboards/:scope': { auth: 'required', limit: 'read', idempotency: 'none', handler: getLeaderboard },
  'GET /v1/top100/:day': { auth: 'none', limit: 'invite', idempotency: 'none', handler: getTop100 },
  'GET /v1/highlights/mine': { auth: 'required', limit: 'read', idempotency: 'none', handler: myHighlights },
  'POST /v1/highlights/:jobId/consent': { auth: 'required', limit: 'write', idempotency: 'worker', handler: decideConsent },
  'POST /v1/highlights/:jobId/withdraw': { auth: 'required', limit: 'write', idempotency: 'worker', handler: withdrawConsent },
  'POST /v1/push/register': { auth: 'required', limit: 'write', idempotency: 'worker', handler: registerPush },
  'GET /v1/highlights/:jobId/preview': { auth: 'required', limit: 'read', idempotency: 'none', handler: previewHighlight },
  'GET /v1/h/:code': { auth: 'none', limit: 'invite', idempotency: 'none', handler: highlightLanding },
  // Idempotent by construction (one keyed code per match), so no Idempotency-Key; per-player write limits apply.
  'POST /v1/matches/:id/share': { auth: 'required', limit: 'write', idempotency: 'none', handler: shareMatch },
  'GET /v1/s/:code': { auth: 'none', limit: 'invite', idempotency: 'none', handler: sharedMatch },
  // The share cap: idempotent by construction (the first time a moment was opened is kept); per-player write limits.
  'POST /v1/matches/:id/moments': { auth: 'required', limit: 'write', idempotency: 'none', handler: claimShareMoment },
  'GET /v1/h/:code/replay': { auth: 'none', limit: 'invite', idempotency: 'none', handler: highlightReplay },
  // Counters only (no Idempotency-Key needed: a duplicate is one count among many); per-network limits apply.
  'POST /v1/attribution': { auth: 'none', limit: 'invite', idempotency: 'none', handler: postAttribution },
  'GET /v1/push/settings': { auth: 'required', limit: 'read', idempotency: 'none', handler: getPushSettings },
  'POST /v1/push/settings': { auth: 'required', limit: 'write', idempotency: 'worker', handler: setPushSettings },
  'POST /v1/rooms/:id/text': { auth: 'required', limit: 'write', idempotency: 'worker', handler: roomText },
} satisfies Record<keyof ApiRoutes, Omit<RouteDef, 'key'>>;

/** The admin console (types in src/admin/types.ts): Cloudflare Access, or ADMIN_TOKEN outside production. */
const ADMIN_ROUTES: Record<string, Omit<RouteDef, 'key'>> = {
  'GET /v1/admin/whoami': { auth: 'admin', limit: 'read', idempotency: 'none', handler: admin.whoami },
  'GET /v1/admin/jobs': { auth: 'admin', limit: 'read', idempotency: 'none', handler: admin.listJobs },
  'GET /v1/admin/jobs/:jobId': { auth: 'admin', limit: 'read', idempotency: 'none', handler: admin.jobDetail },
  'POST /v1/admin/jobs/:jobId/approve': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.approveJob },
  'POST /v1/admin/jobs/:jobId/reject': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.rejectJob },
  'POST /v1/admin/jobs/:jobId/schedule': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.scheduleJob },
  'POST /v1/admin/jobs/:jobId/retry-render': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.retryRender },
  'POST /v1/admin/jobs/:jobId/retry-upload': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.retryUpload },
  'POST /v1/admin/jobs/:jobId/unlist': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.unlistJob },
  'POST /v1/admin/jobs/:jobId/remove': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.removeJob },
  'POST /v1/admin/jobs/:jobId/preview-url': { auth: 'admin', limit: 'write', idempotency: 'none', handler: admin.previewUrl },
  'GET /v1/admin/quota': { auth: 'admin', limit: 'read', idempotency: 'none', handler: admin.quota },
  'GET /v1/admin/dlq': { auth: 'admin', limit: 'read', idempotency: 'none', handler: admin.deadLetters },
  // The report queue (admin/reports.ts); every action is audited with the moderator's identity.
  'GET /v1/admin/reports': { auth: 'admin', limit: 'read', idempotency: 'none', handler: reports.listReports },
  'POST /v1/admin/reports/:reportId/dismiss': { auth: 'admin', limit: 'write', idempotency: 'none', handler: reports.dismissReport },
  'POST /v1/admin/reports/:reportId/rename': { auth: 'admin', limit: 'write', idempotency: 'none', handler: reports.renameReported },
  'POST /v1/admin/reports/:reportId/suspend': { auth: 'admin', limit: 'write', idempotency: 'none', handler: reports.suspendReported },
  'POST /v1/admin/reports/:reportId/unsuspend': { auth: 'admin', limit: 'write', idempotency: 'none', handler: reports.unsuspendReported },
  'POST /v1/admin/reports/:reportId/remove-post': { auth: 'admin', limit: 'write', idempotency: 'none', handler: reports.removeReportedPost },
  // A signed 10-minute link for the console's <video> element (plus the Access token in production).
  'GET /v1/admin/media/:jobId': { auth: 'none', limit: 'read', idempotency: 'none', handler: admin.media },
};

/** The render service (signed requests, highlights/render.ts). */
const INTERNAL_ROUTES: Record<string, Omit<RouteDef, 'key'>> = {
  'POST /v1/internal/render/claim': { auth: 'none', limit: 'write', idempotency: 'none', handler: claimRender },
  'PUT /v1/internal/render/jobs/:jobId/video': { auth: 'none', limit: 'write', idempotency: 'none', body: 'stream', handler: putRenderedVideo },
  'POST /v1/internal/render/jobs/:jobId/complete': { auth: 'none', limit: 'write', idempotency: 'none', handler: completeRender },
  'POST /v1/internal/render/jobs/:jobId/fail': { auth: 'none', limit: 'write', idempotency: 'none', handler: failRender },
};

async function health(ctx: RequestContext): Promise<Reply> {
  return { status: 200, body: { ok: true, version: ctx.cfg.version, engines: ctx.deps.engines.versions(), time: hourIso(ctx.now) } };
}

async function keys(ctx: RequestContext): Promise<Reply> {
  const list = await publishedKeys(await signingKey(ctx.env.SIGNING_KEY), ctx.env.RETIRED_SIGNING_KEYS);
  return { status: 200, body: { keys: list }, headers: { 'cache-control': 'public, max-age=3600' } };
}

export function buildRouter(): Router {
  const router = new Router();
  for (const [key, def] of Object.entries({ ...CONTRACT_ROUTES, ...ADMIN_ROUTES, ...INTERNAL_ROUTES })) router.add({ key, ...(def as Omit<RouteDef, 'key'>) });
  return router;
}

/** Idempotency scope: the account when signed in, otherwise the refresh family or the route. */
function idempotencyScope(ctx: RequestContext): string {
  if (ctx.actor) return `u:${ctx.actor.uid}`;
  if (ctx.route.key === 'POST /v1/auth/refresh') {
    const parsed = parseRefreshToken((ctx.body as { refreshToken?: unknown } | undefined)?.refreshToken);
    return parsed ? `f:${parsed.familyId}` : 'a:refresh';
  }
  return `a:${ctx.route.key.split(' ')[1]}`;
}

function toResponse(reply: Reply, base: Record<string, string>): Response {
  if (reply instanceof Response) {
    const headers = new Headers(reply.headers);
    for (const [k, v] of Object.entries(base)) headers.set(k, v);
    return new Response(reply.body, { status: reply.status, headers });
  }
  return json(reply.body, reply.status, { ...base, ...(reply.headers ?? {}) });
}

export function createWorker(opts: WorkerOptions): { worker: Worker; MatchDO: MatchObjectClass; CupDO: CupObjectClass; RoomDO: RoomObjectClass; deps: WorkerDeps; router: Router } {
  const engines = Array.isArray(opts.engines) ? engineRegistry(opts.engines as SealedSixEngineApi[]) : (opts.engines as EngineRegistry);
  const memoryMetrics = opts.metrics ?? new MemoryMetrics();
  const deps: WorkerDeps = {
    engines,
    helpers: opts.helpers ?? {},
    now: opts.now ?? (() => Date.now()),
    fetch: opts.fetch ?? ((input, init) => fetch(input, init)),
    logger: opts.logger ?? consoleLogger,
    metrics: memoryMetrics,
    google: opts.google,
    passkeys: opts.passkeys,
    push: opts.push,
    youtube: opts.youtube,
  };
  const router = buildRouter();
  const metricsFor = (env: Env): Metrics => analyticsEngineMetrics(env.METRICS, memoryMetrics);

  async function handle(request: Request, env: Env, exec?: ExecutionContextLike): Promise<Response> {
    const now = deps.now();
    const metrics = metricsFor(env);
    const reqDeps: WorkerDeps = { ...deps, metrics };
    const reqId = requestIdFrom(request);
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    // The admin console is served from its own origin, allowed for the admin routes only.
    const allowed = [...parseList(env.ALLOWED_ORIGINS), ...(url.pathname.startsWith('/v1/admin/') && env.ADMIN_ORIGIN ? [env.ADMIN_ORIGIN] : [])];
    const base: Record<string, string> = { ...corsHeaders(origin, allowed), 'x-request-id': reqId };
    let routeKey = 'unmatched';
    let response: Response;
    let code: string | null = null;
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: originAllowed(origin, allowed) ? 204 : 403, headers: base });
      if (!originAllowed(origin, allowed)) fail('forbidden', 'origin not allowed');
      const version = /^\/(v\d+)(?:\/|$)/.exec(url.pathname);
      if (!version) fail('not_found', 'not found');
      if (version[1] !== 'v1') fail('version_mismatch', `${version[1]} is not served here; this server speaks v1`);
      const matched = router.match(request.method, url.pathname);
      if (matched === null) fail('not_found', 'not found');
      if (matched === 'method_not_allowed') fail('invalid', 'method not allowed', { status: 405 });
      const def = matched.def;
      routeKey = def.key;
      const cfg = readConfig(env);
      const salt = def.limit === 'none' ? null : rateSalt(env, deps.logger, cfg.production);
      const ctx: RequestContext = {
        request,
        url,
        env,
        deps: reqDeps,
        cfg,
        reqId,
        now,
        ip: clientAddress(request),
        params: matched.params,
        route: def,
        actor: null,
        admin: null,
        body: undefined,
        rawBody: '',
        idemKey: null,
        salt,
        waitUntil: (p) => (exec ? exec.waitUntil(p) : void p.catch(() => undefined)),
      };
      // Signed-in routes (players and admins) spend the signed-in budget only once the caller is verified; anything
      // anonymous, and every failed sign-in, spends the smaller anonymous budget (guards/limits.ts).
      const caller: Caller = def.auth === 'none' ? 'anonymous' : 'signed';
      const guard = { env, cfg, metrics, salt, ip: ctx.ip, now };
      await enforceNetworkLimit(guard, def.limit, caller);
      if (caller === 'anonymous') await enforceGlobal(guard, def.limit, 'anonymous');
      try {
        if (def.auth === 'required') ctx.actor = await authenticate(ctx);
        else if (def.auth === 'admin') ctx.admin = await authenticateAdmin(ctx);
      } catch (e) {
        await chargeAnonymous(guard, def.limit);
        throw e;
      }
      if (ctx.actor) await enforcePlayerLimit({ ...guard, uid: ctx.actor.uid }, def.limit);
      if (caller === 'signed') await enforceGlobal(guard, def.limit, 'signed');
      if (request.method !== 'GET' && def.body !== 'stream') {
        const raw = await readBody(request, def.maxBody ?? BODY_LIMITS.default);
        if (raw === null) fail('invalid', 'request body too large', { status: 413 });
        ctx.rawBody = raw;
        if (raw.length > 0) {
          if (!/^application\/json\b/i.test(request.headers.get('content-type') ?? '')) fail('invalid', 'content-type must be application/json', { status: 415 });
          try {
            ctx.body = JSON.parse(raw) as unknown;
          } catch {
            fail('invalid', 'body is not valid JSON');
          }
        }
        if (def.idempotency !== 'none') {
          const key = request.headers.get('idempotency-key');
          if (!key || !IDEMPOTENCY_KEY_RE.test(key)) fail('invalid', 'Idempotency-Key header (a UUID) is required on every mutation');
          ctx.idemKey = key;
        }
      }
      const reply =
        def.idempotency === 'worker'
          ? await withIdempotency(
              {
                db: env.DB,
                dataKeys: dataKeys(env, deps.logger),
                metrics,
                scope: idempotencyScope(ctx),
                key: ctx.idemKey as string,
                route: def.key,
                fingerprint: `${JSON.stringify(ctx.params)}\n${ctx.rawBody}`,
                now,
              },
              () => def.handler(ctx),
            )
          : await def.handler(ctx);
      response = toResponse(reply, base);
    } catch (e) {
      if (isApiFailure(e)) {
        code = e.code;
        response = failureResponse(e, base);
      } else {
        code = 'internal';
        deps.logger.log('error', { evt: 'unhandled', reqId, route: routeKey, error: scrub(`${(e as Error)?.name ?? 'Error'}: ${(e as Error)?.message ?? String(e)}`) });
        response = errorResponse('unavailable', 'internal error', 500, base);
      }
    }
    const ms = deps.now() - now;
    deps.logger.log(response.status >= 500 ? 'error' : 'info', { evt: 'request', reqId, route: routeKey, method: request.method, status: response.status, code, ms });
    metrics.count('request', [routeKey, `${Math.floor(response.status / 100)}xx`]);
    if (code) metrics.count('error', [routeKey, code]);
    return response;
  }

  const worker: Worker = {
    async fetch(request, env, ctx) {
      try {
        return await handle(request, env, ctx);
      } catch {
        return errorResponse('unavailable', 'internal error', 500, corsHeaders(request.headers.get('origin'), parseList(env.ALLOWED_ORIGINS)));
      }
    },
    async scheduled(event, env) {
      await runScheduled(event, env, { ...deps, metrics: metricsFor(env) }, readConfig(env));
    },
    async queue(batch, env) {
      await handleQueue(batch, env, { ...deps, metrics: metricsFor(env) }, readConfig(env));
    },
  };

  const MatchDO = createMatchObjectClass({ engines, now: deps.now, logger: deps.logger, metrics: memoryMetrics, helpers: deps.helpers });
  const CupDO = createCupObjectClass({ now: deps.now, logger: deps.logger, metrics: memoryMetrics });
  const RoomDO = createRoomObjectClass({ now: deps.now, logger: deps.logger, metrics: memoryMetrics });
  return { worker, MatchDO, CupDO, RoomDO, deps, router };
}
