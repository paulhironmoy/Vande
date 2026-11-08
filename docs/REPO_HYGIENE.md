# Repository hygiene: the written decisions

The few rules about what may sit in this repository, and the numbers they are held to. Measured on commit `6738bbe` of the
local branch `cricket-clean` on 2026-11-08 (Node 22.23.4, knip 6.42.1, the root `knip.json`); builder-measured, nothing
certified. A change that moves a number changes it here in the same commit.

## 1. Large and pretty-printed data files

Rule: a tracked JSON file of 100,000 B or more averages at least 40 B per line, and no tracked text file is above 1 MB,
unless it is listed here with its reason. Measure: `wc -c` over `git ls-files '*.json'` divided by `wc -l`, and
`git ls-files | xargs wc -c | sort -n | tail`. `package-lock.json` (375,391 B, 35 B per line) is npm's file and is excepted.

| File | Bytes | Lines | SHA-256 | Where a document pins it | Why it stays as it is |
| --- | ---: | ---: | --- | --- | --- |
| `tests/fixtures/unity-practice/reach-proxies-v3.json` | 216,976 | 7,049 | `f78959b2a240acbd7436a71158f0af21734cc84b4588ddb14665f23945f83dee` | PRACTICE_PHYSICS.md, the simulation v3 freeze | The Unity input of the frozen simulation, written by `scripts/practice-reach-corpus.test.ts`. Reformatting it changes the hash the freeze cites |
| `docs/licenses/vande-production-hero/hero-bundle-provenance.json` | 117,244 | 3,647 | `12c338d68ffeb9d01e0919ab2d0a83fab80eea5581d5f565a5a106e734c10c00` | ASSET_REGISTER.md, the hero bundle row (size and SHA-256) | The provenance record that `scripts/export-unity-production-hero-bundle.mjs` writes and its test reads back |
| `tests/fixtures/unity-practice/practice-v3.json` | 6,028,442 | 11,060 | `56f580ab0e0c34e5a421de370c9b89560399b9407d9a271d9a6a911040e0abe5` | PRACTICE_PHYSICS.md, the simulation v3 freeze | The frozen Unity golden corpus; `npm run practice:goldens:check` compares it with the production engine |
| `tests/fixtures/unity-practice/bat-interpolation-v3-5b.json` | 1,303,492 | 1 | `295aca5b297484a3609472bae3c682ed3c67d5e37664feadd9d2783cb4476060` | none | Reference poses of `batAt` (`src/render3d/practice/frame.ts`, freeze 5b) for Unity's `BatInterpolationParityTests`; one line by design |

The three fixtures are marked `linguist-generated` in `.gitattributes`; the provenance record is not. `src/render3d/core/clips.ts`
(101,674 B, 29.7 B per line) is authored TypeScript, not data, and Prettier formats it. Six binaries are above 1 MB, all
under `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/` (`hero-kit-normal.png` 2.24 MB,
`stadium-day-background-v2.png`, `hero-kit-ao.png`, `hero-lod0.bytes`, `hero-skin-albedo-1024.png`,
`human-skin-albedo-1024.png`); each has a row in [ASSET_REGISTER.md](ASSET_REGISTER.md) or a provenance record.

## 2. Unused exports and types: a ceiling that does not rise

`npx knip@6.42.1 --reporter json` with the root `knip.json` reports **404 unused exports and 255 unused types** (381 and 246 before the Target Chase and camera program of 2026-11-08; the 23 and 9 new names are listed by owner in `release/product-sequence/stage-3-chase/QA-INTEGRATION/INT-1-RESULTS.md`, row C4), 0 unused
dependencies or devDependencies, and one `unlisted` name (`@tests/unit` in `scripts/director-corpus-export.ts`, an alias
that the script's own Vitest config resolves: a false positive). Rule: neither count may grow. A change that adds an export
nothing imports removes another, or raises the ceiling here with its reason. Knip is not a dependency of this repository;
`npx` fetches the pinned version.

```sh
npx knip@6.42.1 --reporter json | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")),n=k=>r.issues.reduce((a,i)=>a+i[k].length,0);console.log("exports",n("exports"),"types",n("types"),"unused packages",n("dependencies")+n("devDependencies"))'
```

| Class | Exports | Types | Of which used inside their own file | Why it stays |
| --- | ---: | ---: | ---: | --- |
| Barrel re-exports (`index.ts`) | 111 | 114 | 16 and 7 | A folder's public surface: a name nobody imports yet is still part of the module's interface |
| Physics freeze 5f (`docs/FROZEN-5f.sha256`) | 68 | 40 | 42 and 15 | The files may not be edited, so an unused `export` there cannot be removed |
| Platform bridge (`src/platform`) | 33 | 10 | 13 and 2 | The TypeScript side of the bridge to the native shell and Unity; the other side (Kotlin, C#) is not read by knip |
| Contracts (`src/contracts`) | 11 | 23 | 11 and 23 | Shared types the lead owns; the shape is the contract even where this side imports less than it declares |
| Vendored (`src/render3d/core/motion/vmp.ts`) | 25 | 0 | 17 and 0 | Byte-identical mirror of `scripts/motion/vmp.ts`; it is pruned on neither side alone |
| i18n catalogues (`src/i18n`) | 12 | 12 | 2 and 5 | Catalogue modules are loaded by `import.meta.glob`, which knip does not follow |
| Legacy backend and render service | 7 | 0 | 7 and 0 | The closed Sealed Six product ([docs/README.md](README.md)) |
| Other, named by folder | 114 | 47 | 93 and 43 | Exports mostly in `src/render3d/practice` (16), `src/render3d/core` (15), `src/practice/coach` (13), `src/engine/sim` (12) and `src/practice/game` (11). Most are used inside their own file, so only the `export` keyword is surplus; the rest are debt to prune when the file is next touched |
| Target Chase, camera, controls, lesson and venue modules (2026-11-08) | 23 | 9 | not counted | Small public helpers and types of the new modules that nothing imports yet (for example `chase/index.ts`, `ui/camera/panelViews.tsx`, `ui/lesson/timing.ts`); raised by the lead at the first integration pass with the owners listed in INT-1-RESULTS C4, to be pruned in the next hygiene pass because pruning now would touch finished agents' code before the freeze |

"Used inside their own file" counts a name that appears at least twice in its file; it is approximate and informative, not
a rule. The class totals add up to 404 and 255.

## 3. Files that production never reaches

`npx knip@6.42.1 --production --reporter json` (entries marked `!` in `knip.json`) must report exactly these 13 files and
no other. A file joins the list only with a row here.

| File | Kind | Why it exists | Used by |
| --- | --- | --- | --- |
| `src/engine/sim/harness.ts` | simulation tool | Balance and fairness harness, not shipped | `scripts/simulate-balance.mjs`, `tests/unit/engine` |
| `src/engine/sim/experiments.ts` | simulation tool | Balance experiments built on the harness | `scripts/simulate-balance.mjs`, `balance-smoke.test.ts` |
| `src/engine/sim/golden.ts` | simulation tool | Writes the frozen golden replays of engine v1 (`npm run sim:golden`) | `scripts/simulate-golden.mjs` |
| `src/engine/sim/rankingSim.ts` | simulation tool | Daily Top 100 simulation (`npm run sim:ranking`) | `scripts/simulate-ranking.mjs` |
| `src/practice/game/evaluate.ts` | evaluation harness | Plays policies through the real pipeline for the release gates (FAIR6, EX5 to EX9) | `scripts/practice-properties.mjs` and tests in `tests/unit/physics`, `practice/coach`, `practice/game` |
| `src/render3d/dev/assets.ts` | dev gallery | Close-ups of the Practice stage assets for art review; page `assets.html`, dev server only | opened by hand |
| `src/render3d/dev/practice.ts` | dev harness | Drives the Practice stage for screenshots and measurements; page `practice.html` | `tests/e2e/render3d-practice.spec.ts` |
| `src/screens/dev/fixtures.ts` | test fixtures | A hand-written revealed match; never imported by shipped screens | `scripts/perf/highlight.mjs`, unit and e2e tests |
| `src/screens/dev/gallery.tsx` | dev gallery | Screens rendered with fixtures; page `gallery.html` | `tests/e2e/ux-renderer.spec.ts` |
| `src/screens/dev/harness.ts` | dev harness | Drives the renderer for screenshots and performance runs; page `harness.html` | `scripts/brand/build.mjs`, `scripts/perf/contact.mjs`, `ux-renderer.spec.ts` |
| `src/input/camera/simulate.ts` | test and examiner tool | Synthetic pose traces and a replay through the real camera batter (the camera counterpart of `src/input/simulate.ts`); never shipped | `tests/unit/input/camera`, `tests/unit/camera-fixtures`, examiner scripts |
| `src/practice/chase/derive.ts` | derivation tool | The target method: the reference-batter sweep that writes `targets.ts` (policy `best-play-timing-20` v2); not needed at run time | `scripts/chase-targets.mjs`, `tests/unit/practice/chase` |
| `src/practice/chase/reference.ts` | derivation tool | The reference batter (20 ms timing, best of the coach's three responses); never imported by the app | `derive.ts`, `scripts/chase-*.mjs`, `tests/unit/practice/chase` |

The four `.html` pages are served by the Vite dev server only; `pageInputs` in `vite.config.ts` does not build them.

## 4. Lint suppressions, formatting and pins

- **Suppressions.** `// eslint-disable-next-line <rule> -- <why this is correct>`; one without a reason is a defect (all 29
  in `src`, `tests`, `scripts` and `backend` carry one). `eslint-suppressions.json` holds findings in files nobody may edit
  and must not grow. ESLint writes that file without its final newline, so after `npx eslint --prune-suppressions` run
  `printf '\n' >> eslint-suppressions.json`.
- **Formatting.** Prettier covers `src/` and `tests/` only (`.prettierrc.json`, `.prettierignore`); `npm run format:check`
  runs in CI. The one formatting commit, `2b75b4d`, is in `.git-blame-ignore-revs`; point git at it with
  `git config blame.ignoreRevsFile .git-blame-ignore-revs`.
- **Pins.** A file whose bytes a hash outside it fixes is not reformatted, renamed or edited; a change that needs one goes
  through the lead and regenerates the pin in the same commit:
  - the 25 physics files: `docs/FROZEN-5f.sha256`, checked by `npm run frozen:check` in CI;
  - the sources `.prettierignore` names (`src/engine/prng.ts` and `src/render3d/core/skeleton.ts` are pinned in the Unity
    character provenance, `tests/unit/evaluation/capture-compare-normalize.test.ts` by the independent retest reports);
  - `docs/licenses/**`, verbatim upstream texts with pinned SHA-256;
  - the four data files of section 1;
  - mirrored pairs, edited together: the audio takes and C# copies (`tests/unit/motion/vendoredCopies.test.ts`), the Director
    fixtures (`unityVendored.test.ts`), `vmp.ts` (`motionVendored.test.ts`);
  - known stale: the pins of `package.json` and `package-lock.json` in two provenance records, which is why
    `scripts/export-unity-production-human.test.mjs` is left out of `npm run scripts:test` (`-- --list` says so).
- **Reviewers.** `.github/CODEOWNERS` and `.github/pull_request_template.md` carry the process; branch rules are a host
  setting that this repository cannot show.
