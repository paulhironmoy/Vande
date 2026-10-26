/**
 * Typed API client over ApiRoutes. Adds the bearer token (refreshing once on 401), an Idempotency-Key on every
 * mutation, a timeout, and turns every failure into an ApiClientError with the server's stable code. Never retries
 * by itself: durable retries belong to the outbox.
 */
import { ApiClientError, codeForStatus } from './errors';
import { ANONYMOUS_ROUTES, buildPath, methodOf, newIdempotencyKey, type RouteKey, type RouteParams, type RouteRequest, type RouteResponse } from './routes';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  /** A valid access token for signed-in calls (the session refreshes it when it is about to expire). */
  accessToken?: () => Promise<string | null>;
  /** Called once when a signed-in call gets 401; true when a fresh token is available and the call can be retried. */
  onUnauthorized?: () => Promise<boolean>;
  /** Reachability signal for connectivity tracking (true: the server answered; false: network failure or timeout). */
  onNetworkResult?: (reachable: boolean) => void;
  timeoutMs?: number;
  clientId?: string;
}

export interface CallOptions {
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Overrides the anonymous/signed-in default of the route. */
  anonymous?: boolean;
  timeoutMs?: number;
}

export type CallArgs<K extends RouteKey> = {
  params?: RouteParams<K>;
  body?: RouteRequest<K>;
  query?: Record<string, string | undefined>;
};

export interface ApiClient {
  readonly baseUrl: string;
  call<K extends RouteKey>(route: K, args?: CallArgs<K>, options?: CallOptions): Promise<RouteResponse<K>>;
}

function retryAfterMs(res: Response): number | null {
  const v = res.headers.get('retry-after');
  if (v === null) return null;
  const s = Number(v);
  return Number.isFinite(s) ? Math.max(0, s * 1000) : null;
}

export function createApiClient(o: ApiClientOptions): ApiClient {
  const doFetch: FetchLike = o.fetch ?? ((input, init) => fetch(input, init));
  const base = o.baseUrl.replace(/\/+$/, '');

  async function once(route: string, url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<Response> {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller?.abort();
    }, timeoutMs);
    const onAbort = () => controller?.abort();
    signal?.addEventListener('abort', onAbort);
    try {
      const res = await doFetch(url, { ...init, signal: controller?.signal });
      o.onNetworkResult?.(true);
      return res;
    } catch (e) {
      if (signal?.aborted) throw new ApiClientError('network', 'request cancelled');
      o.onNetworkResult?.(false);
      if (timedOut) throw new ApiClientError('timeout', `${route} timed out`);
      throw new ApiClientError('network', e instanceof Error ? e.message : 'network error');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async function call<K extends RouteKey>(route: K, args: CallArgs<K> = {}, options: CallOptions = {}): Promise<RouteResponse<K>> {
    const method = methodOf(route);
    const anonymous = options.anonymous ?? ANONYMOUS_ROUTES.has(route);
    let path = buildPath(route, args.params as Record<string, string> | undefined);
    const query = new URLSearchParams();
    if (method === 'GET' && args.body && typeof args.body === 'object') {
      for (const [k, v] of Object.entries(args.body as Record<string, unknown>)) if (v !== undefined && v !== null && !(args.params && k in (args.params as object))) query.set(k, String(v));
    }
    for (const [k, v] of Object.entries(args.query ?? {})) if (v !== undefined) query.set(k, v);
    if ([...query.keys()].length > 0) path += `?${query.toString()}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (o.clientId) headers['x-vande-client'] = o.clientId;
    let body: string | undefined;
    if (method !== 'GET') {
      headers['idempotency-key'] = options.idempotencyKey ?? newIdempotencyKey();
      if (args.body !== undefined) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(args.body);
      }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!anonymous) {
        const token = await o.accessToken?.();
        if (!token) throw new ApiClientError('unauthorized', 'not signed in', 401);
        headers.authorization = `Bearer ${token}`;
      }
      const res = await once(route, `${base}${path}`, { method, headers, body }, options.timeoutMs ?? o.timeoutMs ?? 12_000, options.signal);
      if (res.status === 401 && !anonymous && attempt === 0 && o.onUnauthorized && (await o.onUnauthorized())) continue;
      const text = await res.text();
      let parsed: unknown = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        if (res.ok) throw new ApiClientError('bad_response', 'response was not JSON', res.status);
      }
      if (res.ok) return parsed as RouteResponse<K>;
      const err = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
      const code = (err?.code as ApiClientError['code'] | undefined) ?? codeForStatus(res.status);
      const decided = res.headers.get('x-decided-at');
      throw new ApiClientError(code, err?.message ?? `HTTP ${res.status}`, res.status, retryAfterMs(res), decided && !Number.isNaN(Date.parse(decided)) ? decided : null);
    }
    throw new ApiClientError('unauthorized', 'session expired', 401);
  }

  return { baseUrl: base, call };
}
