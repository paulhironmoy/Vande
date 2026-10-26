/**
 * Minimal path router — ROOT-OWNED. Every journey has a real URL so invitations, highlights and the Android back
 * button work the same on the web, the installed PWA and the Capacitor app. Paths are relative to Vite's BASE_URL
 * (the app may be hosted under a sub-path such as /Vande/).
 */
import type { ComponentType, LazyExoticComponent } from 'react';
import { create } from 'zustand';
import type { LeaderboardScope } from '@/contracts';

export type Route =
  | { name: 'home' }
  | { name: 'onboarding' }
  | { name: 'training' }
  /** Offline first-person batting practice (src/practice). */
  | { name: 'practice' }
  | { name: 'daily' }
  | { name: 'ghosts' }
  /** `attribution`: the highlight code a challenge was started from (`?a=`), credited when the duel completes. */
  | { name: 'duel_new'; attribution?: string }
  /** `attribution` is the highlight code an invite was created from (`?a=`), credited when the duel completes. */
  | { name: 'invite'; token: string; attribution?: string }
  | { name: 'match'; matchId: string }
  | { name: 'replay'; matchId: string; moment?: 'key' | 'result' }
  | { name: 'cup_new' }
  | { name: 'cup'; cupId: string }
  | { name: 'room'; roomId: string }
  | { name: 'leaderboards'; scope: LeaderboardScope }
  | { name: 'top100'; day?: string }
  | { name: 'highlight'; code: string }
  /** A shared, revealed match (public, spoiler-safe landing). */
  | { name: 'shared'; code: string }
  | { name: 'highlights' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'not_found'; path: string };

const SCOPES: readonly LeaderboardScope[] = ['national', 'city', 'college', 'company', 'friends'];
/** Invite tokens: base64url payload, optionally `.` + base64url MAC (the server's shape, src/net/shared/ids.ts). */
const TOKEN = /^[A-Za-z0-9_-]{8,200}(\.[A-Za-z0-9_-]{8,64})?$/;
const ID = /^[A-Za-z0-9_-]{4,80}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Highlight and attribution codes (same shape as src/net/shared/ids.ts ATTRIBUTION_RE). */
const CODE = /^[a-z0-9]{4,16}$/;

export type RouteName = Route['name'];
export type RouteOf<N extends RouteName> = Extract<Route, { name: N }>;
/** A route-level screen: it receives its parsed route and reads services, the store and the router itself. */
export type RouteComponent<N extends RouteName> = ComponentType<{ route: RouteOf<N> }>;
/** Route name → screen; each workstream exports its part and the root shell (src/App.tsx) merges them. */
export type RouteTable = { [N in RouteName]?: RouteComponent<N> | LazyExoticComponent<RouteComponent<N>> };

export function basePath(): string {
  let base = '/';
  try {
    base = (import.meta.env?.BASE_URL as string | undefined) || '/';
  } catch {
    base = '/';
  }
  if (!base.startsWith('/')) base = `/${base}`;
  return base.endsWith('/') ? base : `${base}/`;
}

/** Parses an app-relative or absolute URL/path into a route. Unknown or malformed paths become not_found. */
export function parseRoute(input: string): Route {
  let pathname = input;
  let query = new URLSearchParams();
  try {
    const url = new URL(input, 'https://app.invalid');
    pathname = url.pathname;
    query = url.searchParams;
  } catch {
    /* keep raw */
  }
  // Custom scheme links (vandecricket://i/<token>) arrive with the first segment as the URL host.
  const scheme = /^vandecricket:\/\/(.+)$/i.exec(input);
  if (scheme) pathname = `/${scheme[1].split(/[?#]/)[0]}`;
  const base = basePath();
  if (base !== '/' && pathname.startsWith(base)) pathname = `/${pathname.slice(base.length)}`;
  const parts = pathname.split('/').filter(Boolean).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
  const [a, b, c] = parts;
  if (!a) return { name: 'home' };
  switch (a) {
    case 'start':
      return parts.length === 1 ? { name: 'onboarding' } : notFound(pathname);
    case 'train':
      return parts.length === 1 ? { name: 'training' } : notFound(pathname);
    case 'practice':
      return parts.length === 1 ? { name: 'practice' } : notFound(pathname);
    case 'daily':
      return parts.length === 1 ? { name: 'daily' } : notFound(pathname);
    case 'ghosts':
      return parts.length === 1 ? { name: 'ghosts' } : notFound(pathname);
    case 'duel': {
      if (parts.length !== 1) return notFound(pathname);
      const a = query.get('a');
      return a && CODE.test(a) ? { name: 'duel_new', attribution: a } : { name: 'duel_new' };
    }
    case 'i': {
      if (!b || !TOKEN.test(b) || parts.length !== 2) return notFound(pathname);
      const a = query.get('a');
      return a && CODE.test(a) ? { name: 'invite', token: b, attribution: a } : { name: 'invite', token: b };
    }
    case 'm':
      if (!b || !ID.test(b)) return notFound(pathname);
      if (parts.length === 2) return { name: 'match', matchId: b };
      if (c === 'replay' && parts.length === 3) return { name: 'replay', matchId: b };
      if (c === 'key' && parts.length === 3) return { name: 'replay', matchId: b, moment: 'key' };
      if (c === 'result' && parts.length === 3) return { name: 'replay', matchId: b, moment: 'result' };
      return notFound(pathname);
    case 'cup':
      return b === 'new' && parts.length === 2 ? { name: 'cup_new' } : notFound(pathname);
    case 'c':
      return b && ID.test(b) && parts.length === 2 ? { name: 'cup', cupId: b } : notFound(pathname);
    case 'r':
      return b && ID.test(b) && parts.length === 2 ? { name: 'room', roomId: b } : notFound(pathname);
    case 'leaderboards': {
      const scope = (b ?? 'national') as LeaderboardScope;
      return SCOPES.includes(scope) && parts.length <= 2 ? { name: 'leaderboards', scope } : notFound(pathname);
    }
    case 'top100':
      if (parts.length === 1) return { name: 'top100' };
      return b && DAY.test(b) && parts.length === 2 ? { name: 'top100', day: b } : notFound(pathname);
    case 'h':
      return b && CODE.test(b) && parts.length === 2 ? { name: 'highlight', code: b } : notFound(pathname);
    case 'highlights':
      return parts.length === 1 ? { name: 'highlights' } : notFound(pathname);
    case 's':
      return b && CODE.test(b) && parts.length === 2 ? { name: 'shared', code: b } : notFound(pathname);
    case 'me':
      return parts.length === 1 ? { name: 'profile' } : notFound(pathname);
    case 'settings':
      return parts.length === 1 ? { name: 'settings' } : notFound(pathname);
    default:
      return notFound(pathname);
  }
}

function notFound(path: string): Route {
  return { name: 'not_found', path };
}

/** App-relative path for a route (without BASE_URL). */
export function routePath(r: Route): string {
  const e = encodeURIComponent;
  switch (r.name) {
    case 'home':
      return '/';
    case 'onboarding':
      return '/start';
    case 'training':
      return '/train';
    case 'practice':
      return '/practice';
    case 'daily':
      return '/daily';
    case 'ghosts':
      return '/ghosts';
    case 'duel_new':
      return r.attribution ? `/duel?a=${e(r.attribution)}` : '/duel';
    case 'invite':
      return `/i/${e(r.token)}${r.attribution ? `?a=${e(r.attribution)}` : ''}`;
    case 'match':
      return `/m/${e(r.matchId)}`;
    case 'replay':
      return `/m/${e(r.matchId)}/${r.moment === 'key' ? 'key' : r.moment === 'result' ? 'result' : 'replay'}`;
    case 'cup_new':
      return '/cup/new';
    case 'cup':
      return `/c/${e(r.cupId)}`;
    case 'room':
      return `/r/${e(r.roomId)}`;
    case 'leaderboards':
      return `/leaderboards/${r.scope}`;
    case 'top100':
      return r.day ? `/top100/${r.day}` : '/top100';
    case 'highlight':
      return `/h/${e(r.code)}`;
    case 'highlights':
      return '/highlights';
    case 'shared':
      return `/s/${e(r.code)}`;
    case 'profile':
      return '/me';
    case 'settings':
      return '/settings';
    case 'not_found':
      return r.path;
  }
}

/** Absolute URL for sharing (invites, highlights). */
export function routeUrl(r: Route, origin = typeof location !== 'undefined' ? location.origin : 'https://app.invalid'): string {
  return `${origin.replace(/\/+$/, '')}${basePath().replace(/\/$/, '')}${routePath(r)}`;
}

interface RouterState {
  route: Route;
  /** In-app history depth (so Back never leaves the app from an inner screen). */
  depth: number;
  navigate(route: Route, opts?: { replace?: boolean }): void;
  back(): void;
  /** Sync from the browser location (popstate, deep links). */
  syncFromLocation(): void;
}

export const useRouter = create<RouterState>((set, get) => ({
  route: typeof location === 'undefined' ? { name: 'home' } : parseRoute(`${location.pathname}${location.search}`),
  depth: 0,
  navigate(route, opts) {
    const path = `${basePath().replace(/\/$/, '')}${routePath(route)}`;
    try {
      if (opts?.replace) history.replaceState({ depth: get().depth }, '', path);
      else history.pushState({ depth: get().depth + 1 }, '', path);
    } catch {
      /* non-browser test environments */
    }
    set({ route, depth: opts?.replace ? get().depth : get().depth + 1 });
  },
  back() {
    if (get().depth > 0) {
      try {
        history.back();
        return;
      } catch {
        /* fall through */
      }
    }
    get().navigate({ name: 'home' }, { replace: true });
  },
  syncFromLocation() {
    const depth = (history.state as { depth?: number } | null)?.depth ?? 0;
    set({ route: parseRoute(`${location.pathname}${location.search}`), depth });
  },
}));
