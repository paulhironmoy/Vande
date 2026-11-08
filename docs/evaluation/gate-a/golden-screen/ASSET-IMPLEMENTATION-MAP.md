# Gate-A visible asset-to-implementation map

Status: **production acquisition unresolved; no purchase request**

The photoreal direction is feasible as a conventional mobile Unity scene, but the repository does not contain the
source production humans, rigs, mocap or recorded cricket audio needed to realize it. Current code-built rigs,
procedural props/world geometry and synthesized sounds are valuable engineering references and fallbacks; they are
not relabelled as final art.

No candidate marketplace/vendor source, price or licence has been verified from a primary vendor page in this work.
Accordingly this document does not invent a product, price or commercial-use right. Acquisition remains unresolved.

The byte figures below are **planning ceilings for the first import experiment**, not measurements or promises. A
candidate is rejected or reduced if its actual Android delivery cost exceeds the allocation or threatens the binding
50,000,000-byte fresh-installed and 90% India-working-reach goals.

| Visible target | Existing reusable truth/reference | Required production implementation | Rig/material/animation contract | Mobile plan | First-import planning ceiling | Current status |
| --- | --- | --- | --- | --- | --- | --- |
| Batter body and original face | Camera/scale and body timing in `ProceduralPracticeWorld`; code rig in `ProductionCharacterRig` | Original fictional adult mesh, face, hair and skin; no likeness, team or sponsor | Humanoid rig, hands/fingers, eye focus, facial effort; planted stance and weight transfer; release/contact markers | 3 LODs; body/face atlases; one skeleton shared with field roles | 850 kB compressed / 8 MB runtime | `REQUIRED_MISSING` |
| Batter kit and protection | Existing dimensions and palette | Original jersey/trousers, helmet/grille, gloves, pads, guards and shoes | Skinned cloth/gear, hand IK, no clipping through bat/body | Shared 1K atlases with 512 low tier; simplified grille at LOD2 | 650 kB / 6 MB | `REQUIRED_MISSING` |
| Bat | Law-scale procedural prop and current willow texture | Law-scale authored bat with willow grain, edges, toe, grip, restrained original decal and wear | Grip sockets and canonical grip/toe/face markers | 3 LODs; 512 atlas | 120 kB / 1 MB | `REFERENCE_ONLY` |
| Bowler body/face/kit | Current pace/spin timing and release-hand alignment contract | Original fictional pace bowler, distinct from batter, with readable hand/wrist/face | Shared skeleton where safe; bowler-specific hand and release markers; run, gather, plant, release, follow-through | 3 LODs; reuse skin/cloth shader variants | 750 kB / 7 MB | `REQUIRED_MISSING` |
| Bowling motion | `ProductionCharacterMotionSampler` timing and host-derived cue policy | Mocap-quality or hand-authored pace action with root motion removed and authoritative release alignment | Foot plant, pelvis/torso transfer, shoulder/elbow/wrist chain, follow-through; no line/length leakage | Compressed clips; bone culling by tier | 300 kB / 2 MB | `REQUIRED_MISSING` |
| Batter motion | Existing canonical bat reconciliation and footwork enums | Stance, backlift, defence, drive, cut, pull, flick, loft, leave, miss and recovery | Continuous blends, hand IK, canonical bat within 3 cm/5°, no foot slide | Compressed clips, additive aim, shared base poses | 420 kB / 3 MB | `REQUIRED_MISSING` |
| Keeper and nine non-bowler fielders | Canonical stable IDs/coordinates and existing consequence hooks | Original keeper gear and mobile human LODs; role-specific field poses | Keeper crouch/collect/catch; fielder stand/run/dive/pickup/throw; no teleport | Shared human mesh/rig/material, instanced far LOD | 600 kB / 6 MB | `REQUIRED_MISSING` |
| Umpire | Role/position requirement in asset constitution | Original neutral official and restrained idle | Stand, observe and outcome signals needed by exposed rules | Shared human shader and skeleton where possible | 180 kB / 1.5 MB | `REQUIRED_MISSING` |
| White ball | Existing law scale, seam/shine orientation and readability contract | Authored leather/seam geometry or normal map with maintained/rough response | Rotation and polished pole consume authoritative trace only | 256 texture set; simple high/low meshes | 80 kB / 0.5 MB | `REFERENCE_ONLY` |
| Stumps and bails | Current law-scale separated procedural pieces | Authored wood/finish, separate bails and impact-ready pivots | Authoritative impact only; no generic explosion | 2 LODs; 256–512 atlas | 80 kB / 0.5 MB | `REFERENCE_ONLY` |
| Balanced pitch and creases | Existing dimensions, physics metadata and original generated texture | Tiled soil/grass/wear/footmark set tied to balanced physics | No visual bounce/surface contradiction | ETC2/ASTC variants; 1K max; vertex blending | 300 kB / 3 MB | `REFERENCE_ONLY` |
| Outfield, mowing and boundary | Existing field scale and canonical fielder coordinates | Tiled outfield material, mowing bands, rope/cushion | Ball roll remains authoritative; presentation adds no collider | Tiling textures, baked far detail | 220 kB / 2 MB | `REFERENCE_ONLY` |
| Stadium and sight screen | Existing scale, screen/stand/floodlight layout intent | Original fictional compact Indian stadium, pavilion, aisles, rails, screen and lights | Static/baked geometry; screen protects white-ball contrast | Modular meshes, baked lighting, 3 LOD groups | 650 kB / 7 MB | `REQUIRED_MISSING` |
| Crowd | Existing deterministic emotion observer | Original low-detail diverse spectator library with grouped state changes | Anticipation still; outcome reaction only after physical fact | GPU instancing; 8–12 base variants; impostor/culled low tier | 280 kB / 3 MB | `REQUIRED_MISSING` |
| Lighting/sky/atmosphere | Current 58° camera, late-afternoon panorama and lighting rules | Neutral evening sky, floodlight probes, grounded shadow/exposure setup | Stable exposure; no bloom/DOF/motion blur hiding ball | Baked ambient, restricted shaders/variants | 260 kB / 2 MB | `REFERENCE_ONLY` |
| Quiet HUD and field PIP | New exact layout and canonical field projection reference | Shared React/Unity tokens, production font, icons and accessible equivalents | Freeze during approach; pause only; PIP consumes canonical IDs | Subset Indic-capable font strategy; vector/atlas icons | 180 kB / 2 MB | `REQUIRED_MISSING` for typeface; layout implemented |

Planning sum: approximately **5.9 MB compressed** and **54.5 MB runtime memory** if every ceiling were spent. That
compressed sum is already unsafe relative to the old preview artifact's non-binding margin, and the runtime-memory
sum excludes Unity/WebView, render targets and transient allocations. The import experiment therefore needs shared
atlases/rigs, lower measured texture cost and rejection of any nonessential unique asset. It is not authorized to
ship merely because it fits this table.

## Visible-frame implementation mapping

- Rear-shoulder camera: existing law-scale transform and 58-degree horizontal FOV; final framing must be recaptured
  at every locked aspect and left-handed mirror.
- Batter: production prefab at striker position with the camera outside the body and the full silhouette visible.
- Bowler: production rig driven to an approach pose whose release hand later aligns to `Flight[0].p`.
- Keeper: remains physically authoritative behind the striker but is excluded from this live camera when standing
  up would obstruct the corridor.
- Field PIP: exactly 11 defending IDs (`keeper`, `bowler`, and
  `fielder-01` through `fielder-09`) share coordinates with their world facts.
  The separate `batter` marker is never counted as a defender. Orientation is
  bowler-end top, striker-end bottom, and only `bowler` carries the active
  highlight.
- Ball: current frame shows it only where physically plausible; the target image cannot prove 3 px/3:1 readability.
- HUD: deterministic top-left rail, top-right field PIP and pause; score/field facts must come from the host in the
  production adapter, not the prototype strings.
- Evidence overlays: safe area, HUD bounds, protected corridor and lower touch surface exist only in evaluator mode.

## Consolidated acquisition decision

No paid-asset approval is requested yet because there is no verified candidate source, price or licence. The next
owner decision is whether to authorize a bounded sourcing/commissioning round for:

1. one original shared mobile cricket-human family (batter, bowler, keeper, fielder, umpire) with facial/gear LODs;
2. one original cricket equipment/pitch/stadium set;
3. batting, bowling, keeping and fielding motion with redistribution rights; and
4. the authentic recorded transient session defined in `docs/UNITY_ASSET_AUDIO_READINESS.md`.

Free fallback: retain the existing procedural/code-built world. Trade-off: it remains an engineering fallback and
does not meet the approved photoreal artifact/embodiment direction. Creating all production assets in-house avoids a
marketplace purchase but still needs named creators, source files, likeness review, licences/releases, technical-art
time and the same independent acceptance gates.

Before any purchase request, the root owner should bring one primary-source shortlist with exact price, archived
licence terms, modification/compiled-distribution rights, source checksums, expected measured import cost and a free
alternative. No agent may purchase or accept terms.
