import { routePath, basePath, type Route } from '@/app/router';
import type { Services } from '@/app/services';

/**
 * An https link to an app route for sharing: the configured web origin (also in the Android app, where the page origin
 * is capacitor://localhost), else this page's origin.
 */
export function shareUrl(services: Services | null, route: Route): string {
  const web = services?.platform.webOrigins.find((o) => /^https?:\/\//.test(o) && !/^https?:\/\/localhost(:\d+)?$/.test(o)) ?? (typeof location !== 'undefined' ? location.origin : '');
  const origin = web.replace(/\/+$/, '');
  // A configured web origin may carry its own base path (https://host/Vande); the page origin needs BASE_URL.
  const base = services?.platform.webOrigins.includes(web) && /^https?:\/\/[^/]+\/./.test(web) ? '' : basePath().replace(/\/$/, '');
  return `${origin}${base}${routePath(route)}`;
}
