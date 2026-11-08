# Independent retest v2 — capture/compare hardened foundation

- Verdict: **NOT PASSED**
- Scope: Stage 1 master prompt §§9 and 14, capture/compare machine foundation only
- Evaluator: `capture_tool_reaudit_v2`, independent of the implementation
- Audit UTC: 2026-10-29T02:00:14Z–2026-10-29T02:04:17Z
- Repository identity at start: `38924bd+38db72176834`
- Repository identity after adding the independent harness: `38924bd+89866bf0ab17`
- Binding: the exact SHA-256 inventory below, not the mutable dirty-tree build ID alone
- Host load: 1-minute load 41.57 at start and 37.07 at the final snapshot; elapsed durations are indicative only and are not used for a product-performance claim
- Runtime surfaces: no browser, Android device, shared build, competitor title or competitor media was launched

The checked-in and first-pass independent checks are materially stronger: the independent harness passed **52/52**
checks, the focused suites passed **59/59** tests, eight scripts passed syntax/help checks, all three schemas compiled
strictly as Draft 2020-12, and repository typecheck passed. Four additional adversarial/contract checks then found
one Critical false-measurement path and three High gaps. The aggregate adversarial result is therefore **52/56**,
and the verdict is **NOT PASSED**.

Do not use these bytes for a Gate, timing comparison, Unity WebGL identity or competitor-advantage claim. This audit
is not a browser/device capture result, CERI score, player-experience certification or competitor-superiority claim.

## Verification summary

| Check | Result |
| --- | --- |
| Node syntax | **PASS**, 8/8 scripts |
| CLI help without capture/build side effects | **PASS**, 8/8; import-only `lib.mjs` exited cleanly with no output |
| Strict Draft 2020-12 schema compilation | **PASS**, 3/3 schemas |
| Focused Vitest suites | **PASS**, 3/3 files and 59/59 tests |
| Repository typecheck | **PASS** |
| Independent adversarial checks | **NOT PASSED**, 52/56; one Critical and three High failures |
| Real one-axis normalization | **PASS**, 320×180 → ffprobe-observed 160×90; manifest/file duration both 1000 ms |

## Blocking findings

### RET2-C01-DURATION — Critical false measurement

A real MP4 with ffprobe-observed duration **1000 ms** was copied into a byte/hash-valid capture package whose
manifest declared the same file as **10000 ms**. `loadManifest(..., {verifyFiles:true})` accepted it because file
verification checks bytes and SHA-256 but does not probe media duration. An annotation at **9000 ms** then passed,
`calculateMetrics` emitted a measured 9000 ms first-playable value, and the mandatory receipt/compare chain accepted
it with `sourceFilesVerified:true`. The final comparison emitted delta `-8500 ms` and
`favourable_to_candidate`.

Independent confirmation:

```text
ffprobe ... /private/tmp/vande-capture-duration-adversary.0tEW7q/integrated/vande-duration/raw.mp4
=> 1.000000 seconds

loadManifest(..., {verifyFiles:true})
=> accepted:true, declaredVideoDurationMs:10000

node scripts/eval/compare/compare.mjs [the two complete manifest/metrics/receipt packages]
=> ok:true
=> /private/tmp/vande-capture-retest-v2-independent-duration/comparison.json
=> sourceFilesVerified:true; measured VANDE timecode 9000 ms; directional delta -8500 ms
```

This defeats the latest duration bound because the bound is applied to unverified duration metadata. It is a false
measurement even though all media, annotation, receipt and metrics hashes are internally consistent.

### RET2-H02-WEBGL-PROVENANCE — High false renderer/artifact provenance

The direct Unity path now calls `verifyUnityWebGlRoot`, but that verifier trusts the export's own schema-2 manifest.
An arbitrary non-Unity `index.html` plus arbitrary text files named loader/data/framework/WASM passed the verifier
after their self-authored manifest copied the current repository build ID and Unity-source digest and listed the
files' own hashes. Direct `captureWeb({renderer:'unity-webgl'})` then passed provenance and failed only later at the
intentionally unreachable HTTP preflight; no browser was launched.

Repro script:

```text
nice -n 15 node /private/tmp/vande-webgl-binding-adversary.mjs
=> exit 0; 17/17 expected exploit/binding observations reproduced
=> script SHA-256 83f1d6b654c7cd6fd1b3b7f2b808115b53f1ea04d4a6b45825f1550a7f710421
=> scratch /private/tmp/vande-webgl-adversary-ylNH5q
```

The forged export's arbitrary “WASM” SHA-256 is
`148b6ece9fe231f001aaaa87533972e0d0d526a9433b2151ab97cc65eb02fd56`; the forged manifest SHA-256 is
`e1864e061f4e4fb25236a5c1c33e936fcc6cb20af73e4182a9f9017fb522c1ad`. In addition, runtime listeners are attached
only to the original Playwright `page`, not the `context`, and new pages are not rejected; auxiliary-page requests
can therefore evade the runtime inventory and influence the opener. Main-page inventory and response-byte binding
are materially fixed, but the full provenance claim is not.

### RET2-H03-ANDROID-OS-BUILD — High comparability gap

The comparison correctly rejects different `environment.os` strings. Android capture, however, constructs that
string from `ro.build.version.release` and SDK only. It does not record build fingerprint or security-patch/build ID,
while `registration.v2.json` requires the same Android OS build. Two different builds with the same release/API are
therefore indistinguishable and can receive directionality.

### RET2-H04-FROZEN-MEASURE-METHOD — High method-completeness gap

The v2 registration has all 31 IDs, but the artifact/material defect definition omits the master prompt's explicit
visible-player category and depends on a “completed ... checklist” that is not frozen in the registration or another
version-bound file. The text-legibility definition similarly uses per-package “declared” contrast/size thresholds
rather than one frozen threshold contract. Those methods are not yet sufficiently closed for future directional
results.

## Original finding disposition

| Finding | Independent retest result |
| --- | --- |
| AUD-C01 Android identity | **PASS.** Caller-only identity, wrong APK-derived build, changed split, pulled/installed mismatch, missing admission and missing installed native runtime proof were rejected. |
| AUD-C02 foreground binding | **PASS for the validator/source flow.** Wrong or obscured package observations were rejected and before/after resumed+focused sampling is present. Device execution was not run. |
| AUD-C03 metrics provenance | **PASS.** A complete receipt chain verified; missing receipt, media tamper, annotation tamper and receipt-rehashed fabricated metrics were rejected. `sourceFilesVerified` is not hard-coded. |
| AUD-C04 preregistration | **PASS.** Historical v1 remains byte-identical, v1 is rejected as the active method, exact v2 is allowlisted, and a direction flip is rejected. |
| AUD-H01 comparability | **NOT PASSED completely.** Different serialized OS strings and recorder settings fail closed, but capture omits the exact Android OS build identity required by v2. |
| AUD-H02 sidecars | **PASS.** A path-only undeclared sidecar is rejected. |
| AUD-H03 adjudication | **PASS.** Missing adjudication, unknown reviewed hashes and cross-media workflows are rejected. |
| AUD-H04 applicability | **PASS.** An observed but undeclared metric remains `NOT_AVAILABLE`. |
| AUD-H05 web artifact binding | **NOT PASSED.** Served/runtime byte binding works, but the Unity export provenance record is caller-authored and can bind arbitrary bytes to copied current IDs. |
| AUD-H06 Android source-after | **PASS by source-flow audit.** Source identity is re-derived after recording and participates in capture failure. Device execution was not run. |
| AUD-H07 measure completeness | **NOT PASSED completely.** Active v2 has 31 unique IDs, but the defect/legibility methods still depend on incomplete or unfrozen checklist/threshold inputs. |
| AUD-M01 normalization | **PASS** with a real ffmpeg/ffprobe one-axis run. |
| AUD-M02 ball diameter | **PASS**, a 20×10 pixel annotation yields the registered arithmetic mean of 15 pixels. |

## Five prior residuals

### RET-H01-OS — partially closed

Android 14 versus Android 15 now returns `NOT_COMPARABLE` with reason `os mismatch`. Exact OS-build matching remains
unproven because capture omits fingerprint/security-patch identity.

### RET-H01-RECORDER — closed

The manifest now carries structured recorder class and bit rate. The comparison fails closed for different capture
method, recorder class, bit rate, perturbation declaration or missing structured recorder metadata.

### RET-H05-DIRECT-WEBGL — not closed

Direct `capture-web.mjs --renderer unity-webgl` invokes `verifyUnityWebGlRoot`, and an index-only directory is
rejected. A self-authored, internally consistent manifest can nevertheless bind arbitrary bytes to copied current
IDs and pass that verifier.

### RET-H05-DYNAMIC-PAYLOAD — partially closed

The local inventory recursively includes every regular artifact byte rather than only direct HTML dependencies. The
synthetic audit included a dynamic module plus Unity loader, data, framework and WASM files. Runtime request paths
were constrained to the frozen base/inventory; returned bytes were hash/size checked; tampered, redirected, partial
and cross-origin responses were rejected. The capture path separately requires the four manifest-declared Unity
runtime payloads to be observed. Requests from popup/auxiliary pages remain outside the page-scoped observer.

### RET-H07-REGISTRATION — partially closed

`registration.v1.json` retains SHA-256
`09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a`. Active v2 has SHA-256
`79d2b8e7ee9ae521a49986980676579b4bb03f43150d65be812e127040a07178`, preserves the original 17 metric objects,
and adds entries for the 14 formerly missing §9.5 measures. All 31 IDs are unique and emitted, but player-defect and
frozen-checklist/threshold details remain incomplete.

## Latest hardening checks

- **Duration:** annotation timecodes are bounded to the hash-bound video's probed duration, not capture wall time;
  timecoded annotations without a positive probed duration are rejected.
- **Adjudication:** primary/secondary/adjudicator roles, distinct hash-linked reviews, same source binding and a real
  decision are mandatory for an adjudicated workflow.
- **Receipt:** manifest, every media file, copied annotations, selected annotation, exact v2 registration, metrics
  script and rederived values/CERI mapping are bound and rechecked.
- **APK/runtime:** split hashes are compared remote-before/local/remote-after; source, embedded build, live renderer,
  Unity admission and installed native-runtime proof must agree.
- **Foreground:** resumed activity and focused window must both be the expected package for the sampled before/after
  observations; obscured or wrong-package observations reject the binding.

## Exact audited hashes

| File | SHA-256 |
| --- | --- |
| `docs/evaluation/capture-compare/README.md` | `d79cf48cc0f5818fc10ebf5ddaf22acc0d8f0e3a76ee896d96c4155ce4f98c29` |
| `manifest.schema.json` | `63aba20ca3a780fa8edc1611848a74ac03aa8c493b83d7b0bc217a83af0b25f6` |
| `metrics.schema.json` | `dcf4ea600e6c3f006b0dd0ac27ea93b6c6f07878b9116818fe442a2a17461c39` |
| `metrics-receipt.schema.json` | `e71cf4902cb1078ab53a885e12e72aba34c0d09233a68b118eeca30401f0e734` |
| `registration.v1.json` | `09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a` |
| `registration.v2.json` | `79d2b8e7ee9ae521a49986980676579b4bb03f43150d65be812e127040a07178` |
| `sources.json` | `4cc8f8e48aac9f8707e1d6e28b871b83ef80cad13dbc4f52c13bb89985a059b2` |
| `annotate.mjs` | `0a8287c1f974b647ce1d3f791b140528ae45e31dbeada9452f1ad888cd57ca4a` |
| `capture-android.mjs` | `ee9c75f2ba91537b8b2264c0dee3651ee55b5b63a9b37b448f8c21ebaf1600e4` |
| `capture-web.mjs` | `ab5a6a881956872cebc0785680633e30bc4bf1a1dd61fc537c8aa0f3a935f148` |
| `capture-webgl.mjs` | `50842ed0bffe7d42f1b8c7ac89016c9974df8d947893bbf6effcc063055ad9ff` |
| `compare.mjs` | `50f658e93165fbefda919cda8866e7ab82293c75742972d8c4050bb004f712e6` |
| `lib.mjs` | `14f548dad1cf2dc156bff89bd1f77d37b3b2ef00f8a9dd58b5df3fbd7db63866` |
| `metrics.mjs` | `47b949c1fb5de50613c73201a9f8f00d348083ab877d5380fcab91502b043224` |
| `normalize.mjs` | `b174e36cf720e0caf7c1eb60aa353ae89b497bafaa71ce225c9a7308e8fdf990` |
| `capture-compare.test.ts` | `0fbca397697eedf31a03c567d66f757b2525d927711890a9a81ff9f20214f2fd` |
| `capture-compare-adversarial.test.ts` | `2ed20bb33d4217b1ab15fd12d9efc034b281f9e22c0a7a1e34dc97a1feead974` |
| `capture-compare-normalize.test.ts` | `ae4f94672a193714bcd3d9b410352568661241a4787221c1703360c951a1c310` |
| `retest-v2.mjs` | `5faf706d0964300824a5b9bd7a0b62c9f99996fbc3f279ef5a1379508691a59e` |

## Exact commands and results

```text
date -u '+%Y-%m-%dT%H:%M:%SZ'; uptime; release/player-experience/tools/build-id.sh
=> 2026-10-29T02:00:14Z
=> load averages 41.57 30.51 31.29
=> 38924bd+38db72176834

for f in scripts/eval/compare/*.mjs; do node --check "$f"; done
=> PASS, 8/8

for f in scripts/eval/compare/*.mjs; do node "$f" --help; done
=> PASS, 8/8; no capture/build/device side effect

AJV 2020-12 strict compile with allowUnionTypes=true and validateFormats=false
=> manifest.schema.json PASS
=> metrics.schema.json PASS
=> metrics-receipt.schema.json PASS

nice -n 15 npx vitest run tests/unit/evaluation/capture-compare.test.ts \
  tests/unit/evaluation/capture-compare-adversarial.test.ts \
  tests/unit/evaluation/capture-compare-normalize.test.ts
=> nice priority change was not permitted by the host
=> PASS, 3/3 files and 59/59 tests

nice -n 15 npm run typecheck
=> nice priority change was not permitted by the host
=> PASS

nice -n 15 node docs/evaluation/capture-compare/reviews/retest-v2/retest-v2.mjs
=> nice priority change was not permitted by the host
=> first-pass harness PASS, 52/52 checks
=> scratch /var/folders/l5/_njrnd_93616m0sdn6h16s_w0000gn/T/vande-capture-retest-v2-ZSeuZO

independent real-media duration-chain reproduction and current compare rerun
=> FAIL: 1000 ms MP4 accepted as 10000 ms; 9000 ms measurement and favourable direction accepted
=> /private/tmp/vande-capture-retest-v2-independent-duration/

nice -n 15 node /private/tmp/vande-webgl-binding-adversary.mjs
=> nice priority change was not permitted by the host
=> 17/17 exploit/control observations reproduced; arbitrary payload passed the Unity provenance verifier
=> script SHA-256 83f1d6b654c7cd6fd1b3b7f2b808115b53f1ea04d4a6b45825f1550a7f710421
=> /private/tmp/vande-webgl-adversary-ylNH5q
```

The independent harness SHA-256 is
`5faf706d0964300824a5b9bd7a0b62c9f99996fbc3f279ef5a1379508691a59e`.

## Remaining limitations and next action

- Device-dependent Android execution, a real served Web/WebGL runtime, lawful controlled competitor captures and
  real-player evidence remain pending; this audit deliberately did not substitute synthetic checks for them.
- The 14 newly frozen measures currently fail closed as `NOT_AVAILABLE`. Their registered calculations and qualifying
  annotation/evidence flows must exist before any result for those measures may be reported.
- Tool-generated VANDE and competitor Android manifests currently use different perturbation strings, so an otherwise
  matched pair fails safe as `NOT_COMPARABLE`; normalize this structured declaration before the first real comparison.
- `recorder` remains optional in both JSON Schema and runtime manifest validation. Directionality rejects its absence,
  but the capture contract and README say every manifest records it.
- Because host load exceeded the repository ceiling, no elapsed time is product evidence.

Smallest next action: independently probe and bind media duration at manifest/receipt load, then rerun the preserved
one-second/ten-second exploit. After it fails closed, replace self-attested Unity export identity with provenance that
an arbitrary caller-authored manifest cannot forge and obtain another fresh retest before any live capture claim.

**NOT PASSED**
