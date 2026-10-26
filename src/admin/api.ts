/**
 * The admin console's API client. Same origin by default (behind Cloudflare Access the browser carries the Access
 * cookie and the Worker verifies the injected JWT); for local development an API base and the ADMIN_TOKEN can be set,
 * kept for the tab only (sessionStorage) and only ever sent to that base.
 */
import type { AdminRouteKey, AdminRoutes } from './types';

export interface AdminAuth {
  /** API origin, '' for the page's own origin. */
  base: string;
  /** Local ADMIN_TOKEN (development only); null behind Cloudflare Access. */
  token: string | null;
}

export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

type Params<K extends string> = K extends `${string}:jobId${string}` ? { jobId: string } : K extends `${string}:reportId${string}` ? { reportId: string } : undefined;

export function adminPath(key: AdminRouteKey, params?: { jobId?: string; reportId?: string }, query?: Record<string, string | undefined>): string {
  const route = key.slice(key.indexOf(' ') + 1);
  const path = route
    .replace(':jobId', () => {
      const id = params?.jobId ?? '';
      if (!/^j[a-z2-7]{26}$/.test(id)) throw new Error('bad job id');
      return id;
    })
    .replace(':reportId', () => {
      const id = params?.reportId ?? '';
      if (!/^\d{1,12}$/.test(id)) throw new Error('bad report id');
      return id;
    });
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `${path}?${qs}` : path;
}

export function createAdminApi(auth: AdminAuth, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const base = auth.base.replace(/\/+$/, '');
  if (base && !/^https?:\/\/[^/]+$/.test(base)) throw new Error('the API base must be an origin');
  return {
    async call<K extends AdminRouteKey>(key: K, opts: { params?: Params<K>; query?: Record<string, string | undefined>; body?: AdminRoutes[K][0] } = {}): Promise<AdminRoutes[K][1]> {
      const method = key.slice(0, key.indexOf(' '));
      const headers: Record<string, string> = { accept: 'application/json' };
      if (auth.token) headers.authorization = `Bearer ${auth.token}`;
      if (method !== 'GET') headers['content-type'] = 'application/json';
      const res = await fetchImpl(`${base}${adminPath(key, opts.params as { jobId?: string; reportId?: string } | undefined, opts.query)}`, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
        credentials: base ? 'omit' : 'same-origin',
        redirect: 'error',
      });
      const text = await res.text();
      const json = text ? (JSON.parse(text) as unknown) : null;
      if (!res.ok) {
        const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
        throw new AdminApiError(res.status, err?.code ?? 'error', err?.message ?? `HTTP ${res.status}`);
      }
      return json as AdminRoutes[K][1];
    },
  };
}

export type AdminApi = ReturnType<typeof createAdminApi>;

const STORE = 'vc.admin.auth';

export function loadAuth(storage: Pick<Storage, 'getItem'> | null): AdminAuth {
  try {
    const raw = storage?.getItem(STORE);
    if (raw) {
      const v = JSON.parse(raw) as Partial<AdminAuth>;
      return { base: typeof v.base === 'string' ? v.base : '', token: typeof v.token === 'string' && v.token ? v.token : null };
    }
  } catch {
    /* fall through */
  }
  return { base: '', token: null };
}

export function saveAuth(storage: Pick<Storage, 'setItem' | 'removeItem'> | null, auth: AdminAuth): void {
  try {
    if (!auth.base && !auth.token) storage?.removeItem(STORE);
    else storage?.setItem(STORE, JSON.stringify(auth));
  } catch {
    /* private mode */
  }
}
