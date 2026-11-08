# VANDE Cricket

VANDE Cricket is a cricket game for Android and the web. Today it is one thing: **offline first-person batting Practice**.
You face one bowler from the batter's view and play each ball with a touch, a flick or a key. The ball, the bat, the
fielders and the score come from deterministic physics, not from a dice roll. When a shot goes wrong you can play the
exact same ball again, and the coach's tip is computed from the same physics, not written by hand. The rule is that no
outcome is scripted or steered ([experience law 4](docs/VANDE-EXPERIENCE-CONSTITUTION.md)); whether the game keeps it is for
the independent evaluators to score. Progress is kept on the device; Practice needs no account and no network.

## Status

- **Active stage: Stage 1, Practice quality.** Stages 2 to 6 (repeat desire, chase, asynchronous competition, daily ritual,
  social growth) are closed, and no one builds or advances them. The order of authority and the gates are in
  [docs/VANDE-PRODUCT-SEQUENCE.md](docs/VANDE-PRODUCT-SEQUENCE.md).
- **Current focus:** one batter and one bowler: their motion, faces, bat, input feel and result moments (owner directive,
  2026-11-06). The wicketkeeper, non-striker and fielders keep working and get no new work.
- **Launch flow:** Launch, then Practice, then a Predefined Over or a Random Over. An innings is one wicket and up to ten
  six-ball overs. A normal start opens Practice.
- **Physics is frozen.** Simulation version 3 (`PRACTICE_SIM_VERSION`) is frozen at amendment 5f. A physics change needs the
  lead's decision and invalidates any verdict that cites the freeze; see [docs/PRACTICE_PHYSICS.md](docs/PRACTICE_PHYSICS.md).
- **Renderers:** Three.js is the default view on the web and Android. Classic, a 2D painter, is the fallback on weak
  devices. A Unity presentation (a rear-shoulder camera, so the whole batter and bowler are visible) is an opt-in
  engineering path that does not replace the other two until it passes its gates.
- **Practice copy** is complete in English, Hindi and Hinglish (the Hindi and Hinglish are AI-written and await a
  native-speaker review); the other eight locales show English ([src/i18n/practice/STATUS.md](src/i18n/practice/STATUS.md)).
- **Nothing here is certified.** Builders report measurements; independent evaluators score with the locked rubrics. No
  player study is recorded, and the Android size and India reach goals are UNPROVEN (see Quality gates).

### Other modes in the code (closed)

The earlier product, the asynchronous **Sealed Six** duel game, is still in the tree: the rules engine (`src/engine`),
Training, Daily Six, Friend Duel, Group Cups, Practice Ghosts, Cricket Rooms, the Daily Top 100 and highlight Shorts
(`src/social`, `src/highlight`), the Cloudflare Worker (`backend/`), the render job (`render-service/`) and the admin
console (`src/admin`). It is kept and tested, but it is not the product and not the launch: the sequence keeps those
stages closed, and nothing in it is extended. Old deep links still reach its screens. Nothing is deployed or published.
The plan to replace its bowling-plan duel with a physics Sealed Over in later stages is design only
([docs/growth](docs/growth/README.md)); none of it is built.

## Quick start

**You need:**

- **Node 22**, which is what `.nvmrc` and CI use (`nvm use`). `package.json` requires `^22.22.2 || >=23.6`: the scripts that
  run TypeScript directly need 22.18 or 23.6 or later, and the test dependency jsdom 30 needs 22.22.2 or later on the 22 line.
  Node 26 also works.
- **git** and **bash**, which `scripts/build-id.sh` and several other scripts use.
- **Python 3**, standard library only, for the motion tool tests.
- **Blender 5.2** to re-bake motion, **Unity 6000.3.27f1** (`unity/VandePractice/ProjectSettings/ProjectVersion.txt`) for the
  Unity path, and **JDK 21 with the Android SDK** for Android. None of these is needed to run or test the web app.

**Build identity.** `vite.config.ts` stamps every bundle with a build id. It takes `BUILD_ID` from the environment if set (CI
sets the commit hash), and otherwise runs `scripts/build-id.sh`: the short commit hash, plus `+` and 12 hex digits when the
tree has uncommitted changes. A fresh clone therefore needs no setup. Outside a git checkout, set `BUILD_ID` yourself
(7 to 40 hex digits). Evidence records cite the same id (`AGENTS.md`).

**Run, check and build:**

```bash
npm ci                    # install exactly what package-lock.json says
npm run dev               # dev server, http://localhost:5173/ by default; a normal start opens Practice
npm run typecheck         # app and node tooling; typecheck:all adds the Worker and the render service
npm run lint              # ESLint 10 (flat config): TypeScript and React hooks rules, no warnings allowed; part of the CI static job
npm run lint:fix          # the auto-fixable subset of the lint rules
npm run format:check      # Prettier over src/ and tests/ (see Working in this repository); npm run format writes
npm test                  # unit tests (Vitest)
npm run scripts:test      # Node tests of the tooling under scripts/ (Android policy, motion, textures, audio); -- --list shows what it leaves out
npm run build             # typecheck, then the production web build into dist/
node scripts/check-bundle-size.mjs   # the web bundle budget, after a build
npm run preview           # serve dist/ on http://localhost:4173/ (strict; add `-- --port N` to move it)
npx playwright install chromium      # once
npm run test:e2e          # browser journeys, accessibility and the renderer (Playwright; run npm run build first)
npm run test:render       # render-service unit tests
node scripts/scan-secrets.mjs        # no secrets in committable files
```

`npm test` ends with one known failure, `tests/unit/physics/shot.test.ts` ("cuts the short wide ball": a named limitation of
physics freeze 5f, left unskipped on purpose), so the CI unit job is red until it is resolved. A second test, the Director
size budget (`tests/unit/render3d/director/cost.test.ts`), failed on Node 22 until it was changed to count gzip with fflate;
it now passes alone on Node 22.23.4 and 26.0.0. The latest full run, with its build id, is in
[docs/TEST_REPORT.md](docs/TEST_REPORT.md).

Do not run two Playwright runs or two Gradle builds at once, and do not rebuild `dist/` under a running preview.
Configuration is environment variables only ([.env.example](.env.example)); nothing secret is committed or bundled.

**Motion pipeline** (the batter, bowler, keeper and fielder animation):

```bash
npm run motion:test       # Node tests: format, decoder, exporter, metrics, web and Unity twins
npm run motion:check      # the packs on disk equal what the sources build
npm run motion:test:py    # Python tests: the canonical form of the source files
node scripts/motion/export.mjs                     # rebuild the packs (public/practice/motion/*.vmp and the Unity *.bytes)
python3 scripts/blender/motion/vms_json.py --check # every source is in canonical form (--write fixes it)
node scripts/motion/metrics.mjs public/practice/motion/batter.vmp   # naturalness measurements of a pack
```

The sources are `assets-src/motion/<pack>/*.vms.json`, baked from original keyed controls (the scripts are in
`scripts/blender/motion/`); each pack folder has a `SOURCE.md` with its provenance and rebuild notes. The packs are
generated files: change a source, then rebuild.

**Other checks that CI runs:** `npm run scripts:test` runs every tooling test that can pass on a checkout (the Android policy
and evidence tools, the motion pipeline, the textures and the portable audio tools; `npm run scripts:test -- --list` names the
files it leaves out, with the reason), `npm run practice:goldens:check` (the frozen Practice golden fixtures still equal what
the engine produces) and `npm run motion:test:py`. `npm run frozen:check` verifies that the 25 files of the physics freeze 5f (`src/physics` and
`src/render3d/practice/frame.ts`) still have the SHA-256 recorded in [docs/FROZEN-5f.sha256](docs/FROZEN-5f.sha256), with Node
alone. The full audio tool tests (`npm run audio:tools:test`) are not run by CI,
and 5 of their 21 tests fail in a plain clone (ffmpeg 9.0.1, Node 22.23.4), because they need the ignored sound folder
`release/product-sequence/stage-1-practice/wedge/sound/`: four read its REGISTER.md or FREESOUND-SEARCH.md, and the placeholder
render test falls back to a default level without its `placeholders/synth-levels.json`, so its MP3s differ from the shipped
ones. With that folder in place all of them pass on ffmpeg 9.0.1 (the shipped MP3s carry its encoder tag Lavc63.1; other
versions are not measured). `npm run notices` regenerates `public/third-party-notices.txt` with `--android`, so it runs
Gradle: it needs a JDK, the Gradle cache and `android/capacitor-cordova-android-plugins/`, which `cap sync` writes and git
ignores. In a clean clone it exits with 1 and leaves the file unchanged until `npm run android:sync` has run; that it then
reproduces the committed file is UNPROVEN.

**Unity.** The project is `unity/VandePractice`. Its EditMode tests, the WebGL and Android exports and the debug spike are
described in [unity/VandePractice/README.md](unity/VandePractice/README.md). The web preview of the Unity view
(`npm run dev:unity`, `npm run build:unity`, `npm run preview:unity`) needs a WebGL export in `public/unity`, which is
ignored and produced by the Editor.

**Android.** Capacitor 8, application id `in.vande.cricket`. `npm run android:sync` builds the web app and syncs it,
`npm run android:apk:debug` builds a debug APK, `npm run android:preview` builds a local preview release that is never
uploaded, and `npm run android:release` builds the signed release (it needs `APP_LINKS_HOST`; the keystore stays local and is
never printed or committed). `scripts/android-practice.sh` and `scripts/android-lifecycle.sh` drive an emulator. Procedure, toolchain and
launch blockers: [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md) and [docs/LAUNCH_BLOCKERS.md](docs/LAUNCH_BLOCKERS.md).
Nothing is signed for upload, deployed or published without the owner's approval.

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/physics/`, `src/practice/` | The deterministic ball, bat, fielding and scoring physics; the innings, overs, coach, screens, local store, work thread and Unity bridge client |
| `src/input/`, `src/perf/` | The one input model (touch, mouse, pen, keyboard become one swing); the device benchmark and quality tiers (Premium, Balanced, Classic) |
| `src/render3d/` | The Three.js stage, the Classic 2D painter, cameras, the human motion player and the Practice presentation |
| `src/audio/`, `src/i18n/`, `src/ui/`, `src/styles/`, `src/screens/`, `src/app/`, `src/pwa/`, `src/platform/` | Sound and haptics; copy and locales; design system; legacy screens; app shell, router and store; PWA updates; Capacitor adapters |
| `src/contracts/` | Shared types: Practice, the Unity bridge, and the legacy API. Root-owned |
| `src/engine/`, `src/social/`, `src/net/`, `src/analytics/`, `src/highlight/`, `src/admin/` | The legacy Sealed Six product (closed) |
| `tests/` | `unit/` (Vitest), `e2e/` (Playwright), `fixtures/` (frozen golden fixtures) |
| `scripts/` | Tooling: `motion/` (pack builder and metrics), `blender/` (bake scripts, Python tests), `audio/`, `unity-textures/`, `eval/` and `perf/` (evaluation and measurement), Android release and evidence scripts, `export-unity-*` exporters |
| `assets-src/motion/` | Motion sources (VMS1 JSON) for eight packs, each with a `SOURCE.md` |
| `public/` | Static files: audio takes, the motion packs, icons, headers, `third-party-notices.txt` (`public/unity/` is a local, ignored WebGL export) |
| `unity/VandePractice/` | The Unity project (Unity-as-a-Library presentation) |
| `android/` | The Capacitor Android app |
| `backend/`, `render-service/` | The legacy Cloudflare Worker and highlight renderer |
| `docs/` | All documentation; start at [docs/README.md](docs/README.md) |
| `release/` | **Ignored, local only.** Evidence, reports, captures, the locked rubrics, and `release/player-experience/tools/build-id.sh`, a thin wrapper that runs the tracked `scripts/build-id.sh` (the path `AGENTS.md` cites) |
| `store-assets/` | Play listing graphics (the listing copy, `docs/STORE_LISTING.md`, still describes the legacy product) |
| `.github/workflows/ci.yml` | CI: on pushes to `main` and on pull requests, four independent jobs (static checks, unit tests, script tests, build with the browser tests) |

Module boundaries and file ownership are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Quality gates

| Gate | Requirement | State |
| --- | --- | --- |
| Physics freeze | Simulation v3 is frozen at amendment 5f; frozen files are never edited | In force |
| Locked rubrics | `release/player-experience/ceiling-rubric.md`, `release/player-experience/DUAL-CEILING-RUBRIC.md`, `release/competitive-experience/COMPETITIVE-RUBRIC.md`; never edited | Locked |
| Stage 1, automated | Typecheck, tests and builds pass; no Critical or High Practice defect; input latency and frame pacing meet the sequence budgets; deterministic replay; the render agrees with the physics; coach text agrees with the simulation; no unexplained outcome manipulation; no dominant universal shot | Scored only by independent evaluators; not certified |
| Stage 1, human | At least 10 New Player X and 10 Expert Player X testers on representative Indian Android phones, after a 3 + 3 pilot | No study is recorded |
| Android size | At most **50,000,000 bytes** fresh-installed through the first playable ball | **UNPROVEN** |
| India reach | At least **90.0%** India-weighted working reach | **UNPROVEN** |

Artifact size and a count of device models cannot certify the Android goals; the method and the evidence they need are in
[docs/ANDROID_SIZE_AND_REACH.md](docs/ANDROID_SIZE_AND_REACH.md). Report the measured size delta and the affected cohorts
with every Android-affecting change, and mark anything without representative Play or device evidence UNPROVEN. Every claim
cites its evidence: build id (`scripts/build-id.sh`), UTC time, device or browser, settings, method,
expected, observed, pass or fail, and path.

## Documentation

[docs/README.md](docs/README.md) indexes every document with its status. The ones to read first:

1. [AGENTS.md](AGENTS.md): the rules that bind every person and agent.
2. [docs/VANDE-PRODUCT-SEQUENCE.md](docs/VANDE-PRODUCT-SEQUENCE.md): the product constitution and the active stage.
3. [docs/VANDE-EXPERIENCE-CONSTITUTION.md](docs/VANDE-EXPERIENCE-CONSTITUTION.md): the ten experience laws.
4. [docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md](docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md): binding for every Practice screen and asset.
5. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): module map and exclusive file ownership.

Then, for Practice: [PRACTICE](docs/PRACTICE.md), [PRACTICE_RULES](docs/PRACTICE_RULES.md),
[PRACTICE_PHYSICS](docs/PRACTICE_PHYSICS.md), [PRACTICE_PRESENTATION](docs/PRACTICE_PRESENTATION.md),
[PRACTICE_INPUT](docs/PRACTICE_INPUT.md), [PRACTICE_COACH](docs/PRACTICE_COACH.md), [AUDIO](docs/AUDIO.md) and
[PERFORMANCE](docs/PERFORMANCE.md). For test results by date: [TEST_REPORT](docs/TEST_REPORT.md).

## Working in this repository

[AGENTS.md](AGENTS.md) binds every contributor. In short:

- **Builders cannot certify their own work.** Scores and gate decisions come from independent evaluators. AI agents are
  evaluators, never players: a human result is never stated or estimated.
- **No commit, push, deploy, publish or purchase without the owner's explicit approval.** Never reset, stash, clean or
  discard other people's changes, delete working code or tests to get green, kill processes you did not start, uninstall
  the Android app or wipe its data, or print or commit `android/keystore.properties` or `android/keystore/*`.
- **Stay in your files.** Each path has one owner ([docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)); contracts, the app shell,
  config and Android go through the lead.
- **Do no work for a later stage.** Send ideas to the lead for the not-now register (sequence section 9).
- **Share the machine.** Long batch jobs run under `nice -n 15` with at most two workers; record `uptime` with every timing.
- **Keep the docs true.** A new document gets a row in [docs/README.md](docs/README.md); a number in a status document
  names its build and date.
- **Hygiene.** [docs/REPO_HYGIENE.md](docs/REPO_HYGIENE.md) lists the large data files, the ceiling for unused exports, the
  files production never reaches and the lint, formatting and pin policies.
- **Pull requests.** [.github/pull_request_template.md](.github/pull_request_template.md) asks for these rules as evidence,
  and [.github/CODEOWNERS](.github/CODEOWNERS) makes the owner the reviewer of every path (enforcing it is a host setting).

Style is in [.editorconfig](.editorconfig) (two spaces for TypeScript, JavaScript, CSS, HTML and Markdown; four for C#,
Python, Java and Gradle; LF line endings). **Lint and format.** `npm run lint` must pass (ESLint config in `eslint.config.js`). Fix the
cause; a suppression is `// eslint-disable-next-line <rule> -- <why this is correct>` and an unused one is an error.
`eslint-suppressions.json` holds the few findings in files nobody may edit (the frozen physics files, the contract, hash-pinned
evidence scripts); it must not grow (`npx eslint --prune-suppressions` after a fix). Prettier (`.prettierrc.json`, `.prettierignore`)
formats `src/` and `tests/` only, never data, docs or Unity, and skips the files whose hash is pinned; the one formatting commit
is listed in `.git-blame-ignore-revs` (`git config blame.ignoreRevsFile .git-blame-ignore-revs`).

## Assets and licences

Use only original or properly licensed assets: the owner's rule is free tools and CC0, CC BY or owner-made material, with no
paid software, services, assets or APIs. Every Practice asset has a row in [docs/ASSET_REGISTER.md](docs/ASSET_REGISTER.md)
with its source, licence and checksum; third-party licence texts and provenance are in [docs/licenses](docs/licenses/);
`public/third-party-notices.txt` is generated by `npm run notices`. The code is proprietary (`"license": "UNLICENSED"` in
`package.json`).

## Independence

VANDE Cricket is an independent game. It is not affiliated with or endorsed by any cricket board, league, team, player or
broadcaster. All names, marks and players are original.
