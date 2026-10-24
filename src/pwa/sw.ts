/// <reference lib="webworker" />
/**
 * VANDE service worker (vite-plugin-pwa injectManifest).
 * Precache the whole app shell so the game is fully playable offline; runtime cache fonts and images.
 */
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<PrecacheEntry | string> };

const base: string = import.meta.env.BASE_URL || '/';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// App-shell navigation: every in-app route (and unknown deep links) resolves to the precached index.html.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL(`${base}index.html`), {
    // Never serve the shell for requests that look like files (e.g. /icons/x.png, /sw.js).
    denylist: [/\/[^/?]+\.[^/?]+$/],
  }),
);

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
