# VANDE — Performance & PWA Audit

Measured on 2026-10-23 against the production build (`vite build`), served with Brotli compression by a local static
server (`serve -s dist`), Lighthouse 13.5 in headless Chrome 156. Mobile runs use Lighthouse's default simulated
"slow 4G" profile (RTT 150 ms, 1.6 Mbps, 4× CPU slowdown); desktop runs use the desktop preset. Reports:
`docs/perf/lh-*.report.html` (full) and `docs/perf/lh-*.summary.json` (metrics only).

## Scores (final build)

| Page | Profile | Performance | Accessibility | Best practices | FCP | LCP | TBT | CLS | Speed Index | TTI |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (launch → intro/home) | mobile, slow 4G | **96** | 100 | 100 | 1.0 s | 2.6 s | 10 ms | 0 | 3.4 s | 2.8 s |
| `/home` | mobile, slow 4G | **94** | 100 | 100 | 2.0 s | 2.9 s | 0 ms | 0 | 2.0 s | 2.9 s |
| `/` | desktop | **100** | 100 | 100 | 0.5 s | 0.7 s | 0 ms | 0 | 0.5 s | 0.7 s |
| `/home` | desktop | **100** | 100 | 100 | 0.5 s | 0.7 s | 0 ms | 0 | 0.5 s | 0.7 s |

Before the changes below the mobile `/` run scored 89 (FCP 2.6 s, LCP 3.1 s, SI 3.8 s) and `/home` 93 (LCP 3.1 s).
Mobile numbers vary by ±0.3 s between runs on a busy machine; treat them as a band.

Targets from the brief: interactive in ≈3 s on ordinary 4G (met: TTI 2.8–2.9 s under the harsher *slow* 4G profile),
initial compressed transfer < 2 MB (met: 252 kB), no cumulative layout shift (met: 0), no long main-thread tasks
(met: TBT ≤ 10 ms, no `longtask` entries > 50 ms during load or the first 10 s of gameplay), playable offline (met).

## Cold-load waterfall (compressed bytes, Brotli)

13 same-origin requests, **252 kB** transferred (645 kB decoded). Nothing leaves the origin: no font CDN, no analytics.

| Start | File | Transfer | Notes |
| --- | --- | --- | --- |
| 9 ms | `manrope-latin-wght-normal-*.woff2` | 25 kB | **preloaded** from `index.html` (new) |
| 9 ms | `index-*.js` | 148 kB | app + engine + the three scenario JSON files (≈ 300 kB raw, ≈ 60 kB compressed) |
| 9 ms | `index-*.css` | 8.5 kB | was 11.3 kB — the inlined base64 Cyrillic-ext font subset is gone |
| 9 ms | runtime / jsx / zustand / sounds / haptics chunks | 10 kB | module-preloaded by Vite |
| 79 ms | `workbox-window-*.js`, `UpdateBanner-*` | 4.5 kB | after first paint |
| 96 ms | `noto-sans-devanagari-devanagari-500-*.woff2` | 54 kB | `font-display: optional` (new) — never swaps, cached for the next visit |

Fonts: only the Latin subset of Manrope Variable and the Devanagari subset of Noto Sans Devanagari are requested
(unicode-range). The other Manrope subsets (latin-ext, Cyrillic, Greek, Vietnamese; 50 kB in total) are precached by
the service worker but never downloaded on first load.

Lazy chunks (not part of the initial transfer): PixiJS renderer `CityScene-*.js` 80 kB + `Geometry-*.js` 34 kB +
`RenderTargetSystem-*.js` 22 kB + `browserAll-*.js` 11 kB ≈ **147 kB compressed**, fetched when the first map
renders (briefing screen); `PlayScreen-*.js` 19 kB; every other screen 2–5 kB.

## Service worker / PWA

* `sw.js` registers on first load; precache = 96 entries (2.19 MB uncompressed, ≈ 1.3 MB compressed) covering every
  script, style, font, icon and the app shell.
* Second load (`/home`) is served entirely from the service worker: navigation `transferSize` 0, all 13 resources
  `transferSize` 0, `load` event at 47 ms.
* Manifest: name, short_name, `start_url: "/"`, `scope: "/"`, `display: standalone`, theme/background `#07111F`,
  icons 192 px, 512 px and a 512 px `maskable` icon, a "Daily" shortcut — Chrome's installability criteria are met
  (Lighthouse 13 no longer ships a PWA category; checked manually). On GitHub Pages the base is `/Vande/` and both
  `start_url` and `scope` are emitted relative to it.
* Lighthouse best-practices 100 (no console errors, HTTPS-ready headers in `public/_headers`, correct cache policy:
  hashed `/assets/*` immutable for a year, `sw.js`/manifest/HTML `no-cache`).

## Layout shift and main thread

* `PerformanceObserver('layout-shift')` recorded **no** shifts during launch → first screen, nor on the play screen
  while decisions, feed items and the map appear (CLS 0 in every Lighthouse run).
* No `longtask` entries > 50 ms during load or during the first 10 seconds of a chapter (M-series laptop, headless
  Chrome). Lighthouse's 4× CPU slowdown reports TBT 10 ms on `/` — the one task is the main-bundle evaluation.
* PixiJS initialises off the critical path (dynamic import); the SVG map is shown until the WebGL scene is ready.

## Changes made in this pass

| File | Change | Effect |
| --- | --- | --- |
| `vite.config.ts` | `preloadPrimaryFont()` plugin injects `<link rel="preload" as="font">` for the hashed Latin Manrope file | first text paint already uses Manrope; FCP on `/` 2.6 s → 1.0 s, LCP 3.1 s → 2.6 s (mobile) |
| `vite.config.ts` | `assetsInlineLimit` never inlines fonts | render-blocking CSS 11.3 kB → 8.5 kB, no base64 font for everyone |
| `src/main.tsx`, `src/styles/base.css` | Noto Sans Devanagari declared once in `base.css` with `font-display: optional`, Devanagari subset only (the `500.css` import also declared Latin and Latin-ext faces) | no swap or shift for the "वन्दे" accent; 2 fewer font-face rules; system Devanagari on a cold first visit, webfont from the next visit |
| `docs/perf/*` | Lighthouse HTML reports and compact JSON summaries | evidence for release notes |

## Recommendations (outside this pass's file ownership), by expected gain

1. **Code-split the scenario content** (`src/content/index.ts`, `src/engine/scenario.ts`, store call sites): the three
   JSON files are ≈ 300 kB raw / ≈ 60 kB compressed inside the main bundle, and `unused-javascript` flags 43 kB of
   the entry chunk as unused at load. Load one chapter on demand:
   ```ts
   const loaders = { 'examination-crisis': () => import('./scenarios/examination-crisis.json'), /* … */ };
   export async function loadScenario(id: ScenarioId): Promise<Scenario> { return (await loaders[id]()).default as Scenario; }
   ```
   and make `confirmSetup`/`continueCampaign` await it (the briefing screen already sits between setup and play).
   Expected: entry chunk 148 kB → ≈ 90 kB, mobile LCP −0.4 to −0.6 s on slow 4G, perf score ≈ 98–100.
2. **Launch screen first paint** (`src/screens/Launch/*`): every element starts from an opacity-0 `rise` animation.
   Painting the wordmark on the first frame (animate position only, or keep opacity ≥ 0.01) would move FCP on `/`
   closer to the `/home` value under throttling and make the ≤ 1.2 s auto-continue feel instant on slow devices.
3. **Fallback font metrics** (`src/styles/tokens.css`): add a `Manrope Fallback` `@font-face` with
   `size-adjust`/`ascent-override` based on Arial and insert it after `'Manrope Variable'` in `--font-sans`. CLS is
   already 0 in the lab because the preload lands before first paint; this guards the rare slow-network case.
4. **`PlayScreen` chunk prefetch**: add a `modulepreload` for `PlayScreen-*.js` from the briefing screen (or
   `import()` it when the briefing mounts) so the first chapter opens with no network wait on 4G (~19 kB).
5. **Precache trimming** (`vite.config.ts` glob, only if the 1.3 MB offline footprint matters): the 50 kB of
   non-Latin Manrope subsets could be excluded from the precache since the UI is English-only.

## Update: Daily Quick Play content (2026-10-24)

The 30-day daily pool ships eagerly in the entry bundle so that today's crisis is always playable offline after the first
visit without a second fetch. Measured after the upgrade: initial transfer **430.6 kB gzip** (was 238.7 kB; budget 2048 kB),
offline precache 1.43 MB. The remaining recommendation is to lazy-load day files (one ≈ 7 kB chunk per day, precached by
Workbox) behind an async `loadDailyScenario(dailyId)`; the design is in `docs/CONTENT-DAILY.md`. Expected gain on slow
4G: roughly −0.5 s LCP on first visit; no change for repeat visits (service worker cache).
