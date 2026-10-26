/**
 * Deep links (DeepLinkSource in src/contracts/adapters.ts).
 *
 *   https://<web origin>/i/<token>[?a=<code>]   invite: opens the web app without an install; with the app installed,
 *                                                Android App Links (assetlinks.json) open the app on the same URL
 *   vandecricket://i/<token>                    custom scheme (also in.vande.cricket://), for the install referrer
 *   https://<web origin>/m/<matchId>            a match (notifications, Cricket Room cards)
 *   https://<web origin>/c/<cupId>              a Group Cup
 *   https://<web origin>/h/<code>[?a=<code>]    a published highlight's landing ("Can you beat them?")
 *   https://<web origin>/s/<code>               a match a player shared (public replay, POST /v1/matches/:id/share)
 *   (each also as vandecricket://<kind>/<id>, and every https form under the web origin's base path)
 *
 * On first launch after an install from an invite, the Play install referrer supplies the invite (installReferrer.ts),
 * so installing the app keeps the pending match.
 */
import type { DeepLinkSource } from '@/contracts';
import { ATTRIBUTION_RE, CUP_ID_RE, CUSTOM_SCHEMES, HIGHLIGHT_CODE_RE, INVITE_TOKEN_RE, MATCH_ID_RE, SHARED_CODE_RE } from '@/net/shared/ids';
import { NATIVE_TIMEOUT_MS, isNativePlatform, settleWithin } from './capacitor';

export type AppLink =
  | { kind: 'invite'; token: string; attribution: string | null }
  | { kind: 'match'; matchId: string }
  | { kind: 'cup'; cupId: string }
  | { kind: 'highlight'; code: string; attribution: string | null }
  | { kind: 'shared'; code: string };

export function parseAppLink(raw: string, webOrigins: readonly string[]): AppLink | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const scheme = url.protocol.replace(/:$/, '');
  let path: string;
  if ((CUSTOM_SCHEMES as readonly string[]).includes(scheme)) {
    // vandecricket://i/<token> parses with host "i" and path "/<token>".
    path = `/${url.host}${url.pathname}`;
  } else if (url.protocol === 'https:' || url.protocol === 'http:') {
    // A web origin may carry a base path (https://host/Vande): the link's path is what follows it.
    const base = webOrigins
      .map((o) => o.replace(/\/+$/, ''))
      .filter((o) => {
        try {
          return new URL(o).origin === url.origin;
        } catch {
          return false;
        }
      })
      .map((o) => new URL(o).pathname.replace(/\/+$/, ''))
      .find((prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`));
    if (base === undefined) return null;
    path = url.pathname.slice(base.length) || '/';
  } else {
    return null;
  }
  const attr = url.searchParams.get('a');
  const attribution = attr && ATTRIBUTION_RE.test(attr) ? attr : null;
  const invite = /^\/i\/([^/]+)\/?$/.exec(path);
  if (invite && INVITE_TOKEN_RE.test(invite[1])) return { kind: 'invite', token: invite[1], attribution };
  const match = /^\/m\/([^/]+)\/?$/.exec(path);
  if (match && MATCH_ID_RE.test(match[1])) return { kind: 'match', matchId: match[1] };
  const cup = /^\/c\/([^/]+)\/?$/.exec(path);
  if (cup && CUP_ID_RE.test(cup[1])) return { kind: 'cup', cupId: cup[1] };
  const highlight = /^\/h\/([^/]+)\/?$/.exec(path);
  if (highlight && HIGHLIGHT_CODE_RE.test(highlight[1])) return { kind: 'highlight', code: highlight[1], attribution };
  const shared = /^\/s\/([^/]+)\/?$/.exec(path);
  if (shared && SHARED_CODE_RE.test(shared[1])) return { kind: 'shared', code: shared[1] };
  return null;
}

export interface DeepLinkDeps {
  native?: () => boolean;
  /** Native launch URL (Capacitor App.getLaunchUrl). */
  launchUrl?: () => Promise<string | null>;
  /** Native "app opened with a URL" events (Capacitor App 'appUrlOpen'); returns an unsubscribe function. */
  listen?: (cb: (url: string) => void) => Promise<() => void>;
  /** The invite carried by the Play install referrer on the first launch, if any. */
  referrer?: () => Promise<string | null>;
  location?: { href: string };
  /** How long the launch URL and the referrer may take before the app starts without them. */
  timeoutMs?: number;
}

async function capacitorLaunchUrl(): Promise<string | null> {
  const { App } = await import('@capacitor/app');
  return (await App.getLaunchUrl())?.url ?? null;
}

async function capacitorListen(cb: (url: string) => void): Promise<() => void> {
  const { App } = await import('@capacitor/app');
  const handle = await App.addListener('appUrlOpen', (e) => cb(e.url));
  return () => void handle.remove();
}

export function createDeepLinkSource(deps: DeepLinkDeps = {}): DeepLinkSource {
  const native = deps.native ?? isNativePlatform;
  return {
    async initial() {
      if (native()) {
        // Boot waits on this: a native side that never answers costs a few seconds, never the launch.
        const ms = deps.timeoutMs ?? NATIVE_TIMEOUT_MS;
        const launched = await settleWithin((deps.launchUrl ?? capacitorLaunchUrl)(), ms, null);
        if (launched) return launched;
        return deps.referrer ? settleWithin(deps.referrer(), 2 * ms, null) : null;
      }
      const href = deps.location?.href ?? (typeof location !== 'undefined' ? location.href : null);
      return href ?? null;
    },
    onLink(cb) {
      if (!native()) return () => undefined;
      let unsubscribe: (() => void) | null = null;
      let stopped = false;
      void (deps.listen ?? capacitorListen)(cb)
        .then((u) => (stopped ? u() : (unsubscribe = u)))
        .catch(() => undefined);
      return () => {
        stopped = true;
        unsubscribe?.();
      };
    },
  };
}
