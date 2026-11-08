# Independent retest — capture/compare hardened foundation

- Verdict: **NOT PASSED**
- Scope: Stage 1 master prompt §§9 and 14; capture/compare machine foundation only
- Evaluator: `capture_tool_reaudit`, independent of the implementation
- Audit UTC: 2026-10-29T01:45:21Z–2026-10-29T01:46Z
- Repository identity observed immediately before this report was added: `38924bd+9fad66e12a3e`
- Binding caveat: this report changes the dirty-tree build ID. The exact SHA-256 inventory in
  `independent-retest-2026-10-29.json` is the authoritative binding to the audited implementation bytes.
- Host snapshot: `18:45  1 user, load averages: 24.42 34.87 37.22`; elapsed durations are indicative only and are
  not used for a performance claim.
- Runtime surfaces: no browser, Android device, shared build or competitor title was launched.

The hardening rejects the four prior Critical exploits and most High/Medium exploits in the exercised machine
interfaces. The result is still **NOT PASSED** because five High trust/completeness gaps remain: two compatibility
gaps, two Web/WebGL artifact-binding gaps and an incomplete preregistration inventory.

## Final implementation snapshot

| File | SHA-256 |
| --- | --- |
| `docs/evaluation/capture-compare/README.md` | `0625e0063cf3caa124ca26fb015a5d311fdd0c34b2723a2fca52116650e14651` |
| `manifest.schema.json` | `166e1ccb5eb6527d12eb4b22d112f4285197edae40142690c929398736fa9dec` |
| `metrics.schema.json` | `e9ccf6515d6e57445844a5c43bcd8f304c531d260da37afbdad973073fffe448` |
| `metrics-receipt.schema.json` | `cd972b4339ae699231e7f901582ceda387e49ea485e842e319cfecc8e67d07ea` |
| `registration.v1.json` | `09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a` |
| `sources.json` | `4cc8f8e48aac9f8707e1d6e28b871b83ef80cad13dbc4f52c13bb89985a059b2` |
| `annotate.mjs` | `0a8287c1f974b647ce1d3f791b140528ae45e31dbeada9452f1ad888cd57ca4a` |
| `capture-android.mjs` | `ba926143f7a131668608db6baa7e911544f9a52ef4bd773ddcd8eadba86ab661` |
| `capture-web.mjs` | `6bd7d741539243f0d0bea422f9eb1bc40dcb81f86d8ce8a8646c37b12904a229` |
| `capture-webgl.mjs` | `408162d90f7a6fa23cdd99d4b3611af7b65480aebfceff7f6ec011b3b0d2cc4f` |
| `compare.mjs` | `99437b3cadec49f138752256a507421dac3d27cb7436542bb4b2daad234af55d` |
| `lib.mjs` | `14a84117fcf1a2f0087f43041de35e04c8b24dc06c685a05dd445089d982abdf` |
| `metrics.mjs` | `f031e84aed9010a4b4bc31db88775344fdbcb40de434b7fdf2ac26f0e437e325` |
| `normalize.mjs` | `b174e36cf720e0caf7c1eb60aa353ae89b497bafaa71ce225c9a7308e8fdf990` |
| `capture-compare.test.ts` | `9bdfc85649f39872f37b8a04f81e1c305235ba61f4836a029785705cf626ac51` |
| `capture-compare-adversarial.test.ts` | `252ffe23dd675423dd71b0323e96adbf4b5aca67b0d755c1ebed680b98d34e19` |
| `capture-compare-normalize.test.ts` | `ae4f94672a193714bcd3d9b410352568661241a4787221c1703360c951a1c310` |

## Verification result

| Check | Result |
| --- | --- |
| Node syntax | **PASS**, 8/8 scripts |
| CLI help without side effects | **PASS**, 8/8 scripts |
| Draft 2020-12 schema compilation | **PASS**, 3/3 schemas |
| Focused suites | **PASS**, 3 files and 49/49 tests |
| Independent adversarial checks | **30/35 passed**; five High residuals reproduced |
| Real one-axis normalization | **PASS**, 320×180 input → ffprobe-observed 160×90, h264, 24 fps, 1000 ms |

The custom retest is reproducible with:

```text
node docs/evaluation/capture-compare/reviews/retest/retest.mjs
```

Its SHA-256 is `af48cc0117527a751f34bac2cec3b76484321e7cc5180b7b6f379fbfcba85865`. The recorded run used
`/var/folders/l5/_njrnd_93616m0sdn6h16s_w0000gn/T/vande-capture-retest-LsHoZS`; bulk fixtures remain outside the
repository.

## Prior exploit disposition

| Prior finding | Retest disposition |
| --- | --- |
| AUD-C01 Android identity | Caller-only identity, wrong APK-derived build, changed split, missing admission and missing native runtime proof were rejected. Device execution remains not run. |
| AUD-C02 foreground binding | Wrong/obscured package was rejected; before/after focus/resume sampling is present. Device execution remains not run. |
| AUD-C03 metric provenance | Complete receipt chain passed; missing receipt, media tamper, annotation tamper and a receipt-updated fabricated metric all failed. `sourceFilesVerified` was true only for the complete verified chain. |
| AUD-C04 registration replacement | Direction-flipped registration was rejected; exact allowlisted bytes passed. |
| AUD-H01 comparability | Device, platform, incomplete sequence, diagnostic/raw, assistance and uncertainty mismatches became `NOT_COMPARABLE`; OS and recorder-setting gaps remain. |
| AUD-H02 sidecars | Missing/path-only sidecar was rejected. |
| AUD-H03 adjudication | Empty adjudicator and unknown reviewed hashes were rejected. |
| AUD-H04 applicability | Observed but undeclared metric remained `NOT_AVAILABLE`. |
| AUD-H05 web artifact binding | Artifact root is mandatory, but two High bypasses remain. |
| AUD-H06 source-after | Android source-after comparison is present; device execution remains not run. |
| AUD-H07 completeness | Required placeholders and richer Markdown fields were added, but fourteen measures are not preregistered. |
| AUD-M01 normalization | Actual ffmpeg/ffprobe one-axis run recorded the derived axis and duration correctly. |
| AUD-M02 diameter | Arithmetic mean returned 15 px for a 20×10 px annotation. |

## Remaining High findings

### RET-H01-OS — OS mismatch remains directional

Two controlled Android packages were identical except `environment.os`: Android 14 versus Android 15. Expected:
`NOT_COMPARABLE`. Observed: `raw_delta_only`, delta `-300 ms`, direction `favourable_to_candidate`.

This permits a changed runtime environment to receive a directional comparison.

### RET-H01-RECORDER — recorder settings are not compatibility-bound

Two controlled Android packages were identical except the candidate declared `adb screenrecord --bit-rate 6000000`
in its capture perturbation. Expected: `NOT_COMPARABLE`. Observed: `raw_delta_only`, delta `-300 ms`, direction
`favourable_to_candidate`.

Android capture consumes `--bit-rate`, but the resulting manifest has no structured bit-rate field and comparison
does not compare perturbations. Encoding conditions that can affect pixel/video measures can therefore differ while
receiving directionality.

### RET-H05-DIRECT-WEBGL — the provenance wrapper is bypassable

`capture-web.mjs` directly accepts `renderer=unity-webgl`, yet it never calls `verifyUnityWebGlRoot`; that verification
exists only in `capture-webgl.mjs`. A caller can bypass the wrapper and supply an artifact-bound page with matching DOM
labels without proving it is a qualifying current-source Unity export.

### RET-H05-DYNAMIC-PAYLOAD — runtime-loaded bytes are not bound

`bindServedArtifact` hashes `index.html` and only its direct `<script>`/`<link>` references. It does not traverse
dynamic JavaScript imports or the Unity loader's data, framework and WASM requests. The local inventory may therefore
describe one payload while the captured page loads different runtime bytes.

### RET-H07-REGISTRATION — fourteen required measures are not frozen

The implementation now emits all fourteen as explicit `NOT_AVAILABLE` placeholders, which is safer than omission,
but `registration.v1.json` contains no definition, unit, uncertainty or directionality policy for them:

- local luminance contrast;
- camera shake, roll and horizon movement;
- bowler and bat motion jerk;
- foot slide, bat-arc discontinuity and clipping;
- artifact/material defects;
- physical-event-to-camera and physical-event-to-result delay;
- touch-target burden;
- text-legibility defects.

This does not fabricate a value, but it leaves the required analysis method unfrozen before future results.

## Decision

**NOT PASSED.** Do not use these bytes for a Gate A/B/C claim, Unity WebGL renderer proof, cross-title advantage or a
complete §9 comparison. The receipt chain and Android validation logic are materially stronger, but the five High
gaps still allow misleading directionality, incomplete method registration or runtime/artifact misbinding.

Smallest next action: make Unity WebGL provenance non-bypassable and hash-bind every runtime-loaded export payload,
then preserve this failed report and obtain a new independent retest. After that, bind OS/recorder settings and create
a new preregistration version for the fourteen missing measures before collecting results.
