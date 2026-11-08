# Gate-A provisional visual and feasibility rubric

Status: **independent provisional; Gate A NOT PASSED**

This rubric is derived only for the master prompt's Gate-A approval decision. It does not replace or amend a locked
repository rubric. Each row is scored against its maximum weight. A missing mandatory artifact receives zero; a
documented design or source scaffold may receive partial credit but never converts missing runtime or human evidence
into a pass.

## Score

| Dimension | Weight | Score | Evidence state | Independent observation |
| --- | ---: | ---: | --- | --- |
| Exact camera and cricket composition | 12 | 10 | observed in static target | Stable rear-shoulder direction, full batter and bowler, level horizon, credible scale and sight-screen backdrop. Static composition cannot prove live camera stability. |
| Delivery hierarchy and protected corridor | 12 | 9 | corrected static direction | Corrected score, conditions, PIP and pause remain outside the annotated corridor. In-motion ball size/contrast is **NOT SCORED**. |
| Quiet HUD, score, conditions, PIP and pause | 10 | 8 | directional pass; runtime partial | Corrected score, conditions, populated compact PIP and 48 dp pause are restrained and peripheral. Dynamic/runtime behavior is unobserved. |
| Fictional cricket world and artifact direction | 12 | 9 | static direction only | Humans, unbranded kits, bat, helmet, pads, pitch, wickets, field, stadium and crowd read as premium cricket at this scale. Anatomy, rigging, clipping, material response and motion remain **NOT SCORED**. |
| Exact viewport, safe-area, touch and responsive evidence | 8 | 5 | partial | Corrected 844x390 normal/evidence PNGs exist; source tests assert five viewports, 46% touch area, 48 dp pause and <=8% nominal HUD. No accepted runtime captures, cutout cases, 200% text, Hindi, left-hand mirror or accessibility review exist. |
| Runnable production-target fidelity | 10 | 3 | scaffold only | HTML compositor is reproducible and the Unity harness is opt-in, but the shown target is not a Unity render. The harness explicitly reports no gameplay truth and blocks accepted mode without supplied assets. |
| Asset, rig, animation and material feasibility | 14 | 5 | requirements mapped; candidates missing | Per-category requirements and first-import ceilings are useful. No verified source asset, rig inspection, animation clip, material import, variant plan or gameplay-distance acceptance capture exists. |
| Provenance, licence and acquisition closure | 8 | 1 | missing | AI-reference provenance is honestly labelled. Production visible assets have no verified vendor/source, licence record, checksums or approval request. |
| Mobile cost, LOD, memory, size and reach feasibility | 8 | 1 | unproven | Planning ceilings and general LOD ideas exist. No actual compressed/import/installed/runtime-memory measurement or affected Android cohort evidence exists; the planning compressed sum is already unsafe against the old artifact's non-binding margin. |
| Matched current/target evidence and reproducibility | 6 | 1 | current capture missing | Target files are documented and hashable, but current source moved during baseline audit and no exact-current Android screenshot or matched side-by-side exists. Historical preview is excluded from scoring. |
| **Total** | **100** | **52** | **5.2/10 provisional** | Hard failures override the number. |

## Defects and blockers

Severity uses `release/player-experience/ceiling-rubric.md` section 4 where it applies. Evidence blockers that are not
yet player-facing are labelled separately rather than misreported as shipping defects.

| ID | Severity | Finding | Evidence | Closure evidence required |
| --- | --- | --- | --- | --- |
| GA-IP-001 | **RESOLVED in corrected 844x390 artifacts**; historical severity High and would have been Critical if promoted to live play | The first target field radar was not absolutely positioned. Its pseudo-elements and markers resolved against the full screen. Root added positioned containment and recaptured; independent inspection now finds a compact populated PIP wholly outside the corridor. | Corrected `index.html`; current normal/evidence PNGs; rejected `superseded-radar-defect-*.png` retained with hashes | Exact-viewport visual retest passes. A future accepted-runtime and multi-viewport regression still remains under GA-IP-008, rather than reopening this corrected static artifact. |
| GA-IP-002 | Critical promotion blocker | Production humans, equipment, rigs, animation, stadium/crowd, typeface and authentic visible implementation are absent. Procedural or reference art would be a forbidden player-facing placeholder if promoted. | `ASSET-IMPLEMENTATION-MAP.md`; `GoldenScreenReadinessGate` blockers | Verified source/licence records, acquired/imported assets, measured costs, accepted bindings, close/gameplay-distance captures and independent acceptance. |
| GA-IP-003 | Gate blocker, not assigned runtime severity | No exact-current Android capture or current/target side-by-side exists. | `release/gate-a/current-baseline/BASELINE.md` | Frozen source/build identity; installed APK/build/renderer proof; exact screenshot; hashes; normalized comparison. |
| GA-IP-004 | High promotion blocker | The displayed target is an HTML composite over a static reference, not accepted production Unity gameplay and not connected to canonical live facts. | `GoldenScreenPrototype.UsesRuntimeCricketTruth => false`; visual-direction README | Exact accepted-production Unity render on the current Android build, consuming canonical state, with no reference bitmap. |
| GA-IP-005 | Medium evidence-contract weakness | Production readiness trusts caller-supplied strings/booleans (`Status`, `LicenceRecord`, `HasMobileLods`, `HasMeasuredImportCost`) and one shared fielder prefab; it does not itself validate source hashes, register rows, actual LODs, rig markers, animation/material contracts or visible human variation. | `GoldenScreenAssetContract.cs`; `GoldenScreenPrototype.cs` | Bind approvals to immutable asset-register records and import reports; add admission tests for required rig/marker/material/variation contracts. |
| GA-IP-006 | Medium evidence contradiction | The baseline records a 64-degree README versus 58-degree runtime FOV conflict; the target/harness uses the 58-degree runtime constant without resolving the authoritative documentation. | baseline `BASELINE.md`; golden-screen README | One root-approved FOV, matching source, docs, tests and exact-view capture. |
| GA-IP-007 | Gate blocker, not assigned runtime severity | The planning 5.9 MB compressed / 54.5 MB runtime ceiling is not a measurement, and old APK headroom is not fresh-installed evidence. | `ASSET-IMPLEMENTATION-MAP.md`; `docs/ANDROID_SIZE_AND_REACH.md` contract | Measured import deltas, AAB/Play delivery, fresh-installed-through-first-ball bytes, runtime peak and affected-cohort reach analysis. |
| GA-IP-008 | High promotion blocker | Supported accessibility/variant views are unobserved: 200% text, Hindi, left-handed mirror, cutouts and Reduced Motion runtime behavior. | golden-screen source/tests and absent captures | Exact target captures and functional checks for the binding viewport/locale/accessibility matrix. |
| GA-IP-009 | Medium evidence/content gap | The HTML PIP is a static approximation: its 11 plotted points include one element named `batter`, while the Unity review painter plots 11 field markers and production requires canonical host fielder IDs. Neither target proves that the PIP represents the current field without omission or role ambiguity. | `visual-direction/v1/index.html`; `GoldenScreenOverlayPainter.FieldMarkers`; map requirement for canonical IDs | Bind the target PIP to one named canonical 11-fielder field (with striker/orientation represented separately if needed) and include the IDs/coordinates in the comparison manifest. |

## Feasibility inspection of the Unity scaffold

The code has several positive properties: it is isolated and opt-in; it does not write results; it labels reference
and procedural modes; it fails closed when bindings are missing; layout math is deterministic; and tests cover basic
HUD/corridor separation and cost summation. These are implementation strengths, not a visual acceptance result.

The accepted-production branch remains hypothetical. It instantiates caller-supplied prefabs at target positions,
but the repository provides none of the required accepted bindings. The readiness gate checks declared metadata,
not the actual licence archive, asset-register identity, rig topology, animation quality, materials or import report.
The tests prove that synthetic declarations can make the boolean gate return true; they do not prove that any real
asset qualifies. Accordingly the production-feasibility rows remain partial or missing.

## Historical context, explicitly excluded from current scoring

The superseded `38924bd+05f72561424b` Android screenshot shows a functioning `unity-native` engineering preview with
procedural/robotic humans, low-detail artifacts and a dominant field map. It demonstrates why the new direction is
desirable but says nothing about the current source. It contributes **zero points** to current/target closure and may
appear only in a clearly labelled historical appendix.

The first HTML target captures with the radar defect are also excluded. They are preserved as
`superseded-radar-defect-844x390.png` (SHA-256
`36b0ed8d151ad74766ab1d4437dc8aed8a7c7259756d773a5441f3c337d71558`) and
`superseded-radar-defect-evidence-844x390.png` (SHA-256
`421adb2384ecc46fe7cc2dbb77c05c174b1c1051fc33d97105ff76acc8bef593`). The corrected scored artifacts are
`golden-screen-844x390.png` (SHA-256
`d75e208a0363a5905937ef795076b4ccabda90d6ab3eb6e43ae1c5d687caaa57`) and
`golden-screen-evidence-844x390.png` (SHA-256
`d280e70a9dda6d14474ac2696d0bf3253b022c35806396af9db38bf874adc712`).
