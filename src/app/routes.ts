/**
 * Screen ⇄ URL mapping. Navigation is state-driven; URLs mirror the current screen so that deep links,
 * refresh and the browser/hardware back button all work on any static host.
 */
import type { AboutPage, Screen } from './storeTypes';

const ABOUT_PAGES: readonly AboutPage[] = ['privacy', 'disclosure', 'accessibility', 'attribution', 'support', 'version'];

/** Base path with a trailing slash, e.g. "/" or "/Vande/". */
export const BASE: string = normaliseBase(import.meta.env.BASE_URL ?? '/');

function normaliseBase(b: string): string {
  if (!b || b === './' || b === '.') return '/';
  let out = b;
  if (!out.startsWith('/')) out = `/${out}`;
  if (!out.endsWith('/')) out = `${out}/`;
  return out;
}

export function isAboutPage(p: string): p is AboutPage {
  return (ABOUT_PAGES as readonly string[]).includes(p);
}

/** Path for a screen, without the base prefix, always starting with "/". */
export function screenToPath(screen: Screen): string {
  switch (screen.name) {
    case 'launch':
      return '/';
    case 'intro':
      return '/intro';
    case 'home':
      return '/home';
    case 'opponents':
      return '/opponents';
    case 'briefing':
      return '/briefing';
    case 'play':
      return '/play';
    case 'chapter-result':
      return '/chapter';
    case 'final-result':
      return screen.resultId ? `/result/${encodeURIComponent(screen.resultId)}` : '/result';
    case 'daily':
      return '/daily';
    case 'challenge':
      return `/c/${encodeURIComponent(screen.code)}`;
    case 'republic':
      return '/republic';
    case 'history':
      return screen.entryId ? `/history/${encodeURIComponent(screen.entryId)}` : '/history';
    case 'settings':
      return '/settings';
    case 'about':
      return `/about/${screen.page}`;
  }
}

/** Strip the base prefix and trailing slash from a location pathname. */
export function stripBase(pathname: string): string {
  let p = pathname || '/';
  const baseNoSlash = BASE.slice(0, -1); // "" or "/Vande"
  if (baseNoSlash && (p === baseNoSlash || p.startsWith(`${baseNoSlash}/`))) p = p.slice(baseNoSlash.length) || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length) || '/';
  return p || '/';
}

/**
 * Resolve a location to a screen. Returns null for the root path ("/"), which means "launch".
 * Query parameters: `?c=<code>` opens a challenge, `?screen=daily` opens the daily screen.
 */
export function pathToScreen(pathname: string, search = ''): Screen | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const code = params.get('c');
  if (code) return { name: 'challenge', code };
  const q = params.get('screen');
  if (q === 'daily') return { name: 'daily' };
  if (q === 'home') return { name: 'home' };

  const path = stripBase(pathname);
  const parts = path.split('/').filter(Boolean);
  const [head, tail] = parts;
  switch (head) {
    case undefined:
      return null;
    case 'intro':
      return { name: 'intro' };
    case 'home':
      return { name: 'home' };
    case 'opponents':
      return { name: 'opponents' };
    case 'briefing':
      return { name: 'briefing' };
    case 'play':
      return { name: 'play' };
    case 'chapter':
      return { name: 'chapter-result' };
    case 'result':
      return tail ? { name: 'final-result', resultId: decodeURIComponent(tail) } : { name: 'final-result' };
    case 'daily':
      return { name: 'daily' };
    case 'c':
      return tail ? { name: 'challenge', code: decodeURIComponent(tail) } : { name: 'home' };
    case 'challenge':
      return tail ? { name: 'challenge', code: decodeURIComponent(tail) } : { name: 'home' };
    case 'republic':
      return { name: 'republic' };
    case 'history':
      return tail ? { name: 'history', entryId: decodeURIComponent(tail) } : { name: 'history' };
    case 'settings':
      return { name: 'settings' };
    case 'about':
      return { name: 'about', page: tail && isAboutPage(tail) ? tail : 'disclosure' };
    default:
      return { name: 'home' };
  }
}

/** Full URL path (with base) for history.pushState. */
export function buildUrl(screen: Screen): string {
  const p = screenToPath(screen);
  return p === '/' ? BASE : `${BASE}${p.slice(1)}`;
}

/** Absolute, shareable URL for a challenge code (works on any static host, no rewrites needed). */
export function challengeShareUrl(code: string, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return `${origin}${BASE}?c=${encodeURIComponent(code)}`;
}

export function currentLocationScreen(): Screen | null {
  if (typeof location === 'undefined') return null;
  return pathToScreen(location.pathname, location.search);
}
