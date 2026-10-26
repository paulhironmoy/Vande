# Rebuild decisions: VANDE civic game → VANDE Cricket

Audit date: 2026-10-25. Work happens on the local branch `cricket-rebuild`; `main` still holds the civic game at
commit `ea4423f` (Git is the history; nothing was copied into a "legacy" folder). Nothing is committed, pushed,
published or deployed without the owner's explicit authorisation.

## Audit findings

| Item | Finding |
| --- | --- |
| AGENTS.md / repository instructions | None present |
| Git status | Clean at `ea4423f`; no user-owned uncommitted work to preserve |
| Baseline tests (same code as `ea4423f`) | Typecheck clean (app, node, backend); Vitest 58 files / 782 tests passed; Playwright 71 passed; production build 435.2 kB initial gzip (budget 2 MB) |
| Android package id | `in.vande.republic`, versionCode 1. Release AAB/APK exist only in the git-ignored `release/` folder; nothing in the repository or docs shows a Play Console upload. Treated as **unpublished** → new id **`in.vande.cricket`**. If the owner did upload `in.vande.republic` to Play Console, tell the root agent: the id can be restored in three files |
| Signing | Upload keystore `android/keystore/vande-upload.jks` + `android/keystore.properties` (git-ignored) — preserved untouched and reused as the upload key for the new id |
| Secrets / env | `.env.example` only (placeholders); no secret in the repository |

## Subsystem decisions

| Subsystem | Decision | Notes |
| --- | --- | --- |
| React 19 + TypeScript + Vite 8 | Reuse unchanged | Same toolchain and path alias `@/` |
| Zustand | Reuse unchanged | New root store (`src/app/store.ts`) holds only settings, toasts and connectivity; workstreams own their stores |
| Capacitor Android project | Adapt | Id `in.vande.cricket`, name "VANDE Cricket", invite App Links + `vandecricket://` scheme, locales en/hi + 8 Indic; Gradle signing config reused |
| PWA (vite-plugin-pwa, Workbox service worker, update banner) | Adapt | Manifest renamed; precache rules revisited for lazy 3D assets |
| IndexedDB (`idb`) | Reuse unchanged (library) | Civic persistence schema removed; platform writes the new outbox/replay stores |
| UI primitives (`src/components/ui`: Sheet, Dialog, focus trap, Button, Toast…) | Adapt | Restyled by experience into the new design system |
| Effects (`src/components/game/fx`: confetti, CountUp, FloatingPoints, Burst) | Remove | Planned for adaptation, then unused: the renderer's own effects and the 2D fallback replaced them (removed with their test and `src/audio/gameSounds.ts`) |
| Audio synth + haptics (`src/audio`) | Adapt | Synthesis infrastructure kept; new cricket soundscape |
| Analytics adapter, PostHog adapter, privacy sanitiser | Adapt | New closed dictionary in `src/contracts/analytics.ts` |
| Deterministic PRNG (`sfc32`, string hash) | Adapt | Moved into the new Sealed Six engine |
| Civic engine (scenarios, simulation, scoring, daily compiler, opponents, pulse, map state) | Remove | No dependency from the new product |
| Civic content (3 chapters, 30 daily crises, twists, toughness, visuals vocabulary) | Remove | |
| PixiJS city map (`src/map`, `pixi.js` dependency) | Remove | Not the right tool for a 3D match; the renderer is chosen by a measured spike |
| Civic screens, components, Lite, progression, passport, calendar, republic pulse | Remove | Rebuilt as cricket journeys |
| Civic share cards, dares, fingerprint, reply codes | Remove | Share/deep-link patterns re-implemented in `src/platform` (system share sheet, wa.me on tap, deep links) |
| Civic community client and verified dares client | Remove | New API client in `src/net` |
| Reminders (local notifications) | Rewrite | Deadline reminders are server-sent FCM pushes (localised Android strings, quiet hours, caps); `@capacitor/local-notifications` removed as unused |
| Cloudflare Worker backend | Rewrite | Salvage HTTP helpers, guards, per-network rate limits, ECDSA signing with key ids, SQLite-measured D1 testing; replace endpoints, schema and migrations |
| Vitest + Testing Library + jsdom; Playwright + axe | Reuse unchanged | Civic tests removed; new suites per workstream |
| Scripts | Adapt | Kept the bundle-size check, Android build/smoke and Pages deploy (previews only, not run); the civic asset scripts were replaced by `scripts/brand/build.mjs`; civic content scripts removed |
| Civic documentation | Remove | Replaced by the cricket documentation set |
| Branding (icons, splash, OG images) | Rewrite | New VANDE Cricket identity |
| Release artefacts in `release/` (git-ignored) | Preserve | Old civic builds left in place, untouched |

## Product decisions made during the build

| Decision | Why |
| --- | --- |
| Daily Six over sharing is accepted | A finished attempt's replay shows the over it faced, and that over is the same for everyone that day. Like sharing a puzzle answer, this is part of the social game. Daily Six boards are friendly, the Top 100 never uses Daily Six, share cards are spoiler-free, and each attempt faces a different over. |
| One Daily Six salt (`DAILY_SALT_KEY`) for every day | It keeps the engine's 3-day pitch rotation. Days still differ, the salt never leaves the Worker, and replays carry only one-way commit salts. |
| Opponent activity appears after a random 60–600 s delay | No exact lock or completion times, as the brief requires. The rule is "you learn at once what your own action completes; you learn the opponent's actions after the delay". The second player to lock bats at once. |
| Duels reveal at 5-minute slots, at least a minute after both innings end | The reveal push no longer leaks the second finisher's exact completion time, and friends get a shared, honest countdown and reveal moment. Cups keep their fixed reveal times. |
| Highlight consent before rendering | Participants approve the exact cut in-app, because the same deterministic composer renders it. Nothing is rendered or uploaded without every participant's consent, which saves render cost on declined highlights. |
| WhatsApp cap: per player, per match | Each player is prompted at most three times per match (invitation, one reminder, the final reveal or highlight). It is kept on the device as a courtesy, not a security control. |
| First-run language follows the device for production locales only | Hindi phones start in Hindi. Machine-drafted locales are offered but never chosen automatically. |
| New app id `in.vande.cricket` | The civic prototype's id was never published. A new id avoids carrying an unrelated product's history into the store listing. |
| 18+ only at launch (neutral age screen, server-enforced) | India's DPDP Act treats under-18s as children who need verifiable parental consent. This is the conservative default until the owner's legal review; admitting 13–17 later needs a parental-consent design. |
| R8 and resource shrinking stay off for 1.0.0 | Capacitor plugins load through reflection, and the gain is small (most of the 10 MB is the web bundle). Enabling them needs a full device pass with `scripts/android-lifecycle.sh` on a minified build. |
| Release builds refuse unsafe inputs | Gradle's `verifyReleaseInputs` stops a release with no upload key, no production App Links host, WebView debugging, mixed content or a local API. Local test releases are `--preview` builds named `*-PREVIEW-*`. |
| Short invite codes (10 characters, at least 50 bits) | Shorter links and cards. Lookups are rate-limited per network, and unknown and expired codes give the same answer, so codes cannot be enumerated. Long signed tokens still work. |
| The WhatsApp courtesy cap is kept by the server | A local ledger alone reset on storage clears and was per device. The server keeps one claim per player, match and moment; offline, the local ledger decides. |
