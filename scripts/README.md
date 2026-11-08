# Scripts

Tools that build, check, measure and export VANDE. Run everything from the repository root. Node is pinned to 22
(`.nvmrc`, and `engines` in `package.json`); from 22.18 Node strips TypeScript types itself, so the `.ts` helpers need
no build step.

Script tests are the `*.test.mjs` files beside the scripts. `npm run scripts:test` runs all of them with `node:test`,
and `npm run scripts:test -- --list` shows the set and names each file it leaves out, with the reason. CI runs the same
command.

A tool that needs Unity, Android, Blender, Chromium or ffmpeg says so in the header comment of its script. Nothing here
publishes anything except `deploy-pages.mjs`, and publishing needs the owner's approval (`AGENTS.md`).

## Build, checks and release

| File | What it does |
| --- | --- |
| `build-id.sh` | Prints the build id of the working tree: the short HEAD sha, plus `+<12 hex>` when the tree is dirty. `vite.config.ts` and the evidence scripts call it. |
| `check-bundle-size.mjs` | Reports gzip sizes of the production build and fails when the initial transfer is over 450 kB. CI runs it. |
| `scan-secrets.mjs` | Scans every file Git would commit for keys and credentials. CI runs it. |
| `check-frozen.mjs` | Checks that the 25 physics files of freeze 5f still have the SHA-256 in `docs/FROZEN-5f.sha256` (`npm run frozen:check`). CI runs it. |
| `generate-notices.mjs` | Writes `public/third-party-notices.txt` (`npm run notices`). |
| `run-script-tests.mjs` | The runner behind `npm run scripts:test`. |
| `deploy-pages.mjs` | Builds with `BASE_PATH=/Vande/` and pushes the `gh-pages` branch (`npm run deploy:pages`). Owner approval required. |
| `brand/build.mjs` | Draws the app icons, launcher layers, splash screens, store icon and link card (`npm run assets`; needs Playwright's Chromium). |

## Practice physics, scoring and goldens

| File | What it does |
| --- | --- |
| `practice-physics-check.mjs` | Sweeps a swing across timing errors against fixed deliveries and shows that the timing windows come from the bat-ball physics. |
| `practice-scoring-check.mjs` | Runs many scripted swings through the real Practice pipeline and prints the outcome distribution per kind of shot. |
| `practice-properties.mjs`, `practice-properties-method.mjs` | The release-gate property checks (the exploit search and the others named in the header), rerunnable with one command. |
| `practice-unity-goldens.mjs` | Generates and checks (`npm run practice:goldens:check`) the golden fixtures in `tests/fixtures/unity-practice` that the Unity bridge tests replay. |
| `practice-reach-corpus.test.ts` | The producer of the frozen `reach-proxies-v3.json`, not a test run (own Vitest config). The fixture's hash is cited in `docs/PRACTICE_PHYSICS.md`; do not regenerate it casually. |

## Motion

| File | What it does |
| --- | --- |
| `motion/export.mjs` | Builds the VMP1 packs from the VMS1 sources in `assets-src/motion`, deterministically; `--check` verifies the committed packs (`npm run motion:check`). |
| `motion/vmp.ts` | The reference decoder and sampler of the VMP1 format (`docs/MOTION-SPEC.md`). |
| `motion/metrics.mjs` | Measures motion metrics on decoded clips (MOTION-SPEC section 9) for evaluators. It measures; it does not certify. |
| `motion/contact-sheet.mjs` | Run by hand: stick-figure contact sheets of a decoded clip, `node scripts/motion/contact-sheet.mjs <pack.vmp> <out-dir> [clip ...] [--frames 12]`. |
| `motion/unity/` | `VandeMotionPack.cs`, the C# reader of record, with its cross-check tools and EditMode test. |
| `blender/motion/` | Blender (Python) generators that write the VMS1 sources on the canonical skeleton, and the canonical JSON writer. `npm run motion:test:py` runs their tests. |

## Face-and-life Director

| File | What it does |
| --- | --- |
| `director-unity-params.mjs` | Derives the Unity copy of the Director parameters (the C# constants and a byte-identical fixture) from `src/render3d/core/motion/director/params.json`. |
| `director-corpus-export.ts` | Exports the web Director's 490-plan parity corpus that the Unity `DirectorCorpusReplay` test checks: `VANDE_DIRECTOR_CORPUS_OUT=<dir> npx vitest run --config scripts/director-corpus-export.vitest.config.mjs`. |

## Unity

| File | What it does |
| --- | --- |
| `export-unity-*.mjs` | Export the Unity resources from their sources, each with a test: player meshes, the production character (v3), cricket gear, the hero bundle, the MakeHuman-derived human, the production kit and the motion references. `export-unity-production-motion.mjs` converts CMU motion-capture references; their licence status is an open owner decision in `docs/LAUNCH_BLOCKERS.md`. |
| `unity-textures/` | Draws the Unity textures from code with fixed seeds; `--check` regenerates in memory and compares with the committed files. `npm run textures:test` runs its tests. |
| `verify-unity-webgl.mjs` | Verifies the Unity WebGL player behind the opt-in Unity lanes of `vite.config.ts` and fails closed when it is stale. |
| `test-unity-export-gate.mjs` | Exercises the Gradle gate that admits a Unity export, in a scratch copy of the Android project. |
| `cover-drive/` | The cover-drive study: scenario and baseline runs (`scenario.mjs`, `p1.mjs`), the join of Unity frame telemetry with physics telemetry (`analyse.mjs`), the hero clip encode (`encode-hero.mjs`), and `unity-guarded.mjs`, which runs one Unity batch command only when no editor has the project open. |

## Android

| File | What it does |
| --- | --- |
| `android-*.mjs`, `android-*.sh` | adb endpoint and device identity, evidence records, exclusive promotion of artifacts, installed-package inventory and size, the package-data epoch, sealed artifacts, the Unity payload binding, the Gate A attempt, preflight, receipt and admission, and the lifecycle, smoke and Practice runs. Their tests sit beside them: `npm run android:policy:test`. |
| `check-android-size.mjs`, `check-android-release-compat.mjs`, `check-unity-r8.mjs` | The size, release-compatibility and Unity R8 policy checks (`docs/ANDROID_SIZE_AND_REACH.md`). A static pass never replaces a fresh-install, Play-split or device measurement. |
| `build-android.sh` | Builds the release APK and the signed AAB (`npm run android:release`, `npm run android:preview`). |

## Performance and accessibility

`perf/` measures Practice's frame times, startup, tier matrix and accessibility. `perf/run-perf.sh` is the one-command
run (about 100 minutes; `quick` takes about 15) and `perf/run-a11y.sh` the accessibility run. Every number comes from
one machine or its emulator and is not evidence of phone performance (`docs/PERFORMANCE.md`).

## Evaluation and capture

| File | What it does |
| --- | --- |
| `eval/run.mjs` and `eval/modules/` | The Practice evaluation runner (`docs/EVALUATION.md`): drives a served test-hooks build in Chromium and writes screenshots, a video and metrics. |
| `eval/census.mjs`, `eval/score.mjs` | Count the actions reachable in each state; apply the rubric arithmetic to criterion scores that an examiner enters. They do not produce scores. |
| `eval/publish.mjs` | Run by hand: copies the key captured states of a run from the bulk folder (`EVAL_BULK`) into `release/player-experience/rookie/runs/<label>/selected/`. |
| `eval/compare/` | The capture and comparison runner for web, WebGL and Android recordings (`npm run eval:capture:*`, `docs/evaluation/capture-compare`). |
| `eval/compare/trace-demo-debug.mjs` | Run by hand against a preview on `127.0.0.1:4173`: starts the Practice demo with the debugger set to pause on exceptions, records every packet the Unity web host receives and the play-screen states, and prints them as JSON. |

## Audio

| File | What it does |
| --- | --- |
| `audio/placeholders.mjs`, `audio/render-synth.mjs` | Render the placeholder takes and the live synthesised voice by original synthesis. |
| `audio/ingest-recordings.mjs` | `--apply` swaps a sound's placeholders for registered recordings in one step. |
| `audio/freesound-search.mjs` | Searches the Freesound catalogue for candidate recordings. |
| `audio/placeholder-ab.mjs` | Run by hand: builds the owner's blind A/B kit (placeholder takes against the live voice, or recordings against synthesis) with a key file and a small listening page. Only the owner's ratings count. |

`npm run audio:tools:test` and `npm run audio:tools:test:portable` run the audio tool tests.

## Art and tooling for Blender

| File | What it does |
| --- | --- |
| `blender/cover_drive_hero*.py` | The cover-drive hero build, export and render. |
| `blender/cover_drive_measure.py` | Run by hand in Blender: measures the shoulder-elbow-wrist chain of saved hero builds against the physics reach definition. |
| `blender/install_mpfb_system_assets.py`, `blender/mpfb_smoke.py` | Install the MakeHuman CC0 system assets into MPFB; `mpfb_smoke.py` is a headless check that Blender, MPFB and those assets work. Nothing it writes ships. |
| `blender/vande_vpm3.py` | Reads VANDE's VSK1 skeleton and VPM3 skinned-mesh files. |

## Older Sealed Six simulations

`simulate-balance.mjs`, `simulate-golden.mjs`, `simulate-ranking.mjs` and `match-physics-bench.mjs` run the engine v1
simulations (`npm run sim`, `sim:golden`, `sim:ranking`); `simulate-loader.mjs` lets Node load the TypeScript engine.
The Sealed Six modes are closed under the product sequence, but these tools still run.
