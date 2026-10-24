/// <reference lib="webworker" />
/**
 * VANDE service worker (vite-plugin-pwa injectManifest).
 * Precache the whole app shell so the game is fully playable offline; runtime cache fonts and images.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

const base: string = import.meta.env.BASE_URL || '/';

/**
 * Inside the Capacitor shell (https://localhost on Android, capacitor://localhost on iOS) the web bundle ships with
 * the app, so a service worker can only ever serve stale files after an app update. When this worker is installed
 * there (i.e. an older app version left a registration behind) it takes over immediately, drops every cache,
 * unregisters itself and reloads open pages so they load the bundled version directly.
 */
const NATIVE_SHELL =
  (self.location.protocol === 'https:' || self.location.protocol === 'capacitor:') && self.location.hostname === 'localhost';

if (NATIVE_SHELL) {
  self.addEventListener('install', () => {
    void self.skipWaiting();
  });
  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        await self.clients.claim();
        try {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        } catch {
          /* ignore */
        }
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        await self.registration.unregister();
        for (const client of windows) {
          try {
            await client.navigate(client.url);
          } catch {
            /* the page will pick up the bundled version on its next load */
          }
        }
      })(),
    );
  });
}

cleanupOutdatedCaches();
precacheAndRoute(NATIVE_SHELL ? [] : self.__WB_MANIFEST);

// App-shell navigation: every in-app route (and unknown deep links) resolves to the precached index.html.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), {
    // Never serve the shell for requests that look like files (e.g. /icons/x.png, /sw.js).
    denylist: [/\/[^/?]+\.[^/?]+$/],
  }),
);

// Community API (separate origin, configured at build time): never cached, never served from the app shell.
const COMMUNITY_API_ORIGIN = (() => {
  try {
    const raw = (import.meta.env.VITE_COMMUNITY_API_URL as string | undefined) ?? '';
    return raw ? new URL(raw).origin : '';
  } catch {
    return '';
  }
})();
if (COMMUNITY_API_ORIGIN) {
  registerRoute(({ url }) => url.origin === COMMUNITY_API_ORIGIN, new NetworkOnly(), 'GET');
  registerRoute(({ url }) => url.origin === COMMUNITY_API_ORIGIN, new NetworkOnly(), 'POST');
}

// Fonts: cache first for a year (they are hashed/static).
registerRoute(
  ({ request, url }) => request.destination === 'font' || /\.woff2?$/.test(url.pathname),
  new CacheFirst({
    cacheName: 'vande-fonts-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 24, maxAgeSeconds: 365 * 24 * 60 * 60, purgeOnQuotaError: true })],
  }),
);

// Same-origin images and JSON that are not in the precache manifest.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin && (request.destination === 'image' || url.pathname.endsWith('.json')),
  new StaleWhileRevalidate({
    cacheName: 'vande-runtime-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60, purgeOnQuotaError: true })],
  }),
);

self.addEventListener('message', (event) => {
  const data = event.data as { type?: string } | undefined;
  if (data && data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
