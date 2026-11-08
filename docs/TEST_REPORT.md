# Test report

Results by date and build. A test count belongs to the build it was measured on: run the suite for the number that is true
now. Everything here is builder-measured; nothing is certified (independent evaluators score, with the locked rubrics).

## Current state (2026-11-07)

Working tree over commit `4a376ae` (a local checkpoint; nothing is pushed), Apple silicon macOS. Commands that take long
ran through the shared-machine wrapper at `nice -n 15` with at most two workers.

**Full unit suite.** Source: `release/product-sequence/stage-1-practice/wedge/repo/REPO-A-REPORT.md` section 1 (local
evidence, gitignored). `npx vitest run --maxWorkers=2` on Node 26.0.0, build `4a376ae+29335ef3c535`, 2026-11-07 from
about 02:11Z, 595 s at a 1-minute load of 3.6 to 6.2: **245 files and 2,388 tests; 243 files and 2,382 tests passed, 1 file
and 1 test failed, 1 file and 5 tests skipped.** The failure is `tests/unit/physics/shot.test.ts:158`, "cuts the short wide
ball; fishing at it with a straight bat, a pull or a flick misses" (expected contact `middle`, got `outside_edge`): a named
physics limitation (owner PHYS, physics phase 5, freeze 5f) that stays unskipped. A second full run after the repository
cleanup (build `4a376ae+e5dba9cdf3db`, 587 s) gave the same counts, the same names and the same failure.

**Other checks**, in the working tree, Node 26.0.0, build `4a376ae+66b161347119`, 2026-11-07T05:17Z, 1-minute load 3.1 to 4.7:

| Command | Result |
| --- | --- |
| `npm run typecheck` and `npm run typecheck:all` | rc 0 |
| `node --test scripts/motion/*.test.mjs` (`npm run motion:test`) | 43 of 43 pass |
| `node scripts/motion/export.mjs --check` (`npm run motion:check`) | rc 0: all 8 motion packs equal what their sources build |
| `python3 -B -m unittest discover -s scripts/blender/motion -p '*_test.py'` (`npm run motion:test:py`) | 17 tests OK |
| `npx vitest run tests/unit/motion/vendoredCopies.test.ts tests/unit/render3d/motionVendored.test.ts` | 2 files, 6 tests pass |

**A clean copy, as CI sees it.** CI cannot see the ignored `release/` folder, so the working tree was copied without it
(tracked and untracked-but-not-ignored files, 2,321 files, its own throwaway git repository), then run on Node 22.23.4, the
latest 22.x, with `BUILD_ID` set the way `.github/workflows/ci.yml` sets it (snapshots taken at 05:05Z for the unit
suite and 05:12Z for the other steps; both include other agents' unfinished edits):

| Step | Result |
| --- | --- |
| `node scripts/scan-secrets.mjs` | rc 0, 2,236 files |
| `npm audit --omit=dev --audit-level=high` | rc 0, 0 vulnerabilities |
| `npm run typecheck:all` | rc 0 |
| `npm run android:policy:test` | rc 0 |
| `npm run motion:test`, `motion:check`, `motion:test:py` | 43 of 43 pass; rc 0; 17 tests OK |
| `npm run practice:goldens:check` | rc 0: 7 cases, payload sha256 `4f1e2bb5…` |
| `npm run textures:test`, `npm run audio:tools:test:portable` | 27 of 27 pass; 12 of 12 pass |
| `npx vitest run --maxWorkers=2` | 262 files, 2,543 tests: **3 files and 5 tests failed**, 258 files and 2,533 tests passed, 1 file and 5 tests skipped (671 s). The five: the physics test above, and four tests that need the ignored `release/` folder: three in `tests/unit/evaluation/capture-compare-adversarial.test.ts` (`release/player-experience/tools/build-id.sh`) and one in `tests/unit/audio/recorded.test.ts` (`release/product-sequence/stage-1-practice/wedge/sound/placeholders/processed.json`) |
| `npm run build`, then `node scripts/check-bundle-size.mjs` | rc 0; initial transfer 410.1 kB gzip (budget 450 kB); precache 234 entries |
| `npm run test:render` | 5 files, 13 tests pass |
| `npx playwright test --list` | 145 tests in 20 files (chromium, practice, social projects) and 6 in 6 files (flow): listed only |

Not run in this pass: the Playwright journeys, Unity, Android builds and emulators, a physical device, any real player.
`npm audit` needed the registry and ran in the clean copy only. The Android size (50,000,000 B) and India reach (90.0%)
goals remain **UNPROVEN**.

**A clean copy after the tracked build-id tool (REPO-C1, 2026-11-07).** Four of the five failures in the table above came
from files that sit in the ignored `release/` folder. `scripts/build-id.sh` is now tracked (`vite.config.ts` and the scripts that
measure the tree use it; `BUILD_ID` from the environment still wins in `vite.config.ts`), four tests no longer read
ignored files, and `npm run scripts:test` runs the tooling tests. Method as above: tracked and untracked-but-not-ignored
files, no `release/`, no `.git` from the working tree but a throwaway repository with one commit (so the id is the clean
short hash), `node_modules` linked (a copy-on-write clone for the Playwright rows: with the links, the first Playwright attempt got a 403 on a
font, outside Vite's serve allow list, and it passes with the clone), Node 22.23.4, 05:49Z to 06:16Z, 1-minute load 2.0 to 10.5
(builder numbers, not a certification):

| Step | Result |
| --- | --- |
| Before: `npx vitest run tests/unit/engine/primitives.test.ts`, no `BUILD_ID`, unchanged files | fails to load `vite.config.ts`: `spawnSync .../release/player-experience/tools/build-id.sh ENOENT` |
| After: the same command | 1 file, 7 tests pass |
| `npm ci --dry-run` | rc 0 |
| `npm run typecheck:all` | rc 0 (14 s) |
| `BUILD_ID` as CI sets it (`github.sha`): `npx vitest run --maxWorkers=2` | 264 files, 2,572 tests: **1 failed**, 2,566 passed, 5 skipped (700 s). The failure is the named physics test; the three `capture-compare-adversarial` tests and the `recorded` placeholder test of the table above pass |
| `npm run scripts:test` | 38 files, 431 tests: 425 pass, 0 fail, 6 skipped, each skip prints its reason (55 s); the run leaves the tree unchanged |
| `npm run motion:check`, `practice:goldens:check`, `motion:test:py`, `node scripts/scan-secrets.mjs`, `npm run test:render`, `npm audit --omit=dev --audit-level=high` | rc 0 each |
| `npm run build` with no `BUILD_ID`, then `node scripts/check-bundle-size.mjs` | rc 0; the bundle carries the id that `scripts/build-id.sh` prints; 410.1 kB gzip (budget 450 kB) |
| `npm run dev` and `npm run preview` (private ports, no `BUILD_ID`) | `GET /` answers 200 on both; the dev server also transforms `/src/main.tsx` and serves the Manrope font from `node_modules` (200); the preview serves the built bundle (200) |
| Playwright, no `BUILD_ID`, own ports: `--project=chromium` "3D first-person stage plays a delivery" (starts its own dev server) and `--project=practice tests/e2e/practice-launch.spec.ts` (builds with the test hooks, then previews) | 5 of 5 pass (12 s and 25 s); the same chromium test also passes in the working tree |

Not measured: Linux (CI's `ubuntu-latest`; every number above is macOS arm64, so the first real run is the test), the rest of the
Playwright journeys (`test:e2e` and `test:flow` as CI runs them: only the five tests above ran), and `npm ci` itself (only `--dry-run`).

Still on the old `release/` path, because their SHA-256 is pinned or recorded, or because Unity owns them:
`scripts/android-gate-a-unity-admission.mjs` (pinned in `docs/evaluation/gate-a/visual-direction/active-target.v2.json`), the
two independent-retest scripts and the dated reviews under `docs/evaluation/capture-compare/reviews/`, and three files in the
Unity project's Editor folder. On a machine that has `release/` they still work, because `release/player-experience/tools/build-id.sh`
is now a thin wrapper around `scripts/build-id.sh`.

Left out of `npm run scripts:test`, each with its reason in `scripts/run-script-tests.mjs`
(`npm run scripts:test -- --list`): `scripts/export-unity-production-human.test.mjs` (its pins of `package.json` and
`package-lock.json` in `docs/licenses/makehuman-v1.3.0/production-human-provenance.json` and in the Unity
`Characters/provenance.json` are stale) and the three audio tests that `npm run audio:tools:test` still runs (ffmpeg 9.x, or a
local report).

The two sections below are dated records of earlier builds. They are kept as history and are not current.

## Baseline before the rebuild (civic game, commit `ea4423f`)

Recorded on 2026-10-25 from the last full run of the same code.

| Check | Result |
| --- | --- |
| `npm run typecheck` (app + node) | clean |
| `npx tsc -p backend/tsconfig.json --noEmit` | clean |
| `npx vitest run` | 58 files, 782 tests passed |
| `npm run build` + `node scripts/check-bundle-size.mjs` | initial transfer 435.2 kB gzip (budget 2,048 kB), precache 1.50 MB |
| `npx playwright test` | 71 passed |

The civic suites were removed with the civic code (see `docs/decisions/REBUILD_DECISIONS.md`); they remain in Git history.

## VANDE Cricket, recorded 2026-10-25 (historical)

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
