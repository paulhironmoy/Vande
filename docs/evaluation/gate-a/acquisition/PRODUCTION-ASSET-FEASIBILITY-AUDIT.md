# Gate A production-asset feasibility and acquisition audit

Status: **independent source/licence/feasibility audit; not a Gate-A pass, purchase, import or legal opinion**  
Audit interval: 2026-10-28/29 UTC  
Repository build ID at evidence capture: `38924bd+2022054ebc22`  
Scope: active Stage 1 Practice only

## 1. Decision in one page

The exact visual direction is artistically implementable, but it is **not yet demonstrated to be production-feasible
under VANDE's 50,000,000-byte fresh-installed ceiling**. Gate A must therefore remain open. The current repository has
good reusable gameplay, camera, field, layout and event contracts, four small generated material candidates, and
licensed web-font foundations. It does not contain production source human models, production cricket animation,
authentic recorded audio, final stadium/crowd art, or Unity font assets.

The inspected golden reference is a valid direction reference, not a shippable asset. It depicts a realistic fictional
right-handed batter from the rear shoulder, a full pace bowler, umpire and fielders, original unbranded equipment,
law-scale wickets and pitch, a night stadium, sight screen, floodlights and a restrained full crowd. That source
reference intentionally has no baked UI. The concurrent visual-direction pass has now produced the exact locked
`844 x 390` static composition with compact scoreboard, corrected field PIP and pause control, plus an evidence
variant showing safe-area, HUD, 46% lower touch surface and protected-corridor bounds. Those artifacts close the
**static composition** gap only; they are not a Unity render, running gameplay or proof that any production asset
exists or fits the Android contract.

Production replacement cannot be achieved by importing any audited broad marketplace pack wholesale:

- the audited Unity character packs are old, non-mocap and lack an evidenced mobile LOD/Unity-6 path;
- the broad animation pack is 355.0 MB at source, does not prove mocap or release markers and includes country uniforms
  that VANDE must not ship;
- the cricket-kit and stadium packs either miss essential items, miss the target realism, lack current pipeline proof,
  or expose a source-package size that is disproportionate to the unmeasured installed budget;
- no generic animation pack proves a cricket-specific planted run-up, hand-connected release, bat/hand contact,
  weight transfer or exact ball-contact marker; and
- a character generator can accelerate original production, but it does not replace a senior character artist,
  retopology, original kit/equipment, mobile LODs, rig cleanup, motion capture cleanup or independent validation.

The defensible visual route is therefore **original custom production**: a CC0 MakeHuman/MPFB core may be used as a
starting point, finished in Blender by a qualified artist, with original fictional identities, kit, equipment,
textures, mobile LODs and a shared rig. Cricket motion must be captured from or authored with a consenting skilled
performer, then cleaned and validated against the canonical VANDE physics events. The artifact itself remains
`REQUIRED_MISSING` until that work exists.

Only one paid media candidate is sufficiently narrow and rights-clear for a consolidated approval request today:
the Sonniss/TheWorkRoom **Cricket** source-recording library. It can cover physical cricket transients, but not a
complete stadium crowd/emotion layer. The request is in section 11. No purchase, download, account creation or terms
acceptance occurred during this audit.

## 2. Evidence identity and method

| Field | Observed |
| --- | --- |
| UTC capture | `2026-10-29T00:31:51Z` to `2026-10-29T00:33:26Z` for local inventory; vendor pages checked 2026-10-28/29 UTC |
| Build ID | `38924bd+2022054ebc22`, from `release/player-experience/tools/build-id.sh` |
| Host | Apple ARM64, macOS 15.7.4 (`24G517`) |
| Load at local evidence capture | 1/5/15 minute load `18.01 / 18.15 / 21.36`; the binding one-minute load was below 20 |
| Device/runtime | Static source and official-vendor-page audit only; no Android or browser candidate was imported or run |
| Target reference | `docs/evaluation/gate-a/visual-direction/v1/photoreal-live-scene-v1.png` |
| Target dimensions / bytes / SHA-256 | `1672 x 941` PNG; `2,877,947` bytes; `7ad65fcbfa2574ff04964bbddc5010d62bdc89b49595aa954a7ce448f5336b22` |
| Locked static composition | `golden-screen-844x390.png`; `844 x 390`; `632,909` bytes; SHA-256 `d75e208a0363a5905937ef795076b4ccabda90d6ab3eb6e43ae1c5d687caaa57` |
| Locked evidence overlay | `golden-screen-evidence-844x390.png`; `844 x 390`; `626,345` bytes; SHA-256 `d280e70a9dda6d14474ac2696d0bf3253b022c35806396af9db38bf874adc712` |
| Composition status | Hashes verified locally against `visual-direction/v1/README.md`; target artifacts only, not runtime/player/size evidence |
| Repository search | Searched Unity player-facing assets for `.fbx`, `.glb`, `.obj`, `.prefab`, `.anim`, `.wav`, `.mp3`, `.ogg`, raster image files and their bindings |
| Vendor standard | Only current first-party/vendor pages and their current official licence pages are used for candidate facts |
| Non-actions | No asset bought, downloaded, imported, preview-scraped, account-created, subscribed to, or terms-accepted |

The governing repository sources were `AGENTS.md`, the product and experience constitutions, the interface/asset
constitution, architecture, the Stage-1 master prompt, Unity experience/status/readiness/feasibility documents,
Android size/reach contract, asset register and locked evaluation rubrics. This audit does not alter or score a locked
rubric, and the auditor does not claim a human result.

### Status vocabulary

- `EXISTING_REUSE`: lawful repository work can be carried forward, but any stated candidate/acceptance caveat still
  applies.
- `ORIGINAL_CUSTOM_CREATION`: the required output is to be made specifically for VANDE with documented source and
  rights. This describes the route, not the current existence of the artifact.
- `VERIFIED_CANDIDATE`: current official listing and licence facts support controlled owner acquisition or use for the
  stated narrow purpose. It is not imported, accepted, size-qualified or visually accepted.
- `REQUIRED_MISSING`: no production-acceptable artifact exists now. A nearby procedural implementation or generic
  listing does not change this status.

## 3. Repository reality

| Group | Exact current evidence | Classification | Production implication |
| --- | --- | --- | --- |
| Human models and rig | No FBX/GLB/OBJ/prefab/animation asset was found. `ProductionCharacterResources.cs` and `ProductionCharacterRig.cs` build bodies, faces, equipment and LOD parts from generated meshes/materials. | `EXISTING_REUSE` for scale, skeleton/API and behavior reference; final artifact `REQUIRED_MISSING` | Preserve interfaces, handedness, camera clearance and physics bindings. Replace visible procedural geometry; do not relabel it production art. |
| Props/environment | `ProductionCricketProps.cs`, `ProductionCricketEnvironment.cs` and `ProductionCrowdView.cs` generate the field, props, stadium and crowd in code. | `EXISTING_REUSE` for law scale, placement and state behavior; final close art mostly `REQUIRED_MISSING` | Custom source meshes/materials can bind behind existing behavior. Primitive props cannot certify the target. |
| Raster material candidates | Four original generated 512x512 RGB PNGs exist under `Runtime/Presentation/Resources/Textures`. | `EXISTING_REUSE`, status remains `CANDIDATE` in `docs/ASSET_REGISTER.md` | They may seed pitch/outfield/willow/sky work, subject to seam, compression, device, rights and exact-build acceptance. |
| Authentic audio | No WAV/MP3/OGG source file was found. `ProductionFeedbackClipLibrary.cs` loads authored clips if present, then synthesizes explicit fallbacks. | Runtime event contract `EXISTING_REUSE`; authentic media `REQUIRED_MISSING` | Preserve classification/timing/captions/haptics. Replace exposed fallback clips with recorded derivatives. |
| HUD/PIP | `Runtime/UI/Production/**` and `Runtime/GoldenScreen/**` implement layout, score, conditions and field-PIP logic. Current text uses legacy `TextMesh`/Arial fallback. | Layout/state `EXISTING_REUSE`; production Unity typography `REQUIRED_MISSING` | Reuse quiet hierarchy and canonical field mapping. Create TextCore/UI Toolkit static font assets and prove shaping/accessibility. |
| Web font foundation | Local packages contain Manrope 5.3.0 and Noto Sans Devanagari 5.3.0 under SIL OFL 1.1. | `EXISTING_REUSE` for identity/licence | Local WOFF2 files are not Unity TTF/OTF font assets and do not prove Hindi shaping in Unity. |
| Unity packages | Current manifest has core audio/physics/IMGUI/Android packages; no explicit production TextMesh Pro/UI Toolkit font package is registered. | `EXISTING_REUSE` engine; UI integration `REQUIRED_MISSING` | Use Unity TextCore static atlases only after exact package/build verification. |

### Exact local raster inventory

| Asset | Source bytes | SHA-256 | Status / Android risk |
| --- | ---: | --- | --- |
| `bat-willow-albedo.png` | 368,223 | `b6f8bee10e6228de74d8fbb267ab10afc2a0157ddc796c24d22b8cffd5b3a741` | Candidate only; imported/compressed/installed delta unmeasured |
| `pitch-balanced-albedo.png` | 568,643 | `b57528ee1d7ea4d1408e007b7173913fe7056ca00836f8135bee7ef89dfb71aa` | Candidate only; imported/compressed/installed delta unmeasured |
| `sky-late-afternoon-panorama.png` | 646,163 | `e0607a4d7080d074bc648ee8744348ad7999ed55ed54ece5ae22962383aa82cc` | Candidate only and not the night target; delta unmeasured |
| `outfield-grass-albedo.png` | 667,840 | `bb353adc3485a0386990fa91883f7c9dc06ba8d4c598857d20dc4bcd41b73ceb` | Candidate only; imported/compressed/installed delta unmeasured |

The four PNG sources occupy about 2.2 MiB on the audit host. That is not their GPU memory or Android installed delta.

## 4. Asset-to-implementation map for the exact target

Every row names the current classification, intended route, binding point and unresolved acceptance fact. Where the
route says custom creation but the artifact does not yet exist, the current classification remains
`REQUIRED_MISSING`.

| ID and visible/required item | Current classification | Production route and rights | Unity binding / reuse | LOD, size and mobile disposition | Blocking evidence |
| --- | --- | --- | --- | --- | --- |
| `HUM-BAT-01` batter body, clear fictional face, hair, eyes, hands and anatomy | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; CC0 MakeHuman/MPFB core is a lawful base, then original sculpt/retopo/skin/hair by commissioned artist; no real-person scan or likeness | Replace generated meshes behind `ProductionCharacterRig`; retain transforms, handedness and physics pose | Shared rig/atlas; contract ceilings in section 8; exact installed/GPU/frame delta unmeasured | Editable source, originality warranty, LOD0/1/2, skin/eye materials, close/gameplay captures, device result |
| `HUM-BAT-02` original navy kit, helmet/grille/padding, gloves, pads/straps/guards, shoes | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; no manufacturer/team/sponsor marks | Retain equipment visibility/headgear state and collision clearances from current rig | Gear atlas and mesh must fit same character budgets; no current bytes | Source mesh/materials, grip articulation, clipping test, left/right hand, trademark review |
| `HUM-BOWL-01` pace bowler body, fictional face, hair, original teal kit and shoes | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`, ideally same base topology/rig as batter with original identity | Replace generated bowler visuals; retain canonical release transform and delivery trace | Same hero budgets; share skeleton/material families; exact delta unmeasured | Originality, LODs, planted run-up/release captures, device performance |
| `HUM-OFF-01` umpire | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; neutral original clothing and hat | Existing umpire position/signal contracts | Gameplay LOD only in first slice; exact delta unmeasured | Dark-behind-arm contrast, motion, no marks, source/LOD |
| `HUM-FLD-01` visible fielders | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; reuse shared base rig and small lawful original variants | Existing canonical fielder IDs/transforms and PIP projection | LOD2 ceilings; aggressive shared atlases/instancing; exact delta unmeasured | Every visible fielder maps to canonical ID; no teleport; fielding motion and mobile frame evidence |
| `HUM-KPR-01` wicketkeeper, off-camera in this target but required by exposed nick/collection outcomes | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; keeper gloves, pads and headgear | Existing keeper state/event contracts | LOD1/2; exclude only from a fixture that cannot expose it | Required before any exposed keeper result; glove/contact agreement |
| `RIG-HUM-01` shared humanoid/finger/eye/face rig and IK targets | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; source skeleton and retarget map delivered | Preserve current semantic joints and physics anchors; imported rig becomes visual authority only | At most four weights/vertex at hero LOD and two at lower LODs | Scale/axis, joint limits, foot/hand locks, retarget provenance, no runtime correction spikes |
| `ANIM-BOWL-01` approach, gather, release, follow-through | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; consenting cricket performer, signed motion/voice/location releases; capture or skilled hand animation; cleanup in Blender | Bind release marker to canonical TypeScript release event; existing procedural motion is reference only | Compressed clips loaded before delivery; exact clip bytes/load cost unknown | Planted feet, continuous momentum, hand-to-ball <= contract tolerance, no generic substitute |
| `ANIM-BAT-01` stance/trigger/backlift/defence/drive/loft/leave/miss/recovery | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; skilled batter performance plus hand/foot/bat cleanup | Bind bat pose/contact to canonical bat/ball trace; preserve player intent | Compressed clips, shared skeleton, no mid-ball load; bytes unknown | Grip, weight transfer, bat collision alignment, blends, mirroring and exact-ball retry |
| `ANIM-FLD-01` fielder/keeper/umpire reactions needed by the fixed delivery | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; capture/keyframe only exposed motions first | Existing canonical field/result events | LOD animation culling and shared clips; bytes unknown | No teleport, false catch or pre-outcome crowd/player reaction |
| `PROP-BAT-01` law-proportioned willow bat, grip, grain, edges, toe and wear | `REQUIRED_MISSING`; willow albedo `EXISTING_REUSE` candidate | `ORIGINAL_CUSTOM_CREATION` in Blender; no branded face/sticker | Replace current generated prop behind `ProductionCricketProps`; retain collider/physics transform | Small custom mesh, tier-safe texture; exact delta unmeasured | Editable source, scale, hand/collider/contact match, close/gameplay test |
| `PROP-BALL-01` white ball, raised seam, maintained/rough sides and scuff | `REQUIRED_MISSING` for final visual; current physics/rotation `EXISTING_REUSE` | `ORIGINAL_CUSTOM_CREATION` mesh/material; no texture purchase required | Retain current authoritative seam axis, shine, spin and flight bindings | Tiny mesh/material footprint expected but must be measured; ball contrast overrides decoration | At least 3 px/3:1 contrast where required, release/flight/bounce coherence, exact-build delta |
| `PROP-WKT-01` near/far stumps and separate bails | `REQUIRED_MISSING` for target finish; dimensions/behavior `EXISTING_REUSE` | `ORIGINAL_CUSTOM_CREATION`; unbranded wood/paint materials | Retain lawful current scale, hit and bail behavior | Small shared meshes/material atlas; exact delta unmeasured | Contact animation, scale, close/gameplay render, bytes |
| `ENV-PITCH-01` worn balanced pitch, legal creases and footmarks | `EXISTING_REUSE` candidate texture and lawful placement | Finish original material set in Blender/Unity; current generated albedo has documented origin | Bind to `ProductionCricketEnvironment` and physics-selected Balanced look | 512 source exists; compression/GPU/install delta unmeasured | Seam/tiling, normal/roughness, no baked lighting, bounce readability, device tests |
| `ENV-FIELD-01` outfield, mowing character, ring/crease/boundary | `EXISTING_REUSE` candidate grass plus canonical field geometry | Original shader/material/marking work; retain code geometry only where it meets final close quality | Existing field scale, canonical preset and PIP positions | Reuse/atlas textures; tier material variants; exact delta unmeasured | Visual seam/scale, ball contrast, field/PIP identity, thermal/frame tests |
| `ENV-STAD-01` stands, roof, lower concourse, rails, black sight screen and scoreboard structure | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION` modular low-poly shell with baked/atlas detail; no generic football-stadium import | Replace visible generated structure behind `ProductionCricketEnvironment`; preserve sight-screen corridor | Distant LOD/baked lighting/atlas; no source or measured delta now | Editable modular source, cricket geometry, draw/material count, night/day, size/frame/device evidence |
| `ENV-LIGHT-01` floodlight towers, night lighting, shadows and atmospheric depth | `REQUIRED_MISSING` for target-quality setup; behavior code `EXISTING_REUSE` | Original low-cost fixtures, baked world lighting plus bounded hero lights | Existing atmosphere/quality-tier controls | Shader variants and lightmaps are high size/runtime risk; exact build required | Ball contrast, shadow stability, shader warmup, thermal/frame and installed delta |
| `ENV-SKY-01` night sky and distant skyline | `REQUIRED_MISSING` for this target; current afternoon sky candidate cannot satisfy it | Original/custom compressed skyline/sky; no recognizable copyrighted buildings required | Existing sky/environment hook | One tiered atlas/cubemap; exact delta unknown | Rights/originality, compression banding, night contrast and size |
| `CROWD-VIS-01` full but restrained audience | `REQUIRED_MISSING` | `ORIGINAL_CUSTOM_CREATION`; original crowd impostor/atlas art and GPU-instanced low-LOD foreground variants | Preserve causal `ProductionCrowdView` emotion state; replace procedural people | Contract: <=150 tris per crowd member or vertex-animated 16-frame atlas/instancing; exact delta unmeasured | No repeated static wallpaper on capable tier; no pre-result reaction; frame/thermal/size proof |
| `AUD-PHY-01` pitch, bat, edge, pad, wicket, glove and fielding transients | `VERIFIED_CANDIDATE` for source only; media not acquired | Owner-acquired Sonniss/TheWorkRoom Cricket library under its single-editor EULA, then minimal deterministic derivatives | Drop accepted clips behind existing event classifier and `ProductionFeedbackClipLibrary`; retain captions/haptics/timing | Raw source is 815 MB and must never be wholesale imported; exact selected/compressed/installed delta is `UNPROVEN` | Owner acquisition, source hash/track audit, sole-editor scope, blind listening, device timing and exact build |
| `AUD-CROWD-01` stadium bed and dot/run/four/six/close/wicket reactions | `REQUIRED_MISSING` | Original recording with releases or a separately verified commercial crowd library; no music, PA, broadcast or intelligible unlicensed speech | Reuse existing causal emotion curve and broad spatial policy | Curated loops/one-shots, bounded compression; bytes unknown | Rights, content inspection, loop/mix, causality, loudness, size and physical-device listening |
| `AUD-EFFORT-01` optional bowler/batter effort/calls | `REQUIRED_MISSING` if exposed | Original performer recordings with explicit voice release; otherwise omit | Existing event/voice policy | Exclude from first slice unless necessary | Release, content and mix evidence |
| `UI-HUD-01` compact score/conditions/ball strip/touch cue outside corridor | `EXISTING_REUSE` layout/state and locked static target; runtime target rendition still unproven | Original VANDE UI using current design tokens | `Runtime/UI/Production/**`; reproduce the locked target and evidence bounds in the runtime | Prefer code shapes/one small atlas; exact delta unmeasured | Exact-viewport runtime comparison, 48 dp controls, 200% text, safe areas and no decision-corridor occlusion |
| `UI-PIP-01` compact canonical field PIP | `EXISTING_REUSE` state/projection and corrected static target; runtime art/identity still unproven | Original code/vector/raster marks only | `ProductionFieldPipProjection` and HUD view | Code geometry/minimal atlas | Runtime PIP must match the locked compact bounds; world/PIP IDs, hand and transforms agree |
| `FONT-01` English/Hindi typography | `EXISTING_REUSE` family/licence; Unity asset `REQUIRED_MISSING` | Manrope and Noto Sans Devanagari, SIL OFL 1.1; use official TTF/OTF and retained notices | Replace legacy Arial/TextMesh fallback with TextCore static atlases and explicit fallback chain | Local web WOFF2 evidence is 24,836 bytes Manrope regular variable, 50,416 Hindi regular and 53,984 Hindi bold; Unity static atlas delta unknown | Exact upstream binary/hash, OFL notice, Hindi shaping/conjuncts, 200% text, TalkBack and exact build |
| `UI-ICON-01` pause/audio/coach/touch/field symbols | `REQUIRED_MISSING` as a production set | `ORIGINAL_CUSTOM_CREATION` in the VANDE visual language; no copied platform/game iconography | Existing control states | One small sprite atlas or code shapes | 48 dp hit targets, contrast, semantic labels, installed delta |

## 5. Current official candidate register

Prices are the official page display observed at audit time, before tax, and can change. Vendor pages usually disclose
rounded package sizes rather than exact bytes; that is recorded as such. A source package number is never treated as
Android installed bytes.

| Candidate / exact official URL | Narrow classification and decision | Current price and licence | Source size disclosed | Unity/mobile compatibility | Material limitations | Android installed-size risk | Free alternative and trade-off |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [MakeHuman / MPFB core](https://static.makehumancommunity.org/about/license.html) and [commercial export FAQ](https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html) | `VERIFIED_CANDIDATE` as a base for `ORIGINAL_CUSTOM_CREATION`, never as finished art | USD 0. Core assets/exports CC0; MakeHuman code AGPL, MPFB code GPL | Download/output bytes not disclosed on cited licence pages | Editable in Blender; export must be proven against Unity rig/scale/LOD | Generic base, not a cricket identity; community add-ons are not automatically CC0 and need separate review; requires sculpt, retopo, skin/hair, clothing, gear, LOD and rig cleanup | Authoring tool adds zero runtime bytes; custom outputs remain completely unmeasured | Hand-model from scratch in Blender: cleanest authorship, substantially more senior-artist time |
| [Blender](https://www.blender.org/about/license/) | `VERIFIED_CANDIDATE` authoring tool for custom visual/motion derivatives | USD 0; Blender GPL, but official page states artwork/output belongs to creator and may be commercial | Tool download not relevant to runtime and not disclosed on cited page | Native authoring/export route for Unity models and animation | Tool only; confers no rights to imported media/add-ons and no art quality | Zero runtime cost for the tool; output cost is candidate-specific and unmeasured | None needed; it is the free recommended DCC |
| [Character Creator 5](https://cdn-www.reallusion.com/plan-and-pricing/individual/perpetual/character-creator-5-3101), [content policy](https://www.reallusion.com/license/content.html) | Screened but **not selected**; exact multi-character component rights and Windows workflow make it not approval-ready | USD 299 perpetual software, proprietary EULA. Official content policy says Standard exportable assets may be used in games, while its FAQ limits one Standard CC Component licence to one game character and requires Extended for unlimited character outputs | Software/content bytes not disclosed on cited pages | Official page exports to Unity; official store FAQ states CC5 supports Windows, not macOS/VMs | Still needs original cricket kit/equipment, LOD/retopo and artist work; component-by-component licence accounting; no native workflow on audit host | Output bytes unmeasured; potentially heavy source textures/meshes | MakeHuman/MPFB CC0 plus Blender: more manual finish, clearer core-asset rights |
| [Cricket Batter](https://assetstore.unity.com/packages/3d/characters/cricket-batter-76945) | **Rejected for target**; final batter remains `REQUIRED_MISSING` | USD 19; Standard Unity Asset Store EULA, Single Entity | 42.9 MB rounded; exact bytes undisclosed | Authored for Unity 5.4.2; current Unity 6/mobile/pipeline/LOD behavior unproven | 2018 asset, eight animations explicitly not mocap, 2K player texture, no evidenced current LOD/face/hands/kit originality standard | High review risk: the large source-package label is not installed bytes, and no selective exact-build delta exists | Original CC0/custom batter: more labor, exact identity/LOD/rights control |
| [Cricket Bowler](https://assetstore.unity.com/packages/3d/characters/cricket-bowler-91129) | **Rejected for target**; bowler remains `REQUIRED_MISSING` | USD 19; Standard Unity Asset Store EULA, Single Entity | 21.8 MB rounded; exact bytes undisclosed | Authored for Unity 5.6.1; legacy in-place animation; Unity 6/mobile/LOD unproven | Four animations, explicitly not mocap, no proven planted feet/hand release/facial or kit standard | High and unmeasured | Original performer capture/custom bowler: more work, correct cricket release and rights |
| [Cricket Actions](https://assetstore.unity.com/packages/3d/animations/cricket-actions-242681) | **Rejected as production solution**; may be a paid reference only, which is not necessary for Gate A | USD 70; Standard Unity Asset Store EULA, Single Entity | 355.0 MB rounded; exact bytes undisclosed | Unity 2021.3.6; Built-in compatible, URP/HDRP listed not compatible; FBX/PNG; publisher calls it mobile optimized | 150+ generic actions but no proof of mocap, release/contact markers or cleanup; includes 10 country uniforms that must not ship | Critical if imported broadly; exact selective clip delta unknown | Custom skilled-performer capture/manual cleanup; narrower, original, technically aligned |
| [Cricket Bowling Animations Pack – 8](https://assetstore.unity.com/packages/3d/animations/cricket-bowling-animations-pack-8-cricket-bowling-animations-281523) | `VERIFIED_CANDIDATE` only for a quarantined retarget experiment; **not** a final cricket-motion claim | FREE; Standard Unity Asset Store EULA, listed as Extension Asset, therefore seat rules apply | 11.0 MB rounded; exact bytes undisclosed | Unity 2022.3.19, Built-in/URP/HDRP listed compatible; Humanoid FBX, root motion | Eight left/right pace/spin motions; no official proof of mocap, hand release marker, planted foot or target-quality continuity | Medium and unmeasured; bundled character/clip imports must be curated | Hand-keyed original test motion in Blender: slower; no external seat/download dependency |
| [3D Game Kit – Cricket kit pack](https://assetstore.unity.com/packages/3d/props/3d-game-kit-cricket-kit-pack-333792) | Screened, **not selected** for production; prop art remains custom/missing | USD 4.99; Standard Unity Asset Store EULA, Single Entity | 91.2 MB rounded; exact bytes undisclosed | Unity 2022.3.62; Built-in compatible, URP/HDRP listed not compatible; FBX/PNG | 10 prefabs and 34 2K PBR textures; bat/ball/stumps/helmet/caps only; no gloves, pads or full equipment set; no rig/animation; source visual/LOD/device quality not inspected | Critical if wholesale; selective recompression might work but exact installed delta is unproven | Original Blender props using existing law-scale references and generated albedos: more art time, minimal exact scope |
| [Low-poly Cricket Stadium](https://assetstore.unity.com/packages/3d/environments/low-poly-cricket-stadium-213978) | **Rejected for photoreal target**; stadium remains `REQUIRED_MISSING` | USD 15; Standard Unity Asset Store EULA, Single Entity | 21.6 MB rounded; exact bytes undisclosed | Unity 2019.4.27, Built-in only; current Unity/mobile evidence absent | Listing is explicitly low-poly and publishes sparse technical detail; does not evidence target roof/crowd/sight-screen/night finish | High relative to unknown headroom; exact delta unknown | Original minimal modular cricket shell plus baked atlas: more artist time, precise camera-only scope |
| [Modular Cricket Arena Stadium 3D Environment with Props](https://assetstore.unity.com/packages/package/412856) | **Not verification-ready**; do not acquire | Official current listing displayed USD 65 sale / USD 130 regular; licence/seat detail was not available from the accessible product record | Not disclosed in accessible official listing | Not disclosed in accessible official listing | New listing, no ratings and no accessible source-size/pipeline/LOD/material facts during audit; title/screenshot is insufficient | Unknown, therefore unacceptable under the hard gate | Original camera-bounded modular shell; more labor, controllable size/materials |
| [Rokoko Vision 3.0](https://www.rokoko.com/products/vision), [pricing](https://www.rokoko.com/pricing), [current terms update](https://support.rokoko.com/hc/en-us/articles/48470600017553-Mandatory-Rokoko-Studio-Update-16-July-2026) | Conditional authoring-tool candidate, **not purchase-ready in this audit**; motion remains `REQUIRED_MISSING` | Starter USD 0 for 30 seconds/month; Basic USD 12/month or USD 10/month billed annually for 600 seconds. Proprietary Studio/Create/Vision terms | Service/output clip bytes not disclosed | Officially exports FBX/BVH for Unity/Blender | Official page says no finger tracking; single-camera solve cannot prove wrist/finger/ball release, planted foot or skilled cricket form; performer/video/location rights and latest output-use terms must be archived | Tool has no runtime cost; cleaned exported clips have unmeasured build size | Manual keyframe/capture cleanup in Blender; slower. Free Starter is still account/terms-bound and only 30 seconds |
| [Sonniss / TheWorkRoom Cricket](https://sonniss.com/sound-effects/cricket/) and [Sonniss licence](https://sonniss.com/license/) | `VERIFIED_CANDIDATE` for authentic physical cricket transients only | Product page USD 30; worldwide, non-exclusive, royalty-free Sonniss sound-library licence; commercial games/interactive synchronization, editing and no attribution permitted; one editor/local drive plus one backup, multi-user licence otherwise | 815 MB, 54 WAV files containing 436 recordings; 96 kHz/24-bit stereo; exact bytes undisclosed | WAV imports into Unity; production derivative must be resampled/channel-curated/compressed and preloaded | Does not prove stadium bed or complete emotion reactions; no reviews; raw source must not enter build; AI training prohibited | Raw library is impossible under the cap; a tiny selected derivative set may fit, but exact installed delta remains `UNPROVEN` | No quality-equivalent free cricket library was verified. Record original gear with signed performer/location releases; more scheduling/equipment/editor labor |
| [Manrope official Google Fonts metadata](https://github.com/google/fonts/blob/main/ofl/manrope/METADATA.pb) | `EXISTING_REUSE` family/licence | USD 0; SIL OFL 1.1 | Official metadata does not disclose bytes; local Latin WOFF2 regular variable is 24,836 bytes | Official TTF is usable through Unity TextCore; local WOFF2 is not a Unity source font | Manrope does not cover Devanagari; Unity atlas and weights are still missing | Low but unmeasured; use a static glyph atlas so source TTF need not ship | System/Arial fallback is free but violates the intended identity and has inconsistent Android metrics |
| [Noto Sans Devanagari official repository](https://github.com/notofonts/devanagari) | `EXISTING_REUSE` family/licence | USD 0; SIL OFL 1.1; official release observed as Noto Sans Devanagari 2.007 | Official page does not disclose exact binary bytes; local WOFF2 regular 50,416 and bold 53,984 bytes | TTF/OTF can feed Unity TextCore; complex shaping and fallback must be proven | Static glyph selection must include actual Hindi UI strings/conjuncts; local web font cannot simply be copied as a Unity asset | Low-to-medium atlas risk, exact installed/GPU delta unmeasured | Android system font is free but device-variable and cannot certify identical layout/shaping |
| [Unity TextCore/UI Toolkit font guidance](https://docs.unity3d.com/6000.0/Manual/best-practice-guides/ui-toolkit-for-advanced-unity-developers/graphic-and-font-assets-preparation.html) and [atlas modes](https://docs.unity3d.com/6000.0/ScriptReference/TextCore.Text.AtlasPopulationMode.html) | `VERIFIED_CANDIDATE` engine path, not a font asset | Included with Unity; Unity terms apply; fonts retain their own licence | No separate media package bytes stated | Unity 6 supports TTF/OTF and FontAsset; static atlases omit source font from builds, dynamic atlases include it | Current project uses legacy TextMesh/Arial; Indic shaping, fallback and accessibility require runtime evidence | Static atlas is preferred, but exact package/atlas delta must be measured | Keep legacy TextMesh only as engineering fallback; it cannot meet final typography/localization evidence |

Unity Asset Store candidates above are governed by the current [Unity Asset Store Terms and EULA](https://unity.com/legal/as-terms).
The standard EULA permits an eligible non-restricted asset to be embedded in a substantial original licensed product,
but prohibits standalone redistribution and AI/model-training use. Extension Assets are per seat. Contractors need
their own required licences. Exact listing licence type still controls each item.

## 6. Why generic motion does not close the cricket gap

The release hand, front-foot plant, shoulder/hip sequence, wrist position, bat grip, bat face, contact frame and
follow-through are gameplay evidence, not decoration. A generic pack may supply a useful retarget smoke test, but it
does not demonstrate:

1. the ball is within 5 cm of the release hand at the canonical release event;
2. the rendered bat is within the prescribed positional/angular tolerance at authoritative contact;
3. the bowler's front foot is planted without sliding and momentum remains continuous;
4. the batter's trigger, head, weight transfer, hands and bat face agree with shot intent;
5. left/right mirroring preserves legality, grip and field direction; or
6. clip blending and IK remain clean at normal speed on the exact Android build.

Therefore the free eight-bowl pack and the 150+ action pack cannot be promoted as production cricket motion without
skilled custom cleanup and the exact evidence above. In practice, the required route is an original performer capture
or high-skill hand animation, not a marketplace shortcut.

## 7. Licence and provenance controls before any import

Every candidate remains outside player-facing Unity paths until all applicable fields are complete:

- exact creator/vendor, product/version, acquisition UTC, invoice/agreement reference and untouched source SHA-256;
- archived governing terms and accepted commercial mobile/web, modification, compiled distribution and marketing
  rights, including seat/editor/contractor scope;
- originality/no-likeness statement and signed model, motion, voice and location releases where a human is involved;
- trademark, country/team kit, sponsor, broadcast, music, PA and embedded third-party work inspection;
- editable source and deterministic derivative hashes, including tool/version and conversion recipe;
- triangles, materials, textures, LODs, skin weights, blend shapes, animation clips or audio duration/format;
- intended exact scene/event exposure, preloading behavior and no mid-delivery network/asset/shader load; and
- measured exact-build installed-size, memory, frame/load and affected compatibility cohorts.

An invoice or marketplace availability does not prove these fields. Ambiguous items remain quarantined.

## 8. Binding LOD, memory and size plan

These are existing repository ceilings, not new measurements or evidence that an asset fits:

| Asset | Premium | Balanced / lower tier | Distant / crowd |
| --- | --- | --- | --- |
| Hero batter or bowler LOD0 | <=40k triangles; body/head up to 2048 textures and gear up to 1024 | <=15k triangles; up to 1024 textures | Not used live at unnecessary distance |
| Gameplay LOD1 at about 20 m | <=8k triangles; 512 textures | <=4k triangles; 512 textures | — |
| Fielder LOD2 at about 30-60 m | <=2k triangles; 256 textures | <=1.2k triangles; 256 textures | — |
| Crowd | — | — | <=150 triangles/member or vertex-animated GPU-instanced atlas with 16 pose frames |
| Skinning | <=4 influences/vertex | <=2 at LOD1/2 | — |
| Face | 52 blend shapes on LOD0 | blinks plus six expressions on LOD1 | none |
| Live character texture memory | <=48 MB | <=24 MB | Included in tier budget |

Implementation disposition for the first exact delivery:

1. One batter and one bowler share skeleton, shader families and atlases where visually safe.
2. Only camera-visible/detail-critical surfaces receive hero resolution; live delivery switches to gameplay LOD before
   approach and never changes quality mid-ball.
3. Fielders, umpire and crowd use lower LODs/instancing; crowd reactions reuse the existing causal state machine.
4. Stadium is camera-bounded modular geometry with baked/atlased night detail; no broad generic stadium package is
   imported.
5. Only exact exposed audio events enter the build; raw 96 kHz masters remain in approved private source storage.
6. Fonts use static, string-driven glyph atlases and a tested Devanagari fallback; no dynamic source font unless a
   measured ADR proves it.
7. All assets and shaders are preloaded/warmed before approach; no network request or first-use compilation occurs
   during a ball.
8. Classic/Three fallback remains complete for unsupported ABI, low-memory and unsafe Unity cohorts before
   `UnityPlayer` construction.

### Hard Android result

The current Unity-inclusive preview APK is documented as 43,584,653 bytes, but the Android contract explicitly says
that APK/AAB size is **not** the binding fresh-installed measurement. The required complete footprint through the first
playable ball is still `UNPROVEN`, as are Play splits, physical 16 KB runtime and India-weighted working reach.

Consequently, there is no honest numeric asset headroom to allocate. Every visual, animation, audio, font, lightmap,
shader or native dependency must be tested as an isolated exact-build delta and then in combination. The candidate is
rejected or redesigned if the complete result exceeds 50,000,000 bytes, harms a compatibility cohort, or requires an
in-delivery load. Source-package compression ratios must not be used as a substitute.

## 9. Production feasibility verdict by category

| Category | Route | Gate-A feasibility today |
| --- | --- | --- |
| Batter/bowler/fielder/umpire | Original fictional custom production using one shared CC0-derived or fully original base | **Route feasible; assets `REQUIRED_MISSING`; size/performance unproven** |
| Rig | Original shared mobile rig with documented semantic-joint/IK map | **Route feasible; rig `REQUIRED_MISSING`** |
| Cricket gear and props | Original unbranded Blender models, retaining lawful dimensions/physics bindings and selected existing albedos | **Route feasible; most final meshes `REQUIRED_MISSING`** |
| Stadium/field | Reuse field/physics/layout contracts and two material candidates; custom camera-bounded stadium/lighting/sky | **Route feasible; target finish `REQUIRED_MISSING`; night/lightmap cost unproven** |
| Crowd visual | Original instanced/impostor art driven by current causal crowd state | **Route feasible; art `REQUIRED_MISSING`; thermal cost unproven** |
| Animation/mocap | Skilled original performance/authoring plus manual cricket cleanup | **Route feasible; all production clips `REQUIRED_MISSING`; generic packs do not close it** |
| Authentic physical audio | Sonniss pack is a defensible source candidate; curate a minimal derivative set | **Acquisition candidate verified; media not acquired; installed/listening evidence unproven** |
| Crowd/ambience audio | Original recording or separately verified clean crowd library | **`REQUIRED_MISSING`; no defensible exact candidate selected** |
| Fonts/UI | Reuse locked static HUD/PIP composition, runtime state/projection, design tokens and OFL families; build static TextCore assets and original icons | **Static target exists; exact Unity font/icon assets and runtime reproduction remain missing/unproven** |
| 50 MB / 90% India reach | Exact-build measurement only | **`UNPROVEN`; visual direction cannot yet be certified under either gate** |

## 10. Work that can proceed without acquisition

The following work is safe and does not pretend a placeholder is production:

- retain the hashed locked static composition and evidence overlay, then bind the exact runtime HUD/PIP/safe-area,
  corridor and touch bounds to that target without treating the PNG as runtime evidence;
- freeze the one-delivery exposed-item manifest and canonical release/contact/field event markers;
- commission or produce original unbranded bat, ball and wicket source meshes within the current law/physics contracts;
- prepare import presets, deterministic derivative/provenance forms, static font-atlas tests and per-asset exact-build
  delta tooling;
- create the shared rig specification and performer/model/location release templates; and
- run a no-cost quarantined retarget test only if an owner intentionally accepts the relevant account/store terms.

Do not broaden production replacement until the owner approves the exact visual direction. Do not import paid or free
store assets merely to make the target appear complete.

## 11. One consolidated owner approval request

This audit recommends **one narrow acquisition only**. It does not request approval for any audited marketplace
character, generic animation, prop or stadium pack.

> **Approval requested:** May the owner acquire one single-editor licence for
> [Sonniss / TheWorkRoom Cricket](https://sonniss.com/sound-effects/cricket/) at the current product-page price of
> **USD 30 before tax**, governed by the [Sonniss sound-library licence](https://sonniss.com/license/), and place the
> untouched 815 MB source in owner-approved private storage? The production team would audit the track list and
> source hashes, then derive and import only the minimum authentic pitch, bat, edge, pad, wicket, glove and exposed
> fielding transients. No raw master, unused recording or source library would enter the app. The expected contribution
> is authentic physical cricket contact, not crowd ambience, player voices, music or commentary. The compressed and
> Android installed effect is **UNPROVEN** and must be measured before acceptance; acquisition is not permission to
> ship. The free alternative is a new original recording session with owned cricket equipment and signed
> performer/location releases; it avoids a library fee but adds recording, scheduling, equipment, editing and rights
> work. If more than one audio editor will access the sources, do **not** buy the single-editor licence; obtain and
> approve a multi-user quote instead.

No visual candidate is included because none of the audited paid packs is a defensible end-to-end match for the exact
photoreal target, original identity requirement, cricket-specific motion, editable LOD path and unmeasured 50 MB
ceiling. Those items require scoped custom production and a separate artist/performer quote before any spend request
can be decision-ready.

## 12. Stop conditions

Stop and escalate rather than import, acquire or claim Gate A when any of the following is true:

- licence, seat/editor/contractor scope, likeness, voice, location, trademark or embedded-work rights are unclear;
- editable originals needed for LODs or deterministic derivatives are unavailable;
- generic movement is being treated as verified cricket motion;
- a placeholder/reference asset is required to make the target frame look complete;
- an asset changes physics, score, player intent, Coach facts, replay identity or field mapping;
- a source loads during a delivery, obscures the ball or changes quality mid-ball;
- exact installed bytes, GPU memory, frame pacing, thermal, physical-device, 16 KB runtime or compatibility evidence
  is missing where a pass is claimed; or
- a builder is asked to certify their own visual score, human response, SIZE-50 or REACH-90 result.

This audit closes the sourcing question, not Gate A: **the exact static target composite now exists, but custom
production assets and an exact runtime reproduction are still required, and 50 MB feasibility remains unproven until
a measured one-delivery production candidate exists.**
