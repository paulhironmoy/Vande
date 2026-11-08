# Gate-A active static-direction candidate addendum

Status:
`STATIC_DIRECTION_CANDIDATE_PENDING_CURRENT_CAPTURE_ASSET_FEASIBILITY_AND_OWNER_APPROVAL`

Recorded UTC: `2026-10-29T05:38:59Z`  
Validator binding refreshed UTC: `2026-10-29T12:10:13Z`  
Machine-readable authority: `active-target.v2.json`

This addendum selects v2 only as the active static-direction candidate for the
next exact-current comparison. It is not owner approval, Gate-A approval,
runtime evidence, production-asset acceptance, Android evidence, or a player
result.

## Selected target

| Binding | Exact value |
| --- | --- |
| Clean target | `docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-844x390.png` |
| Clean SHA-256 | `f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9` |
| Evidence overlay | `docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-evidence-844x390.png` |
| Overlay SHA-256 | `9c8611e6a44b90b1eda2bc576de1138bd48858e6469c2690a49ec5055cedf099` |
| Target hand | `right` |
| Viewport | `844 × 390`, device scale factor `1` |
| Camera | `58°` horizontal FOV |
| Crop | cover, centre-bottom; anchor `(0.5, 1.0)` in top-left normalized coordinates |
| README | `docs/evaluation/gate-a/visual-direction/v1/README.md` |
| Capture contract | `docs/evaluation/gate-a/visual-direction/v1/capture.mjs`, exclusive hard-link/no-overwrite outputs |

v1 is preserved as history but is not the active target. Its PIP did not bind
a separate batter plus exactly keeper, bowler and nine other fielders to stable
identities, and its HTML and Unity crop anchors differed. v2 corrects those
defects: the batter is separate, the 11 defenders have canonical identities,
only `bowler` receives the active highlight, orientation is bowler-end top and
striker-end bottom, and HTML/Unity share the centre-bottom crop contract.

## Frozen 13-file static package

| Path | SHA-256 |
| --- | --- |
| `docs/evaluation/gate-a/golden-screen/ASSET-IMPLEMENTATION-MAP.md` | `79bc89de9d664a95210f10426a4d0baf263bb0496875b39513b172363e217b61` |
| `docs/evaluation/gate-a/golden-screen/README.md` | `fd4f8734452b6442cba92f4e4868134d215d7749e8534a412018a8edbb27851a` |
| `docs/evaluation/gate-a/visual-direction/v1/README.md` | `7fb61522ccd9205ae23124b4156afe09747e72ca5de7e8d271c347595fa9f6f3` |
| `docs/evaluation/gate-a/visual-direction/v1/capture.mjs` | `d0939a4dacaf0f4526163698b84c4a0b48696b31f8d6db562e0c7dc0448c4191` |
| `docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-844x390.png` | `f7e70b281a7127ae0f2eead9f4f5e1fb4e60c220eec9ae0a94ec7c58b59a97e9` |
| `docs/evaluation/gate-a/visual-direction/v1/golden-screen-v2-evidence-844x390.png` | `9c8611e6a44b90b1eda2bc576de1138bd48858e6469c2690a49ec5055cedf099` |
| `docs/evaluation/gate-a/visual-direction/v1/index.html` | `de981715600b13299992b6e04645f3e1a2cea78726c8f5c11760b8a6a5439bea` |
| `docs/evaluation/gate-a/visual-direction/v1/target.v1.json` | `7d0189d01b2d77b5ae01453b49b462960a2c8448ff74592d0099c43ba7f40b83` |
| `docs/evaluation/gate-a/visual-direction/v1/validate.mjs` | `f4ca9840def66c19090c9145a7dd3ca59a708fc0d28fff7f387a6b7b39f15ed5` |
| `unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/GoldenScreenLayout.cs` | `54185a623cf5949652829e26c6ecb794372f49146652be15660160c98bf2a1dd` |
| `unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/GoldenScreenOverlayPainter.cs` | `dd3dc0f4acf4076524f47d434e87f969ff746030a401a11361e3854952a00260` |
| `unity/VandePractice/Assets/VandePractice/Runtime/GoldenScreen/GoldenScreenPrototype.cs` | `60668848dc804d994aca292040dd1e48114f41cace264e56b991db009c3c59ab` |
| `unity/VandePractice/Assets/VandePractice/Tests/EditMode/GoldenScreen/GoldenScreenLayoutTests.cs` | `c80bd1564eb81984da39b3eb30f0958e00130f4d8b7b2c96c9032feaa3e6e87b` |

Independent retest:
`release/gate-a/visual-direction/independent-retest-20261029T044422Z/INDEPENDENT-GATE-A-V2-TARGET-RETEST.md`,
SHA-256
`32f7b4a188bfe68e967b410756f5c6b10f41eee462d8d05370316dc1cd379595`.
Its verdict is PASS only for the frozen v2 static-direction package; Gate A is
not passed.

The production-feasibility boundary for this v2 selection is frozen separately
in
`docs/evaluation/gate-a/acquisition/ACTIVE-V2-ASSET-FEASIBILITY-ADDENDUM.md`,
SHA-256
`efeddb4787737a13f89ec6b3c11bdc776a8edde2e492d16ec282f5a14377a04f`.
It records that v2 closes only the PIP and crop defects: production humans,
rigs, cricket motion, props, stadium/crowd, authentic audio, typography,
licences, runtime bindings and mobile measurements remain unresolved. Its Gate-A
verdict is **NOT PASSED**.

## Historical record is unchanged

The v1 clean target (`d75e208a...`) and overlay (`d280e70a...`) remain in
place. The historical provisional rubric, `EVIDENCE.json`, independent README,
and 2026-10-29 screen matrix remain byte-for-byte historical records. This
addendum does not revise their old observation, score, or verdict and does not
retroactively attribute v2 to those reviews.

The strict still comparator is now frozen against the full production-shaped
Android evidence contract. It requires an exact physical-pixel match, an exact
logical CSS viewport match, device pixel ratio `1`, matching handedness and a
complete H7 replay before it can emit directional comparison readiness:

- `scripts/eval/compare/gate-a-still.mjs`:
  `2ce9643ef5fde672c4acaa77052923e24a10842d0664a43abe92a2aad02c0c15`;
- `scripts/eval/compare/gate-a-still.test.mjs`:
  `7a05fbf46884fb687277bde40c7302b475cffb0e9c3cc30638128d8610dab7f1`;
- `docs/evaluation/gate-a/independent-provisional/CURRENT-TARGET-COMPARISON-TEMPLATE.md`:
  `736a5fa03190481feb84564c89411bda89d8cbf717cca5f031700f37e5b5cd96`.

The pointer also freezes the five local validation dependencies used by that
comparator:

| Dependency | SHA-256 |
| --- | --- |
| `scripts/android-device-identity.mjs` | `61c17a102f7f2e5d24992d9e67623a005da6d44b51e0f634927bab2b8bd47625` |
| `scripts/android-gate-a.mjs` | `7d1a39d3e38e09caaad90655cf463d079f90276d8d4a7f58b1ee9eb18d0cdff6` |
| `scripts/android-gate-a-unity-admission.mjs` | `2baa05a793141de447c883919cf392b81fce3db501f8cc805f5f9992fd91b80a` |
| `scripts/android-installed-package-inventory.mjs` | `b27fb24350fa58633bcb918f7a6a610a6b019859562baae5c56c620bdf705ead` |
| `scripts/android-unity-payload-binding.mjs` | `d5c8b6f97d3888a3f686d0ad4d58df451757db87405740eb209ffbd533a88a36` |

The comparator test and two Android identity dependencies were re-bound after the
failed v4 run exposed volatile SurfaceFlinger cache rows in the former device
identity projection. The V2 stable-identity receipt separates those diagnostics,
adds ABI evidence and rejects mixed identity policies. This is an evaluator
integrity correction only: it does not change either target image, approve the
candidate, or pass Gate A.

The replay contract was also re-bound after a pre-install audit found that the
production harness records `adb-isolation.txt` while the exact-key replay
schema omitted that record. The producer and validator now share the frozen
record map; replay requires loopback, a dedicated non-default port, the exact
receipt serial and exact-one-device inventories. Production-shaped tests cover
missing, added, altered and semantically invalid isolation evidence. This is an
evaluator-integrity correction only and does not promote the target or pass
Gate A.

The first-ball capture/input contract was re-bound after the failed v7 and v8
runs exposed two separate evidence-path races. The run-unique remote directory
is prepared before the live release. The single atomic on-device transaction
then begins with `screencap -p`, performs exactly one
`input touchscreen tap`, and collects explicitly post-tap uptime, size and hash
metadata only afterward. The pre-transaction observation reuses the immutable
install-bound device identity; a fresh full identity observation follows the
tap. The exact command, bounded stdout, outer ADB status, byte-empty stderr,
coordinate, remote and persisted PNG bytes, hash and geometry are retained.

The exact bounded transaction stdout and stderr are retained immediately as
immutable raw files before status checks, decoding or parsing. A non-null
schema-2 initial attempt record is then written before one immediate raw remote
capture pull; that pull's stdout and stderr are likewise retained before PNG
validation. An append-only fsynced checkpoint/error journal and separate
one-shot final snapshot preserve rejected as well as accepted paths. The raw
files, initial record, journal and final snapshot are hash-bound into the report
and evidence manifest, including failed transaction, pull, identity, PNG,
saved-resolution, dead-phase, native-event and validator paths. Acceptance
still requires zero rejected or dropped native events and exact
`release < pointer < gesture < dead` ordering. A post-tap `playing`
observation is valid only when the saved state is either unchanged in-flight or
the exact authoritative resolved state with an accepted gameplay swing; partial
or contradictory states fail closed. The strict comparator now applies the
same invariant, with direct right-handed 844 × 390 logical/physical, DPR 1
regressions for both valid forms. These are evaluator-integrity corrections
only: they do not establish a successful device run, change either target
image, approve the candidate, or pass Gate A.

This freeze prevents a 844 × 390 physical image produced from a different
logical viewport or scale factor from being treated as matched evidence. It is
an evidence-integrity improvement only; it does not promote the static target
or pass Gate A.

## Pending before any approval claim

- exact-current accepted Android capture;
- matched current-versus-v2 comparison with right hand and 844 × 390 physical
  pixels;
- verified production asset source, licence, import, installed-size,
  runtime-memory and mobile-feasibility evidence;
- explicit owner approval.

Until those exist, the comparison template remains **NOT PASSED** and the
candidate status above remains unchanged.
