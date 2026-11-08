# NRG Studios LP Cricket Model Pack — acquisition and Stage 1 review

## Decision

**Acquired to scratch for review; rejected for shipping.** No model, texture, material or importer setting from this
pack was copied into the Unity project. `ProductionCricketProps.cs` was not changed by this review.

This is a measured technical-selection decision, not an art-quality certification. The pack is lawful and inexpensive
enough to ship, but the reviewed bat, white ball, stump and bail do not improve VANDE's existing Stage 1 Practice
equipment while preserving its real-scale, seam/shine-authority and mobile-complexity requirements.

## Source-page snapshot

| Field | Observed value |
| --- | --- |
| Listing | <https://nrgs.itch.io/lp-cricket-model-pack> |
| Page title | `LP Cricket Model Pack` |
| Creator shown by page | `nrgs` / NRG Studios |
| Listing/purchase state | Free pack; optional contribution; one included ZIP shown as 5.1 MB |
| Anonymous route used | `No thanks, just take me to the downloads` |
| Account/login/email/payment | None provided or requested on the route used |
| Purchase / checkout | Not performed |
| New terms dialog | None presented or accepted |
| Acquired UTC | `2026-10-30T09:23:03.920Z` |
| Download page | Ephemeral token intentionally redacted |
| Final file URL (query removed) | <https://itchio-mirror.cb031a832f44726753d6267436f3b414.r2.cloudflarestorage.com/upload2/game/4248479/19790752> |
| Downloaded filename | `Cricket_LP_model_pack_free_version.zip` |
| Downloaded bytes | `5,372,434` |
| Downloaded SHA-256 | `a83db3df61fe356d496d9cf12526ec2d4f5e7a968022034ebb661690d597b4ca` |
| Scratch location | `/private/tmp/Cricket_LP_model_pack_free_version.zip` (not a repository dependency) |

The source page's payment terms apply to completing a payment; this review did not enter that flow. The final URL is
recorded without its transient query string, and the token-bearing download URL is deliberately not retained here.

## Embedded license and authorship snapshot

The archive's `Cricket/README.txt` identifies `Low Poly Cricket Model Pack`, NRG Studios 2026, update V1.1. It says
`No AI used for anything` and `Released under CC0`. It describes the models as real-scale and includes Blend, PNG,
3DS, FBX, OBJ, glTF and text sources. Its CC0 notice permits copying, modification, distribution, performance and
commercial use without permission; it excludes endorsement and provides no warranty. Patent, trademark, publicity
and privacy rights are not waived by that notice.

| License evidence | Value |
| --- | --- |
| Embedded file | `Cricket/README.txt` |
| README SHA-256 | `86db4ef87095d67a2f4975b385ff8112f69be625544ef9a7fc366e99117105c3` |
| Declared license | CC0 / public-domain dedication |
| Declared creation method | Human-made; no AI used |
| Attribution required | No, but source and provenance are retained here |

## Safe archive inspection

- Inspection used ZIP listing and stream/extract operations only; no archive content was executed.
- The archive contains 63 entries and 11,916,052 uncompressed bytes.
- Every entry is rooted below `Cricket/`; no absolute path or `..` traversal entry was present.
- Only the four requested equipment models, their OBJ counterparts, the embedded README and the minimum referenced
  textures were extracted to `/private/tmp/vande-nrgs-a83db3df/` for measurement.

## Candidate integrity

FBX files were the candidate Unity-native import sources. The corresponding OBJ files were used only to make geometry
and material counts inspectable without executing Blender or Unity import code.

| Equipment | FBX bytes | FBX SHA-256 | OBJ SHA-256 |
| --- | ---: | --- | --- |
| Bail | 27,180 | `7a5bcd60ccc8fd219663e7544474f4c90ce76c5064f4a6c2bd169d415b027876` | `94ddd9a8e851d3ed75b989de4a35bc6da395f5c33f7553fd1ca28c4694da45bf` |
| White ball | 125,020 | `e8a3fc57e4867bff246c77a215717b0b1bf89048da0e4ba4b4db452745ce35a0` | `5d0a84c32664f58c11ff6ad4be5fedc79e0f2561aa6895d32b61afe285ee65f0` |
| Bat | 48,188 | `62df3830c6d90a0b159a486ede0debab8bb14f009514f4d34caa5f6d5ebe3bad` | `c0c9a09ce859f0562c1fc123ad1e822e45ded50fe08f49fe27424167798684a0` |
| Stump | 22,108 | `cbd00a58cd3b49916e1334f62d9edfd3947fa7aae404b285b012bccf97db914d` | `927e2d1bed239c90a5046b8af70a7d9eff3716b9dd704211e1f1c86a23bbd378` |

| Referenced texture | Bytes | Dimensions | SHA-256 |
| --- | ---: | ---: | --- |
| `bails_1.png` | 97,685 | 1024 × 1024 | `10e53ac3f4f3295fe733e908270e8f5b89e65cd77bb524dd61a68696c443940c` |
| `ball_new_white.png` | 505 | 1024 × 1024 | `70008f73c0c74ccd38ae816a6918fbf4e183d1e089d584927ad394e7a2860e08` |
| `stitch_1.png` | 496,969 | 1024 × 1024 | `34c2fc83c820b535b95e65bd27e90e281c78b0cd71a3c9f24eb37b8d7d44a1c8` |
| `bat_1.png` | 79,703 | 1024 × 1024 | `25a85aadc7bd362e832920472722a9bef26a8e1567452bb0810dd5d19f98b8b6` |
| `stump_1.png` | 45,235 | 1024 × 1024 | `071626a6ddb3d21cfe5219b72a8f0eddb718d8e9ea68b12ba00e37a0572ab215` |

If all four FBXs and their five minimum referenced textures had been copied as raw sources, the repository input delta
would have been 942,593 bytes before Unity import metadata, mesh serialization, texture compression and build stripping.

## Measured selection review

OBJ bounds are in the pack's declared metre-scale coordinates. Triangle totals use deterministic fan triangulation of
each OBJ face. Existing comparison counts are computed from the High-quality procedural constructors in
`ProductionCricketProps.cs`; they are not runtime timing measurements.

| Equipment | Pack bounds in metres (X × Y × Z) | Pack triangles | Materials / textures | Existing High comparison | Selection result |
| --- | --- | ---: | --- | --- | --- |
| Bail | 0.123434 × 0.026000 × 0.026000 | 380 | 1 / 1 | 0.1095 m authoritative length; 288 triangles | Reject: 12.7% longer than VANDE's authoritative bail and more geometry. Flat atlas does not improve the current turned profile. |
| White ball | 0.072000 × 0.072663 × 0.072664 | 4,224 | 3 / 2 | 0.072 m diameter; 1,024 body + 640 independently oriented seam triangles | Reject: 2.54× the full existing High ball triangle count. Its combined mesh cannot replace VANDE's independent seam and polished-half frames without losing delivery-authoritative seam/shine orientation. The diffuse maps add no corresponding close-up surface detail. |
| Bat | 0.112050 × 0.920000 × 0.074731 | 1,128 | 1 / 1 | 0.108 m blade width; 0.064 m maximum modelled blade depth; 238 blade + 48 handle triangles | Reject: the drop-in bounds exceed VANDE's authoritative width and modelled depth, and triangle count is 3.94× the complete existing High bat. The flat `SCOOP` atlas is visibly less detailed than the existing original willow-grain texture. |
| Stump | 0.026000 × 0.711200 × 0.026000 | 192 | 1 / 1 | 0.711 m × 0.035 m diameter; 180 triangles | Reject: height is suitable but diameter is 25.7% below VANDE's authoritative value. The flat brown atlas does not improve the current grooved, banded profile. |

The FBX/OBJ material files also contain creator-machine absolute texture paths. Those could be repaired during a future
import, but doing so would not resolve the measured geometry, authority or visual-detail deficits above.

## Repository and release impact

| Measure | Result |
| --- | --- |
| Models/textures imported | 0 |
| Runtime code changed | 0 files |
| Raw asset delta | 0 bytes |
| Estimated release-artifact delta from this review | 0 bytes |
| Android compatibility cohorts affected | None; no Android/runtime change |
| SIZE-50 certification | **UNPROVEN** — this review is not fresh-installed Play-split/device evidence |
| REACH-90 certification | **UNPROVEN** — this review is not representative Play/device evidence |

## Review evidence context

| Field | Value |
| --- | --- |
| Repository build id at final review | `38924bd+ec0352a7e64d` |
| Final review UTC | `2026-10-30T09:25:24Z` |
| Host | Darwin arm64, kernel 24.6.0 |
| Host load at record | 17.25 / 23.68 / 31.45; no timing result was taken |
| Method | Anonymous source acquisition; ZIP path/size/hash inspection; README review; OBJ bounds, face, material and texture-reference inspection; visual texture inspection; source comparison to deterministic procedural constructors |
| Expected | Import only lawful, original/human-made zero-cost props that improve current Stage 1 presentation without breaking authoritative dimensions, seam/shine behaviour or the Android budget |
| Observed | License and source criteria passed; all four equipment candidates failed at least one measured integration criterion |
| Result | **REJECTED FOR INTEGRATION**; procedural fail-closed path remains the only path |
