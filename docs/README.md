# VANDE documentation index

Start with the repository [README](../README.md), then [AGENTS.md](../AGENTS.md) (the rules that bind every person and
agent), then [VANDE-PRODUCT-SEQUENCE.md](VANDE-PRODUCT-SEQUENCE.md), the product constitution. Its top section names the
active stage.

This index lists every file under `docs/` with one line of purpose and a status. When you add a document, add its row
here in the same change.

## Status labels

| Status | Meaning |
| --- | --- |
| **Active** | Describes or governs the Stage 1 Practice product as it is built. Its owner keeps it current. |
| **Legacy** | Describes the retained Sealed Six product (code and tests stay in the tree; a normal start opens Practice instead). Not the product. Do not extend it. |
| **Closed-stage** | Design for a stage the product sequence keeps closed (Stages 2 to 6; today only Stages 4 to 6 have documents). Nothing in it is built. Each file carries a banner saying so. |
| **Historical** | A dated record, a recorded score or a superseded brief. Read it for context. Do not rely on it for the current state. |

## Conventions that apply to every document

- **Evidence labels.** `VERIFIED` (reproducible, with real players where the gate needs them), `PROVISIONAL` (internal or
  automated only) and `UNPROVEN` (no adequate evidence). Builders report measurements; independent evaluators score with
  the locked rubrics. AI agents are not players, so a human result is never stated or estimated.
- **Evidence paths.** Reports, captures and logs live under `release/` (gitignored, local, not in a fresh clone). Many
  documents name them in shorthand relative to `release/product-sequence/stage-1-practice/wedge/`; for example a
  reference to unity/REPORT.md means `release/product-sequence/stage-1-practice/wedge/unity/REPORT.md`. The locked rubrics are under
  `release/player-experience/` and `release/competitive-experience/`; never edit them.
- **Build ids.** Evidence cites the id printed by `scripts/build-id.sh` (the short commit, plus `+` and 12 hex digits when
  the tree has uncommitted changes). `release/player-experience/tools/build-id.sh`, the path `AGENTS.md` names, is a local
  wrapper that runs it and prints the same id.
- **Paths a clone cannot resolve.** Some citations name files that are not in a fresh clone, on purpose; the next
  section lists the classes.
- **Test counts go stale.** `TEST_REPORT.md` and `UNITY_PRACTICE_STATUS.md` quote the counts of a named build and date.
  Run the suite for the current number.

## Citations a clone cannot resolve

A repository path in backticks, and a relative Markdown link, should resolve in a fresh clone. These classes are exempt
by design, so the several hundred citations in them are not edited; a citation in none of them is a defect to fix.

| Class | What it covers | Examples |
| --- | --- | --- |
| Ignored evidence | Everything under `release/` (reports, captures, logs, the locked rubrics, the original of the physics freeze list; it is gitignored and local). The shorthand unity/REPORT.md (and the other unity/ report names) means the same folders under `release/product-sequence/stage-1-practice/wedge/`. Relative links into `release/` are in this class too; `ui-baselines/` records are immutable, so their links stay. | `release/player-experience/`, `release/competitive-experience/` |
| Ignored on purpose | A path that `.gitignore` names: secrets, local configuration, build output. | the keystore and its properties file, `local.properties`, the Firebase client config, the Worker's local dev variables, the Unity build folders |
| Closed stages | Every path in `docs/growth/`: design for Stages 4 to 6, whose files open with a banner saying the code is not built. | a `sim` folder under `src` |
| History | A sentence that names a path in order to say it was removed or withdrawn. | the removed brand folder and old generators in VISUAL_SYSTEM.md, the removed screens and sounds in REBUILD_DECISIONS.md, the `WITHDRAWN` rows of ASSET_REGISTER.md, the decision log in VANDE-PRODUCT-SEQUENCE.md |
| Verbatim upstream | A SHA-256-pinned upstream text is not edited. | the link to `LICENSE.CODE.md` inside `licenses/makehuman-v1.3.0/LICENSE.md` (upstream's file, not vendored) |
| Another tool's files | The Gate A documents under `evaluation/gate-a/` cite captures (`*.png`) and the GoldenScreen prototype (a folder under the Unity Runtime folder) that belong to Codex's work and are not in this branch. | the `golden-screen-*.png` and `photoreal-live-scene-v1.png` captures |

A path may also be written relative to the folder of the document that cites it.

## Rules and architecture

| File | Purpose | Status |
| --- | --- | --- |
| [VANDE-PRODUCT-SEQUENCE.md](VANDE-PRODUCT-SEQUENCE.md) | The product constitution: the six stages, the active stage, exit gates, the decision log and the not-now register. | Active |
| [VANDE-EXPERIENCE-CONSTITUTION.md](VANDE-EXPERIENCE-CONSTITUTION.md) | The ten experience laws, proportional feedback and the prohibited patterns. | Active |
| [prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md](prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md) | Binding rules for every Practice screen, component, animation and visual asset. | Active |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Module map, the Practice data flow, the work thread, the Unity transition and exclusive file ownership. | Active |
| [REPO_HYGIENE.md](REPO_HYGIENE.md) | What may sit in the repository: the large and pretty-printed data files, the ceiling for unused exports, the files production never reaches, and the lint, formatting and pin policies. | Active |
| [ANDROID_SIZE_AND_REACH.md](ANDROID_SIZE_AND_REACH.md) | The measurement contract for the Android size goal (50,000,000 B fresh-installed through the first playable ball) and the India reach goal (90.0%). | Active |
| [decisions/UNITY-PRACTICE-INTEGRATION.md](decisions/UNITY-PRACTICE-INTEGRATION.md) | Architecture decision record: Unity as the Practice presentation behind gates, with TypeScript as the authority. | Active |
| [decisions/REBUILD_DECISIONS.md](decisions/REBUILD_DECISIONS.md) | The 2026-10-25 audit and decisions for the rebuild from the civic game to VANDE Cricket (kept for the record; the removed paths it names no longer exist). | Historical |

## Practice (Stage 1)

| File | Purpose | Status |
| --- | --- | --- |
| [PRACTICE.md](PRACTICE.md) | Product, flows, tiers, Android, privacy, accessibility and the device test plan for offline first-person batting. | Active |
| [PRACTICE_RULES.md](PRACTICE_RULES.md) | Overs, field, fielding, running, scoring, dismissals and replay. | Active |
| [PRACTICE_PHYSICS.md](PRACTICE_PHYSICS.md) | Delivery and contact physics, timing windows, LBW, and the simulation v3 freeze. | Active |
| [FROZEN-5f.sha256](FROZEN-5f.sha256) | The SHA-256 of the 25 files of the physics freeze 5f (a byte-for-byte copy of the list in the ignored release folder); `npm run frozen:check` verifies it. | Active |
| [PRACTICE_PRESENTATION.md](PRACTICE_PRESENTATION.md) | The first-person stage, camera, humans, motion and result moments, and how a swing is read. | Active |
| [MOTION-SPEC.md](MOTION-SPEC.md) | The shared motion format: the VC17 skeleton, VMP1 packs, the canonical mirror and the naturalness caps (section 9) every motion pack must pass. | Active |
| [DIRECTOR-UNITY-PORT.md](DIRECTOR-UNITY-PORT.md) | The face-and-life Director's porting contract (director/3): keys and draws, channels, plan, bake, sampler, the runtime and where it plugs into the Unity rig; frozen on the web by a golden fixture. | Active |
| [PRACTICE_INPUT.md](PRACTICE_INPUT.md) | The one input model: touch, mouse, pen and keyboard become one normalized swing. | Active |
| [PRACTICE_COACH.md](PRACTICE_COACH.md) | Coach Mode, the exact-ball engine: diagnosis, recommendation, demonstration and retry. | Active |
| [PRACTICE_FIDELITY.md](PRACTICE_FIDELITY.md) | The Real-Match Fidelity Score and the study protocol that validate Practice. | Active |
| [AUDIO.md](AUDIO.md) | Sound, crowd emotion, mix, haptics and captions. | Active |
| [LOCALIZATION.md](LOCALIZATION.md) | The languages (en, hi, hi-Latn complete; eight drafts), where the text and the Android notification strings live, how to add a string, and the player-facing word checks (F8). | Active |
| [PERFORMANCE.md](PERFORMANCE.md) | Device tiers, frame and startup budgets, accessibility verification, and every measured number with its command. | Active |
| [VISUAL_SYSTEM.md](VISUAL_SYSTEM.md) | The design system, the renderer decision record and the screens. The Sealed Six screens in it are Legacy. | Active |

## Unity and Android

| File | Purpose | Status |
| --- | --- | --- |
| [UNITY_PRACTICE_STATUS.md](UNITY_PRACTICE_STATUS.md) | What the Unity path implements and which automated evidence has been captured. | Active |
| [UNITY_PRACTICE_EXPERIENCE.md](UNITY_PRACTICE_EXPERIENCE.md) | The Unity Practice experience contract (readiness, not evidence that a gate passed). | Active |
| [UNITY_ASSET_AUDIO_READINESS.md](UNITY_ASSET_AUDIO_READINESS.md) | Sourcing, production and acceptance contract for Unity assets and audio, with the truth labels. | Active |
| [UNITY_WEBGL_FEASIBILITY.md](UNITY_WEBGL_FEASIBILITY.md) | The Unity Web feasibility gate: desktop preview passed through the run-up, mobile not run. | Active |
| [ANDROID_RELEASE.md](ANDROID_RELEASE.md) | Building, signing and shipping the Capacitor app, and the optional Unity export. | Active |
| [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md) | External credentials, approvals and publishing actions only the owner can take. | Active |

## Evaluation and evidence

| File | Purpose | Status |
| --- | --- | --- |
| [EVALUATION.md](EVALUATION.md) | The QA and Rookie examiner's method, narrative and score tables for the builds it evaluated. | Historical |
| [PLAYER_EXPERIENCE.md](PLAYER_EXPERIENCE.md) | The Player Experience Director's integrated assessment as of 2026-10-26 (engineering estimates, no real players). | Historical |
| [TEST_REPORT.md](TEST_REPORT.md) | Typecheck, test and build results by date: the current state first, then the 2026-10-25 records. | Active |
| [evaluation/CRICKET-EXPERIENCE-SUCCESS-METRIC.md](evaluation/CRICKET-EXPERIENCE-SUCCESS-METRIC.md) | Supplemental method for measuring cricket experience and product success (does not amend the locked rubrics). | Active |
| [ui-baselines/README.md](ui-baselines/README.md) | The versioned, immutable UI baselines and the re-score rule. | Active |
| [ui-baselines/38924bd-05f72561424b.md](ui-baselines/38924bd-05f72561424b.md) | The evaluator's UI-only baseline for build `38924bd+05f72561424b`. | Historical |

### Capture and comparison (`evaluation/capture-compare/`)

Stage 1 measurement foundation: binds a recording to its source, renderer, environment and method, and measures only what
the evidence can establish.

| File | Purpose | Status |
| --- | --- | --- |
| [README.md](evaluation/capture-compare/README.md) | The runner: lanes, evidence classes, what it measures and what it refuses to claim. | Active |
| [manifest.schema.json](evaluation/capture-compare/manifest.schema.json), [metrics.schema.json](evaluation/capture-compare/metrics.schema.json), [metrics-receipt.schema.json](evaluation/capture-compare/metrics-receipt.schema.json) | JSON schemas for a capture manifest, its measurements and the provenance receipt. | Active |
| [registration.v1.json](evaluation/capture-compare/registration.v1.json), [registration.v2.json](evaluation/capture-compare/registration.v2.json), [registration.v3.json](evaluation/capture-compare/registration.v3.json) | Scenario classes and matching rules registered before any comparison (v3 is current; v1 and v2 are kept). | Active |
| [sources.json](evaluation/capture-compare/sources.json) | Public reference sources and the policy for using them (links and notes only; no downloads). | Active |
| [visual-method.v1.json](evaluation/capture-compare/visual-method.v1.json) | The frozen contract for counting artifact and text-legibility defects. | Active |
| [unity-export-trust.v1.json](evaluation/capture-compare/unity-export-trust.v1.json) | The trusted-exporter key policy for Unity WebGL capture (no key provisioned). | Active |
| [INDEPENDENT-AUDIT-2026-10-29.md](evaluation/capture-compare/reviews/INDEPENDENT-AUDIT-2026-10-29.md), [independent-audit-2026-10-29.json](evaluation/capture-compare/reviews/independent-audit-2026-10-29.json), [adversarial-audit.mjs](evaluation/capture-compare/reviews/adversarial-audit.mjs), [adversarial-results-2026-10-29.json](evaluation/capture-compare/reviews/adversarial-results-2026-10-29.json) | The independent audit of the foundation (verdict NOT PASSED), its adversarial script and results. | Historical |
| [INDEPENDENT-RETEST-2026-10-29.md](evaluation/capture-compare/reviews/retest/INDEPENDENT-RETEST-2026-10-29.md), [independent-retest-2026-10-29.json](evaluation/capture-compare/reviews/retest/independent-retest-2026-10-29.json), [retest.mjs](evaluation/capture-compare/reviews/retest/retest.mjs) | The first independent retest (NOT PASSED). | Historical |
| [INDEPENDENT-RETEST-V2-2026-10-29.md](evaluation/capture-compare/reviews/retest-v2/INDEPENDENT-RETEST-V2-2026-10-29.md), [independent-retest-v2-2026-10-29.json](evaluation/capture-compare/reviews/retest-v2/independent-retest-v2-2026-10-29.json), [retest-v2.mjs](evaluation/capture-compare/reviews/retest-v2/retest-v2.mjs) | The second independent retest (NOT PASSED). | Historical |
| [independent-retest-v3.mjs](evaluation/capture-compare/reviews/retest-v3/independent-retest-v3.mjs), [replay-v3.mjs](evaluation/capture-compare/reviews/retest-v3/replay-v3.mjs) | The read-only v3 replay scripts (`npm run eval:capture:replay-v3` runs `replay-v3.mjs`). | Historical |

### Gate A (`evaluation/gate-a/`)

Gate A is the visual-direction and asset-feasibility gate for the Unity production art. Every document here says Gate A is
not passed. Files under this folder that are not tracked belong to another tool and are not indexed.

| File | Purpose | Status |
| --- | --- | --- |
| [README.md](evaluation/gate-a/visual-direction/v1/README.md), [target.v1.json](evaluation/gate-a/visual-direction/v1/target.v1.json), [index.html](evaluation/gate-a/visual-direction/v1/index.html), [capture.mjs](evaluation/gate-a/visual-direction/v1/capture.mjs), [validate.mjs](evaluation/gate-a/visual-direction/v1/validate.mjs) | The v1 visual-direction reference (a picture of a target, not gameplay) and the scripts that render and validate it. | Active |
| [ACTIVE-TARGET-V2-ADDENDUM.md](evaluation/gate-a/visual-direction/ACTIVE-TARGET-V2-ADDENDUM.md), [active-target.v2.json](evaluation/gate-a/visual-direction/active-target.v2.json), [validate-active-target.mjs](evaluation/gate-a/visual-direction/validate-active-target.mjs) | The v2 static-direction candidate, pending owner approval, and its validator. | Active |
| [acquisition/PRODUCTION-ASSET-FEASIBILITY-AUDIT.md](evaluation/gate-a/acquisition/PRODUCTION-ASSET-FEASIBILITY-AUDIT.md) | Independent source, licence and feasibility audit of production assets (not a purchase or a legal opinion). | Active |
| [acquisition/ACTIVE-V2-ASSET-FEASIBILITY-ADDENDUM.md](evaluation/gate-a/acquisition/ACTIVE-V2-ASSET-FEASIBILITY-ADDENDUM.md) | Asset feasibility for the v2 direction: unresolved. | Active |
| [golden-screen/README.md](evaluation/gate-a/golden-screen/README.md), [golden-screen/ASSET-IMPLEMENTATION-MAP.md](evaluation/gate-a/golden-screen/ASSET-IMPLEMENTATION-MAP.md) | The golden live-delivery prototype and the map from visible assets to their implementations. | Active |
| [README.md](evaluation/gate-a/independent-provisional/README.md), [GATE-A-PROVISIONAL-RUBRIC.md](evaluation/gate-a/independent-provisional/GATE-A-PROVISIONAL-RUBRIC.md), [CURRENT-TARGET-COMPARISON-TEMPLATE.md](evaluation/gate-a/independent-provisional/CURRENT-TARGET-COMPARISON-TEMPLATE.md), [EVIDENCE.json](evaluation/gate-a/independent-provisional/EVIDENCE.json) | The independent provisional review, its rubric, an empty comparison template and the evidence record. | Active |

## Assets and licences

| File | Purpose | Status |
| --- | --- | --- |
| [ASSET_REGISTER.md](ASSET_REGISTER.md) | Every visual and audio asset Practice uses: source, cost, checksum, rights review and acceptance. | Active |
| [licenses/makehuman-v1.3.0/README.md](licenses/makehuman-v1.3.0/README.md) | Provenance of the MakeHuman v1.3.0 CC0 anatomy source (immutable upstream identity). | Active |
| [licenses/makehuman-v1.3.0/LICENSE.md](licenses/makehuman-v1.3.0/LICENSE.md), [LICENSE.ASSETS.md](licenses/makehuman-v1.3.0/LICENSE.ASSETS.md) | Verbatim, checksum-pinned upstream licence texts. Do not edit: the unresolved link to `LICENSE.CODE.md` inside `LICENSE.md` is upstream's. | Active |
| [SYSTEM-ASSET-SKIN-SNAPSHOT.md](licenses/makehuman-v1.3.0/SYSTEM-ASSET-SKIN-SNAPSHOT.md), [production-human-provenance.json](licenses/makehuman-v1.3.0/production-human-provenance.json) | The record of the single CC0 skin albedo, and the provenance manifest of the generated human meshes. | Active |
| [licenses/meshoptimizer-1.1.1/README.md](licenses/meshoptimizer-1.1.1/README.md), [LICENSE.md](licenses/meshoptimizer-1.1.1/LICENSE.md) | Build-tool provenance and licence for the offline mesh simplifier (not shipped). | Active |
| [licenses/nrgs-lp-cricket/ACQUISITION-AND-REVIEW.md](licenses/nrgs-lp-cricket/ACQUISITION-AND-REVIEW.md) | A third-party model pack acquired for review and rejected for shipping. | Historical |
| [hero-bundle-provenance.json](licenses/vande-production-hero/hero-bundle-provenance.json) | Provenance manifest of the production hero bundle. | Active |
| [vande-production-typography-provenance.json](licenses/fonts/vande-production-typography-provenance.json) | Provenance manifest of the production typography. | Active |

`public/third-party-notices.txt` (generated by `npm run notices`) is the shipped notice file; the register above and this
folder are its sources.

## Legacy product: Sealed Six (retained, closed)

The asynchronous duel game, its rules engine and its backend remain in `src/engine`, `src/social`, `backend/` and
`render-service/`, with tests. They are not the Stage 1 launch.

| File | Purpose | Status |
| --- | --- | --- |
| [GAME_RULES.md](GAME_RULES.md) | Sealed Six rules, engine v1 (frozen by a golden replay fixture). | Legacy |
| [INFRASTRUCTURE.md](INFRASTRUCTURE.md) | Cloudflare Worker, Durable Objects, D1, R2, Queues, the render job and the activation steps. Nothing is deployed. | Legacy |
| [COST_MODEL.md](COST_MODEL.md) | Estimated monthly cost of the backend (targets and ceilings). | Legacy |
| [SECURITY.md](SECURITY.md) | The backend security model: sealing, sessions, consent races, deletion and the review findings. | Legacy |
| [PRIVACY_AND_CONSENT.md](PRIVACY_AND_CONSENT.md) | What the backend and client store for the social product, retention, export and deletion. Not legal advice. | Legacy |
| [ANALYTICS.md](ANALYTICS.md) | The closed analytics event dictionary of the social product. | Legacy |
| [YOUTUBE_OPERATIONS.md](YOUTUBE_OPERATIONS.md) | Daily Top 100 highlight Shorts: quota, OAuth setup and operations (mock adapter only). | Legacy |
| [STORE_LISTING.md](STORE_LISTING.md) | Draft Play Console copy for "VANDE Cricket: Sealed Six". It must be rewritten for the Practice launch before any submission. | Legacy |

## Closed stages (`growth/`)

The growth architecture for Stages 4 to 6 (asynchronous competition, daily ritual, social growth). Design only: the owner's
sequence keeps these stages closed, and every file opens with a banner that says so.

| File | Purpose | Status |
| --- | --- | --- |
| [growth/README.md](growth/README.md) | The physics Sealed Over and what follows it; the owner decisions O1 to O9. | Closed-stage |
| [growth/BUILD_PLAN.md](growth/BUILD_PLAN.md) | Phases, agents, tests and the definition of done for the growth stages. | Closed-stage |
| [growth/CONTRACTS.md](growth/CONTRACTS.md) | Proposed TypeScript contracts for challenges. | Closed-stage |
| [growth/BACKEND.md](growth/BACKEND.md) | Data model, API, operations, retention, deletion and costs. | Closed-stage |
| [growth/LIFECYCLE.md](growth/LIFECYCLE.md) | State machines and reveal rules. | Closed-stage |
| [growth/LINKS.md](growth/LINKS.md) | Links, App Links, the web fallback and sharing. | Closed-stage |
| [growth/MIGRATION.md](growth/MIGRATION.md) | Migration from the bowling-plan Sealed Six to the physics Sealed Over. | Closed-stage |
| [growth/NOTIFICATIONS.md](growth/NOTIFICATIONS.md) | The notification principles and their stage placement. | Closed-stage |
| [growth/ANALYTICS.md](growth/ANALYTICS.md) | Taxonomy, funnels, dashboards and validation gates. | Closed-stage |
| [growth/VERIFICATION.md](growth/VERIFICATION.md) | Determinism, re-simulation, anti-cheat and CPU limits. | Closed-stage |

## Briefs and prompts (`prompts/`)

The briefs the owner and the lead gave to agents. The constitution above outranks them (order of authority:
[VANDE-PRODUCT-SEQUENCE.md](VANDE-PRODUCT-SEQUENCE.md)). Do not edit them without the lead.

| File | Purpose | Status |
| --- | --- | --- |
| [VANDE-PRODUCT-SEQUENCE-BRIEF.md](prompts/VANDE-PRODUCT-SEQUENCE-BRIEF.md) | The brief that locked the six-stage sequence. | Active |
| [VANDE-GAME-DIRECTOR-BRIEF.md](prompts/VANDE-GAME-DIRECTOR-BRIEF.md) | The brief behind the ten experience laws. | Active |
| [VANDE-INTERFACE-ASSET-CONSTITUTION.md](prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md) | The interface and asset constitution (also listed above). | Active |
| [VANDE-PRACTICE-NORTHSTAR.md](prompts/VANDE-PRACTICE-NORTHSTAR.md) | The Practice North Star: first-person cricket, Coach Mode, mastery. | Active |
| [VANDE-PRACTICE-WEDGE-PROMPT.md](prompts/VANDE-PRACTICE-WEDGE-PROMPT.md) | The current wedge brief: get one shot right through exact-ball retry and coaching that provably works. | Active |
| [VANDE-COVER-DRIVE-PROMPT.md](prompts/VANDE-COVER-DRIVE-PROMPT.md) | The cover-drive reference slice, the detailed batter spec. | Active |
| [VANDE-STAGE-1-WOW-EVIDENCE-MASTER-PROMPT.md](prompts/VANDE-STAGE-1-WOW-EVIDENCE-MASTER-PROMPT.md) | The whole Stage 1 product and its evidence system. | Active |
| [VANDE-DUAL-CEILING-BRIEF.md](prompts/VANDE-DUAL-CEILING-BRIEF.md) | The brief for the dual-ceiling (New Player X and Expert Player X) rubric. | Active |
| [VANDE-RELEASE-DIRECTOR-BRIEF.md](prompts/VANDE-RELEASE-DIRECTOR-BRIEF.md) | The release director and evidence authority brief. | Active |
| [VANDE-PRACTICE-PRODUCTION-BRIEF.md](prompts/VANDE-PRACTICE-PRODUCTION-BRIEF.md) | The earlier brief for a production-quality Practice experience. | Historical |
| [VANDE-PRACTICE-PROMPT.md](prompts/VANDE-PRACTICE-PROMPT.md) | The owner's original Practice brief of 2026-10-25, which the Practice contract follows. | Historical |
| [VANDE-CRICKET-PROMPT.md](prompts/VANDE-CRICKET-PROMPT.md) | The rebuild brief for the Sealed Six product. | Historical |
| [VANDE-GROWTH-BRIEF.md](prompts/VANDE-GROWTH-BRIEF.md) | The growth brief that led to `growth/`. | Closed-stage |
