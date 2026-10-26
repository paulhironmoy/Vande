# VANDE Cricket — Architecture

Status: living document. Root-owned; workstreams update their own sections.

## Product shape

Asynchronous social cricket. The signature mode, **Sealed Six**, is two one-over innings: each player seals a six-ball
bowling plan, bats against the opponent's sealed over whenever convenient, and both innings are revealed together as a
cinematic match. Modes: Training (offline), Daily Six, Friend Duel, Group Cup (3–10 players), Practice Ghosts (offline).

## Runtime layout

```
Android (Capacitor WebView) ─┐
Web / installable PWA ───────┼─► React app (src/) ──► src/net (API client, outbox, sync) ──► Cloudflare Worker (backend/)
                             │        │                                                     ├─ MatchDO  (one per match or Daily Six attempt: seal, bat, reveal)
                             │        ├─► src/render3d (Three.js MatchRenderer, 2D fallback) ├─ CupDO    (one per Group Cup: fixtures, standings, alarms)
                             │        └─► src/engine (deterministic rules, shared)            ├─ RoomDO   (one per Cricket Room: posts, reactions, banter)
                             │                                                               ├─ D1       (accounts, groups, leaderboards, Daily Six, Top 100, jobs, consents, audit)
                             │                                                               ├─ R2       (archived replays, temporary videos, exports)
                             │                                                               ├─ Queues   (vande-notify, vande-maint, vande-media, each with a dead-letter queue)
                             │                                                               └─ Cron     (Top 100 cutoff 00:00 IST, consent sweep, cleanup)
render-service/ (Cloud Run job) ◄── media queue: headless Chromium drives render.html (src/highlight) frame by frame → FFmpeg → Worker → R2
YouTube (MockYouTube in local and test runs; RealYouTube with server-only OAuth secrets) ◄── media queue, after consent and approval
FCM (off until the Firebase credentials are configured) ◄── notify queue
admin.html + src/admin (Cloudflare Access) ──► /v1/admin/* (highlight review, reports, quota, dead letters)
```

The engine (`src/engine`) is pure TypeScript with no DOM or Node APIs. The same code runs in the browser (Training,
Ghosts, presentation), in the Worker (authoritative results) and in the render service (via the built renderer page).

## Practice (offline first-person batting, 2026-10-25)

Physics-first and fully on the device: gesture → `NormalizedSwing` (src/input) → virtual bat → swept bat–ball
collision → ball trajectory → fielding → runs or wicket (src/physics) → presentation and replay (src/render3d), with
the one-wicket, ten-over innings in src/practice/game and the screens in src/practice/ui. A normal start (the app opened
at `/`) first offers Practice or Skip (src/App.tsx `useLaunchChoice`; deep links never see it). Contract:
`src/contracts/practice.ts`. Brief: `docs/prompts/VANDE-PRACTICE-PROMPT.md`. Docs: `docs/PRACTICE.md` (product,
flows, tiers, Android, privacy, accessibility, device test plan), `docs/PRACTICE_PHYSICS.md`, `docs/PRACTICE_RULES.md`,
`docs/PRACTICE_PRESENTATION.md`.

| Path | Contents |
| --- | --- |
| `src/physics/geometry.ts`, `constants.ts` | The one source of cricket geometry (Laws 4, 6–8; kept tiny because the app shell's field map uses it) and of physics constants and timing windows (`TIMING_BANDS`, `BAT_TRAVEL_MS`, pace and spin ranges, pitches) |
| `src/physics/{vec,ball,probe,delivery,bat,collision,impact,contact,lbw,timing}.ts` | Deterministic vector maths; the 1 ms RK4 ball integrator (drag, Magnus, swing, seam, bounce, turn, outfield roll); allocation-free probes; deliveries; the virtual bat; swept collision; contact; LBW (Law 36); assistance bands |
| `src/physics/{field,fielding,running,scoring,resolve}.ts` | Field layouts, fielding, automatic running, and the one scoring and dismissal pipeline (`resolveDelivery`) |
| `src/physics/{matchPath,aim}.ts` | The multiplayer reveal's balls through the same physics: `flightFromPath` (the server's `BallPath` and `releaseToContactMs`, fitted exactly) and `aimShot` (outcome-first shots) |
| `src/practice/game/**` | Random, guided and built overs; the innings state machine (`inningsReducer`); replay (`DeliveryRecord` → identical `DeliveryResult`); coaching facts |
| `src/practice/ui/**`, `src/practice/store/**` | Launch choice, Practice screens and the flow controller; local persistence with in-flight protection (no save-scumming) |
| `src/perf/**` | The one device benchmark and quality classifier (Full ≥ 55 fps, Assisted 45–54, Below < 45 or software), the per-version cache and the in-session monitor; the match renderer's `auto` quality uses it too |
| `src/input/**` | The one input model: `PointerTrace`/`eventTime` (event timestamps, coalesced moves) used by Practice's GestureSurface and the match's batting, release meter and aim pad; `normalizeGesture`; calibration |
| `src/render3d/**` | The one renderer: one `StageScene` and bat mesh for the match and Practice, one camera director, one 2D painter (`TopDownPainter`) for the match fallback and Classic Practice; `core/trajectory.ts` is a thin adapter over the physics |

**One implementation per concern (the redundant-code addendum).** Delivery physics, collision, input, scoring and
dismissal (Practice), the camera director, the benchmark and classifier, the PRNG (`src/engine/prng.ts`) and the
cricket constants each exist once. Retained on purpose, each with its active consumer:

| Retained | Why | Active consumer |
| --- | --- | --- |
| The Sealed Six outcome model, its innings machine, `MatchEventLog` and plan generators (`src/engine`, v1) | Server-authoritative multiplayer: results, deadlines, ranking and replays of existing matches must stay byte-identical; Practice is a different product (real-time physics batting) | backend Worker, Training, Ghosts, Daily Six, reveals, highlights |
| The engine's camera shot list (`src/engine/v1/cues.ts`) | Part of the deterministic match log that highlight rendering replays; the renderer's director executes it | `src/render3d/core/camera.ts` via `choreo.ts` |
| `seededRandom` in `src/ui/avatar/traits.ts` | Its output defines every existing player's generated avatar; moving it to the engine PRNG would change them | `Avatar`, `avatarSvg` |
| Outcome-first choreography (`src/render3d/core/choreo.ts`) | The server decided the result; the choreography stages it, but every ball movement in it is physics (`flightFromPath`, `aimShot`) | reveals, replays, highlights |

## Source ownership (exclusive; route shared files through the root agent)

| Path | Owner | Contents |
| --- | --- | --- |
| `src/contracts/**` | root | Shared types: domain, API, social, highlights, renderer, adapters, analytics |
| `src/app/**`, `src/App.tsx`, `src/main.tsx` | root | App shell, routing, root store (settings, toasts, connectivity), providers |
| `vite.config.ts`, `capacitor.config.ts`, `android/**`, `package.json` | root | Build, PWA manifest, Android packaging (agents may `npm install --save-exact` their own new deps, one at a time) |
| `src/engine/**`, `tests/unit/engine/**`, `scripts/simulate*.mjs` | gameplay | Rules engine, outcome model, validation, ghosts, simulation |
| `docs/GAME_RULES.md` | gameplay (root approves rule changes) | Frozen rules and tactical explanations |
| `src/i18n/engine/**` | gameplay | Engine copy: commentary, explanations, ghosts, guide, advice (11 locales) |
| `src/social/**`, `src/i18n/social/**`, `tests/unit/social/**`, `tests/e2e/social-*.spec.ts` | platform | Group Cup, Cricket Room, leaderboards, Top 100, highlight consent and landing, profile |
| `src/render3d/**`, `src/screens/**`, `src/ui/**`, `src/styles/**`, `src/audio/**`, `src/i18n/**` (except `src/i18n/engine/**` and `src/i18n/social/**`) | experience | Renderer, design system, screens and journeys, training, audio/haptics, copy and locales |
| `tests/unit/ui/**`, `tests/unit/render3d/**`, `tests/e2e/ux-*.spec.ts` | experience | Component, renderer and journey tests |
| `docs/VISUAL_SYSTEM.md` | experience | Design system, renderer decision record |
| `src/highlight/**`, `render.html` | experience | Highlight composer (`HighlightRenderHost` in `src/contracts/highlights.ts`): the 1080×1920 Short cut the render service records and the in-app consent preview plays |
| `public/brand/**`, `public/icons/**`, `public/og/**`, `android/app/src/main/res/mipmap-*/**`, `android/app/src/main/res/drawable*/splash.png` | experience | Brand marks, app icons, splash screens, social cards (generated images; the rest of `android/**` stays root) |
| `src/net/**`, `src/platform/**`, `src/analytics/**`, `src/admin/**`, `admin.html` | platform | API client, outbox/sync, session, adapters (push, share, deep links, install referrer, secure storage, identity, ads, billing), analytics, admin console |
| `backend/**`, `render-service/**`, `tests/unit/net/**`, `tests/unit/platform/**` | platform | Worker, Durable Objects, D1 migrations, queues, YouTube/FCM/render adapters, render job |
| `docs/SECURITY.md`, `docs/PRIVACY_AND_CONSENT.md`, `docs/ANALYTICS.md`, `docs/INFRASTRUCTURE.md`, `docs/COST_MODEL.md`, `docs/YOUTUBE_OPERATIONS.md` | platform | |
| `scripts/build-android.sh`, `scripts/android-*.sh|mjs`, `scripts/check-bundle-size.mjs`, `scripts/generate-notices.mjs`, `scripts/scan-secrets.mjs`, `privacy.html`, `delete-account.html`, `public/_headers`, `public/third-party-notices.txt` | root | Release tooling, legal pages, notices |
| `tests/e2e/flow-*.spec.ts`, `docs/TEST_REPORT.md`, `docs/ANDROID_RELEASE.md`, `docs/STORE_LISTING.md`, `docs/LAUNCH_BLOCKERS.md`, `README.md`, `REBUILD_DECISIONS.md`, this file | root | Cross-workstream tests, release, docs |

Rules for every agent: never commit, push, deploy or run destructive git commands; never run two Playwright runs or
two Gradle builds at once (Playwright wipes `test-results/`; rebuilding `dist/` under a running preview breaks it);
announce any contract change to the root agent instead of editing `src/contracts`.

## Key decisions (details in REBUILD_DECISIONS.md)

- **App id** `in.vande.cricket` (the old `in.vande.republic` was never published). Branch `cricket-rebuild`.
- **Renderer**: chosen by a measured spike (Three.js vs Babylon.js); see `docs/VISUAL_SYSTEM.md`. PixiJS is removed.
- **Server-authoritative sealing**: plans are canonicalised, salted, SHA-256-committed and signed when locked, stored
  encrypted (AES-GCM) in the MatchDO, and revealed with their salt. Each delivery is revealed to the batter only when
  bowled, with a signed single-use ball token; runs and wickets stay sealed until the reveal.
- **Determinism**: `src/engine` is versioned (`ENGINE_VERSION`); every match stores its seed and engine version; replays
  are verified with the engine version that produced them.
- **Guest-first auth**: guest accounts, short-lived HMAC access tokens, rotating refresh tokens in secure storage;
  Google sign-in and passkeys link accounts (adapters, disabled until configured). No SMS.
- **Cost**: no always-on servers. Workers Paid + D1 + R2 + Queues + a Cloud Run render job; target ~$25/month,
  ceiling $100/month (see `docs/COST_MODEL.md`).
