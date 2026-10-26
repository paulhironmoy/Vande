# Test report

## Baseline before the rebuild (civic game, commit `ea4423f`)

Recorded on 2026-10-25 from the last full run of the same code.

| Check | Result |
| --- | --- |
| `npm run typecheck` (app + node) | clean |
| `npx tsc -p backend/tsconfig.json --noEmit` | clean |
| `npx vitest run` | 58 files, 782 tests passed |
| `npm run build` + `node scripts/check-bundle-size.mjs` | initial transfer 435.2 kB gzip (budget 2,048 kB), precache 1.50 MB |
| `npx playwright test` | 71 passed |

The civic suites were removed with the civic code (see `REBUILD_DECISIONS.md`); they remain in Git history.

## VANDE Cricket

Recorded 2026-10-25 on the integrated tree (branch `cricket-rebuild`, uncommitted), macOS, Node 22, Chromium from
Playwright 1.64.1.

| Command | Result |
| --- | --- |
| `npm run typecheck:all` (app, node tooling, Worker, render service) | clean |
| `npx vitest run` (app, engine, net, platform, social, UI, renderer, backend with in-memory and real-SQLite D1) | 84 files, 701 tests passed |
| `npm run test:render` (render service) | 5 files, 13 tests passed |
| `npm run build` + `node scripts/check-bundle-size.mjs` | initial transfer 373.9 kB gzip as counted by the script (budget 450 kB; Latin-script players download about 190 kB, `docs/VISUAL_SYSTEM.md` §12); precache 162 entries |
| `npx playwright test` (`chromium`: offline-capable journeys, renderer, accessibility, 360 px–desktop; `social`: cups, rooms, leaderboards, Top 100, consent, landing, profile against a mocked API) | 47 passed |
| `npm run test:flow` (two or three phones, real backend in process, real engine) | 4 passed: Friend Duel (1.4 min), Daily Six, offline mid-innings, Group Cup to the final (3.7 min) |
| `npm run sim` (100,000+ simulated matches, 19 balance checks) | 19/19 pass (gameplay report) |
| `npm run sim:golden` | committed golden replays verify |
| `npm run sim:ranking` (40 days × 3,000 players, grinding and collusion) | pass (see `docs/GAME_RULES.md` §14) |
| `scripts/build-android.sh` | signed `release/vande-cricket-1.0.0-1-release.aab` (9.8 MB) and `.apk` (10.0 MB), V2 signature by the upload key |
| `scripts/android-smoke.sh` (debug APK, Android 16 emulator) | installs, launches in 5.5 s cold, Back works, no crash or ANR |

Reviews (independent agents, read-only, findings fixed by the owning workstream and re-verified):

* Security and privacy review: 11 verified findings (1 high, 4 medium, 6 low); 1–10 fixed with regression tests,
  11 (hosting headers on a dedicated origin) is a launch blocker. See `docs/SECURITY.md`.
* Gameplay integration review: 3 major and 6 minor findings, all fixed.
* UX, accessibility and product review: 2 blockers, 7 major, 11 minor and 3 polish findings, all addressed; a
  verification pass and the rubric scores are recorded in the final handoff.

Cross-workstream bugs found by the flow suites and fixed: the outbox losing its clock (all online innings), the
batting screen freezing on "Saving your shot…" after a slow answer, the cup's current round following the device
clock, the services hook missing a finished boot, and the router rejecting real invite tokens.
