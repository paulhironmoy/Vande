/**
 * Network configuration from the build environment. With nothing set the app is offline-only (Training, Ghosts and
 * every local mode still work). Only https API URLs are accepted, except a local Worker on localhost/127.0.0.1.
 *
 *   VITE_API_URL=https://api.example        production or staging Worker
 *   VITE_API_LOCAL=1                        the local dev Worker at http://127.0.0.1:8787 (docs/INFRASTRUCTURE.md)
 *   VITE_KILL_ONLINE=1                      kill switch: offline-only even when a URL is set
 */
export interface NetConfig {
  /** Base URL of the API without a trailing slash, or null when the app runs offline-only. */
  apiUrl: string | null;
  timeoutMs: number;
  /** Sent as x-vande-client: the app version only (never anything about the person or device). */
  clientId: string;
}

export const LOCAL_API_URL = 'http://127.0.0.1:8787';

function appVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function isAllowedApiUrl(url: string): boolean {
  return /^https:\/\/[a-z0-9.-]+(:\d+)?(\/[^\s]*)?$/i.test(url) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
}

export function readNetConfig(env: Record<string, unknown> = import.meta.env as Record<string, unknown>): NetConfig {
  const base = { timeoutMs: 12_000, clientId: `vande-cricket/${appVersion()}` };
  if (String(env.VITE_KILL_ONLINE ?? '') === '1') return { ...base, apiUrl: null };
  const explicit = String(env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');
  const url = explicit || (String(env.VITE_API_LOCAL ?? '') === '1' ? LOCAL_API_URL : '');
  return { ...base, apiUrl: url && isAllowedApiUrl(url) ? url : null };
}
