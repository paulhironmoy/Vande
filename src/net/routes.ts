/** Route typing for the client, derived from the root contract's ApiRoutes (every Worker route is in the contract). */
import type { ApiRoutes } from '@/contracts';

export type RouteKey = keyof ApiRoutes & string;
export type RouteRequest<K extends RouteKey> = ApiRoutes[K][0];
export type RouteResponse<K extends RouteKey> = ApiRoutes[K][1];

type PathOf<K> = K extends `${string} ${infer P}` ? P : never;
type ParamNames<P> = P extends `${string}:${infer N}/${infer R}` ? N | ParamNames<`/${R}`> : P extends `${string}:${infer N}` ? N : never;
export type RouteParams<K extends RouteKey> = [ParamNames<PathOf<K>>] extends [never] ? undefined : Record<ParamNames<PathOf<K>>, string>;

/** Calls that never carry a bearer token. */
export const ANONYMOUS_ROUTES: ReadonlySet<string> = new Set([
  'POST /v1/auth/guest',
  'POST /v1/auth/refresh',
  'POST /v1/auth/google',
  'POST /v1/auth/passkey',
  'GET /v1/invites/:token',
  'GET /v1/top100/:day',
  'GET /v1/keys',
  'GET /v1/health',
  'GET /v1/h/:code',
  'GET /v1/h/:code/replay',
  'GET /v1/s/:code',
  'POST /v1/attribution',
]);

export function methodOf(route: string): string {
  return route.slice(0, route.indexOf(' '));
}

/** Fills `:name` segments (URI-encoded); throws when one is missing. */
export function buildPath(route: string, params: Record<string, string> | undefined): string {
  const path = route.slice(route.indexOf(' ') + 1);
  return path.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const v = params?.[name];
    if (typeof v !== 'string' || v === '') throw new Error(`missing route parameter ${name}`);
    return encodeURIComponent(v);
  });
}

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
