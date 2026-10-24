# VANDE — Release Guide

Everything ships from this repository with **zero recurring infrastructure cost**: a static web build (GitHub Pages or
Cloudflare Pages), an installable PWA, and an Android app built with Capacitor. There is no backend to deploy.

## 0. Prerequisites (one-time)

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 26.x (≥ 20) | `node -v` |
| npm | 11.x | `npm ci` installs the locked tree |
| JDK | 21 (Android Studio JBR) | `/Applications/Android Studio.app/Contents/jbr/Contents/Home` |
| Android SDK | platforms 36, build-tools 36.x | `~/Library/Android/sdk` (`android/local.properties` points here) |
| Gradle | 8.14.3 via wrapper, AGP 8.13.0 | downloaded automatically by `./gradlew` |
| Playwright browsers | Chromium | `npx playwright install chromium` |

```bash
npm ci
npx playwright install chromium
```

## 1. Versioning

1. Bump `"version"` in `package.json` (semver, e.g. `1.0.1`).
2. Bump `versionCode` (integer, must always increase) and `versionName` in `android/app/build.gradle`.
3. The web build stamps `__APP_VERSION__`, `__BUILD_ID__` (UTC `YYYYMMDD.HHMM`) and `__BUILD_DATE__`; they are shown on
   the in-app **About → Version** page and written to `VERSION.txt` on GitHub Pages deploys.

## 2. Test

```bash
npm run typecheck        # strict TypeScript, app + node configs
npm test                 # Vitest unit tests (engine determinism, scoring, evidence, persistence, codecs)
npm run build            # production build → dist/
npm run test:e2e         # Playwright journeys against `vite preview` (builds must exist)
node scripts/check-bundle-size.mjs dist   # initial transfer budget (2 MB gzip)
```

`npm run test:all` runs unit → build → e2e in sequence.

## 3. Web build

```bash
npm run build                      # base "/"        → dist/        (Cloudflare Pages, Capacitor, any root host)
npm run build:pages                # base "/Vande/"  → dist-pages/  (GitHub Pages project site)
npm run preview                    # serve dist/ at http://localhost:4173 for a local smoke test
```

The build output is fully static: `index.html`, hashed `assets/*`, `sw.js` + `manifest.webmanifest` (PWA), `icons/`,
`og/`, `_headers` + `_redirects` (Cloudflare), `404.html` + `.nojekyll` (GitHub Pages).

## 4. Deploy — GitHub Pages (free HTTPS, current production)

```bash
npm run deploy:pages               # = node scripts/deploy-pages.mjs
```

The script builds with `BASE_PATH=/Vande/`, commits `dist-pages/` onto the `gh-pages` branch (history preserved) and
pushes with the repository's SSH push URL. Production URL: **https://paulhironmoy.github.io/Vande/**

* First deploy only: if the URL still returns 404 after ~5 minutes, open the repository → *Settings → Pages* and set
  *Source: Deploy from a branch → `gh-pages` / (root)*. Subsequent pushes publish automatically in 1–3 minutes.
* Verify: `curl -s https://paulhironmoy.github.io/Vande/VERSION.txt`.
* Deep links (`/Vande/play`, `/Vande/c/<code>`) work through `404.html`, which stores the requested path in
  `sessionStorage.vandeRedirect` and loads the app shell; the app re-navigates on start.

## 5. Deploy — Cloudflare Pages (alternative, also free)

Option A — Git integration: Cloudflare dashboard → *Workers & Pages → Create → Pages → Connect to Git* → select the
repository. Build command `npm run build`, build output directory `dist`, Node version `20` or newer
(set `NODE_VERSION=20` in environment variables). `_headers` and `_redirects` from `public/` are applied automatically.

Option B — Direct upload from this machine:

```bash
npm run build
npx wrangler@latest pages deploy dist --project-name vande   # prompts for a one-time Cloudflare login
```

Either way the site is served from `https://<project>.pages.dev` with free HTTPS; add a custom domain in the
Cloudflare Pages project settings if desired (also free).

## 6. PWA

The service worker (`src/pwa/sw.ts`) precaches the entire shell, so the game runs offline after the first visit. New
builds are picked up on the next load; players see a non-blocking **"A new version is ready"** banner (never during a
chapter) and can update or defer. No action is required at deploy time.

## 7. Android

Full details and troubleshooting: `docs/ANDROID.md`.

```bash
# Release APK (testing on devices) + signed AAB (Play Console upload)
scripts/build-android.sh                 # → release/vande-<version>-<code>-release.{apk,aab} + SHA256SUMS

# Individual steps
npm run android:sync                     # web build + cap sync
npm run android:apk:debug                # debug APK → android/app/build/outputs/apk/debug/app-debug.apk
npm run android:apk                      # release APK → android/app/build/outputs/apk/release/app-release.apk
npm run android:aab                      # release AAB → android/app/build/outputs/bundle/release/app-release.aab
```

Signing uses the upload keystore described in `docs/ANDROID.md`. Upload the `.aab` to Google Play Console (Internal
testing first), enrol in Play App Signing with this upload key, then promote the release.

## 8. Smoke-test checklist (run after every production deploy)

1. Open the production URL in a private window: launch mark settles, Home appears in < 1.2 s, no console errors.
2. **Start campaign** → opponents → briefing → a chapter plays; decisions change the map and the Republic Pulse.
3. Complete one chapter → chapter result → next briefing. Reload mid-chapter → the chapter resumes where it was.
4. Install as PWA (browser menu → Install). Turn Wi-Fi off → relaunch → the game still opens and plays.
5. Finish the campaign → final result → *Challenge friends* → open the generated link in another tab → the same
   scenario, opponents and difficulty are shown.
6. Daily challenge opens with today's date and plays.
7. Settings: reduced motion, high contrast and 200 % text scale apply instantly; keyboard Tab reaches every decision.
8. Check the viewports 360×800, 390×844, 412×915, 768×1024, 1366×768, 1440×900, 1920×1080 for clipping/horizontal scroll.
9. Android: `adb install -r release/vande-*-release.apk`, launch, play one decision, press hardware Back on each screen.
10. Record the deployed commit (`git rev-parse origin/gh-pages`) in the release notes for rollback.

## 9. Daily content, backend and analytics (added with Daily Quick Play)

* Content: `node scripts/validate-daily.mjs` must pass; before the first public day resolves run
  `node scripts/validate-daily.mjs --pin-through=<launch date>` and paste the output into `src/content/daily/schedule.json`
  `pinned`; bump `contentVersion` whenever a published day changes. Authoring guide: `docs/CONTENT-DAILY.md`.
* Backend (optional, Cloudflare Workers + D1): `cd backend && npx wrangler d1 create vande-daily && npx wrangler d1 migrations apply vande-daily
  && npx wrangler secret put RATE_SALT && npx wrangler deploy`; then rebuild the app with `VITE_COMMUNITY_API_URL=https://<worker>.workers.dev`.
  Full steps, cost table and threat model: `docs/BACKEND.md`, `docs/COST.md`.
* Analytics (optional): set `VITE_ANALYTICS_PROVIDER=posthog`, `VITE_POSTHOG_HOST`, `VITE_POSTHOG_KEY` at build time; event
  dictionary in `docs/ANALYTICS.md`. Flags and kill switches: `docs/FEATURE-FLAGS.md`.
* Android: `npx cap sync android` after dependency changes (the reminder plugin adds notification permissions; see
  `docs/PRIVACY.md`).
