# Independent audit — capture/compare machine foundation

- Verdict: **NOT PASSED**
- Scope: Stage 1 master prompt §§9 and 14; capture/compare machine foundation only
- Evaluator: `capture_tool_independent_audit` (did not author the audited implementation)
- Audit UTC: 2026-10-29T00:33:58Z–2026-10-29T00:35:51Z
- Repository identity observed before the final review files were written: `38924bd+63c3790874bf`
- Host at evidence snapshot: `17:35  1 user, load averages: 16.33 17.32 20.51`
- Runtime surfaces: no browser, Android app, build, competitor title or competitor media was launched
- Raw adversarial scratch: `/var/folders/l5/_njrnd_93616m0sdn6h16s_w0000gn/T/vande-capture-audit-EKq5b9`
- Stale-WebGL receipts: `/private/tmp/vande-audit-webgl-not-available-20261029T0035Z/` and `/private/tmp/vande-audit-webgl-not-available-20261029T0036Z/`

The checked-in happy-path tests pass and the stale Unity WebGL path fails closed correctly. The foundation nevertheless
cannot support an evidence claim yet: several trust boundaries accept self-asserted or fabricated identity, metrics,
adjudication and registration data, and the comparison layer can produce a favourable direction for explicitly
incomparable platforms/devices.

## Audited implementation snapshot

| File | SHA-256 |
| --- | --- |
| `docs/evaluation/capture-compare/README.md` | `4fc67176b605674b92f882efd122afa7db98f4d874862599000141f4bfdc46b5` |
| `docs/evaluation/capture-compare/manifest.schema.json` | `9db60efc622e2a0b7b78a8742b35e3bb500dfc751e3b35c1084463fec1b9e336` |
| `docs/evaluation/capture-compare/metrics.schema.json` | `843e1e53afe3e63a1ed2bcabe6c5423dfe1ba8e418efdf6aa4448e4dd7471a85` |
| `docs/evaluation/capture-compare/registration.v1.json` | `09d600346e28523248573b0d42d3cde1492e86dfe95da8d70cb0886d7ecabc8a` |
| `docs/evaluation/capture-compare/sources.json` | `4cc8f8e48aac9f8707e1d6e28b871b83ef80cad13dbc4f52c13bb89985a059b2` |
| `scripts/eval/compare/annotate.mjs` | `af407629f94ba240ec7efd0bf17ffd568e2dd8f3b1710dffac626c876e5b84be` |
| `scripts/eval/compare/capture-android.mjs` | `cf78504811943cf477f6d11cca3e9d0191a2faa31da5d42482866c600f556a17` |
| `scripts/eval/compare/capture-web.mjs` | `48c8dfc3072f04df5dddf4d323cf0bcf32ba0faa7627befd677077dd3a3862` |
| `scripts/eval/compare/capture-webgl.mjs` | `0dbc297a1aa1728b40e98b8d3ea3cc466a3b9d7c1cda8201d4822592027d49dd` |
| `scripts/eval/compare/compare.mjs` | `ec9f8eeaa28332c149ebb51e959f876805e79b3a7f00bc0fe7b79da11b1c871b` |
| `scripts/eval/compare/lib.mjs` | `b7791dcbb77753dc6729a4faadbe8b77236307686dbfcf813d02d6482c3a8a71` |
| `scripts/eval/compare/metrics.mjs` | `89bb7770ab7b6fecc4a088fd1e338538faeb01d29a3d640dd316476b384c8638` |
| `scripts/eval/compare/normalize.mjs` | `191d4359d198da895e08b4fec9970b91f1086b20eab650645884041188f1fcce` |
| `tests/unit/evaluation/capture-compare.test.ts` | `9d81b32999f6d46978396d60a9249bd6426b14a71afe06f92332ad93a7515950` |

The repository identity changed while the review artifact itself was being added; the hashes above, rather than the
mutable working-tree build ID alone, bind this verdict to the audited implementation.

## Blocking findings

### AUD-C01 — Android runtime and renderer identity can be caller-forged (Critical)

Expected: derive and cross-check current source, embedded runtime and installed artifact identity; a visible/runtime
claim must not come from nullable caller input.

Observed:

- `validateAndroidIdentityEvidence` checks string equality inside caller-supplied JSON
  (`capture-android.mjs:34–51`).
- the capture manifest then writes `embeddedBuildId: sourceId` and `observed: renderer` itself
  (`capture-android.mjs:292–301`) rather than observing either from the installed bytes/live runtime;
- pulled APK split hashes are inventoried, but no build/renderer identity is extracted from and matched to those
  bytes.

Adversarial result: `callerForgedAndroidIdentityAccepted: true` and
`unityNativeWithoutProofAccepted: true`, both with empty error arrays. This violates master prompt §9.2 and the
automatic source/renderer rejection gate in §9.7.

### AUD-C02 — Android video is not bound to the claimed foreground application (Critical)

Expected: prove the package visible during the capture and preserve that observation.

Observed: both VANDE and competitor paths verify that a package is installed, then invoke `screenrecord`; neither
checks/resamples the top resumed activity/window before and after recording. An unrelated app, launcher, permission
dialog or static screen can therefore be recorded and labelled as the installed package. The competitor path also
cannot mechanically establish its text claim that the install is lawful; that part remains operator attestation.

### AUD-C03 — Fabricated metrics pass comparison without annotations or a receipt (Critical)

Expected: every comparison metric is hash-linked to the selected annotation(s), media and manifest; absent provenance
rejects the affected claim.

Observed: `compare.mjs:212–223` accepts any schema-valid metrics file whose `captureId`, manifest hash and scenario
match. It does not require or verify the metrics receipt, copied annotations, annotation hashes or media hash.
`buildComparison` then unconditionally writes `sourceFilesVerified: true` (`compare.mjs:137`).

Integrated adversarial result: two hand-authored metrics files with empty `sources`, no annotations and no receipt
were accepted; comparison returned `ok: true`, `findings: []` and `sourceFilesVerified: true`.

### AUD-C04 — The frozen registration is replaceable at comparison time (Critical)

Expected: use the preserved preregistration exactly, or a new version with an explicit registered deviation.

Observed: `--registration` accepts any JSON having `analysisVersion: "1.0.0"` and
`registeredBeforeComparison: true` (`compare.mjs:224–226`). There is no schema, approved path/hash or versioned
deviation verification.

Adversarial result: changing only `lowerIsBetter` for first-playable time inverted the report from
`favourable_to_candidate` to `unfavourable_to_candidate`; the supplied registration was accepted by the integrated
comparison.

### AUD-H01 — Explicitly incomparable platforms/devices receive a directional result (High)

Expected: Android is the same-device competitor platform; Unity WebGL is a separate parity lane; mismatched device,
recording, input, whole-sequence or platform conditions are `NOT_COMPARABLE`.

Observed: `comparePackages` checks only exact scenario text, unit and numeric value (`compare.mjs:26–60`). It does
not gate lane/platform, device, orientation, refresh, capture method, audio, input class, `wholeSequence`, settings or
uncertainty. Diagnostic values are also eligible for a favourable/unfavourable direction.

Adversarial result: a VANDE package on `Phone A` and controlled competitor on `Phone B`, both with
`wholeSequence: false`, produced `raw_delta_only`, delta `-300 ms`, direction `favourable_to_candidate`.

### AUD-H02 — Declared sidecars need not exist or be hash-declared (High)

Expected: event/physics/replay/frame/annotation sidecars exist, are regular files and are hash-bound.

Observed: `validateManifest` verifies only entries in `files`; `sidecars` are checked only as syntactically safe paths
(`lib.mjs:433–438`). It does not require each sidecar path to appear in `files`.

Adversarial result: `events: ["ghost-event-sidecar.json"]` with no such file passed `verifyFiles: true` with no
errors.

### AUD-H03 — Adjudication can be asserted without reviewing anything (High)

Expected: an adjudicator file must hash-link the independent primary/secondary files and preserve decisions; multiple
annotations without real adjudication remain incomplete.

Observed: validation permits `role: "adjudicator"` with `adjudication: null`, or an empty review list
(`lib.mjs:526–530`). Metrics selects the first file with an adjudicator role (`metrics.mjs:296`) without checking that
its `reviewedFiles` contains the supplied annotation hashes.

Adversarial result: an adjudicator with no adjudication passed validation with no errors.

### AUD-H04 — An undeclared metric becomes measured (High)

Expected: only explicitly `eligible` or `diagnostic_only` metrics may produce values; a missing applicability entry
fails closed.

Observed: `statusFor` treats only explicit `not_available` as unavailable (`metrics.mjs:76–82`). On raw evidence, a
missing key falls through to `measured`.

Adversarial result: with `applicability.metrics: {}`, `time_to_first_playable_ball_ms` was emitted as `measured`.

### AUD-H05 — Production web/WebGL evidence is not artifact-bound (High)

Expected: exact source/build and artifact hash, plus renderer/admission proof.

Observed: the web manifest always stores `identity.artifact: null` and trusts DOM build/renderer attributes supplied
by whatever URL `--base` names. The WebGL preflight validates the export root, but the later live URL is not
cryptographically or path-bound to that export. A caller-controlled page exposing the expected attributes can pass
the live part. This also falls short of §14's artifact-hash requirement for every claim.

### AUD-H06 — Android source identity is not rechecked after capture (High)

Expected: reject if source changes during a capture.

Observed: web records `sourceBefore` and `sourceAfter`; Android derives `sourceId` once before copying artifacts and
recording, then never rechecks. A concurrent source change can leave a captured manifest labelled current when it is
not current at completion.

### AUD-H07 — Required §9.5 measures/report fields are incomplete (High)

The frozen metric list omits, among other required controlled-video outputs: local luminance contrast; camera shake,
roll and horizon movement; motion jerk, foot slide, bat-arc discontinuity and clipping; artifact/material defect
checklists; camera/result response delay; touch-target burden; and text legibility. The readable Markdown report also
omits measurement uncertainty, metric timecodes/evidence references and explicit observable wins/losses, even though
some values exist in JSON. A raw file record has bytes/hash but no per-file duration field.

### AUD-M01 — One-axis normalization records the wrong output dimensions (Medium)

`normalizePlan` permits width-only or height-only scaling. FFmpeg derives the missing axis with `-2`, but
`normalizeManifest` records the parent dimension for that axis (`normalize.mjs:65–68`) and never probes the produced
file. Example: 1920×1080 normalized with `--width 1280` is expected to become 1280×720, while the manifest records
1280×1080.

### AUD-M02 — Ball diameter does not match the registered definition (Medium)

Registration defines bounding-box **mean diameter**. `pixelDiameter` uses
`sqrt(widthPx * heightPx)` (`metrics.mjs:96–99`), the geometric mean, rather than the registered arithmetic mean.
This changes measurements for non-square/uncertain annotations.

## Verified strengths

- **PASS:** all eight `.mjs` files passed `node --check`.
- **PASS:** focused suite: 1 file, 16 tests passed in 1.23 s.
- **PASS:** both checked-in schemas compile as Draft 2020-12 with AJV when union types are enabled.
- **PASS:** current-source Unity WebGL preflight rejected the stale export with exit code `3`; expected
  `38924bd+63c3790874bf`, found `38924bd+6bedc0236562`; the manifest says `not_available`, has no files and makes no
  renderer claim.
- **PASS:** manifest validation rejects a direct captured-VANDE source/runtime build mismatch.
- **PASS:** public-reference manifests cannot include redistributed media.
- **PASS:** reviewed-zero markers are distinguished from absent observations in the focused tests.
- **PASS:** file entries are byte/hash checked when `verifyFiles` is used, safe relative paths are enforced, output
  directories are not reused, and writes refuse overwrite.
- **PASS:** web machine input is labelled diagnostic and ADB/audio limitations are stated.
- **PASS:** deterministic report rendering is covered by a focused test and passed.

These strengths do not compensate for the provenance bypasses above.

## Impact classification

| Finding | Impact class | What it permits |
| --- | --- | --- |
| AUD-C01 | **FALSE EVIDENCE** | A caller-created JSON file can become exact-build/Unity-native Android evidence without deriving identity from the installed artifact or live renderer. |
| AUD-C02 | **FALSE EVIDENCE** | Bytes from another foreground app/screen can be attributed to VANDE or a named competitor package. |
| AUD-C03 | **FALSE EVIDENCE** | Invented metric values with no annotation/media derivation can be reported as verified source files. |
| AUD-C04 | **FALSE METHOD / MISLEADING COMPARISON** | A post-result registration can reverse a favourable/unfavourable direction while presenting itself as preregistered. |
| AUD-H01 | **MISLEADING COMPARISON** | Incomparable platforms, devices, inputs and incomplete sequences receive a directional result. |
| AUD-H02 | **FALSE EVIDENCE** | A manifest can claim event/physics/replay/annotation evidence that does not exist. |
| AUD-H03 | **FALSE EVIDENCE** | A self-labelled adjudicator can replace primary evidence without reviewing any supplied annotation. |
| AUD-H04 | **FALSE MEASUREMENT** | An inapplicable/unregistered metric can be promoted to measured. |
| AUD-H05 | **FALSE EVIDENCE** | A caller-controlled web page can supply current-looking DOM identity without binding the video to the verified production/WebGL artifact. |
| AUD-H06 | **STALE EVIDENCE** | Android output can be labelled current after the working source changes during capture. |
| AUD-H07 | **INCOMPLETE / MISLEADING COMPARISON** | Required defects and uncertainty can disappear from the readable comparison surface. |
| AUD-M01 | **FALSE METADATA** | The manifest can state dimensions different from the produced normalized video. |
| AUD-M02 | **FALSE MEASUREMENT** | A registered mean-diameter result is calculated with a different formula. |

Any **FALSE EVIDENCE**, **FALSE METHOD**, **FALSE MEASUREMENT**, **FALSE METADATA** or **STALE EVIDENCE** finding
rejects the affected claim under §9.7. The misleading-comparison findings independently prohibit a competitor-rank or
advantage claim even if the underlying raw media is authentic.

## Exact commands and results

```text
date -u '+%Y-%m-%dT%H:%M:%SZ'; uptime; release/player-experience/tools/build-id.sh
=> 2026-10-29T00:33:58Z
=> load averages 16.90 17.89 21.16
=> 38924bd+ccbef2fdf065 (before the audit script was added)

for f in scripts/eval/compare/*.mjs; do node --check "$f" || exit 1; done
=> PASS (8/8 syntax checks)

npx vitest run tests/unit/evaluation/capture-compare.test.ts
=> PASS (1 file, 16/16 tests, duration 1.23 s)

AJV 2020-12 compile, strict with allowUnionTypes=true and validateFormats=false
=> manifest.schema.json COMPILED_DRAFT_2020_12
=> metrics.schema.json COMPILED_DRAFT_2020_12

node scripts/eval/compare/capture-webgl.mjs --export-root unity/VandePractice/Builds/WebGL \
  --output-dir /private/tmp/vande-audit-webgl-not-available-20261029T0036Z \
  --evaluator independent-audit
=> exit 3, NOT_AVAILABLE
=> expected 38924bd+63c3790874bf; found 38924bd+6bedc0236562

node docs/evaluation/capture-compare/reviews/adversarial-audit.mjs
=> completed; every bypass described above reproduced
=> scratch /var/folders/l5/_njrnd_93616m0sdn6h16s_w0000gn/T/vande-capture-audit-EKq5b9
```

No timing/performance claim is made from these commands. The 1-minute load was below the repository's `>20`
indicative-only threshold at both recorded snapshots; this audit does not use the timings as product evidence.

## Machine-foundation decision

**NOT PASSED.** Do not use this version of the capture/compare runner for a Gate A/B/C claim, competitor advantage,
CERI evidence claim, renderer proof or exact-build Android claim. It is safe only as an experimental diagnostic
foundation whose outputs are explicitly untrusted until the Critical and High findings are corrected and rerun by a
fresh evaluator.

Minimum correction order:

1. bind Android capture to installed artifact bytes, extracted embedded identity, live renderer evidence and the
   foreground package before/during/after recording;
2. make metrics receipts and annotation/media hashes mandatory inputs to comparison, then verify the entire chain;
3. pin/hash/schema-validate preregistration and require a versioned deviation record;
4. fail comparison closed across lane/platform/device/input/whole-sequence/settings mismatches and diagnostic/raw
   mismatches;
5. enforce sidecar existence/hash membership, real adjudication and explicit metric applicability;
6. bind web/WebGL live capture to the verified artifact and add a source-after check on Android;
7. complete the required metric/report inventory and correct normalization/diameter calculations;
8. add adversarial regression tests for every reproduced bypass, then obtain a fresh independent audit.

## Prioritized remediation contract

This is an acceptance contract, not an implementation prescription. A fresh evaluator must rerun it against the
corrected files.

### P0 — provenance blockers (must pass before any output is called evidence)

1. **Android artifact/runtime/media binding**
   - derive source identity before and after capture;
   - derive embedded build identity from the pulled installed bytes, not from `--identity-evidence`;
   - prove the requested renderer/admission from a live, same-session runtime surface and bind that proof to the
     installed artifact inventory;
   - sample and record the resumed/foreground package at least immediately before and after screen recording, and
     reject any mismatch or obscuring system surface;
   - keep caller JSON as supporting evidence only; it must never populate an observed identity by itself.
   - **Acceptance:** the forged identity fixture, a wrong foreground package, a changed APK split, a missing renderer
     proof and a source change during capture each produce non-zero exit and a failed/not-available manifest with no
     eligible metric.
2. **End-to-end metric provenance**
   - comparison requires a metrics receipt;
   - verify metrics bytes, manifest bytes, every selected annotation, annotation-to-media/manifest hashes and all
     source paths before reading a value;
   - compute `sourceFilesVerified`; never hard-code it;
   - reject orphaned or hand-authored metrics without the complete chain.
   - **Acceptance:** the audit's fabricated metrics fixture is rejected before report creation and
     `sourceFilesVerified` can never be true when any referenced object is missing or altered.
3. **Frozen registration integrity**
   - schema-validate the registration and pin the accepted path/version/hash in code or a separately approved
     registry;
   - a custom registration requires a new analysis version plus a hash-bound deviation record created before its
     results; a boolean in the candidate file is not proof.
   - **Acceptance:** the direction-flip registration fixture is rejected; the checked-in registration hash above is
     accepted; a byte change requires the documented new-version path.

### P1 — anti-fake and comparability gates

4. **Comparison compatibility matrix**
   - require a registered scenario-class ID distinct from free-text deviations;
   - compare controlled competitors only on Android with matching device identity, display/orientation/refresh,
     thermal/network/recording class, input class, settings and complete-sequence status;
   - keep Unity WebGL in its parity lane;
   - diagnostic/staged/machine-input evidence may be displayed but receives no favourable/unfavourable direction
     against raw human-controlled evidence;
   - uncertainty incompatibility is `NOT_COMPARABLE`.
   - **Acceptance:** the Phone A/Phone B fixture, Android/WebGL pair, `wholeSequence:false` pair and diagnostic/raw
     pair all return `NOT_COMPARABLE` with the exact reason.
5. **Sidecar and adjudication integrity**
   - every sidecar path must name a unique regular file declared in `files` with verified bytes/hash;
   - an adjudicator role requires non-null adjudication, at least the required independent source annotation hashes,
     no unknown hashes and recorded decisions for ambiguity;
   - multiple annotations without valid adjudication remain incomplete and cannot yield final measurements.
   - **Acceptance:** `ghost-event-sidecar.json` and the empty adjudicator fixture are rejected.
6. **Explicit applicability and evaluator conflicts**
   - absent metric applicability fails closed;
   - measured requires `eligible`; diagnostic requires `diagnostic_only`; `not_available` never carries a value;
   - contradictory authored/independent flags reject rather than merely add a finding.
   - **Acceptance:** the empty applicability map yields `not_available` or validation failure, never `measured`.
7. **Web/WebGL artifact binding**
   - hash and record the production artifact set;
   - prove the served URL bytes originate from that set and that its embedded build/renderer/admission agree;
   - retain the existing stale-export `NOT_AVAILABLE` behavior.
   - **Acceptance:** a page that only copies DOM build/renderer attributes is rejected, while the stale export still
     exits `3` with no fake Unity evidence.

### P2 — completeness and measurement correctness

8. Add every §9.5 registered measure or mark it explicitly unimplemented/not available; make Markdown/HTML expose
   uncertainty, timecodes/references, mismatches, limitations and unfavourable evidence as visibly as favourable
   evidence. Add per-file duration where applicable.
9. Probe normalized output and record observed width, height, FPS, codec and duration. Preserve the full transform
   chain. Width-only and height-only normalization must report the actual derived axis.
10. Implement the registered arithmetic mean diameter, or version the registration before changing the definition.

### Mandatory regression set

The corrected focused suite must include the exact cases in
`docs/evaluation/capture-compare/reviews/adversarial-audit.mjs`, plus tampered APK/media/annotation/receipt bytes,
foreground changes during capture, a source-after mismatch, an unapproved registration hash, WebGL-vs-Android,
diagnostic-vs-raw, incomplete sequence, different device/settings and one-axis normalization. All original 16 tests
and the stale-WebGL fail-closed check must remain green. Passing these machine checks is still not device, human,
CERI or release certification.
