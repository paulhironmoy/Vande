# Gate A visual-direction reference v1

Status: **visual-direction reference only**. This image is not running gameplay,
not a Unity render, not proof that the shown assets exist, and not evidence for
visual quality, ball readability, input, physics, performance, Android reach or
player preference.

## Artifact

- File: `photoreal-live-scene-v1.png`
- Generated: 2026-10-29T00:09Z with the built-in OpenAI image-generation tool
- Dimensions: 1672 x 941 pixels
- Bytes: 2,877,947
- SHA-256: `7ad65fcbfa2574ff04964bbddc5010d62bdc89b49595aa954a7ce448f5336b22`
- Rights/provenance status: AI-assisted original reference; the governing
  commercial-use terms, likeness review and embedded-work review must be
  recorded before any player-facing use.
- Intended use: Gate A composition and art-direction discussion only.

The source image is intentionally free of baked score/UI text so the exact HUD,
PIP, safe-area and protected-corridor overlays can be produced deterministically
in the runtime prototype.

## Exact-viewport compositions

`target.v1.json` is the machine-readable static composition contract. The
deterministic HTML and the isolated Unity golden-screen prototype consume or
are checked against that same contract. The current HTML composition was
captured once at the locked 844 x 390 viewport by `capture.mjs` at
2026-10-29T04:32:24Z:

- `golden-screen-v2-844x390.png` — 627,457 bytes; SHA-256
  `f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9`
- `golden-screen-v2-evidence-844x390.png` — 620,779 bytes; SHA-256
  `9c8611e6a44b90b1eda2bc576de1138bd48858e6469c2690a49ec5055cedf099`

The evidence variant makes the 46% lower touch surface, safe-area bounds, HUD
bounds and protected release-to-contact corridor visible. These are target
composition artifacts only; neither capture is runtime or player evidence.

The preceding `golden-screen-844x390.png` and
`golden-screen-evidence-844x390.png` are preserved, not overwritten. They are
superseded because the PIP did not bind keeper, bowler and nine other fielders
to stable identities, counted the batter incorrectly, and used a different
crop anchor between HTML and Unity. Their exact identities remain frozen in
`target.v1.json`.

An earlier independent review also found that the first radar experiment
omitted its local positioning context, which spread its markers and pitch
across the protected delivery corridor. That rejected evidence is preserved as
`superseded-radar-defect-844x390.png` (629,501 bytes, SHA-256
`36b0ed8d151ad74766ab1d4437dc8aed8a7c7259756d773a5441f3c337d71558`)
and `superseded-radar-defect-evidence-844x390.png` (623,658 bytes, SHA-256
`421adb2384ecc46fe7cc2dbb77c05c174b1c1051fc33d97105ff76acc8bef593`).
They are failed artifacts, not target candidates.

## Frozen composition contract

- Camera: 58-degree horizontal field of view, matching the current procedural
  practice runtime constant. This is a static consistency check, not a camera
  quality result.
- PIP orientation: bowler end at the top, striker end at the bottom. The
  batting marker is `batter` and is separate from the defending side. The
  defending side is exactly `keeper`, `bowler` and `fielder-01` through
  `fielder-09`. Only `bowler` receives the active-bowler highlight.
- Crop: aspect-fill/cover with anchor `(0.5, 1.0)` in top-left normalized
  coordinates: horizontal centre and source bottom.
- HUD: exact score, conditions, field-PIP and pause rectangles are frozen in
  `target.v1.json`; total occupancy is 5.846%, below the 8% ceiling.
- Touch: the lower 46% is the invisible shot surface. The four frozen corridor
  points and every visible HUD rectangle remain disjoint.

For source size `Ws × Hs` and destination size `Wd × Hd`, let
`S = Ws / Hs` and `D = Wd / Hd`:

- when `S > D`, `shownWidth = D / S` and the crop is
  `(x, y, w, h) = ((1 - shownWidth) × 0.5, 0, shownWidth, 1)`;
- otherwise, `shownHeight = S / D` and the top-left-coordinate crop begins at
  `yTop = (1 - shownHeight) × 1`. Unity's UV origin is bottom-left, so
  `yUv = (1 - shownHeight) × (1 - 1) = 0`; the crop is
  `(0, yUv, 1, shownHeight)`.

The HTML equivalent is `object-fit: cover; object-position: 50% 100%`.
`node validate.mjs` checks the target, HTML, Unity constants and formulas,
PIP identities, FOV, HUD/touch/corridor geometry, and every listed artifact's
PNG dimensions, byte count and SHA-256.

## Generation prompt

```text
Use case: ui-mockup
Asset type: Gate-A golden live-game screen reference for a landscape Android cricket game, exact 16:9 composition
Primary request: create a photorealistic, production-grade mobile cricket batting view from a stable rear-shoulder camera, showing the full fictional right-handed batter in the near foreground and the full fictional right-arm fast bowler beginning the final stride toward release at the far crease. The experience must look like a premium real cricket match rather than animation or concept art.
Scene/backdrop: original fictional Indian night cricket stadium under floodlights, realistic grass outfield and mowing pattern, regulation pitch and creases, three stumps with separate bails, sight screen directly behind the bowler, believable fielders in correct positions, restrained diverse crowd and stadium depth.
Subject: original adult fictional batter with natural anatomy, readable face in slight profile, original unbranded deep-navy jersey, helmet with metal grille, segmented gloves, pads, shoes and a detailed willow bat; original bowler with natural anatomy, original unbranded teal kit, credible run-up, planted foot, arm action and weight transfer. A law-scale white cricket ball is visible at the bowler's hand and has a raised seam and realistic leather highlight.
Style/medium: photorealistic real-time game render target, physically based materials, believable skin and cloth, realistic cricket equipment; no cartoon, no stylization, no plastic CGI look.
Composition/framing: landscape 16:9, stable rear-shoulder batter view at credible eye/shoulder height and about 58-degree horizontal field of view; batter occupies lower-right/near-center without obscuring the bowler; preserve a completely clear central corridor from release hand to expected bounce and contact; horizon level; field-setting awareness visible. Leave quiet peripheral negative space at top-left and top-right for a compact score rail and a small field radar overlay to be added separately.
Lighting/mood: clear evening under neutral floodlights, grounded soft shadows, subtle atmospheric depth, sufficient contrast around the white ball and sight screen, restrained crowd energy, anticipation before release.
Materials/textures: pores and natural skin roughness, woven cloth and folds, helmet shell and grille metal, glove leather, pad straps, willow grain and bat wear, pitch grass/soil wear, white crease paint, leather ball seam, stadium concrete and seating.
Constraints: original fictional people only; no real-player likeness; no real team, sponsor, league, broadcaster or equipment branding; no logos; no watermark; no text; no score UI baked into the image; physically coherent cricket scale; clean ball corridor; realistic full bodies; correct bat grip; no clipping; mobile-game feasible rather than cinematic depth-of-field.
Avoid: capsule or primitive characters, robots, cartoon faces, exaggerated muscles, glossy plastic skin, duplicate crowd clones in the foreground, random non-cricket props, standing wicketkeeper blocking the camera, camera shake, motion blur on the ball, particles, bloom, lens flare, excessive glow, broadcast camera angle, visible joystick or button bank.
```

## Acceptance boundary

Gate A still requires a feasible asset/rig/material/animation/licence/LOD/size map
for every visible item, a runnable exact-viewport composition, the exact current
Android comparison capture, and independent provisional review. This reference
alone passes none of those gates.
