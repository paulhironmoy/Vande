/**
 * The static privacy policy and account-deletion pages (privacy.html, delete-account.html at the web root, built
 * into every build). In the Android app they open in the system browser from the hosted site when
 * VITE_PUBLIC_WEB_ORIGIN is set (an address outside the app always leaves the WebView); otherwise, and on the web,
 * the copy bundled with this build opens.
 */
import { isNativePlatform } from '@/platform';

export type LegalPage = 'privacy' | 'delete-account';

export function legalUrl(page: LegalPage, env: Record<string, unknown> = import.meta.env as Record<string, unknown>, native: boolean = isNativePlatform()): string {
  const file = `${page}.html`;
  const origin = String(env.VITE_PUBLIC_WEB_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (native && /^https:\/\//.test(origin)) return `${origin}/${file}`;
  const base = String(env.BASE_URL ?? '/');
  return `${base.endsWith('/') ? base : `${base}/`}${file}`;
}
