# VANDE Practice asset register

Constitution Part II §18: every visual and audio asset the Practice stage uses, with where it comes from, what it
costs and whether it is accepted. Assets are either original project code (geometry, shaders, computed textures and
synthesised audio) or explicitly registered generated candidates. Generated candidates are not accepted merely by
being in the repository: their prompt, generator, checksum, rights review and visual/device gates stay visible below.
No real players, teams, kits, sponsors or equipment brands appear anywhere; the only marks are VANDE's own (the
chevron and the wordmark).

Last updated 2026-10-31, branch `cricket-rebuild`.

## Unity production typography (owner: Unity presentation)

The Stage-1 HUD uses two repository-pinned SIL Open Font License 1.1 faces through Unity 6 TextCore/UI Toolkit
Advanced Text. The checked-in TTF files are deterministic format conversions of the exact Fontsource WOFF2 package
files; glyph outlines, names and tables were not edited. Manrope is the Latin/digit primary and Noto Sans Devanagari
is the Devanagari fallback. Dynamic TextCore atlases retain the source font tables required by HarfBuzz/ICU shaping;
there is no operating-system-font or network fallback.

| ID | Runtime role | Source / transform | Repository asset / bytes / SHA-256 | Licence | Status |
| --- | --- | --- | --- | --- | --- |
| `UNITY-FONT-MANROPE-OFL-001` | Latin, digits and punctuation | `@fontsource/manrope@5.2.8`, `manrope-latin-400-normal.woff2` SHA-256 `849290ef12a2eeb9af5c11924120d11aa4ae8b435ed3347d7fc8bc240c293ca3`; decompressed with fonttools 4.63.0 | `unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/Resources/Fonts/ManropeLatin-Regular.ttf`; 35,728 bytes; `bbc5b16214071277028f042faa7c36e2f65319ea36c1f9c8f3b418ebd8e58102` | Included `Manrope-OFL.txt`; SHA-256 `d826ab6583b12c26807d8716a545bdbbb672df04f48608a364ba9efdbe501c30` | `LICENSED / TECHNICALLY INTEGRATED; RUNTIME VISUAL EVIDENCE OPEN` |
| `UNITY-FONT-NOTO-DEVANAGARI-OFL-001` | Hindi/Devanagari fallback, including conjunct shaping | `@fontsource/noto-sans-devanagari@5.3.0`, `noto-sans-devanagari-devanagari-400-normal.woff2` SHA-256 `f86f14cbd1004f5795689ee9cc70d5d87d915f5135b30283525c1c7b8f0eb192`; decompressed with fonttools 4.63.0 | `unity/VandePractice/Assets/VandePractice/Runtime/UI/Production/Resources/Fonts/NotoSansDevanagari-Regular.ttf`; 188,960 bytes; `d31a69d6a0e060f20c47b550c817d6e8a1c9d3cf3a617da60ae9773cfe26e132` | Included `NotoSansDevanagari-OFL.txt`; SHA-256 `79c44862256af9a67fc23df7c45ae289e730c7f6d4f8fb8ef593bd3c314b6d6d` | `LICENSED / TECHNICALLY INTEGRATED; RUNTIME VISUAL EVIDENCE OPEN` |

Exact copyright notices, package versions, source/output checksums, conversion method and rights review are recorded
in `docs/licenses/fonts/vande-production-typography-provenance.json`. The two TTFs total 224,688 source bytes.
Generated `.meta`, dynamic FontAsset, material, atlas and panel-settings bytes are measured separately after Unity
import. Android fresh-installed delta, Play-split delta, runtime atlas memory, physical-device rendering and
India-weighted reach remain **UNPROVEN**; these entries do not certify SIZE-50 or REACH-90.

## How to read it

- **Status** is one of *accepted* (meets the constitution's bar at gameplay distance and in close-up, judged on the
  screenshots listed), *accepted at gameplay distance* (convincing in play, not in close-up), or *not accepted*
  (procedural stand-in below the bar; the "Professional human assets needed" section says what would replace it).
  Older rows retain the art engineer's legacy screenshot labels for historical context only. Those labels are
  **non-certifying builder opinions** and cannot satisfy an acceptance gate. Current acceptance or rejection comes
  only from an independent evaluator using the locked rubrics and exact-build evidence.
- **Physical device**: *not verified* everywhere. No phone has been tested by this workstream. The tier budgets below
  are from the desktop (Apple M1 Pro, Chromium on Metal) and from SwiftShader as a slow-GPU proxy.
- **Polygons** are triangles as drawn (instanced meshes: per instance × instances). **Memory** is GPU memory for
  textures (with mipmaps) and vertex buffers, approximate. **Load** is the one-off cost at stage creation on the M1 Pro
  (main thread); assume 5–10× on a low-tier phone.
- **Android installed bytes** are a separate mandatory field for every imported Unity model, texture, animation and
  audio asset. This pre-Unity register does not yet measure that contribution, so no entry here certifies the
  50,000,000-byte Android gate. Measure the delta in device-specific APKs and in the full fresh-installed footprint
  under `docs/ANDROID_SIZE_AND_REACH.md` before accepting an asset for the Android path.
- **Tiers**: lite (Balanced on low-end devices, `preset.quality` 'low'), standard (Balanced), high (Premium). Classic
  2D is not covered here (it draws simple shapes, `src/render3d/fallback2d`).
- **Owners**: *art* (this register's author: `props.ts`, `stadium.ts`, `players.ts`, `firstPerson.ts`),
  *presentation core* (`ball.ts`, `overlays.ts`, the Coach ghost and close-up view), *audio* (`src/audio/**`).
- **Screenshots** (close-up and gameplay distance, lite and high, day and evening) are in the art engineer's
  scratchpad session (`.../scratchpad/assets/shots/`); they were reviewed, not committed.

## Unity raster material candidates (owner: Unity presentation)

**Owner decision 2026-11-03:** AI-generated textures are not allowed under the free-only rule.
- The six OpenAI-generated rows below (`-001`, `STADIUM-DAY-001/002`) and `WEB-TEX-STADIUM-SHELL-001` are `WITHDRAWN`.
- Their files were replaced in place by original procedural textures generated by `node scripts/unity-textures/generate.mjs`
  (deterministic and seeded; no third-party or AI pixels or structure. Disclosure: the 12 tile colour targets in `scripts/unity-textures/generate.mjs` `TILE_TARGETS` (mean colour and spread) were measured from the withdrawn AI bitmaps; owner decision pending on keeping or restating them. Wedge `textures/REPORT.md` and `eval-assets/VERDICT.md`).
- The withdrawn rows keep their prompts as provenance history. The originals are kept outside the repository.
- The replacements remain `CANDIDATE / UNPROVEN` until visual, seam, compression, device and installed-size review pass.
- None is evidence of photorealism by itself.

| ID | Asset / exact prompt | Repository path | Generator / source | Dimensions / bytes | SHA-256 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `UNITY-TEX-PITCH-001` | Balanced pitch albedo. Prompt: “Seamless square top-down balanced cricket pitch, compacted tan clay with sparse grass, photogrammetry albedo, neutral light, no baked shadows, lines, objects, text, logos or watermark.” | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/pitch-balanced-albedo.png` | OpenAI image generation; original generated output for this repository | 512×512 RGB PNG; 568,643 bytes | `b57528ee1d7ea4d1408e007b7173913fe7056ca00836f8135bee7ef89dfb71aa` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only. Replaced in place by the procedural row with the same file |
| `UNITY-TEX-GRASS-001` | Outfield albedo. Prompt: “Seamless top-down maintained cricket grass, fine blades and subtle mowing character, neutral albedo, no lines, objects, text, logos or watermark.” | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/outfield-grass-albedo.png` | OpenAI image generation; original generated output for this repository | 512×512 RGB PNG; 667,840 bytes | `bb353adc3485a0386990fa91883f7c9dc06ba8d4c598857d20dc4bcd41b73ceb` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only. Replaced in place by the procedural row with the same file |
| `UNITY-TEX-WILLOW-001` | Bat willow albedo. Prompt: “Seamless pale English willow albedo with fine vertical grain, neutral light, no bat silhouette, decal, text, logo or watermark.” | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/bat-willow-albedo.png` | OpenAI image generation; original generated output for this repository | 512×512 RGB PNG; 368,223 bytes | `b6f8bee10e6228de74d8fbb267ab10afc2a0157ddc796c24d22b8cffd5b3a741` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only. Replaced in place by the procedural row with the same file |
| `UNITY-TEX-SKY-001` | Late-afternoon sky-dome candidate. Prompt: “Believable wide 360-degree cricket-match sky and atmospheric horizon over India; restrained high clouds, humid haze, natural light, visually continuous edges; sky only; no stadium, field, people, buildings, aircraft, birds, sun disk, text, logos, trademarks or watermark.” | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/sky-late-afternoon-panorama.png` | OpenAI image generation built-in mode; original 1774×887 output downsampled once for the mobile candidate | 1024×512 RGB PNG; 646,163 bytes | `e0607a4d7080d074bc648ee8744348ad7999ed55ed54ece5ae22962383aa82cc` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only. Replaced in place by the procedural row with the same file |
| `UNITY-TEX-STADIUM-DAY-001` | Daylight batter-end facade. Prompt chain: generate an original photorealistic, centred two-tier cricket stadium with a dense varied crowd, plain central black sight screen, empty player corridor, no pitch/players/UI/text/logos; change only sky, exposure and practical lighting to neutral late-morning daylight with floodlights off; then identity-preservingly reduce only the sight screen to realistic cricket proportions and reconstruct the newly exposed concourse, seating and crowd, without adding field people, pitch markings, UI, text, logos or advertising. | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/stadium-day-background-v1.png` | OpenAI image generation built-in mode; original generated composition followed by lighting and sight-screen proportion edits for VANDE | 1672×941 RGB PNG; 2,894,263 source bytes; Unity import capped at 1024 | `aa9a75f549bfc21090abae397d58d65f71ca8215ce3b5b21c7663eacc6f267ce` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only; the file had already been removed from the tree (about 03:07Z) |
| `UNITY-TEX-STADIUM-DAY-002` | Wide daylight batter-end facade; full exact prompt is recorded below. | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/stadium-day-background-v2.png` | OpenAI image generation built-in mode; original generated output for VANDE; source and repository copies are byte-identical | 2172×724 RGB PNG; 2,823,351 source bytes; Unity import capped at 1024 | `b1b0c5017744706be5ce8c0f19563d2a4d17fea96b40d0d2c00d6a0cea722dd8` | `WITHDRAWN`: owner decision 2026-11-03. AI-generated, not allowed under free-only. Replaced in place by the procedural row with the same file |
| `WEB-TEX-STADIUM-SHELL-001` | Responsive Practice-shell derivative of `UNITY-TEX-STADIUM-DAY-002`; no content edits. Deterministic transform: `cwebp -q 78 -m 6 -resize 1600 0`. | `public/practice/stadium-shell.webp` | Repository-owned generated source above; resized and WebP-compressed locally with cwebp | 1600×534 RGB WebP; 132,890 bytes | `b1a34c46910b47209997b2db1bd9a0dd9c339dcec841225360551571836f3cae` | `WITHDRAWN`: owner decision 2026-11-03. Derivative of an AI-generated plate; replaced in place by `WEB-TEX-STADIUM-SHELL-002` |
| `UNITY-TEX-PITCH-002` | Balanced pitch albedo; isotropic in metres for the one-tile-per-pitch UV; mean 3.5% darker than PITCH-001 for ball contrast | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/pitch-balanced-albedo.png` | `node scripts/unity-textures/generate.mjs`, seed `vande-pitch-balanced-v1`; VANDE original | 512×512 RGB PNG; 410,576 | `bfffa186368d5658dda9b1b592f1af947024644de03335a35a82840660e8c353` | `CANDIDATE / UNPROVEN` |
| `UNITY-TEX-GRASS-002` | Outfield grass albedo; blade strokes with a mowing lay, tileable at 2.38 m | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/outfield-grass-albedo.png` | same; seed `vande-outfield-grass-v1` | 512×512 RGB PNG; 629,218 | `413afb0b36797bcf433c16c076458d38a6176aa6cc4c97c324d396e7c7f22e6d` | `CANDIDATE / UNPROVEN` |
| `UNITY-TEX-WILLOW-002` | English willow face; wavy vertical grain, tonal bands, pin knots | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/bat-willow-albedo.png` | same; seed `vande-willow-v1` | 512×512 RGB PNG; 156,369 | `8360158f290654718d12404539958d33c33caa566afa5d5b5b54187da9761ecd` | `CANDIDATE / UNPROVEN` |
| `UNITY-TEX-SKY-002` | Late-afternoon sky panorama; key-light glow at azimuth 104° / elevation 15° (web convention, matching `LOOKS.late_afternoon`; moved from 76°/22° on 2026-11-03), no disc; cloud-plane altocumulus and cirrus; seamless in u | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/sky-late-afternoon-panorama.png` | same; seed `vande-sky-late-afternoon-v1` | 1024×512 RGB PNG; 343,918 | `0678bd31117e1141a7288695e4fa2fe6c26660b857fc05ff326fbd52d44621f2` | `CANDIDATE / UNPROVEN` |
| `UNITY-TEX-STADIUM-DAY-003` | Daylight plate behind the bowler, ray-cast from the live eye against the game's own stadium layout; lit by the Day sun `SunKey(58, 54)` (web convention, re-lit 2026-11-03), with the roof's sun shadow on the upper tier; seated crowd per seat; plain matte near-black sight screen over the red-ball cutout; no text, logos or advertising | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/stadium-day-background-v2.png` (name kept, so no C# change) | same; seed `vande-stadium-day-v3` | 2048×1024 RGB PNG; 1,926,131; imports at 1024×512 DXT1 (editor) / ETC_RGB4 (Android), 349,544 bytes (`nPOTScale` ToNearest); world aspect 2172:724 from C# | `9d2157a6a0b1848d2b5946cef5b568eb6f274de14b569aa7b0fc78ba3f88a192` | `CANDIDATE / UNPROVEN` |
| `WEB-TEX-STADIUM-SHELL-002` | Practice-shell backdrop: `cwebp -q 78 -m 6 -resize 1600 534` (the plate's 2172:724 world aspect) applied to `UNITY-TEX-STADIUM-DAY-003`; regenerated 2026-11-03 from the plate re-lit by `SunKey(58, 54)` | `public/practice/stadium-shell.webp` | Derived from the procedural plate above; VANDE original | 1600×534 RGB WebP; 85,018 bytes (−47,872 against SHELL-001) | `e77172a33494196207375a4a66182aa128e1b42b275844e0f21371b3a0f27a98` | `CANDIDATE / UNPROVEN` (visual review open; the shell's 58% outfield overlay must be checked by eye) |

The working originals are retained in the Codex generated-image store for provenance; the repository PNGs above are
the shipped-candidate copies. Acceptance must use the repository checksums, not the transient source locations.

### `UNITY-TEX-STADIUM-DAY-002` exact generation prompt

```text
Use case: photorealistic-natural
Asset type: original Unity mobile cricket stadium panoramic background plate for a rear-shoulder batting scene
Primary request: Create a highly realistic, coherent daytime cricket stadium bowl background with tiered seating, a dense but economical crowd, roof structure, sight screen, boundary edge and open blue sky. This is a generic fictional venue in India, viewed from ground level near the batting crease, designed to wrap behind real-time 3D foreground geometry.
Scene/backdrop: modern cricket ground on a clear late-afternoon match day; continuous stadium architecture across the full wide frame; even perspective and horizon; believable crowd scale.
Subject: stadium and crowd only; distant anonymous spectators with no recognizable faces.
Style/medium: photorealistic production game environment backplate, natural materials, restrained broadcast realism, not concept art, not cartoon, not glossy CGI.
Composition/framing: extremely wide landscape panorama; horizon and stands centered; foreground grass/boundary kept minimal so a 3D pitch and players can be composited over it; left and right edges visually compatible for wrapping; no close foreground objects.
Lighting/mood: bright natural daylight, coherent single sun direction, subtle atmospheric depth, energetic but not overdramatic.
Materials/textures: concrete, steel, fabric shade, varied seating and crowd clothing; realistic tonal detail without noisy neon.
Constraints: completely original fictional venue; no brands, logos, flags, advertisements, readable text, watermarks, protected team uniforms, identifiable real players, trophies, UI, scoreboards with text, or duplicated giant faces. Maintain clean ball-readable sky and sight-screen contrast. Suitable for downsampling and texture compression in a <=50 MB Android game.
Avoid: animation style, toy proportions, fantasy architecture, excessive bloom, oversaturation, warped stadium tiers, impossible railings, close-up spectators, prominent empty black rectangle.
```

The v2 plate is a composition candidate, not a quality certification. Its 3:1 aspect reduces the vertical scale of
the static facade at the same 112 m width, while a 9.2 m centre aligns its imaged boundary and sight screen with the
real-time field and physical screen. Runtime maps it onto an original 24-segment, 50-vertex inward-facing 64.8 m
arc so the facade stays in front of the 70 m seating ring across its width rather than exposing stepped side
occluders. The physical screen cutout is derived from those real dimensions rather than a texture-specific guessed
rectangle. The v1 source is preserved for comparison. Both files currently remain under
Unity `Resources`, so the exact Android installed-byte delta and any cost of carrying the retained v1 are
**UNMEASURED**; the final asset choice must follow an exact-build runtime comparison and independent review.

## Unity production-hero candidate (owner: Unity presentation)

`VANDE-PRODUCTION-HERO-001` is the first atomic Stage-1 hero bundle. It combines the complete MakeHuman v1.3.0
CC0 anatomy, a 75-bone compact skeleton, four encoded and retained skin slots at every LOD, CC0 hair and separate
shoes, 1024- and 512-pixel CC0 skin albedos, one protected shared CC0 eye renderer with a 256-pixel colour albedo,
and original VANDE cricket equipment and bat geometry. The anatomy is deterministically classified into fitted
skin, jersey, trouser and covered-foot material regions from its dominant authored deformation bone. Mixed-region
source triangles are disconnected by a deterministic categorical rule without changing positions, bind positions,
UVs, normals, tangents or four-slot skin records. No body face is culled and the rejected generic casual-suit mesh is
not rendered. The body, fitted material regions, hair and shoes are one VPM3 skinned renderer per LOD; the
172-triangle eye renderer is shared across all LODs. It uses no real-player likeness, real team kit, sponsor,
equipment brand or marketplace model.

Exact upstream versions, archive-entry hashes, licence records, body-culling facts, material regions, motion terms,
output hashes and limitations are in
`docs/licenses/vande-production-hero/hero-bundle-provenance.json` (117,244 bytes; SHA-256
`12c338d68ffeb9d01e0919ab2d0a83fab80eea5581d5f565a5a106e734c10c00`). MakeHuman core and selected system-pack
assets are CC0-1.0. The equipment meshes and VBT1 bat are original VANDE parametric art. The two VMA1 motion
references come from the CMU Graphics Lab Motion Capture Database under its stated commercial-product permission
and direct-resale prohibition; the requested CMU acknowledgement is recorded in the provenance file.

### Body, kit, skeleton, skin and eyes

| ID | Runtime role | Repository path | Vertices / triangles | Raw bytes | SHA-256 | Status |
| --- | --- | --- | ---: | ---: | --- | --- |
| `VANDE-HERO-VSK1-001` | Shared 75-bone compact hero skeleton; skeleton ID `f5e900eb2ff93c6f`; canonical Hips semantic is the common root | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-skeleton.bytes` | — | 2,432 | `5a7fd8a7268300be70f06ce0ab84a7525683d279f387ea8d77e18c19f599220b` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-001-L0` | Explicit High-detail close-up only; fitted anatomy plus body-conformal low-relief collar, sleeve-cuff and jersey-hem bands, CC0 hair and separate shoes; never selected merely by distance | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-lod0.bytes` | 18,507 / 32,222 | 1,525,868 | `c63e8f8c99512686f1e3a43e05232f573a4d2a2c6091192f9ceff8c183eb173a` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-001-L1` | Face-protected live batter; fitted material regions and retained body-conformal clothing bands, hair and separate shoes; four authored influences are retained and mixed-region output triangles are zero | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-lod1.bytes` | 3,325 / 4,999 | 269,426 | `d4b7423361caf85d62e5cdeef639614990ff392c5870ef474f488ced0abffaef` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-001-L2` | Live pace/spin bowler and close/ring fielder; fitted material regions and body-conformal clothing bands with four authored influences retained; reserves 172 triangles for the shared eyes and 60 for the spinner/fielding cap | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-lod2.bytes` | 2,665 / 3,768 | 214,520 | `083e6bc9a57f1a60ba469247e47da1fd6a8e29f18a51b04d8e3e83a9708adada` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-001-L3` | High-detail wicketkeeper and Premium distant fielder; fitted material regions and four authored influences retained; complete 2,000-triangle ceiling retained | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-lod3.bytes` | 1,412 / 1,756 | 112,232 | `db96ae02b7e7af644deb8397277395fea6fe37cda17d9838df30a71359bdd8d3` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-001-L4` | Medium/Low wicketkeeper and Balanced/Lite distant fielder; fitted material regions and four authored influences retained; complete 1,200-triangle ceiling retained | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-lod4.bytes` | 902 / 948 | 70,664 | `08b5b2e4ee9024dccf99ac66ed3a0926e729108fc033065fcae3e9083e687330` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-SKIN-CC0-001` | Hero skin albedo; 1024×1024 derivative of MakeHuman system-asset `young_darkskinned_male_diffuse.png` | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-skin-albedo-1024.png` | — | 1,275,183 | `a733665648922a48cc2d923f7551f1ce398fac42c4530a23a5ed4a04d48b6759` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-SKIN-CC0-001-LIVE` | Live/Balanced hero skin albedo; direct 512×512 derivative of the same pinned CC0 source | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-skin-albedo-512.png` | — | 329,662 | `47cb90a768ac72a184f4cd603beaa4b953db907fdb066841ef5c6e46d79cc356` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-EYES-CC0-001` | One shared opaque VPM3 eye renderer at every hero LOD; 96 vertices rigidly bound to the common head bone; protected shader region 16 | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-eyes.bytes` | 96 / 172 | 7,976 | `84cfdd71fe6c34d5de8241fc9f27c794f1a1c192bbae8e62f71c91d33288669d` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-EYE-ALBEDO-CC0-001` | 256×256 RGB derivative of MakeHuman system-asset `eyes/materials/brown_eye.png`; sRGB, mipmapped, non-readable and import-capped at 256 for Android/WebGL | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-eye-albedo-256.png` | — | 76,993 | `d47fd0debb3b3234d6b48926ca2c3c8283b9cb12bc5e2ea159658fc0ea8991d3` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-UNIFORM-NORMAL-CC0-001` | Retained legacy 2048² CC0 suit normal source, importer-capped at 512²; deliberately not bound to the fitted anatomy because its garment UV/tangent atlas is incompatible | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-kit-normal.png` | — | 2,235,477 | `ccdbf48a86eb922f5ccf38a7d3dc9de8828a6460c687eb84dacf8315d079a343` | `RETAINED BUT DISABLED FOR FITTED HERO / ANDROID SIZE UNPROVEN` |
| `VANDE-HERO-UNIFORM-AO-CC0-001` | Retained legacy 2048² CC0 suit AO source, importer-capped at 512²; deliberately not bound to the fitted anatomy because its garment UV atlas is incompatible | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-kit-ao.png` | — | 1,663,549 | `dc27b02602060a8df4c1117f55bde7dea952342d847003afe2c6e12145301147` | `RETAINED BUT DISABLED FOR FITTED HERO / ANDROID SIZE UNPROVEN` |

### Face-protected live-batter LOD1

LOD1 uses face policy `makehuman-v1.3.0-fitted-body-kit-uv-landmarks-v2`. The policy locks the complete incident-ring
topology around nine pinned MakeHuman UV landmark groups: left/right brow, left/right eye, nose, mouth, chin and the
left/right ocular islands. The 29,533-triangle combined source contains 969 protected source triangles and 611 locked
vertices. The 4,999-triangle output retains all 969 triangles and all 611 vertices; maximum position, bind-position,
UV, normal and tangent drift are each zero. All four authored influence slots are retained exactly; VPM3 already
stores four fixed slots, so discarding two influences would save no bytes while damaging deformation. Every landmark
has non-zero protected topology (the smallest recorded group has three incident triangles; the complete right-brow
ring has 18). The final protected vertex-record SHA-256 is
`b8e5e94f889033da828bb84a1f52740a8a143e06d3403a9f1311e228cfc53ae5`.

The simplifier targets 5,000 triangles and deterministically resolves to 4,999 without padding, with observed relative
error `0.029654789716005325` against the `0.05` maximum. Before simplification, mixed categorical-region triangles are
deterministically assigned to one region and disconnected. This prevents the interpolated shader-region tears that
were visible across skin and jersey while preserving authored vertex attributes exactly.

The measured final categorical output is:

| Final VPM3 triangle region | Face-protected LOD1 |
| --- | ---: |
| Skin (`0`) | 2,219 |
| Jersey and fitted clothing transitions (`1`) | 1,079 |
| Trousers (`2`) | 800 |
| Covered feet and separate shoes (`3`) | 748 |
| Hair (`11`) | 153 |
| Mixed regions | 0 |
| **Total** | **4,999** |

This is a topology-retention policy, not a visual or identity certification. It applies only to the live-batter LOD1
simplification and does not add a facial rig, blend shapes, eyelid motion, gaze, expressions, skin microdetail or
authentic cricket clothing. Exact four-slot retention does not by itself certify shoulder, wrist, hip or cloth
deformation quality. Every authored pose, left/right-handed presentation, helmet/grille occlusion, close-up and
gameplay-distance appearance, clipping, WebGL/Android runtime behavior,
fresh-installed size, low-tier performance, thermal behavior and India-weighted reach remain independently
**UNPROVEN**. Standard/High foreground batter rendering explicitly requests four-bone skinning; Lite and distant
roles remain platform-bounded. The complete-delivery Android frame-time delta is still **UNPROVEN**.

The fitted-clothing transition geometry adds the same exact 288 closed two-manifold triangles at LOD0 as four-sided,
body-conformal low-relief bands: a 4.0 mm-half-width collar, a 4.5 mm-half-width jersey hem and two 3.5 mm-half-width
sleeve cuffs. Relief is 1.3 mm at collar/hem and 1.1 mm at each cuff, with 0.5 mm stand-off. Each samples the actual
body boundary and copies the nearest complete authored four-slot body skin record without mutating the body. Measured
maximum/p95 distance to the body surface is 3.749/3.269 mm at the collar, 2.065/1.962 mm at the hem and
2.223/2.119 mm at the cuffs. Post-simplification encoded/decoded LOD1 evidence retains 64 collar, 82 hem,
36 left-cuff and 36 right-cuff triangles with non-zero extent on all three axes. This
proves shipped-mesh survival, not animated-pose clipping or visual acceptance.

### Original cricket equipment and bat

| ID | Runtime role | Repository path | Vertices / triangles | Raw bytes | SHA-256 | Status |
| --- | --- | --- | ---: | ---: | --- | --- |
| `VANDE-HERO-VPM3-GEAR-001-L0` | VPM3 close-up fitted helmet with distinct padded ear guards/nape and complete metal cage; tapered shin-overlapping wrap pads; compact wrist-bound thumb/finger-channel gloves | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-gear-lod0.bytes` | 3,854 / 5,996 | 313,496 | `74d97a129a704096250a8a35a40d655839c3cebec7b0bf682ea874655ac340e9` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VPM3-GEAR-001-L1` | VPM3 live fitted helmet with distinct padded ear guards/nape and complete metal cage; tapered shin-overlapping wrap pads with a contrast front channel; compact gloves retain thumb and four contrast finger channels without increasing geometry | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-gear-lod1.bytes` | 1,588 / 2,196 | 127,544 | `456246cdbc74dc4e78a0206bf0397d3c6457c40e11f4b61e121443a5c666a0eb` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-BAT-001-L0` | VBT1 original law-scale close-up bat; 0.86 m total length; outward-facing blade/handle with deterministic toe, shoulder and handle caps | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-bat-lod0.bytes` | 574 / 1,064 | 38,560 | `7c1ea72a91a38f46308193cf77c5691e5ac457c93093eed727c397924d085074` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-BAT-001-L1` | VBT1 original live bat with the same closed-surface contract | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/hero-bat-lod1.bytes` | 157 / 272 | 10,456 | `2284fbdfb2871f0b6120462849b1689b94156368b773f71f8e5555f9070dfd0c` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |

The shared opaque character material gives equipment steel a bounded non-emissive light value
(`0.62, 0.66, 0.69`), applies `0.26` nape contrast, and enables a bind-space compression-undersleeve mask only on the
existing lower-arm region-0 surface. The latter keeps crossed forearms from reading as an exposed waist while leaving
hands and face in the photographic-skin treatment. It adds no mesh, renderer, texture or raw runtime-asset byte and
does not open kit selection or any later product stage. Material appearance and clipping remain subject to independent
normal-speed and slow-motion review.

### Reference motion resources

| ID | Presentation-only role | Repository path | Frames / rate / duration | Raw bytes | SHA-256 | Status |
| --- | --- | --- | --- | ---: | --- | --- |
| `VANDE-HERO-VMA1-RUNUP-001` | CMU Subject 35 run/jog reference; root locked; blended only before the pace gather; presentation-only and not an authentic cricket action | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/motion-runup.bytes` | 84 / 60 Hz / 1.383 s | 20,312 | `8b9dae43e15bc42eaf549be8f65e7a29295b72e591153a9a1086932cf8e28b77` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |
| `VANDE-HERO-VMA1-WEIGHT-001` | CMU Subject 124 baseball-swing reference; root locked; presentation-only, low-weight pelvis/spine/leg transfer; never bat/arm/contact authority or an authentic cricket action | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/motion-batting-weight.bytes` | 649 / 60 Hz / 10.800 s | 154,782 | `caf80b980b853e03da2461d59403ffef2e5918f96664e3ff0a883e1dd283d1b2` | `TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN` |

The eighteen hero runtime files, including the two retained disabled legacy surface maps, total 8,449,132 raw source
bytes, 606 bytes less than the immediately preceding runtime bundle. The body-conformal transition
resimplification redistributes the body LODs while the helmet/pad/glove rebuild preserves the prior gear byte counts;
bat byte counts are unchanged. The provenance JSON is
documentation and is not included in that runtime total. The two retained legacy uniform surface sources account for
3,899,026 of those repository bytes but are each importer-capped at 512×512, use mipmaps and remain non-readable at
runtime; their actual platform import/package/memory deltas are unmeasured. They add no diffuse suit texture, team
mark, sponsor, equipment brand or logo. The fitted body uses a different UV/tangent atlas, so binding these legacy
suit normal/AO maps would be invalid; fitted-hero material admission must leave them disabled. The photographic skin remains
region-0-only and retains bounded per-material palette variation rather than being replaced by a flat palette. The
eye texture is sampled only by protected region 16; a missing eye mesh or texture rejects the complete hero role
transaction instead of exposing empty sockets or Unity's implicit white texture.
LOD3 and LOD4 add 170,890 raw source bytes relative to
the pre-field-role runtime family; removing the two incorrectly exposed guard meshes saves 47,280 raw source bytes.
None of these figures is an Android installed-size delta. Unity import
compression, mandatory first-ball data/cache, split delivery, runtime memory, low-tier frame pacing, thermal behavior
and India-weighted working reach have not been measured. The runtime admits the common skeleton/body bundle
atomically for every Stage-1 player role. A batter additionally requires both gear and both bat LODs. A wicketkeeper
or fielder additionally requires both field-role LODs; a missing, corrupt, over-budget or skeleton-mismatched member
rejects that complete role transaction and uses the retained VPM2 fallback. Live batter uses body/gear/bat LOD1,
live bowler, Low/Lite batter and close/ring fielder use body LOD2, High wicketkeeper and Premium distant fielder use body LOD3, and
Medium/Low wicketkeeper and Balanced/Lite distant fielder use body LOD4. LOD0 requires an explicit close-up request
and is never selected for keeper or fielders.

The live batter aggregate is 7,639 triangles (4,999 body/kit + 172 eyes + 2,196 equipment + 272 bat), within the Premium live
8,000-triangle target but above the register's Balanced live 4,000-triangle target. The bundle therefore does not
certify Balanced geometry compliance; a measured lower-cost whole-player presentation remains required.
The explicit close-up aggregate is 39,454 triangles (32,222 body/kit + 172 eyes + 5,996 equipment + 1,064 bat), within its
40,000-triangle Premium ceiling. Neither total includes an exposed thigh or lower-arm guard.
The pace bowler uses 3,940 triangles (3,768 body/kit + 172 eyes). The spin bowler retains an original low-detail
48-triangle cap crown and 12-triangle peak, making its complete visible aggregate 4,000 triangles.
The Low/Lite batter uses 6,408 triangles (3,768 body/kit + 172 eyes + 2,196 equipment + 272 bat).
The close/ring fielder uses the same 3,768-triangle body, 172 eye triangles and retained 60-triangle cap. Distant VPM3
fielder body LODs are 1,756 triangles for Premium and 948 for Balanced/Lite, reserving the shared eyes and retained cap inside the locked
complete-player ceilings. The keeper body uses those same bounded meshes, leaving headroom for its retained original
cap/helmet, pads, gloves and web. Including role equipment, the deterministic topology totals are: close/ring fielder
4,000; Premium distant fielder 1,988; Balanced/Lite distant fielder 1,180; standing-back keeper High/Medium/Low
3,108/1,852/1,364; and standing-up keeper High/Medium/Low 3,884/2,372/1,852 triangles. These are source/runtime-selection facts, not device
performance or visual acceptance. The procedural role-equipment overlays remain visual candidates, not accepted art.

The exporter tests establish format, checksum, topology, covered-face removal, region and deterministic-byte facts;
they do not certify appearance. Unity EditMode execution, a fresh WebGL/Android build, complete-ball capture,
left/right-handed mirroring, every-pose clipping, face/identity review, real-player evaluation and independent locked-
rubric review remain open. Therefore this entire bundle remains
`TECHNICAL CANDIDATE / VISUAL, ANDROID SIZE, INDIA REACH UNPROVEN`.

## Unity licensed anatomy fallback (owner: Unity presentation)

`VANDE-HUMAN-ANATOMY-CC0-001` remains the fail-closed MakeHuman anatomy fallback for incomplete/corrupt hero
role bundles. It uses VANDE's older 17-joint/two-weight VPM2 binding plus
procedural equipment/motion, and its combined presentation was independently rejected. Exact upstream rights and
derivation remain recorded under `docs/licenses/makehuman-v1.3.0/`.

| ID | Fallback role / LOD | Repository path | Vertices / triangles | Raw bytes | SHA-256 | Status |
| --- | --- | --- | ---: | ---: | --- | --- |
| `VANDE-HUMAN-ANATOMY-CC0-001-L0` | Close fallback anatomy | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-lod0.bytes` | 13,380 / 26,756 | 915,436 | `1434513f204f06980e4d7e4b81a07052fc967c534c56d668ca84af1157071e0d` | `FALLBACK / CURRENT PRESENTATION REJECTED` |
| `VANDE-HUMAN-ANATOMY-CC0-001-L1` | Gameplay fallback anatomy | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-lod1.bytes` | 2,002 / 4,000 | 145,280 | `479f641cf20358a8b426b7e8825718f3acf7a6752a35ea05d7a6cf6d288e139f` | `FALLBACK / CURRENT PRESENTATION REJECTED` |
| `VANDE-HUMAN-ANATOMY-CC0-001-L2` | Premium distant-fielder fallback | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-lod2.bytes` | 1,002 / 2,000 | 75,924 | `c5de2b10e4cab76bcc9dedbd5662c0cf7c7b9b38d7d297d9eb2cadf151ee1d3d` | `FALLBACK / CURRENT PRESENTATION REJECTED` |
| `VANDE-HUMAN-ANATOMY-CC0-001-L3` | Balanced/Lite distant-fielder fallback | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-lod3.bytes` | 602 / 1,200 | 47,464 | `976edf587f052b1d0517ae6c16ed133ca7ee78d07c4f92fb71a988b13b12d9da` | `FALLBACK / CURRENT PRESENTATION REJECTED` |
| `VANDE-HUMAN-SKIN-CC0-001` | 1024×1024 fallback skin albedo | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/ProductionCharacters/human-skin-albedo-1024.png` | — | 1,065,858 | `a7700f7a538fa723647296416b77713aefda9e6ad3ba037f30bf4c9eab6ad0d0` | `FALLBACK / CURRENT PRESENTATION REJECTED` |

The four fallback meshes total 1,184,104 bytes; with the fallback skin, the retained family totals 2,249,962 raw
bytes. Those values supersede the stale pre-VPM2 figures previously recorded here. They remain source-tree facts,
not installed-size, memory, device, reach or visual-acceptance evidence.

## Unity live procedural fallbacks (canonical disclosure)

These project-original code-generated elements are currently shipped and player-facing around the licensed anatomy.
They preserve a functioning Stage 1 engineering path but are not licensed/final 3D assets. The exact WebGL frame
independently rejected the current combined presentation; a category not visible or judgeable in that single frame
remains non-final rather than visually certified.

| ID | Visible/runtime role | Exact Unity source | Origin and rights | Current exposure | Status |
| --- | --- | --- | --- | --- | --- |
| `UNITY-REF-CHARACTER-OVERLAYS-001` | Primitive kit regions, face, eyes, hair, helmet/grille, pads, gloves, shoes, keeper webs, caps and bat attachment around licensed or retained anatomy | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Characters/ProductionCharacterRig.cs`; `ProductionCharacterResources.cs`; `ProductionBakedCharacterMesh.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/VandeProductionCharacter.shader`; `VandePracticeSurface.shader`; `VandePracticeLit.shader` | Original VANDE procedural code and shaders; licensed anatomy is registered separately; no third-party equipment model | Batter, pace/spin bowler, keeper and fielders on the Unity Stage 1 live path | `REFERENCE_ONLY / CURRENT PRESENTATION REJECTED` — exact frame rejected primitive gear, weak face/cloth detail and robot-like silhouettes |
| `UNITY-REF-MOTION-001` | 17-joint code-sampled stance, run-up, strokes and fielding around canonical trace application | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Characters/ProductionCharacterMotion.cs`; `ProductionCharacterRig.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/ProceduralPracticeWorld.cs` | Original VANDE deterministic presentation code; no mocap or third-party animation | All visible roles; authoritative trace remains external | `REFERENCE_ONLY / CAPTURED POSE REJECTED; FULL MOTION UNPROVEN` — one frame rejected pose/hand/bat coupling but cannot evaluate the complete motion set |
| `UNITY-REF-PROPS-001` | Procedural bat, stumps and bails | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Props/ProductionCricketProps.cs`; `ProductionVisualPrimitives.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/bat-willow-albedo.png`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/VandePracticeSurface.shader`; `VandePracticeLit.shader` | Original VANDE geometry/code/shaders plus the separately registered procedural willow bitmap (`UNITY-TEX-WILLOW-002`) | Batter bat and both wickets visible in live Practice | `REFERENCE_ONLY / CURRENT PRESENTATION REJECTED` — primitive bat/wicket treatment and visual layering failed frame review |
| `UNITY-REF-BALL-001` | Law-scale procedural ball, seam and rough/polished hemispheres | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Props/ProductionCricketProps.cs`; `ProductionVisualPrimitives.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/VandePracticeSurface.shader`; `VandePracticeLit.shader` | Original VANDE procedural code and shaders; no third-party model | Canonical live ball trace; not established in the reviewed run-up frame | `REFERENCE_ONLY / NON-FINAL; VISUAL ACCEPTANCE UNPROVEN` |
| `UNITY-REF-GROUND-001` | Procedural field, pitch, crease, rings, boundary and sight screens around procedural pitch/grass textures | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Environment/ProductionCricketEnvironment.cs`; `ProductionPitchLooks.cs`; `ProductionFieldPresentation.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Props/ProductionVisualPrimitives.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/pitch-balanced-albedo.png`; `outfield-grass-albedo.png`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/VandePracticeSurface.shader`; `VandePracticeLit.shader` | Original VANDE geometry/code/shaders plus the separately registered procedural bitmaps `UNITY-TEX-PITCH-002` and `UNITY-TEX-GRASS-002` | Full Stage 1 live field and pitch | `REFERENCE_ONLY / CURRENT PRESENTATION REJECTED` — pitch/outfield/material match and foreground layering failed frame review |
| `UNITY-REF-STADIUM-CROWD-001` | Procedural stands, sight screens, floodlights and deterministic crowd around procedural sky/backdrop candidates | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Environment/ProductionCricketEnvironment.cs`; `ProductionCrowdView.cs`; `ProductionEnvironmentAtmosphere.cs`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Textures/sky-late-afternoon-panorama.png`; `stadium-day-background-v2.png`; `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/VandeStadiumBackdrop.shader` | Original VANDE procedural code/shader plus the separately registered procedural bitmaps `UNITY-TEX-SKY-002` and `UNITY-TEX-STADIUM-DAY-003` | Live Stage 1 stadium/crowd and outcome-driven crowd state | `REFERENCE_ONLY / CURRENT PRESENTATION REJECTED` — procedural backdrop (`UNITY-TEX-STADIUM-DAY-003`, re-lit 2026-11-03) is live, but scene lighting/material integration and crowd/player match failed frame review |
| `UNITY-REF-AUDIO-001` | Runtime-synthesized event clips and feedback sink when authentic authored recordings are absent | `unity/VandePractice/Assets/VandePractice/Runtime/Audio/Production/ProductionFeedbackClipLibrary.cs`; `ProductionPracticeFeedbackSink.cs` | Original VANDE synthesis code; no third-party recordings or samples | Current Unity engineering fallback for exposed Practice feedback | `REFERENCE_ONLY / NON-AUTHENTIC` — no authentic recorded transients and no blind/device acceptance |
| `UNITY-PRACTICE-BOARDS-001` | Practice boundary boards: 8 dark, muted, original panels (wicket, seamed ball, bat, weave), with no words, brand or logo; 2048×64 strip (1024×32 on Lite), 31 repeats on the 0.40 m boards | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Environment/ProductionPracticeBoards.cs`; `ProductionCricketEnvironment.cs` | Original VANDE code, a C# port of the web `paintPracticeBoards`; no external asset | Unity live Practice boards, in place of the former navy and amber cushions | `IMPLEMENTED / VISUAL ACCEPTANCE OPEN` (wedge `unity/REPORT.md` U5–U6) |
| `UNITY-FIELDING-CLIPS-001` | 21 fielder and keeper clips, plus the choreography that places them on the physics trace | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Characters/ProductionFieldingClips.cs`; `ProductionFieldingChoreography.cs` | Original VANDE code, ported key for key from the web `clips.ts` and `fielding.ts`; no mocap | Every non-bowler fielder and the keeper in Unity live Practice | `IMPLEMENTED / CREDIBILITY UNPROVEN` (wedge `unity/REPORT.md` §4) |
| `UNITY-AUDIO-APPLAUSE-001` | The licensed recorded applause takes TC-12-01 to TC-12-04, byte-identical to `public/audio/cricket/applause-1.mp3` to `applause-4.mp3`, imported as Vorbis at 24 kHz | `unity/VandePractice/Assets/VandePractice/Runtime/Audio/Resources/Audio/Cricket/applause-1.mp3` to `applause-4.mp3`; `unity/VandePractice/Assets/VandePractice/Runtime/Audio/Production/ProductionRecordedManifest.cs`, `ProductionRecordedTakes.cs`, `ProductionRecordedTakeBank.cs` | Licensed as in the web "Recorded applause takes" row; the attribution in `public/third-party-notices.txt` covers the Unity library too | Unity live Practice crowd applause; the synthesised voice stays the fallback | `CANDIDATE` (owner blind A/B pending; Android and WebGL timing UNPROVEN) |
| `UNITY-AUDIO-PLACEHOLDERS-001` | The 54 placeholder takes, byte-identical to the web files, imported as Vorbis q0.6 at 48 kHz | `unity/VandePractice/Assets/VandePractice/Runtime/Audio/Resources/Audio/Cricket/ph-*.mp3` (+ `.meta`); `ProductionRecordedManifest.cs` ContactTakes | Original (VANDE) | Unity live Practice contact sounds; the synthesised clips stay the fallback | `PLACEHOLDER` (StandaloneOSX +65,800 packed; Android and WebGL UNMEASURED) |

## Unity retained-player mesh candidates (owner: Unity presentation)

These files are deterministic binary bakes of VANDE's own retained Three.js procedural cricket-human source. They
add no third-party model, likeness, team, kit, sponsor or marketplace licence. The prompt-equivalent source contract
is `scripts/export-unity-player-meshes.mjs`: select one original batter and one original bowler variant, compact both
existing LODs, reverse triangle winding for Unity, and preserve the shared 17-joint skin bindings plus material-region
facts. `provenance.json` binds the exact source and output hashes. They are a better engineering bridge than Unity
capsules, not the missing production human/mocap asset, and therefore remain `CANDIDATE / UNPROVEN`.

| ID | Role / LOD | Repository path | Vertices / triangles | Raw bytes | SHA-256 | Status |
| --- | --- | --- | ---: | ---: | --- | --- |
| `UNITY-MESH-BATTER-L0-001` | Batter close/gameplay | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters/batter-lod0.bytes` | 9,138 / 13,688 | 484,216 | `3ee66f51ee12c5d7826f1645360f34a2aa5824bdf282d359baf439ea9c36f44d` | `CANDIDATE / UNPROVEN` |
| `UNITY-MESH-BATTER-L1-001` | Batter low | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters/batter-lod1.bytes` | 1,358 / 1,680 | 69,848 | `547a876e02685acd60791fbd4f1c713c31334538989ca6bb97ddd8e5df1ba849` | `CANDIDATE / UNPROVEN` |
| `UNITY-MESH-BOWLER-L0-001` | Pace/spin bowler close/gameplay | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters/bowler-lod0.bytes` | 5,271 / 8,036 | 280,156 | `70b74d2b760cb9d7dcf8486bbcc85bdab4822288f079f20aa151abcf9d025711` | `CANDIDATE / UNPROVEN` |
| `UNITY-MESH-BOWLER-L1-001` | Pace/spin bowler low | `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters/bowler-lod1.bytes` | 980 / 1,304 | 50,960 | `f702f7d8f83b1590d3ddc7fbcbc25ae5ffb5eeca52a2681558bca61565e940ea` | `CANDIDATE / UNPROVEN` |

The four binaries total 885,180 raw bytes. The generated provenance record is 3,728 bytes at
`unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Characters/provenance.json` (SHA-256
`d1f3b70806761270068a7b5bbad254b50286e2801941f90b1d5d0906e4ee0003`). The original regional surface shader is
`VandeProductionCharacter.shader` (23,593 bytes; SHA-256
`287b0a36191bbbe3a08957790bfec0897ac354e78339ddd379a99f142e06caed`). The daylight facade uses the original
`VandeStadiumBackdrop.shader` (4,026 bytes; SHA-256
`e3b562369fac0214d6680555253243289aa8764f59b8fb03a68f93da488e4373`; re-measured by EVAL-ASSETS 2026-11-03, the earlier 3,817-byte value predated a 2026-10-30 edit) and uses a red-ball sight-screen cutout plus
a restrained transparency band for the emotion-driven three-dimensional crowd; the field remains in front. These source-tree byte counts are not
Android installed-size deltas. Unity import cost, exact APK/AAB and fresh-installed deltas, runtime memory, thermal,
frame-pacing, visual/device acceptance and India-weighted reach are pending and remain `UNPROVEN`.

## Equipment, ground and stadium (owner: art)

| Asset | Purpose | Source | Polygons | Textures | Materials | LODs | Animation | Tier variants | Memory | Load | Status | Device |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bat | Every bat (batter, non-striker, first person; overlays reuse its geometry for ghost bats) | `props.ts` `createBat`, `batGeometry`, `paintBat*` | 4,740 (one mesh, shared geometry) | 512 × 1024 RGBA atlas (colour + roughness in alpha) and a 256 × 512 normal map, painted once per page | 1 (MeshStandard, patched for roughness) | 1 | Rigid, placed on the physics pose each frame | Same in all tiers | ≈ 3.5 MB (textures with mips) + 0.2 MB geometry | ≈ 45 ms on first use, then 0 (shared) | Accepted at gameplay distance and in first person: willow grain, splice, face mark, spine decal, ball marks around the physics sweet spot, edge scuffs, toe dirt, twine and grip. Close-up: the face mark and grip read well; the bow and the edges' rounding are subtle; no wood-fibre micro detail. Drawn blade width is exactly 10.80 cm, the Law 5 maximum (it was 1.2 mm over; Track D, wedge `world/REPORT.md`) | Not verified |
| Wicket, painted wood | Both wickets: stumps and bails | `props.ts` `createStumps`, `stumpGeometry`, `bailGeometry` | 6 × 720 + 4 × 616 = 6,784 | 64 × 512 stump finish (cream enamel, navy band with cyan keyline, soil at the foot) | 2 | 1 | Closed-form in time from the script's stump hit: the struck stump knocked back (uprooted by a fast ball), its neighbours flex, the bails fly, bounce once and slide to rest | Same in all tiers | ≈ 0.2 MB | < 5 ms | Accepted: Law 8 dimensions (tested), domed tops with grooves, turned bails with barrel, collars and spigots seated in the grooves | Not verified |
| Wicket, illuminated (LED) | Original light-up variant (`StumpsFx.setLed(true)`) | `props.ts` `createStumps` | as above | 64 × 512 graphite finish and a 64 × 512 glow mask | 4 (per-end, so only the broken wicket lights) | 1 | Calm pulses for a second after the hit, then a fading glow | Same in all tiers | ≈ 0.4 MB | < 5 ms | Accepted at gameplay distance; the light windows are painted, not modelled | Not verified |
| Pitch surfaces | The 22-yard strip for Balanced, Green, Hard & Bouncy, Dusty (physics 'turning') and Dry | `stadium.ts` `pitchLook` (from `src/physics` PITCHES), `pitchMacroTexture`, `pitchMicroTexture`, `patchGround` | Part of the ground mesh (below) | Macro masks 256 × 1024 (wear, rough, soil variation, grass density) over the whole strip; tiling micro detail 512² (lite 256²) over 0.8 m (grain, grass blades, crack networks); creases analytic | Shares the ground's one material | 1 (lite: one micro sample and no bump) | Static (uniforms change between balls) | lite: 2 texture reads per pixel; standard and high: 3 reads plus a bump from cracks, footmarks and grass | ≈ 2.8 MB (lite ≈ 1.75 MB) | ≈ 48 ms macro + 84 ms micro (26 ms in lite), once per page (cached) | Accepted at gameplay distance: five distinct surfaces derived from the physics (tested); worn creases at Law positions (tested), bowlers' footmarks, the batter's guard, rough outside a right-hander's off stump, patchy grass, polygonal and hairline cracks. Close-up: cracks are flat (no depth or crumbled edges), grass is a texture not blades. Ball-mark wear near the bounce was tried and rejected: it lowered the ball's contrast at the bounce (Track D readability gate, wedge `world/REPORT.md`) | Not verified |
| Practice bounce scuff | The mark the ball leaves where it pitched, from the bounce on (no particles) | `props.ts` `createEventFx` (Practice), `paintScuff` | 2 | 64 × 128 | 1 | 1 | Appears at the bounce event, lies along the ball's ground track | Same | < 0.1 MB | < 1 ms | Accepted: small, subtle, not a landing marker before the bounce | Not verified |
| Outfield | Grass with straight mowing stripes whose tones swap with the view direction, blade detail near the camera, the 30-yard ring's painted dashes | `stadium.ts` `patchGround` | ≈ 320 (one disc; the pitch shares it) | Reuses the micro texture | 1 (shared with the pitch) | 1 | None | lite: one texture read | — | — | Accepted at gameplay distance | Not verified |
| Boundary | A padded navy cushion with a chevron print and stitched seam, and a three-strand rope along its field side | `stadium.ts` (`paintCushion`, `paintRope`) | 6,400 + 8,640 | 512 × 64 and 64 × 16, tiled | 2 | 1 | None | Same | ≈ 0.2 MB | < 5 ms | Accepted at gameplay distance | Not verified |
| Sight screens | Behind both ends, 18 × 7.5 m at BOUNDARY_R + 6.5, on steel frames with trusses and wheels | `stadium.ts` `SIGHT_SCREEN`, `SIGHT_TONES`, `setSightScreens` | 24 + frames | 256 × 128 (faint panel seams) | 1 (+ the shared steel) | 1 | None | Same | < 0.2 MB | < 2 ms | Accepted: the release and early flight are always against them (tested for both arms, both hands, release heights 1.8–2.3 m); dark behind a white ball (contrast 17:1 against 1.1:1 on white), off-white behind a red one (6.3:1 against 2.4:1 on dark), matte, no glowing edges | Not verified |
| Sky and environment | Sky dome per environment: gradient, horizon haze, the sun disc, clouds, stars; six looks (day, late afternoon, evening × clear, overcast) | `stadium.ts` `ENVIRONMENTS`, `skyMaterial`, `setEnvironment` | 960 | none (shader) | 1 | 1 | Clouds drift on the decorative clock (frozen in Quiet Mode) | lite: cheaper cloud noise | — | — | Accepted at gameplay distance: believable gradients and haze, correct sun and shadow direction; clouds are soft noise, not modelled clouds | Not verified |
| Lights | Hemisphere fill, key (the sun by day, a floodlight tower at night) with the shadow map, a rim light | `stadium.ts` `applyLook` | — | — | — | — | Static per environment | Shadow map per the profile (none in lite) | — | — | Accepted | Not verified |
| Ball environment map | Reflections on the ball's polished half (sun and sky, or the floodlight banks) | `stadium.ts` `buildEnvMap` (`setRenderer` + `setEnvironment`, PMREM 64, cached per look) | — | 64-px PMREM (cube-UV) | — | — | Built between balls, never per frame | Same | ≈ 0.4 MB per look used | ≈ 25 ms for the first (the PMREM shaders), 6–8 ms per new look, 0 when cached | Accepted as a mechanism; the visual result belongs to the ball (presentation core) | Not verified |
| Stands | Two tiers of stepped rows; the painted crowd and seating per seat cell: section colours, aisles with steps, vomitories, shirts and heads (rows from the front, heads from above), arms up with the excitement, phone lights at night | `stadium.ts` `tierGeometry`, `patchStands` | lite 5,632; standard and high ≈ 15,500 | none (shader) | 1 | 1 | Arms and phone lights follow the excitement; still at a hush; frozen in Quiet Mode | lite: one average colour per seat (no figure detail) | — | ≈ 10 ms | Accepted at gameplay distance; close up it is a painted pattern, not people | Not verified |
| Instanced crowd | Spectators in the front rows of the lower tier: seated, clapping, cheering, hands on heads, standing, a wave; regional colour blocks; localized reactions near the ball | `stadium.ts` `spectatorGeometry`, `crowdMaterial`, `setExcitement`, `setCrowdFocus`, `setCrowdMood` | lite 1,400 × 80 (112k); standard 3,600 × 114 (410k); high 6,500 × 114 (741k) | none (instance attributes: shirt, skin, hat, sleeves, seat, thresholds) | 1 | 2 (geometry per tier) | Vertex shader from the excitement (the emotion signal): still at a hush (≤ 0.12), fidget, clap, cheer or dismay by the mood, standing at each spectator's own threshold (standard, high), a wave of standing at full voice (high), stronger near setCrowdFocus (high, half in standard) | lite: static, sparse; standard: animated, standing; high: all, waves, focus | ≈ 0.8 MB (instance buffers sized for 6,500 in every tier) | < 20 ms | Not accepted close up: box-and-sphere figures with no faces; accepted as distant crowd at gameplay distance | Not verified |
| Crowd banners and flags | 48 hand-held flags in the front rows (high tier): hidden at a hush, raised and waving with the excitement and near the ball | `stadium.ts` `crowdBannerGeometry`, `crowdBannerMaterial` | 48 × 28 | the flag atlas (512 × 256, shared) | 1 | 1 | Vertex shader from the excitement: they come up in celebrations, after the ball is dead, never in a delivery's hush | High only | < 0.1 MB | < 1 ms | Accepted at gameplay distance | Not verified |
| Pavilion and players' area | Behind the bowler's end: sandstone building with two storeys of glazed balconies, the dressing rooms' balconies, a clock-tower gable with the VANDE mark, the players' gate and steps, a covered dugout | `stadium.ts` `buildStructures`, `paintFacade` | ≈ 1,500 | 1024 × 512 facade and window-light mask (512 × 256 in lite) | 3 | 1 | None (windows lit at night) | lite: half-size art | ≈ 5.6 MB (lite 1.4 MB) | ≈ 15 ms | Accepted at gameplay distance (it sits above the far sight screen); boxy in close-up | Not verified |
| Scoreboard | Behind the striker's end on a stand with the same facade: an original display (VANDE mark, seven-segment numerals at rest, progress bars; no text) | `stadium.ts` `paintScoreboard` | ≈ 200 | 1024 × 384 (512 × 192 in lite) | 1 | 1 | Static | lite: half-size art | ≈ 2 MB (lite 0.5 MB) | < 10 ms | Accepted at gameplay distance | Not verified |
| LED boards and fascia | Boundary boards and the ribbon between the tiers: VANDE's own lines and glyphs | `stadium.ts` `boardTexture` | 400 + 400 | 2048 × 64 (1024 × 32 in lite), tiled | 2 | 1 | Scroll on the decorative clock; frozen in Quiet Mode; flash on boundaries and wickets | lite: half-size art | ≈ 1.4 MB (lite 0.35 MB) | < 10 ms | Accepted | Not verified |
| Practice boundary boards and fascia | The Practice ground's boards: 8 dark, muted, original panels (wicket, seamed ball, bat, weave) with no wording, brand, team or logo, in place of the match boards' Sealed Six lines; the match renderer keeps its boards | `stadium.ts` `paintPracticeBoards` (`StadiumSignage` `'practice'`, from `ThreePracticeStage.ts`) | shares the LED boards' meshes | 2048 × 64 (1024 × 32 in lite), shares the board and fascia materials | 2 | 1 | Static | lite: half-size art | same as the LED boards row | < 10 ms | Implemented (Track D, wedge `world/REPORT.md`); visual acceptance open | Not verified |
| Floodlights | Six towers: tapered poles, headframes, lamp banks (a lens grid), glow billboards, light shafts (high) | `stadium.ts` `buildStructures`, `paintLamps` | ≈ 1,000 + shafts | 256 × 160 lamp grid, 128 × 128 glow | 3 | 1 | Lamps on under lights, partly in late afternoon, off by day | Shafts only in high | ≈ 0.3 MB | < 5 ms | Accepted at gameplay distance | Not verified |
| Roof, walls, railings, camera platforms, flags | The cantilever roof and its soffit light, parapet and back walls, steel railings, four camera platforms (none behind the bowler's arm), eleven original flags | `stadium.ts` `buildStructures`, `paintFlags` | ≈ 4,000 | 512 × 256 flag atlas | 4 | 1 | Flags wave on the decorative clock; frozen in Quiet Mode | lite: coarser flags | ≈ 0.7 MB | < 5 ms | Accepted at gameplay distance | Not verified |
| Blob shadows | Soft contact shadows: one per floodlight tower at night (up to the profile's count), one by day pointing away from the sun, longer for a low sun | `props.ts` `createBlobShadows` (sources from `Stadium.shadowSources()`) | 2 per shadow | 64 × 128 | 1 | 1 | Per frame from player positions | Count per profile | — | — | Accepted | Not verified |

Stadium totals (meshes, triangles as drawn): lite 37 meshes and 143k triangles, standard 37 and 452k, high 37 and 783k
(most of it the instanced crowd). Measured draw calls in the live first-person view: lite 56, standard 66, high 76
(before this work: 53, 63 and 74).

## Players (owner: art)

All players are one skinned mesh each (a single draw call) built from code on the shared 17-bone skeleton, painted per
region in one patched MeshStandardMaterial (no textures). Variants (hair styles, the full beard, headgear) live in the
geometry and are switched per player by uniforms, so every player of a gear shares one geometry and one shader. Seeded
variety from `avatarTraits` (skin and its shade, hair colour and style, beard, brows, eye shape, height) and per-player
hashes (iris, blink phase).

| Asset | Purpose | Source | Polygons (LOD0 / LOD1) | Textures | Materials | LODs | Animation | Tier variants | Memory | Load | Status | Device |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Batter | Striker and non-striker: helmet (shell, peak, ear guards, neck guard, padding, a steel grille of three bars and three uprights about 6 cm below the peak, chin strap), batting gloves with finger and thumb rolls and cuffs, pads with six vertical rolls, a knee roll, thigh rolls, side wings and three straps, spiked shoes with soles | `players.ts` `bodyParts('batter')`, `helmetParts`, `handParts`, `padParts`, `shoeParts` | 13,688 / 1,680 | none | 1 (+ ghost twin, + depth) | 2 (switch at the profile's distance: 9 / 22 / 40 m) | Driven by the choreography clips and IK (stageScene) | LOD distance per profile | ≈ 0.6 MB geometry per gear | ≈ 20 ms first build per gear (shared after) | Accepted at gameplay distance: equipment reads correctly and is the right scale. Not accepted in close-up: primitive-built forms, no cloth, no stitching on the gear, no real hands | Not verified |
| Wicketkeeper | Keeper gloves (broad padded mitts with webbed thumbs), shorter keeping pads with five rolls, helmet standing up or cap standing back (`setRigHeadgear`) | `players.ts` `bodyParts('keeper')` | 15,896 / 2,394 | none | 1 | 2 | Clips (keep_crouch, keep_take, keep_stump) | as above | ≈ 0.7 MB | ≈ 17 ms | Accepted at gameplay distance; not in close-up | Not verified |
| Fielders and bowler | Original kit (collar, placket and buttons, side panels, seams, a fabric weave fading with distance; five patterns), trousers with belt and seams, spiked shoes, bare hands with fingers; caps (crown seams and piping), sun hats, bareheaded, patka | `players.ts` `bodyParts('fielder' / 'bowler')`, `kitColor` | 12,776 / 2,286 (bowler 11,336 / 1,908) | none | 1 | 2 | Clips | as above | ≈ 0.6 MB | ≈ 12 ms | Accepted at gameplay distance; not in close-up (no cloth folds, sleeves are tubes) | Not verified |
| Practice fielding clips | Fielder and keeper bodies on the physics paths: `run_drive`, `field_pickup`, `field_throw`, `field_fumble`, `field_spill`, `field_dive_r` / `field_dive_l`, `keep_dive_r` / `keep_dive_l`, `keep_shuffle`, `hands_on_hips` | `src/render3d/practice/fielding.ts`, `core/clips.ts` (code-authored, original; no textures, no mocap) | none (uses the fielder and keeper rigs) | none | — | — | Placed by the physics trace: bodies stay on the physics path and every throw releases at the physics time | Same in all tiers | +7,488 raw / +1,426 deflate bytes in the choreography chunk | 0 (no asset load) | Implemented (Track D, wedge `world/REPORT.md`); visual acceptance open | Not verified |
| Umpires | Neutral original dress: dark navy shirt (behind the bowler's arm), charcoal trousers, long sleeves, a dark navy wide-brimmed hat | `players.ts` `dressRig` (`UMPIRE_*`), `hatParts` | 11,800 / 2,060 | none | 1 | 2 | Clips (ump_stand, signals) | as above | ≈ 0.6 MB | ≈ 11 ms | Accepted at gameplay distance: never a light shape behind the release (tested shirt luminance) | Not verified |
| Faces and heads | Sculpted head (jaw angle, chin, brow ridge, eye sockets, cheekbones, the mouth's muzzle), wedge nose with nostril wings, ears; painted eyes (sclera, iris, pupil, a catch light, lashes, lid crease) that blink on the stadium clock, three eye shapes, three brow shapes, lips, socket and nose shading; soft wrap lighting on skin; hair shells for six styles with a painted hairline; stubble, moustache, short and full beards; expressions (concentration, effort, frustration, relief, celebration) by `setRigExpression` | `players.ts` `sculpt`, `noseGeometry`, `earGeometry`, `hairShell`, `beardShell`, `skinColor` | part of the counts above (head ≈ 1,300 at LOD0) | none | — | 2 (LOD1 has no nose, ears or painted detail beyond the eyes) | Blinks (deterministic, per-player phase); expressions by uniform | — | — | — | Not accepted: stylised, readable at gameplay distance (a face 10–30 px tall), clearly not photoreal in close-ups: the eyes are painted on the surface, there is no eyelid geometry, teeth, specular eye, pore detail, subsurface scattering or facial rig; hair is a smooth shell | Not verified |
| First-person gloves and bat | The batter's own gloves in the lower corner: finger rolls round the handle, palm, padded back with an original VANDE chevron, thumb roll, cuff with a kit-coloured band; the bat (createBat) on the physics pose | `firstPerson.ts` `gloveGeometry`, `createFirstPerson` | 8,440 (two gloves and the bat) | 64 × 64 mark | 4 | 1 | Placed on the physics pose (or the ready pose) each frame; mirrored for left-handers | Same in all tiers | < 0.5 MB | 2 ms | Accepted at gameplay distance: reads as a batting glove on the handle in the corner, inside the old envelope, clear of the ball's path. Close-up: rolls are tori, no leather texture or stitching | Not verified |

## Web brand icons and link card (owner: lead; added 2026-11-03 after EVAL-ASSETS)

Generated by `npm run assets` (`scripts/brand/build.mjs`): the mark is drawn from `src/ui/brand/mark.ts`; the wordmark is
outlined from Manrope (SIL Open Font License 1.1, `@fontsource/manrope`); the link card's stadium is a frame from the
game's own renderer. No traced, licensed or downloaded artwork. Files date from 2026-10-25 and were not regenerated in
this wave; reproduction from the current generator is unverified.

| ID | File | Bytes | SHA-256 | Status |
| --- | --- | --- | --- | --- |
| `WEB-BRAND-FAVICON-SVG` | `public/icons/favicon.svg` | 1,702 | `78a96fa9d67814ed32c1ad918fb0122d63776570a05da5eae3a48b9e3aa5f124` | Shipped; VANDE original |
| `WEB-BRAND-FAVICON-32` | `public/icons/favicon-32.png` | 2,680 | `ce8cbcd2bd57b50a42fe9461ceeb56557713dccaae9308096185ff7e250f2438` | Shipped; VANDE original |
| `WEB-BRAND-ICON-192` | `public/icons/icon-192.png` | 30,201 | `291d9d467906678bbf61e732c857471da2b10737462f08fa734b80531697f068` | Shipped; VANDE original |
| `WEB-BRAND-ICON-512` | `public/icons/icon-512.png` | 88,371 | `06f39df9c4c7bbd371142e6cb6b1a215c2fcf4855e054c91d52a68074f16c9ac` | Shipped; VANDE original |
| `WEB-BRAND-MASKABLE-512` | `public/icons/maskable-512.png` | 85,217 | `526af80420df5932f8f260456020d7fc15e34fe935b1a925fa97b8379337b2db` | Shipped; VANDE original |
| `WEB-BRAND-APPLE-TOUCH` | `public/icons/apple-touch-icon.png` | 27,318 | `ebc07bae5dd06008b00c25d8562d6887238ece0cc20a30899d9ce7d19ed96ff5` | Shipped; VANDE original |
| `WEB-BRAND-OG-CARD` | `public/og/og-card.png` | 181,383 | `46ce5425e182578518c67e1bd29407adf2afd9672c558586b8c3174d6e29b00c` | Shipped; VANDE original (link previews are Stage 6) |

**Stale exports (EVAL-ASSETS, 2026-11-03).** The untracked Unity WebGL export in `public/unity/` (exported 03:21Z) and
the Android export in `unity/VandePractice/Builds/Android` (2026-10-31) predate the texture replacement; the WebGL
`VandePractice.data` still embeds the five withdrawn OpenAI textures. Neither may ship: both are re-exported in I1 before
any build, deploy or release evidence. `dist-unity-preview/` (Codex's preview) carries the same stale payload.

## Presentation core assets (owner: presentation core)

Details to be completed by the presentation core.

| Asset | Purpose | Source | Polygons | Textures | Materials | LODs | Animation | Tier variants | Memory | Load | Status | Device |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ball | Match and Practice ball: polished and rough hemispheres, restrained scuffs, raised seam, Practice surround/shadow/trace and match-only outline/glow | `src/render3d/three/ball.ts`, `practice/ballLook.ts` | 1,808 surface triangles (two 24×16 hemispheres, seam and three scuff arcs), plus presentation meshes | No unique surface texture; generated shared glow texture only for the shadow/surround support and match effect | 4 surface materials (polished, rough, seam, scuff), plus presentation materials | 1 | One rigid surface: release orientation comes from `BallFlight.seam.axis` / `shine`, then turns about `ballRotation(flight)` so scrambled seams wobble | Same source surface all tiers; Classic camera-projects the exact axes; CSS-pixel live and close-up size policy shared | Geometry/material cost not yet measured | Not yet measured | Implemented; independent close-up/gameplay visual acceptance remains open | Not verified |
| Overlays | Diagnostic replay overlays: paths, timing bands, ghost bats, contact markers, the landing cue, the edge flash | `src/render3d/three/overlays.ts` | TBD | TBD | TBD | TBD | Revealed in step with the replay | TBD | TBD | TBD | TBD | Not verified |
| Coach ghost batter and bat | Coach Mode's complete demonstration batter: the existing striker rig is temporarily translucent; its ordinary clip, footwork and exact physics bat remain authoritative, then the rig is actively restored | `ThreePracticeStage.ts`, `stageScene.ts`, `players.ts`, `practice/session.ts` | as the batter and bat | — | existing per-rig ghost material (prewarmed) plus the ordinary bat material | as the batter | Existing full-body clip and physics bat track, fixed `demo_side` camera | 3D on Premium/Balanced; projected full silhouette and exact bat in Classic | No additional geometry; one already-created ghost material per rig | No runtime asset creation on entry | Implemented; independent visual acceptance remains open | Not verified |
| Ball training close-up | The same release ball held large, then leaving slowly; exposes maintained/rough sides, raised seam and scuffs without changing the delivery | `practice/session.ts`, `core/camera.ts`, `three/ball.ts`, `fallback2d/batterView.ts` | reuses the ball above; Classic is Canvas paths | none | reuses ball materials; Canvas uses restrained solid/gradient fills | 1 | Existing close-up time warp; exact seam plane, polished pole and physical rotation remain distinct | Same 92–260 CSS-pixel bounded size policy in 3D and Classic | No additional persistent geometry | No runtime asset creation on entry | Implemented; independent close-up acceptance remains open | Not verified |

## Audio

Owner: audio (`src/audio/**`, docs/AUDIO.md). Every audio asset is **original**: synthesised in code by this repository, with no recordings, samples, sound libraries or third-party audio, except the licensed recordings registered in the wedge sound `REGISTER.md` (`release/product-sequence/stage-1-practice/wedge/sound/REGISTER.md`; CC0 or CC BY only), each with a synthesised fallback, and the placeholder takes: original synthesis rendered offline by `scripts/audio/placeholders.mjs` and shipped as files. Licence of the original assets: the project's own (UNLICENSED, proprietary to VANDE). Polygon, texture, material, LOD and animation fields do not apply to sound. Audible acceptance is by unit test (deterministic render, loudness, order, distinct signatures) and has not been rated by a human listening test. Physical-device verification: not done.

| Asset | Purpose | Source | Status | Variants | Memory | Load cost | Acceptance | Device |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Effects sprite | Every Practice effect and interface voice, played from one buffer | `src/audio/bank.ts` (renders the rows below) | Original, synthesised | One per surface, pace and contact | about 1.8 MB (9.4 s mono at 48 kHz) | One OfflineAudioContext render in idle time, off the main thread | Unit tests: layout, render, two-node playback | Not verified |
| fx `release_slow` | Release whoosh, slower bowlers | `voices.release` | Original, synthesised | none | 60 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `release_fast` | Release whoosh, pace | `voices.release` | Original, synthesised | none | 60 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `bounce` | Pitch contact, balanced surface | `voices.bounce` | Original, synthesised | none | 30 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `bounce_hard` | Pitch contact, hard surface (a crack) | `fxVoices.bounce` | Original, synthesised | none | 26 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `bounce_green` | Pitch contact, green surface (a soft thud) | `fxVoices.bounce` | Original, synthesised | none | 34 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `bounce_turning` | Pitch contact, turning surface (a puff with grit) | `fxVoices.bounce` | Original, synthesised | none | 38 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `sweet` | Bat contact, sweet spot (crack and bright ring) | `voices.bat + voices.ring` | Original, synthesised | none | 94 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `middle` | Bat contact, middle (crack and ring) | `voices.bat + voices.ring` | Original, synthesised | none | 64 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `mistimed` | Bat contact, mistimed middle (thock) | `fxVoices.mistimed` | Original, synthesised | none | 41 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `block` | Defensive block (damped dead-bat thud) | `fxVoices.block` | Original, synthesised | none | 30 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `edge_thick` | Inside or leading edge | `voices.edge` | Original, synthesised | none | 22 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `edge_thin` | Outside edge | `voices.edge` | Original, synthesised | none | 22 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `top_edge` | Top edge (hollow tock, rattle) | `fxVoices.topEdge` | Original, synthesised | none | 22 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `swish` | The swing of a miss | `voices.swish` | Original, synthesised | none | 34 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `pad` | Ball on pad | `voices.pad` | Original, synthesised | none | 38 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `body` | Ball on body | `fxVoices.body` | Original, synthesised | none | 30 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `stumps` | Stumps broken | `voices.stumps` | Original, synthesised | none | 49 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `bails` | Bails off (LED stumps) | `voices.bails` | Original, synthesised | none | 79 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `gloves` | Keeper take, catch | `voices.gloves` | Original, synthesised | none | 26 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `fielded` | Ball fielded | `voices.fielded` | Original, synthesised | none | 26 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `throw` | Throw | `voices.throw` | Original, synthesised | none | 45 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `board` | Ball into the boundary boards | `fxVoices.board` | Original, synthesised | none | 41 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `dhol` | Celebration music after a four or six (music bus) | `voices.drums` | Original, synthesised | none | 304 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `ui_select` | Interface: selection tick | `fxVoices.uiSelect` | Original, synthesised | none | 17 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `ui_confirm` | Interface: confirmation | `fxVoices.uiConfirm` | Original, synthesised | none | 51 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `seal` | Interface: over locked (seal chime) | `voices.seal` | Original, synthesised | none | 107 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `mastery` | Coach Mode mastery chime | `fxVoices.mastery` | Original, synthesised | none | 188 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| fx `stage_up` | Coach Mode: less assistance next time | `fxVoices.stageUp` | Original, synthesised | none | 75 KB of the sprite | in the sprite | Unit test (signature, timing) | Not verified |
| Crowd reactions | The crowd's reactions (src/audio/emotion.ts decides which) | `src/audio/crowdVoices.ts`, `src/audio/dsp.ts` | Original, synthesised (deterministic DSP) | none | about 1.4 MB in all (22 s mono at 16 kHz) | Idle slices of 512 samples, paused during deliveries; about 180 ms desktop CPU in all | Unit tests: deterministic, loudness ±0.5 LU, peak ≤ 0.95, timbre order | Not verified |
| crowd `lift` | The crowd lifting as a hit goes somewhere | `CROWD_RECIPES.lift` | Original, synthesised | none | 69 KB | idle slices | -21 LUFS at unit gain | Not verified |
| crowd `ooh` | Close call or edge (tension) | `CROWD_RECIPES.ooh` | Original, synthesised | none | 84 KB | idle slices | -20 LUFS at unit gain | Not verified |
| crowd `groan` | Missed opportunity | `CROWD_RECIPES.groan` | Original, synthesised | none | 112 KB | idle slices | -21 LUFS at unit gain | Not verified |
| crowd `relief` | Survival after a close call | `CROWD_RECIPES.relief` | Original, synthesised | none | 100 KB | idle slices | -23 LUFS at unit gain | Not verified |
| crowd `applause` | Runs (acknowledgement) | `CROWD_RECIPES.applause` | Original, synthesised | none | 156 KB | idle slices | -21 LUFS at unit gain | Not verified |
| Recorded applause takes | The crowd's applause for runs, in place of the synthesised `applause` reaction (which stays the fallback) | `public/audio/cricket/applause-1.mp3` … `applause-4.mp3`; `src/audio/recordedManifest.ts`; wedge `sound/REGISTER.md` TC-12-01 … TC-12-04 | Licensed recordings: CC0 1.0 (Sandermotions, Amada44), CC BY 3.0 (RHumphries), CC BY 4.0 (Thomas Bresson); attribution in `public/third-party-notices.txt`. Indoor audiences, **not a cricket ground**. `CANDIDATE` | 4 takes, chosen from the delivery record (seed, over, ball) | 111,288 bytes on disk; about 960 KB decoded (24 kHz mono, not measured on a phone) | 4 background fetches and decodes, never started during a delivery; SHA-256 checked | Unit tests: byte and SHA-256 match, −21 LUFS ± 0.5, peak ≤ 0.95, deterministic, fallback. Owner blind A/B pending (WA9 PROVISIONAL). | Not verified |
| Placeholder contact takes | The 18 contact sounds, in place of their live synthesised voices (which stay the fallback) until recordings replace them | `public/audio/cricket/ph-<sound>-1..3.mp3` (54) and their Unity copies; `src/audio/recordedManifest.ts` CONTACT_TAKES (`placeholder: true`); `scripts/audio/placeholders.mjs`; wedge `sound/REGISTER.md` §8, TC-01-P01 to TC-11-P03 | Original, synthesised offline by VANDE code (impact and modal synthesis, no samples); labelled "Placeholder: … not a recording". `PLACEHOLDER` | 3 per sound, chosen from the delivery record | 95,640 bytes on disk; about 1.45 MB decoded (computed, not measured on a phone) | 54 background fetches and decodes, never during a delivery; SHA-256 checked | Builder checks: byte-reproducible, onset 3 ms ± 0.5, peak ≤ 0.95, within 0.5 LU of the live voice. Owner A/B pending. | Not verified |
| crowd `cheer` | Four (strong release) | `CROWD_RECIPES.cheer` | Original, synthesised | none | 181 KB | idle slices | -17.5 LUFS at unit gain | Not verified |
| crowd `eruption` | Six (peak celebration) | `CROWD_RECIPES.eruption` | Original, synthesised | none | 244 KB | idle slices | -16 LUFS at unit gain | Not verified |
| crowd `ovation` | Milestone (50 or 100) | `CROWD_RECIPES.ovation` | Original, synthesised | none | 350 KB | idle slices | -18 LUFS at unit gain | Not verified |
| crowd `dismay` | The shift after a wicket's silence | `CROWD_RECIPES.dismay` | Original, synthesised | none | 119 KB | idle slices | -22 LUFS at unit gain | Not verified |
| Crowd bed | The continuous murmur that follows the emotion curve | `src/audio/crowdBed.ts` (three band-passed noise loops, LFOs, a brightness low-pass) | Original, synthesised | none | uses the noise buffer | built once per context | Unit tests: curve scheduling, resync | Not verified |
| Noise buffer | White noise for every noisy voice | `makeNoise` in `src/audio/voices.ts` (engine PRNG, seeded) | Original, generated | none | about 375 KB (2 s at 48 kHz) | built with the context, in idle time | Deterministic | Not applicable |
| Sealed Six live voices | Crowd roar, riser, result hit and fireworks for the match reveal and highlights | `src/audio/voices.ts` (live and offline synthesis) | Original, synthesised | none | none (nodes per cue) | none | Highlight loudness test (about −14 LUFS, ≤ −1 dBTP) | Not verified |

## Professional human assets needed

The procedural players are honest stand-ins: correct scale, kit, equipment and readable faces at gameplay distance,
but they cannot reach the constitution's bar for faces, bodies and clothing (§19–23) in close-ups, Coach replays and
dead-ball reactions. Reaching it needs professionally made, licensed assets. What we would need, so sourcing can be
decided:

### Characters

- **Base bodies**: 3 adult male and 3 adult female body types (height 1.65–1.95 m, slim to athletic), production
  topology with clean edge loops at shoulders, elbows, hips and knees, UVs, and skin weights on one shared skeleton.
- **Skeleton**: a humanoid rig of about 60–70 joints (spine 3+, neck 2, full fingers 3 per digit, twist joints for
  forearms and thighs, a jaw and eye joints), plus a retargeting map to our current 17-bone skeleton
  (`src/render3d/core/skeleton.ts`) so gameplay clips keep working while the richer rig is introduced.
- **Heads and faces**: at least 24 original, diverse South Asian, East Asian, African, European and mixed-heritage
  faces (no likeness of a real person; a written originality statement per face), each with:
  - 52 ARKit-compatible blend shapes (or an equivalent FACS set): blinks, brow raise and frown, squints, smile, jaw
    open, lip press, cheek puff;
  - eye meshes (sclera, cornea with refraction, iris), eyelashes, teeth and tongue;
  - textures: albedo, normal, roughness, cavity or AO and a subsurface or thickness mask.
- **Hair and facial hair**: 12 hair styles and 8 beard and moustache styles as hair cards with alpha, plus
  helmet-safe and cap-safe variants (compressed hair under headgear).

### Clothing and equipment

- **Clothing**: an original playing shirt (short and long sleeve), trousers, an undershirt and a sweater; tileable
  fabric weave normals; cloth simulation or authored corrective shapes for the elbow, shoulder, knee and hip; dirt,
  grass-stain and sweat masks driven by innings time.
- **Batting equipment**: a helmet with a separate grille and real padding, batting gloves with articulated fingers
  (gripping and open poses), pads with straps, under-clothing thigh and arm guards that never render through the kit,
  and spiked shoes. All original designs with no
  manufacturer marks.
- **Keeper and officials**: keeper gloves with inner gloves, keeping pads, original umpire clothing and hats.

### Animation sets (motion capture, cleaned, root-motion and in-place versions)

- **Batting** (right-handed, mirrored for left): stance and trigger movements, forward and back defence, leave, drive
  (straight, cover, on), cut, pull, hook, sweep, flick, loft, the defensive tap, running between the wickets, the
  turn, the dive into the crease, and walking off.
- **Bowling**:
  - pace: long and short run-ups, side-on and front-on actions, the release variations already cued (wrist, back,
    slower ball);
  - finger spin and wrist spin: approach, release with rip, follow-through;
  - appeal and celebration.
- **Fielding**: ready, walk-in, chase, slide stop, dive, pick-up and throw (overarm and underarm), high, chest and
  diving catches, celebrations.
- **Wicketkeeping**: crouch, standing up and back, lateral shuffle, take, stumping, run-out collection, appeal.
- **Umpire signals**: four, six, out, wide, no-ball, bye, leg bye, dead ball, plus an idle.
- **Faces**: blinks, eye focus or saccades, and the concentration, effort, frustration, relief and celebration
  expressions as blend-shape animation.

### Budgets per tier

| Asset | Premium (high) | Balanced (standard and lite) | Distant or crowd |
| --- | --- | --- | --- |
| Hero player, LOD0 (explicit close-ups and replays only) | ≤ 40k triangles, 2k textures (body and head 2048², gear 1024²) | ≤ 15k, 1k textures | — |
| Gameplay LOD1 (live delivery at 20 m) | ≤ 8k triangles, 512² | ≤ 4k, 512² | — |
| Fielder at 30–60 m (LOD2) | ≤ 2k, 256² | ≤ 1.2k, 256² | — |
| Crowd member | — | — | ≤ 150 triangles, vertex-animated atlas or GPU instancing with 16 pose frames |
| Skinning | ≤ 4 influences per vertex | Four encoded slots; Standard foreground batter explicitly uses Bone4, while Lite/distant roles remain platform-bounded | — |
| Face blend shapes | 52 on LOD0 | blinks and 6 expressions on LOD1 | none |

Texture formats: KTX2 (Basis UASTC for normal maps, ETC1S for albedo) so phones keep GPU memory low. The total
character texture memory in a live delivery should stay ≤ 48 MB on Premium and ≤ 24 MB on Balanced.

### Licence requirements

- Royalty-free, perpetual, worldwide rights to use, modify and ship in a commercial mobile and web game, including
  in-app purchases and marketing captures.
- No real-person likeness, with the vendor's written warranty, and model releases for any scanned performers (face and
  motion capture).
- No third-party trademarks or kit designs on any garment or piece of equipment.
- Source files (FBX or glTF plus the authoring files) delivered, so we can create LODs and variants.
- No attribution required in-game (or a credits-only requirement we accept).

## Cover-drive authoring tools and batter candidate (Track B, 2026-11-03)

The owner approved installing Blender and MPFB on 2026-11-03 (wedge prompt §10).
- Nothing in this section ships yet.
- The candidate is not placed in Unity Resources until P2 passes and the lead approves placement.
- Evidence: `release/cover-drive/p2/REPORT.md` §1 and §5.

| ID | Item | Version | Licence | Source | SHA-256 | Role / status |
| --- | --- | --- | --- | --- | --- | --- |
| `TOOL-BLENDER-5.2.3` | Blender | 5.2.3 LTS, build `e13b728c6880` | GPL-3.0-or-later | blender.org release, via the official mirror `mirror.clarkson.edu/blender/release/Blender5.2/`; signed by the Blender Foundation and notarised | `acc05374485a272342d4b323c15ac01953e7f697da2f1bad8af9c3bf087267a4` (DMG) | Authoring tool; nothing of it ships |
| `TOOL-MPFB-2.0.18` | MPFB (Blender extension) | 2.0.18, build 20261010 | GPL-3.0-or-later | `extensions.blender.org` (archive hash matches the API's `archive_hash`) | `c075b3e9b94b8e5556a5f03f4653602d02ea306de08126e8f55ed6dee28a2dad` | Authoring tool. Its bundled base mesh (byte-identical to the pinned MakeHuman v1.3.0 mesh), targets, rigs and weights are CC0. |
| `SRC-MH-SYSTEM-ASSETS-CC0` | MakeHuman system asset pack | As downloaded 2026-11-03 (same hash as the existing hero provenance) | CC0-1.0 (94/94 in the pack JSON; CC0 header in all 209 text assets) | `files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip` | `b542127a8e25547c7c29c19f2d1d2adb9a664c80396ecd694095dbc8028a0107` | Source for the candidate's skin, eyes, brows, lashes, hair, casual suit and shoes |
| `VANDE-HERO-MPFB-CANDIDATE-001` | MPFB batter candidate: body, kit, hair and shoes on the 75-bone game skeleton; original VBT1 bat | P2 r1 | CC0-derived; the generated shape and the hand-keyed pose are VANDE's own work | `scripts/blender/cover_drive_hero.py`, `cover_drive_hero_export.py`, `scripts/cover-drive/encode-hero.mjs` | VSK1 `f5eac822…`, LOD0 `a58adacb…`, LOD1 `669cd69e…` | `TECHNICAL CANDIDATE`, not shipped. Fails A3 (the grip) and part of A1; the owner's rating is pending. Visual acceptance, Android size and India reach are UNPROVEN. |

## Motion packs (VMP1; owner: MOTION format, human-elements round 2026-11-03)

All motion is owner-made: keyed controls in Blender, baked per frame, on the canonical VC17 skeleton
(`docs/MOTION-SPEC.md` v1.1; decoder `scripts/motion/vmp.ts`, encoder `scripts/motion/export.mjs`). No Mixamo,
no Quaternius, no new CMU use. Web packs are fetched lazily and add 0 B to the initial bundle. Unity carries the same
bytes under `Resources/Motion/`. SIZE-50 and REACH-90 stay UNPROVEN. Naturalness is a builder observation until the
independent evaluators score it.

| ID | File | Source | Licence | Bytes | SHA-256 | Status |
| --- | --- | --- | --- | --- | --- | --- |
| `VANDE-MOTION-BATTER-001` | `public/practice/motion/batter.vmp`; Unity copy `unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Resources/Motion/batter.bytes` | `assets-src/motion/batter/*.vms.json`, made by `scripts/blender/motion/batter_anticipation.py` (TRACKB) | Owner-made original; no third-party motion | 38,140 | `6f70d3d3011069397d942d54adcf6c3721e1740f705944fbb8b818a6cd05a095` | v3 (06:12Z) adds `bat_backlift_compact` and `bat_ready_hold_compact`: the hands follow 70% of the blade's turn and the wrists flex at most 79°, with the palms on the hand points. Earlier ships: 01:31Z 30,950 B `36922892…`, first ship 29,562 B `7aac669d…`. Clips `bat_stance_live`, `bat_trigger`, `bat_backlift`, `bat_ready_hold`, plus the two compact ones. All gated. Not yet integrated; evidence `release/product-sequence/stage-1-practice/wedge/humans/trackb/` |
| `VANDE-MOTION-LOCOMOTION-001` | `public/practice/motion/locomotion.vmp`; Unity copy `…/Resources/Motion/locomotion.bytes` (byte-identical) | `assets-src/motion/locomotion/*.vms.json`, made by `scripts/blender/motion/{vc17,gait,locomotion,build}.py` (MOTION) | Owner-made original; no motion capture, no third-party motion | 39,565 | `1e60b5b765ef7dc50b1132e0503308bfeb0f0dcf87f075ffa1a856e3e7b11e57` | v2 (03:08Z): `loco_idle`, walk 1.5, jog 3.3, run 5.6, sprint 7.8 m/s, `loco_start`, `loco_stop`, `loco_turn_l90` (alias `_r90`), `loco_strafe_l` (alias `_r`). All gated. Re-baked inside Blender 5.2.3 LTS: v1 at 01:33Z and v2 at 03:35Z, both byte-identical to the shipped pack (log `release/product-sequence/stage-1-practice/wedge/humans/motion/blender-byte-identity.log`). The editable `.blend` stays in scratch and does not ship. Evidence `release/product-sequence/stage-1-practice/wedge/humans/motion/` |
| `VANDE-MOTION-FIELDER-001` | `public/practice/motion/fielder.vmp`; Unity copy `…/Resources/Motion/fielder.bytes` (byte-identical) | `assets-src/motion/fielder/*.vms.json`, made by `scripts/blender/motion/fielder.py`, `fielder_common.py` and the shared library (MOTION) | Owner-made original | 62,570 | `bcf079d1d9f6e40310b4b0909283fe467fb848eac5e57862c350be43f5c4e416` | v6 (03:04Z; earlier ships v1–v5 superseded; re-baked inside Blender 5.2.3 LTS at 03:35Z, byte-identical): `fld_ready`, `fld_walk_in`, `fld_set`, `fld_sprint_start`, `fld_decel_stop`, `fld_return`, `fld_pickup_2h`, `fld_pickup_1h`, `fld_long_barrier`, `fld_turn_run_r` (alias `_l`; drop-step leg Δω 526, within the 650 explosive-move cap, flagged for the evaluators). All pass the gates in `scripts/motion/motion.test.mjs`. Update this row on each re-ship. |
| `VANDE-MOTION-FIELDER-ACTIONS-001` | `public/practice/motion/fielder_actions.vmp`; Unity copy `…/Resources/Motion/fielder_actions.bytes` | `assets-src/motion/fielder_actions/*.vms.json`, made by `scripts/blender/motion/fielder_actions.py` (MOTION-FIELD2) | Owner-made original | 41,115 | `ba54a47aaa79040d7f77656d9ce686097b7dd4f27e16591e60efca700ff18ff1` | v3 (03:30Z) adds `fld_dive_fast_r` (alias `_l`) and `fld_dive_scramble_r` (alias `_l`), on his feet 0.80 s after `reach` (= `DIVE.recoverS`; explosive list, lead-approved). From v2: `fld_throw_over`, `fld_flick_under`, `fld_dive_r` (alias `_l`; limb Δω 405 under the dive class, flagged for the evaluators), `fld_getup_r` (alias `_l`), `fld_catch_high`, `fld_catch_low`, `fld_celebrate` (only after a physics catch; one contained fist pump). Evidence `release/product-sequence/stage-1-practice/wedge/humans/motion-field2/`. Gated. Budget 48 KB (lead ruling: a separate pack so each pack has one owner). Update this row on each re-ship. |
| `VANDE-MOTION-BOWLER-001` | `public/practice/motion/bowler.vmp`; Unity copy `…/Resources/Motion/bowler.bytes` (+ `.meta`) | `assets-src/motion/bowler/*.vms.json`, made by `scripts/blender/motion/bowler_*.py` (MOTION-BOWL) | Owner-made original; no motion capture or third-party motion | 73,296 | `262c2174060a19644a574514fb0dfd3ef2b780ccfc73c5586861dbd86bcb7bfd` | v5 (05:49Z) adds `bowl_pace_bouncer` (ball at 2.194 m at scale 1; legs on the explosive list, peak 595) and `bowl_pace_bouncer_follow` (joins `bowl_pace_follow` at 0.5333 s). Budget 72 KB (lead ruling), 432 B left. From v4: `bowl_pace` release re-authored (braced front leg, heel up, trunk flexed 13° to the side, arm 9.7° from vertical), so the ball is at 2.150 m at scale 1 (was 1.929 m) per lead ruling; `bowl_pace_follow` adjusted to match. 13 clips, all passing and gated; includes `bowl_turn_pace` and `bowl_turn_spin`; `bowl_leg` headroom improved (Δω 269). `bowl_run`, `bowl_stride` and `bowl_pace` are on the explosive list (legs). Budget 64 KB with 11 B left, so any further clip needs a budget ruling. Cleared for integration |
| `VANDE-MOTION-NONSTRIKER-001` | `public/practice/motion/nonstriker.vmp`; Unity copy `…/Resources/Motion/nonstriker.bytes` (+ `.meta`) | `assets-src/motion/nonstriker/*.vms.json`, made by `scripts/blender/motion/nonstriker_clips.py` (MOTION-BOWL) | Owner-made original | 45,855 | `7d89fa977cb8073ee00b02c9f2e847e9e6eb6bf77ce2f1f85e75f9ec7b4130c7` | v4 (04:24Z): 7 clips, all passing and gated. `ns_turn` v2 (+`ns_turn_r`) is an in-place turn between runs on WEB-HUMANS' `sprintProfile`. Legs Δω 590 under the explosive approval. The ground step is report-only under `GROUND_STEP_REPORT_ONLY` (lead ruling). v1 is replaced; `ns_walk_back` is now at 30 Hz with its lowest shoe point at −0.3 cm. `ns_run` is on the explosive list (legs). 178 B headroom. Cleared for integration |
| `VANDE-MOTION-KEEPER-001` | `public/practice/motion/keeper.vmp`; Unity copy `…/Resources/Motion/keeper.bytes` (+ `.meta`) | `assets-src/motion/keeper/*.vms.json`, made by `scripts/blender/motion/keeper.py` on MOTION's vc17 and baked in Blender 5.2.3 (MOTION-KEEPER) | Owner-made original; no third-party motion or motion capture | 26,471 | `eaf306f50bc57b9837dc46df6c4160129b9d0af6e1ef204047e56aec38949480` | v1 (03:42Z): `kp_crouch_back`, `kp_crouch_up`, `kp_rise`, `kp_shuffle_l` (+`_r`), `kp_take_waist_r` (+`_l`), `kp_take_chest_r` (+`_l`), `kp_dive_r` (+`_l`; dive class, legs 423 and arms 393). `kp_stump` is not built: the physics has no stumping. All gated. Evidence `release/product-sequence/stage-1-practice/wedge/humans/motion-keeper/` |
| `VANDE-MOTION-BATTER-STROKES-001` | `public/practice/motion/batter_strokes.vmp`; Unity copy `…/Resources/Motion/batter_strokes.bytes` (+ `.meta`) | `assets-src/motion/batter_strokes/*.vms.json`, made by `scripts/blender/motion/batter_*.py` (TRACKB) | Owner-made original; no third-party motion | 26,498 | `b3dbb25fc03f1e117cc15382f20db62272b2ac0d84bb26112d7919ac66105dde` | v2 (07:13Z): `bat_leave` re-baked with no grip roll (it holds the compact top, the bat out of the line, the head watching the ball past; lead ruling). From v1 (06:35Z, `12066346…`): lower-body and trunk overlays (arms masked; the renderers IK them to the physics bat). Clips `bat_drive`, `bat_fwd_defence`, `bat_backfoot_punch`, `bat_pull`, `bat_back_defence` and `bat_leave`. Natural pace from the input: 320 ms to the forward plant, 280 ms back; the back foot steps back and across (lead ruling). All gated, with no explosive entries. Evidence `release/product-sequence/stage-1-practice/wedge/humans/trackb/strokes/` |
