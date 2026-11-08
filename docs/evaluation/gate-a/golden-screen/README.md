# Gate-A golden live-delivery prototype

Status: **runnable composition prototype; Gate A not passed**  
Prototype source: `unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/`  
Focused compile/test observation: 2026-10-29T04:38:34Z, Unity 6000.3.27f1,
13/13 passed  
Host load observed immediately afterward: 48.04 / 55.63 / 51.64; functional
result only, with no timing or performance claim  
Whole-tree identity observed at 2026-10-29T04:39:22Z:
`38924bd+c011e1724510`; subsystem file hashes are the stable handoff identity

This isolated component establishes one measurable live-delivery direction without changing the current runtime,
bridge, scene, package configuration or renderer selection. It does not score, predict or replay a ball. TypeScript
remains the only gameplay authority.

## What runs

`GoldenScreenPrototype` has three explicit backdrops:

1. `ExternalVisualDirectionReference` composites a caller-supplied review texture with the exact quiet HUD. The
   repository reference remains outside Unity player assets and therefore contributes zero player-build texture
   bytes. It is labelled `VISUAL DIRECTION · NOT LIVE GAMEPLAY` by default.
2. `CurrentUnityEngineeringWorld` constructs the existing Unity world, places the existing 58-degree rear-shoulder
   camera at a frozen mid-run-up pose and adds the exact quiet HUD. It is labelled
   `CURRENT PROCEDURAL ART · NOT GATE-A TARGET` by default.
3. `AcceptedProductionBindings` instantiates a supplied batter, bowler, keeper, fielder, umpire, pitch/outfield,
   stadium and cricket-props set at the target composition. It fails closed behind a readiness panel unless every
   required group has accepted provenance, a licence record, mobile LODs and measured import cost.

The component is opt-in. Nothing auto-installs it into the shipping bridge. A review scene may create it with:

```csharp
var prototype = GoldenScreenPrototype.Create(
    GoldenScreenBackdrop.CurrentUnityEngineeringWorld);
prototype.SetEvidenceOverlay(true);
```

An editor review tool may pass the visual-direction texture as the third argument. Do not copy the 2.88 MB reference
PNG into a runtime `Resources` or `StreamingAssets` path merely to make the review easier.

## Exact live screen

The canonical review viewport is 844×390. The same deterministic layout is asserted at 640×360, 844×390, 915×412,
1280×800 and 1920×1080.

Visible during the approach:

- top-left score/wickets, over.ball and six-ball strip;
- a quiet pitch, ball, bowler and assistance cue below the score;
- a canonical PIP at top-right, oriented bowler-end top and striker-end bottom;
- exactly 11 defending markers: `keeper`, `bowler` and `fielder-01` through
  `fielder-09`; the `batter` marker is separate and never counted as a defender;
- only the stable `bowler` identity receives the active-bowler highlight;
- a density-correct 48 dp pause target;
- the cricket world, with no result, coaching, reward, progression, notification, shot-button bank or technical
  label;
- no touch guide once the approach has begun.

The reference layout occupies about 5.8% of the safe area, below the 8% constitutional ceiling. HUD regions are
outside the measured release-to-contact corridor. The lower 46% remains the invisible shot surface. Safe area, HUD
bounds, touch region and delivery corridor appear only when the evidence overlay is enabled.

## Visual reference

The optional reference is
`docs/evaluation/gate-a/visual-direction/v1/photoreal-live-scene-v1.png`:

- 1672×941;
- 2,877,947 source bytes;
- SHA-256 `7ad65fcbfa2574ff04964bbddc5010d62bdc89b49595aa954a7ce448f5336b22`;
- AI-assisted original reference, not a Unity render or accepted player-facing asset;
- no runtime/build-byte contribution unless someone later imports it, which this prototype deliberately does not.

The compositor uses an aspect-fill crop without distortion. Its one canonical
anchor is `(0.5, 1.0)` in top-left normalized coordinates: centre-bottom. For
source aspect `S` and destination aspect `D`, a horizontal crop has
`shownWidth = D/S` and `x = (1-shownWidth) × 0.5`; a vertical crop has
`shownHeight = S/D`, top-left `y = (1-shownHeight) × 1`, and Unity UV
`y = (1-shownHeight) × (1-1) = 0`. HTML uses
`object-fit: cover; object-position: 50% 100%`. The runtime target is the
mapped 58-degree-horizontal-FOV 3D composition, not the bitmap.

## Validation result and limits

The current deterministic source/artifact validator passed at
2026-10-29T04:35Z:

```text
GATE_A_GOLDEN_TARGET_OK markers=12 defence=11 fov=58 hud=5.846% artifacts=7
```

It checks that `target.v1.json`, HTML and Unity sources agree on the PIP IDs,
roles, coordinates and highlight; the 58-degree horizontal FOV; the crop
formula and anchor; exact HUD, touch and corridor geometry; and exact PNG
dimensions, bytes and SHA-256.

The updated focused Unity EditMode set passed 13/13 at
2026-10-29T04:38:34Z. The result was written to
`/private/tmp/vande-golden-consistency-20261029T0441Z.xml`; that temporary host
path is not durable release evidence. The source tests cover:

- the 8% quiet-HUD limit and corridor separation;
- every locked landscape viewport and a physical-pixel safe-area case;
- 48 dp pause sizing;
- the 46% shot region;
- distortion-free centre-bottom reference cropping;
- exact canonical PIP IDs, roles, coordinates and active-bowler identity;
- equality with the current runtime's 58-degree horizontal FOV;
- exact reference HUD, touch and corridor geometry;
- fail-closed production-asset admission and measured-cost summation.

This is builder evidence only. It is not an independent visual score, Android artifact result, physical-device
result, player result or Gate-A approval. It has not produced a same-build Android screenshot. The review compositor
uses IMGUI and the fallback font when no accepted typeface is bound; those are prototype mechanics, not the proposed
shipping typography implementation.

## Size and compatibility

- Current C# plus focused test source: 66,057 source bytes. This is a source
  count, not a build or installed-size measurement.
- New imported runtime textures/models/audio: zero.
- Reference PNG included in Unity/Android: no.
- Android APK/AAB/fresh-installed delta: **UNMEASURED**.
- India-weighted reach delta: **UNPROVEN**.

The prior sealed Unity-preview APK was 43,584,653 bytes, only 6,415,347 artifact bytes below the 50,000,000-byte
number. That is not current-source or installed-size evidence. Production assets cannot spend that apparent margin
without a fresh AAB, Play-split, first-playable installed-footprint and affected-cohort run.

## Integration handoff

After the owner approves the exact direction and production assets are acquired:

1. import each asset through the canonical asset register and quarantine workflow;
2. fill `GoldenScreenAssetBindings` and one accepted `GoldenScreenAssetApproval` for every required ID;
3. measure actual compressed and runtime-memory cost; estimates do not satisfy the readiness gate;
4. make a root-owned bridge adapter feed canonical scene/field/score facts into a production UI implementation;
5. replace the review-only IMGUI layer with the shared accessible design-token and typography path;
6. bind real rig markers to the authoritative release hand and bat trace;
7. capture the exact Android candidate at normal speed and compare it with the current Android screen;
8. run independent visual, corridor, artifact, performance, size and compatibility review.

The present smallest blocker is not layout code. It is a provenance-complete mobile character/equipment/stadium
set plus animation and authentic-audio inputs. See [ASSET-IMPLEMENTATION-MAP.md](ASSET-IMPLEMENTATION-MAP.md).
