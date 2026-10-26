# VANDE Cricket

**Lock your over. Reveal the rivalry.**

VANDE Cricket is an asynchronous cricket rivalry game for Android and the web. Its signature mode is **Sealed Six**.
Each player plans a secret over: six deliveries plus a Super Ball, a field and a release for every ball. The player
seals it with a cryptographic commitment, then bats against the opponent's sealed over whenever they like. Runs and
wickets stay hidden until both innings are done. Then the server reveals one deterministic, verifiable result as a
cinematic replay.

* **Practice** (offline, no account): bat in first person against a full over, with real ball physics, a full field
  and fielding, and scores that come from the physics. Offered as Practice or Skip when the app opens.
* **Training** teaches batting, bowling and the reveal in under a minute, and works offline.
* **Daily Six**: three attempts a day at the same sealed overs everyone faces, with honest boards (national, city,
  college, company, friends) and a streak.
* **Friend Duel** is played over a WhatsApp link. The friend plays in the browser with no install, and installing
  later keeps the pending match.
* **Group Cup**: round-robin cups for 3–10 friends, with fixed deadlines and a final. Nobody has to be online
  together, and nobody can stall it.
* **Practice Ghosts**: five original, deterministic rivals, fully offline.
* **Cricket Rooms**: spoiler-safe match cards, reactions and preset banter for every group.
* **Daily Top 100**: an anti-grinding ranking (best three of the first five eligible matches a day) and a permanent
  badge. With every player's explicit consent, a highlight Short is rendered from the verified replay for the official
  YouTube channel.

The game sells nothing that affects play: no stronger players, outcomes or ranking. There are no ads in an innings and
no loot boxes. Players need only an alias: no real name, no contacts, no location.

## Repository

| Path | What |
| --- | --- |
| `src/contracts/` | Shared types: rules, API, social, highlights, renderer, adapters, analytics |
| `src/engine/` | Sealed Six rules engine (deterministic, versioned), ghosts, ranking, training, simulations |
| `src/physics/`, `src/practice/`, `src/input/`, `src/perf/` | Practice: deterministic ball, bat and fielding physics (also used for the match replays' ball paths), overs and innings, screens, the one input model, the device benchmark and quality tiers |
| `src/render3d/`, `src/screens/`, `src/ui/`, `src/i18n/`, `src/audio/`, `src/highlight/` | 3D renderer (Three.js, with a 2D fallback), screens, design system, 11 locales, sound and haptics, highlight composer |
| `src/social/` | Group Cups, Cricket Rooms, leaderboards, Top 100, highlight consent and landing, profile |
| `src/net/`, `src/platform/`, `src/analytics/` | API client with a durable outbox, session, device adapters (share, deep links, push, install referrer, secure storage, identity), consent-gated analytics |
| `src/app/`, `src/App.tsx` | Shell, router, root store, services, Android Back |
| `backend/` | Cloudflare Worker, Durable Objects (match, cup, room), D1, R2, Queues, crons, local harness |
| `render-service/` | Highlight renderer (Cloud Run job: headless Chromium + ffmpeg) |
| `admin.html`, `src/admin/` | Highlight admin console (web only, behind Cloudflare Access) |
| `android/` | Capacitor 8 Android app `in.vande.cricket` with native plugins |

Start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Then:
- the game itself: [GAME_RULES](docs/GAME_RULES.md), [VISUAL_SYSTEM](docs/VISUAL_SYSTEM.md);
- Practice: [PRACTICE](docs/PRACTICE.md), [PRACTICE_PHYSICS](docs/PRACTICE_PHYSICS.md), [PRACTICE_RULES](docs/PRACTICE_RULES.md), [PRACTICE_PRESENTATION](docs/PRACTICE_PRESENTATION.md);
- trust and data: [SECURITY](docs/SECURITY.md), [PRIVACY_AND_CONSENT](docs/PRIVACY_AND_CONSENT.md), [ANALYTICS](docs/ANALYTICS.md);
- running it: [INFRASTRUCTURE](docs/INFRASTRUCTURE.md), [COST_MODEL](docs/COST_MODEL.md), [YOUTUBE_OPERATIONS](docs/YOUTUBE_OPERATIONS.md);
- shipping it: [ANDROID_RELEASE](docs/ANDROID_RELEASE.md), [STORE_LISTING](docs/STORE_LISTING.md), [TEST_REPORT](docs/TEST_REPORT.md), [LAUNCH_BLOCKERS](docs/LAUNCH_BLOCKERS.md).

## Develop

Requires Node 22.6 or later.

```bash
npm ci
npm run dev                                   # offline-only build: Practice, Training and Practice Ghosts
node backend/local/serve.mjs --engine real    # the whole API in process on 127.0.0.1:8787 (in-memory D1/DO/R2/Queues)
VITE_API_LOCAL=1 npm run dev                  # the app against the local API: duels, Daily Six, cups, rooms
```

`POST http://127.0.0.1:8787/__dev/advance?ms=…` moves the backend clock forward to try deadlines. Configuration
lives in environment variables only (`.env.example`); nothing secret is ever committed or bundled.

## Test

```bash
npm run typecheck:all     # app, node tooling, Worker, render service
npm test                  # unit and backend tests (Vitest)
npm run test:render       # render service tests
npm run build && npm run test:e2e   # browser journeys, accessibility, renderer (Playwright)
npm run test:flow         # cross-workstream flows: two phones, real backend and engine
npm run sim && npm run sim:golden && npm run sim:ranking   # balance, golden replays, ranking
node scripts/practice-physics-check.mjs                     # Practice timing windows measured on the real bat geometry
node scripts/practice-scoring-check.mjs --n=1000            # Practice scoring evidence: sixes, fours, catches, runs, replays
node scripts/match-physics-bench.mjs                        # match replay physics within its per-ball budget
node scripts/scan-secrets.mjs                               # no secrets in committable files
npm run notices                                             # regenerate public/third-party-notices.txt
```

## Build for Android

```bash
APP_LINKS_HOST=<domain> scripts/build-android.sh   # signed AAB + APK in release/ (keystore stays local)
scripts/build-android.sh --preview                 # local test release (*-PREVIEW-*), never uploaded
scripts/android-smoke.sh release/<apk>             # install, launch, Back, crash check on an emulator
scripts/android-lifecycle.sh                       # real WebView on an emulator: online Daily Six, Home and kill mid-ball
scripts/android-practice.sh                        # offline Practice on an emulator: launch choice, landscape, Home and kill mid-ball (keeps app data)
```

See [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md). Production needs the external accounts listed in
[docs/LAUNCH_BLOCKERS.md](docs/LAUNCH_BLOCKERS.md): a domain, Cloudflare, Firebase, Google sign-in, the YouTube
channel and quota, Play Console, and a legal review of the 18+ policy and privacy notice. Nothing is deployed or
published without the owner's authorisation.

The privacy policy (`privacy.html`) and account-deletion page (`delete-account.html`) ship with every build; the
operator name and support address come from `VITE_OPERATOR_NAME` and `VITE_SUPPORT_EMAIL`.

## Independence

VANDE Cricket is an independent game. It is not affiliated with or endorsed by any cricket board, league, team,
player or broadcaster. All names, marks, players and ghosts are original.
