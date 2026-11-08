# MakeHuman v1.3.0 asset provenance

This folder records the licence and immutable upstream identity for the anatomy
source used by VANDE's Stage 1 Unity production-art candidate. It is not an art,
identity, device, Android-size or player-experience acceptance decision.

## Pinned upstream

- Repository: <https://github.com/makehumancommunity/makehuman>
- Tag: `v1.3.0`
- Commit: `1f508f6083b2f823dab15de924b3bde72e08d77c`
- Licence for the listed graphical assets: `CC0-1.0`
- Attribution: none required
- Source acquisition began: `2026-10-30T05:23:42Z` (UTC conversion of the checksum-verified pinned mesh master's
  filesystem timestamp immediately after download)
- First derivative record: `2026-10-30T05:29:46Z`

| Purpose | Pinned upstream path | SHA-256 |
| --- | --- | --- |
| Neutral anatomy mesh | `makehuman/data/3dobjs/base.obj` | `8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c` |
| Skeleton description | `makehuman/data/rigs/default.mhskel` | `99f179bce0aa850b45d4191a1d0d234c5851f881c057439470ded3bddf729a24` |
| Vertex weights | `makehuman/data/rigs/default_weights.mhw` | `0f3641d651ae3d00ad6b4ccee43142edb109d3bd909d27d9e4139ef1beed8625` |
| Official system skin archive entry | `skins/young_caucasian_male/young_lightskinned_male_diffuse.png` | `862a26e335e958b70534cb5f0d7c47ef30ab148a56c42b3e9da969cf76f12963` |
| Upstream licence summary | `LICENSE.md` | `edd99571ca62698f78c943fd4fffb159a413c315fa0d4819d3cec5cadaf8b4f1` |
| Full asset licence | `LICENSE.ASSETS.md` | `f6089cba01cb570a24712b41ab8a586ccd3cc5ef53dc266ca50b95c288956d2c` |

The provenance manifest preserves notices per source: the mesh header names
the three holders with 2020 notices, `default.mhskel` declares the same holders
with a 2020 notice, and `default_weights.mhw` declares the same holders with a
2021 notice. These distinct upstream statements are not collapsed into a
single assumed year.

The two licence files archived beside this record are byte-for-byte copies of
the pinned upstream files. Their checksums match the table; neither is a
paraphrase or a substitute convenience summary.

The pinned `base.obj` header explicitly says the asset was released under CC0
in September 2020. The pinned root licence defines base meshes, proxies,
targets, textures, clothes, poses and expressions as CC0 graphical assets.
MakeHuman application code remains AGPL and is neither copied nor linked by the
VANDE bake. The texture's exact official-index commit, pack URL/hash, entry
hash, acquisition record and derivative command are archived in
`SYSTEM-ASSET-SKIN-SNAPSHOT.md`.

## VANDE derivative

`scripts/export-unity-production-human.mjs` reads the three pinned graphical
asset files from an external scratch directory, validates every checksum,
collapses the weights onto VANDE's existing 17-joint presentation rig, maps the
neutral source pose to VANDE's rest pose, applies a deterministic symmetric
fictional-athlete proportion treatment, preserves the OBJ's independent UV
corners with render-vertex duplication at seams, and writes VPM2 high and mobile
LOD candidates. The Unity decoder remains compatible with retained VPM1 assets.
LOD1 is capped at 4,000 triangles, the Premium far-field candidate at 2,000,
and the Balanced/Lite far-field candidate at 1,200.

Only faces in the upstream OBJ's `g body` group are admitted. Every `joint-*`,
`helper-*` and other non-body group is excluded, and unreferenced vertices are
removed before encoding. This prevents rig guides, tights, eyelashes, tongue
and genital helper geometry from entering the runtime derivative.

The fictional treatment uses no image or real-person reference. That statement
does not constitute identity or publicity-right clearance: independent
derivative review remains `UNPROVEN`. No team kit, player name, sponsor,
manufacturer mark or texture is present in the anatomy files.

One 2048×2048 official system skin was acquired from the direct CC0 pack and
deterministically downscaled to a 1024×1024 shipped albedo. It is sampled only
for head, neck, forearm and hand regions. VANDE's original unbranded procedural
cricket kit, trousers and shoes remain unchanged. No separate eye/hair asset,
generative image or real-player reference is used.

The untouched large upstream assets stay outside the repository as production
scratch/source masters, consistent with the shared-machine rule. The exact URLs,
hashes, transformation parameters and output hashes are retained in
`docs/licenses/makehuman-v1.3.0/production-human-provenance.json`, so the
derivative can be reproduced from the pinned source without a marketplace
account or click-through terms. The record deliberately lives outside Unity's
`Assets` and `Resources` trees, so it remains auditable without becoming a
shipped `TextAsset`.

The generated provenance record checksum-binds the VPM2 baker, `package.json`,
`package-lock.json`, meshoptimizer 1.1.1's exact simplifier implementation and
its MIT licence. Every reduced LOD uses topology-restricted attribute-aware edge
collapse with UV error weight 10 and no permissive, prune or regularize flags,
then fails the bake unless all vertices are used, no triangle is degenerate,
every welded undirected edge belongs to exactly two faces and every surviving
UV edge is at most 0.25. It also records the exposed roles and quality tiers,
role-specific fallback order, raw derivative bytes, acquisition/creation dates,
candidate owner and independent-review state, measured Editor-only memory/load
facts, and the exact missing Android installed-size, reach, device and human
evidence. The current exact WebGL presentation is explicitly `REJECT / REWORK`;
other `UNMEASURED`, `UNPROVEN` and `NOT RUN` states remain deliberate truth
states, not implied passes.

The declared deterministic-bake baseline is Node `v26.0.0` with V8
`14.6.202.33-node.19` on Darwin arm64. The baker refuses a different runtime
until its output is compared and this provenance baseline is reviewed. Repeated
bakes on that baseline are byte-identical; determinism across another Node
version, operating system or architecture remains `UNPROVEN`.

The live runtime selects LOD0 only for a near Premium hero. LOD1 serves
Balanced/Medium, every wicketkeeper, every fielder below 30 m and every pace or
spin bowler at least 12 m from the striker (the live bowler is about 20 m away).
At 30 m or farther, a High/Premium fielder uses LOD2 and every other fielder
uses LOD3. The live scene, quality profile and benchmark pass the actual planar
distance from the striker presentation reference. Far meshes decode lazily on
the first actual fielder and are shared by the team resource owner; the dynamic
bowler owner loads only LOD0/LOD1. Runtime spatial clustering is not used.

On the pre-VPM2 Editor evidence build `38924bd+3c7bb1b48a98`, the four raw
resources totalled 951,184 bytes; shared-team Mesh objects reported 2,864,016 bytes,
the dynamic-bowler owner 2,589,360 bytes and both owners 5,453,376 bytes, with
619 renderers and 30 materials. These are historical Editor-only facts, not
current post-texture measurements. The current four VPM2 meshes total 1,184,104
bytes and the shipped PNG is 1,065,858 bytes; fresh Unity/Android runtime and
installed-size deltas remain unmeasured. The prior measurement's one-minute
load average was 29.01, so its decode/load timings are not qualifying
performance evidence. Android memory, installed size, physical-device load,
Android visual acceptance and India-weighted reach remain `UNPROVEN`; the
available exact WebGL presentation review is `REJECT / REWORK`.

## Focused builder verification

At `2026-10-30T09:40:41Z`, Unity `6000.3.27f1` ran the exact EditMode
fixture `Vande.Practice.Tests.ProductionCharacterTextureAndFormatTests` in
macOS batch mode with graphics disabled and two job workers. The expected
result was that retained VPM1 data would decode without enabling skin-texture
sampling, VPM2 would retain UV0 and enable the capability only for UV-bearing
vertices, malformed VPM2 data would fail closed, and a missing skin texture
would leave the procedural material active. The observed result was **PASS**:
4 tests run, 4 passed, 0 failed and 0 skipped. The command exited 0.

The result XML was written to
`/private/tmp/vande-makehuman-skin-vpm2-20261030T0940Z.xml` (SHA-256
`7af49c191496e16ca7003c9af38fc9e2d85eb649ab293a81ab0cc5fbba216c78`),
and the Unity log to
`/private/tmp/vande-makehuman-skin-vpm2-20261030T0940Z.log` (SHA-256
`460c56bbc9b8cf3dcb368c3f35e86732a9a339efdf92a192bb1e831d86937e95`).
The log contains no C# compiler, shader compiler, test-run or unhandled-exception
failure. It does contain a transient Unity access-token update warning; Unity
then resolved the entitlement, updated its licence and completed the tests.

Because another owner was importing shared project state concurrently, the
repository-wide build id moved from `38924bd+bde0bc063617` before the run to
`38924bd+134c3d2c2d84` after it. The tested owned sources were unchanged across
the run and are therefore the binding source identity:

| Tested source | SHA-256 |
| --- | --- |
| `scripts/export-unity-production-human.mjs` | `84c5dca20c4fcea97261fd9bddbb1fd041ce78d94a6be51d8a04c997f6d930be` |
| `scripts/export-unity-production-human.test.mjs` | `b42ef2bd8fe36cb45d8d69d02700a1a10a71b2875546ce6140ba4bd43dd4b9a1` |
| `ProductionBakedCharacterMesh.cs` | `ea0b187bb2608519d8c51a0e7ebd058363fa236906370b6851857faeb1b1a47b` |
| `ProductionCharacterResources.cs` | `19a30310225a91f8cea447582b2f90dc1e932691a724060497bd6af95f7c868f` |
| `VandeProductionCharacter.shader` | `f710475359cddb090adc5393219cb097d60596bdd929bde68007f817005a6478` |
| `ProductionCharacterTextureAndFormatTests.cs` | `174cb4e5b35a6c5940e4bcc2be2de6f3c639adeb2d00231c2c156b1f2f335464` |

The one-minute load average was 28.97 before and 27.45 after the run, above the
shared-machine qualifying threshold. This is functional builder evidence only;
its duration is indicative and makes no performance, certification or player
experience claim. No independent acceptance state changes as a result.

## Status

The derivative is a `TECHNICAL COMPONENT CANDIDATE`; its current player-facing
presentation is `REJECT / REWORK`. Licensed-first runtime integration and
automated rig/LOD/fallback validation are complete. Passing independent
equipment/cloth coherence and clipping review, day/evening and LOD captures,
physical-device performance, measured Android installed-size delta, India reach
and real-player evaluation are still required.
