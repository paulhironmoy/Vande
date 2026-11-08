# Gate-A independent provisional review

Evaluator: `/root/gate_a_independent_review`  
Evaluator independence: did not author the visual reference, exact-viewport compositor, Unity prototype, capture
tooling or asset map; made no source/runtime changes  
Evaluation scope: Gate A only, Stage 1 Practice  
Final review observation: 2026-10-29T01:18:31Z; moving-tree snapshot `38924bd+016337888b55`  
Host load at final observation: 30.92 / 73.15 / 53.11; no timing/performance claim is made  
Status: **NOT PASSED**

This is an evidence review, not a player test and not a Stage-1 or release score. It applies only to the artifacts
listed below. It does not certify controls, ball readability in motion, physics, audio, performance, Android size or
reach, a human reaction, CERI, or superiority to another game.

## Evidence reviewed

| Evidence | Classification | Use in this review |
| --- | --- | --- |
| `docs/prompts/VANDE-STAGE-1-WOW-EVIDENCE-MASTER-PROMPT.md`, Gate A | binding requirement | pass/fail basis |
| `release/gate-a/current-baseline/BASELINE.md` and `EVIDENCE.json` | read-only baseline audit | proves that no exact-current Android screenshot existed at audit close |
| `docs/evaluation/gate-a/visual-direction/v1/photoreal-live-scene-v1.png` | AI-assisted static reference | directional scene/artifact observation only |
| `docs/evaluation/gate-a/visual-direction/v1/golden-screen-844x390.png` | deterministic HTML composition | exact-viewport visual observation only; not gameplay or Unity |
| `docs/evaluation/gate-a/visual-direction/v1/golden-screen-evidence-844x390.png` | deterministic HTML evidence overlay | annotation/layout observation only |
| `docs/evaluation/gate-a/golden-screen/README.md` and `ASSET-IMPLEMENTATION-MAP.md` | builder documentation | feasibility claims checked against source |
| `unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/**` | isolated opt-in review harness | source inspection; not shipping runtime evidence |
| `unity/VandePractice/Assets/VandePractice/Tests/EditMode/GoldenScreen/**` | builder-authored EditMode tests | implementation evidence only; not independent machine rerun |
| `release/practice-android/38924bd-05f72561424b-unity-preview-release-fresh/02-after-first-ball-exact-preview-release.png` | superseded Android engineering preview | historical context only; never treated as current-source evidence |

## Verdict

Gate A is **NOT PASSED**. The proposed scene is a materially stronger directional composition than the superseded
procedural preview, and the isolated code establishes useful fail-closed scaffolding. The initially reviewed field-
radar positioning defect was corrected and independently rechecked in the recaptured 844x390 normal/evidence PNGs;
the rejected captures remain preserved. However, the mandatory exact current-source Android capture and matched
side-by-side are absent; the target is not a production-asset Unity screen; required production assets and licences
are unresolved; and measured import/installed/memory costs do not exist.

The provisional Gate-A evidence score is **5.2/10 (52/100)**. This is a purpose-built Gate-A evidence-closure score,
not one of the locked player, rookie, expert, competitive or CERI scores. Missing mandatory evidence receives zero
or only the documented partial credit shown in `GATE-A-PROVISIONAL-RUBRIC.md`; no numeric score can override a hard
Gate-A requirement.

## Hard requirement matrix

| Gate-A requirement | Status | Evidence and reason |
| --- | --- | --- |
| Exact current-source Android screen | **MISSING** | Baseline audit found only installed build `38924bd+05f72561424b`, not the changing current tree. |
| Exact target gameplay screen | **PARTIAL** | 844x390 HTML composition exists, but it is static reference compositing rather than accepted production Unity gameplay. |
| Rear-shoulder batter, full bowler, protected corridor | **DIRECTIONAL PASS / RUNTIME UNSCORED** | People and camera direction are visible and the corrected static overlay leaves the corridor clear; normal-speed runtime proof is absent. |
| Realistic fictional visible world and equipment | **DIRECTION ONLY** | Static AI-assisted image is credible at a glance, but none of its depicted assets is a bound, licensed runtime asset. |
| Compact scoreboard and field PIP outside corridor | **DIRECTIONAL PASS** | Corrected 844x390 target shows a populated compact PIP and score/pause rail wholly outside the annotated corridor. |
| Minimal touch guidance and coherent language | **PARTIAL** | 48 dp pause and invisible lower touch surface are specified; production typeface, token integration and runtime behavior are missing. |
| Annotated safe area, corridor, HUD and touch regions | **PARTIAL** | Corrected overlay exists at 844x390 and layout tests cover dimensions, but no accepted runtime capture proves the regions. |
| Per-visible-item asset-to-implementation map | **PARTIAL** | Categories, contracts and planning ceilings are documented; verified candidates, source packages, import results and animation/material acceptance evidence are absent. |
| Source/licence status and missing approvals | **FAIL / MISSING** | Reference provenance is stated, but production humans, equipment, motion, ground, stadium, crowd and typeface have no verified source/licence. |
| Compressed/installed estimate and memory/LOD plan | **PARTIAL / UNPROVEN** | Planning ceilings exist; actual Android contribution, installed footprint, runtime memory and tier evidence are unmeasured. |
| Current/target side-by-side | **MISSING** | Historical preview may not substitute for the required current-source Android screenshot. |
| Independent provisional review | **PRESENT** | This review, with the limitations and score above. |
| Owner approval | **NOT RECORDED** | The exact approved target package is not yet complete. |

## Evidence states that remain explicitly unscored

| Claim | Result |
| --- | --- |
| Ball readability in motion, including READ1/READ2 | **NOT SCORED** — no exact normal-speed target delivery |
| Player control, physics or causal coherence | **NOT SCORED** — prototype declares `UsesRuntimeCricketTruth => false` |
| Animation, contact, fielding, crowd and audio quality | **NOT SCORED** — no accepted runtime delivery |
| Premium/Balanced/Classic performance | **NOT SCORED** |
| Fresh-installed-through-first-ball SIZE-50 | **UNPROVEN** |
| India-weighted REACH-90 | **UNPROVEN** |
| Physical-device quality | **UNPROVEN** |
| Rookie, expert or human preference | **NOT SCORED / HUMAN EVIDENCE MISSING** |
| CERI | **NOT SCORED** |
| Better than Cricket League, Real Cricket or WCC3 | **NOT SCORED** |

## Smallest evidence-backed next action

Bind this review to one frozen current-source Android build and exact renderer screenshot using
`CURRENT-TARGET-COMPARISON-TEMPLATE.md`. Production-direction approval must still
wait for a verified source/licence/import shortlist and measured cost envelope for every required visible asset
group.
