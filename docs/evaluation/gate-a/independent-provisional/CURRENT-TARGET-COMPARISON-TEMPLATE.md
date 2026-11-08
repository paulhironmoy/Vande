# Gate-A exact current versus target comparison

Status: **TEMPLATE — NOT YET EVIDENCE**  
Gate-A verdict until every required field is bound: **NOT PASSED**

Active static-direction candidate: [v2 selection addendum](../visual-direction/ACTIVE-TARGET-V2-ADDENDUM.md), status
`STATIC_DIRECTION_CANDIDATE_PENDING_CURRENT_CAPTURE_ASSET_FEASIBILITY_AND_OWNER_APPROVAL`.
This selection does not rewrite the historical v1 review or record owner approval.

This template must be completed only after the source is frozen and an exact-current Android artifact is installed
on an evaluator-owned emulator or physical device without altering another agent's process or app data.

## Provenance binding

| Field | Exact current Android | Golden target |
| --- | --- | --- |
| Source/build ID | **MISSING** | no runtime build ID; frozen 13-file package in `docs/evaluation/gate-a/visual-direction/active-target.v2.json` |
| Artifact path | **MISSING** | `docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-844x390.png` |
| Artifact SHA-256 | **MISSING** | `f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9` |
| APK/AAB SHA-256 | **MISSING** | not applicable to HTML direction; accepted runtime artifact **MISSING** |
| Capture UTC | **MISSING** | `2026-10-29T04:32:24Z` |
| Device / API / ABI / GPU | **MISSING** | HTML exact-viewport reference only |
| Logical viewport / physical pixels / safe area | **MISSING** | 844x390 / 844x390 / full static viewport |
| Handedness | **MISSING** | `right` |
| Horizontal FOV | **MISSING** | `58°` |
| Renderer marker | **MISSING** | static HTML; not a renderer claim |
| Admission state/reason | **MISSING** | not applicable |
| Gameplay state and canonical ball identity | **MISSING** | frozen approach pose; no gameplay identity |
| README and capture contract | **MISSING** | `docs/evaluation/gate-a/visual-direction/v1/README.md`; `docs/evaluation/gate-a/visual-direction/v1/capture.mjs` (`d0939a4d…4191`), local headless Chromium, exclusive hard-link/no-overwrite |
| Host uptime/load | **MISSING** | **NOT RECORDED for the static capture** |

Do not continue the visual comparison if current source ID, installed build ID or renderer identity differs. Preserve
the failed manifest and return **NOT COMPARABLE**.

## Side-by-side

| Exact current-source Android | Exact target direction |
| --- | --- |
| **INSERT immutable screenshot link only after identity checks pass** | [Golden target v2](../visual-direction/v1/golden-screen-v2-844x390.png) |

After the exact-current first-ball receipt passes, create the comparison with the tracked fail-closed tool:

```bash
npm run eval:gate-a:still -- \
  --current-image "$GATE_A_DIR/live-frame.png" \
  --current-evidence "$GATE_A_DIR/first-playable-ball.json" \
  --target-image docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-844x390.png \
  --expected-target-sha256 f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9 \
  --expected-build-id "$BUILD_ID" \
  --output-dir "$EVIDENCE_DIR/current-target-still"
```

The tool emits both an unscaled native-pixel composition and a separately labelled `fit=contain` normalized view,
plus a hash-bound manifest. It reuses the canonical Android live-bracket and first-ball-transition validators and
refuses a rejected harness, any crash/WebView/native error, the wrong exact engineering-preview admission,
non-Unity or non-live state, an arbitrary delivery, a mismatched build/device/artifact/image identity, or an unstable
dead-ball boundary. It also replays the three complete H7 verifier objects, their six receipt-bound admission/bracket
files and the install start/completion bindings through the frozen Android validator; a top-level success label or
reduced digest is insufficient. Both PNGs are decoded before the output directory is created. Its target classification remains
`STATIC_GOLDEN_DIRECTION_NOT_RUNTIME`; the output is directional Gate-A evidence and cannot become a runtime,
player, performance, size, reach, CERI or release claim.

`DIRECTIONAL_COMPARISON_READY_NOT_GATE_PASS` is emitted only when receipt-bound current and target physical pixels
match exactly, the current logical CSS viewport also matches the target dimensions exactly, the attested device pixel
ratio is exactly `1`, the image matches the current receipt's authoritative native geometry, the current receipt
explicitly attests the same handedness as the target, and full H7 replay passes. A physical viewport, logical viewport,
device-pixel-ratio or handedness mismatch emits `DIRECTIONAL_COMPARISON_NOT_COMPARABLE_NOT_GATE_PASS`. Missing or
contradictory current viewport/native geometry or handedness rejects the receipt entirely; a normalized image never
repairs comparability. In particular, a 844x390 physical screenshot produced from a 422x195 logical viewport at DPR 2
is not comparable to the 844x390/DPR-1 target.

The current frame must show the same Stage-1 state: rear-shoulder approach, full bowler, right-handed batter, quiet
HUD, score, conditions and field PIP at exact 844x390 physical pixels, exact 844x390 logical CSS pixels and DPR 1.
If phase, physical or logical viewport, DPR or handedness differs, label the row **NOT COMPARABLE** rather than
claiming an improvement.

## Matched review rows

| Criterion | Current observation | Target observation | Result | Evidence limitation |
| --- | --- | --- | --- | --- |
| Rear-shoulder composition | **MISSING** | directional composition visible | **NOT COMPARABLE** | current exact frame absent |
| Full bowler and embodied batter | **MISSING** | visible in static reference | **NOT COMPARABLE** | no target motion/rig proof |
| Release-to-contact corridor | **MISSING** | corrected static annotation leaves corridor clear | **NOT COMPARABLE** | no normal-speed trace |
| Score/conditions/PIP/pause hierarchy | **MISSING** | corrected static target passes directional layout review | **NOT COMPARABLE** | accepted runtime remains absent |
| Human anatomy, gear and artifact detail | **MISSING** | credible static direction | **NOT COMPARABLE** | target assets not runtime-bound |
| Pitch/field/stadium/crowd | **MISSING** | credible static direction | **NOT COMPARABLE** | animation/performance unscored |
| Ball size and local contrast | **MISSING** | **NOT SCORED** | **NOT COMPARABLE** | requires sampled delivery frames |
| HUD occupancy and touch surface | **MISSING** | nominal 5.8% and 46% in overlay | **NOT COMPARABLE** | needs runtime safe-area capture |
| Typeface, locale and 200% text | **MISSING** | **MISSING** | **NOT COMPARABLE** | production typeface unresolved |
| Left-handed mirror | **MISSING** | **MISSING** | **NOT COMPARABLE** | separate matched capture required |
| Installed-size/runtime-memory impact | **MISSING** | **UNPROVEN** | **NOT COMPARABLE** | target is not an Android artifact |

## Independent closure checklist

- [ ] One stable build ID is recorded before and after the capture.
- [ ] Installed APK identity and hash match the frozen source artifact.
- [ ] Renderer is observed as `unity-native`, not inferred from a canvas or request flag.
- [ ] Admission state/reason and quality tier are recorded.
- [ ] The frame is normal player flow, not a staged diagnostic disguised as gameplay.
- [ ] Current and target are phase/handedness/physical-viewport/logical-viewport/DPR matched or explicitly marked not comparable.
- [x] The target PIP defect is independently reproduced as corrected in the 844x390 normal/evidence captures.
- [x] Normal and evidence-overlay target PNG hashes are final and documented.
- [ ] Production asset candidates have verified source/licence and measured import reports.
- [ ] No physical-device, player, CERI, size or reach claim is inferred from emulator/static evidence.

Until all applicable boxes are checked, the exact verdict remains **NOT PASSED**.
