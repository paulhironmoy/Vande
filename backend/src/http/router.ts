/** A tiny versioned router: method + pattern ("/v1/matches/:id/lock") with named path parameters. */
import type { LimitScope } from '../guards/limits';
import type { RequestContext } from './context';

export type Reply = { status: number; body: unknown; headers?: Record<string, string> } | Response;

export interface RouteDef {
  /** "METHOD /path/:param", as in ApiRoutes. */
  key: string;
  /** required: a player's bearer token; admin: Cloudflare Access (or the local ADMIN_TOKEN); none: public or signed. */
  auth: 'required' | 'none' | 'admin';
  limit: LimitScope;
  maxBody?: number;
  /** stream: the handler reads the raw body itself (video uploads); json (default): parsed with the size limit. */
  body?: 'json' | 'stream';
  /**
   * worker: the Worker stores and replays the response (D1); match: the key is forwarded to the match object, which
   * keeps its own records; none: GET routes and capability links.
   */
  idempotency: 'worker' | 'match' | 'none';
  handler(ctx: RequestContext): Promise<Reply>;
}

interface Compiled {
  def: RouteDef;
  method: string;
  re: RegExp;
  names: string[];
}

export class Router {
  private routes: Compiled[] = [];

  add(def: RouteDef): this {
    const [method, path] = def.key.split(' ');
    const names: string[] = [];
    const re = new RegExp(
      `^${path
        .split('/')
        .map((seg) => {
          if (seg.startsWith(':')) {
            names.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/')}$`,
    );
    this.routes.push({ def, method, re, names });
    return this;
  }

  /** The route for a request, `method_not_allowed` when only the path matches, or null. */
  match(method: string, pathname: string): { def: RouteDef; params: Record<string, string> } | 'method_not_allowed' | null {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.re.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      const params: Record<string, string> = {};
      r.names.forEach((n, i) => (params[n] = m[i + 1]));
      return { def: r.def, params };
    }
    return pathMatched ? 'method_not_allowed' : null;
  }

  keys(): string[] {
    return this.routes.map((r) => r.def.key);
  }
}
