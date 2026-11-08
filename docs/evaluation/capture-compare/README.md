# Capture and comparison runner

Status: Stage 1 measurement foundation, analysis version `1.2.0`.

This runner binds a recording to its source, runtime renderer, environment, method and file hashes. It measures only
what the evidence can establish. It does not score its own work, turn machine input into a player, infer hidden
competitor telemetry, download public videos or certify CERI, a locked rubric, commercial success or release
readiness.

The product scope remains Practice. This is internal evaluation tooling, not a player-facing recording, highlight or
sharing feature.

## Evidence lanes

1. `vande_engine_truth`: an exact current VANDE build plus renderer proof and, when available, canonical sidecars.
2. `controlled_competitor`: a current lawfully installed title on an owned comparison phone, with human input and no
   instrumentation, modification or protection bypass.
3. `public_reference`: URL, publisher metadata and timecoded qualitative coding only. The runner never downloads or
   redistributes public footage.

Android is the matched controlled-comparison platform. Unity WebGL is a separate VANDE parity/presentation lane; it
is not ranked for device performance against Android apps.

`registration.v3.json` is the active frozen contract for scenario classes, 31 metric definitions, applicability,
exclusions, sampling, directionality and per-metric uncertainty policy. It binds the complete player/artifact defect
checklist and fixed text-legibility thresholds in the exact allowlisted `visual-method.v1.json`. Registrations v1 and
v2 remain byte-preserved historical evidence and are rejected by analysis `1.2.0`. Do not edit a frozen registration
or visual-method artifact after seeing results. A changed method needs a new version and a stated reason.

## Safety and truth rules

- Raw/derived media must be outside the repository or under gitignored `release/`. Capture commands reject another
  in-repository destination.
- Existing evidence directories and files are never overwritten.
- Every raw file is byte-counted and SHA-256 hashed. A validator can re-read every declared file.
- Every admitted video is re-probed from its exact hash-bound bytes. Visual duration comes only from the selected
  decoded video stream's frame count and duration/timestamp time base; container or audio duration can never extend
  an annotation window. Material stream/container disagreement is rejected.
- A captured non-public manifest binds exactly one video. Raw directional evidence must select that untransformed
  `raw:true` video; a transformation child belongs in a separate derived manifest and stays non-directional.
- A synchronized-audio claim requires at least one actually decoded embedded audio stream. Declaring audio metadata
  or annotating an `impact_audio` label cannot manufacture audio evidence.
- Every declared sidecar must be a unique hash-bound entry in `files`; a path-only or missing sidecar is rejected.
- Every crop, scale, frame-rate conversion, codec transcode or other media transform records parent and child hashes.
- `capture-webgl.mjs` emits `NOT_AVAILABLE` unless the current repository identity, Unity-source digest, structurally
  valid Unity loader/data/framework/WASM payloads, exhaustive export tree, independently signed exporter receipt and
  separately inventoried React host all agree. The complete hosted `unity/` subtree must equal the verified export,
  and the live runtime must consume those exact response bytes while proving `unity-webgl`. At armed input, the exact
  admission marker, runtime-handshaken visible Unity canvas, centre hit-test and exclusive input ownership are required;
  renderer and admission must then remain invariant through the dead-ball result. Downloaded Unity files or a late DOM
  label cannot qualify a hidden/unused runtime. The pinned trust policy currently contains no approved signing key, so
  retained/self-authored exports honestly remain unavailable. Three.js and Classic are never relabelled.
- `capture-android.mjs` never builds, installs, launches, uninstalls or clears the app. Caller JSON is supporting
  evidence only: the tool derives the embedded build from pulled APK bytes, compares remote APK hashes before/after,
  observes the live WebView build/renderer before/after, verifies the foreground package around recording and
  re-derives repository identity at completion. Android OS identity includes release, API, exact build fingerprint,
  security patch and build ID, sampled before and after recording.
- ADB screen recording has no game audio and can perturb performance. It cannot prove input-to-photon latency,
  contact-to-audio timing or engine FPS.
- Browser machine input is `DIAGNOSTIC`, even at normal speed through the shipped input path. It is never human-skill
  evidence.
- Missing or incomparable evidence stays `NOT_AVAILABLE` or `NOT_COMPARABLE`; it is never zero and never a VANDE
  win.
- An annotation file with no camera-cut or contradiction marker does not establish a zero count. A reviewed explicit
  count or timecoded events are required.
- Competitor media stays in the operator's authorized evidence workspace. Commit only source metadata and
  non-reconstructive measurements; never commit frames, audio or video from another title.
- Builders may collect evidence, but only a fresh independent evaluator applies locked scores or gate decisions.

## Files

```text
docs/evaluation/capture-compare/
  README.md
  sources.json
  registration.v1.json
  registration.v2.json
  registration.v3.json
  visual-method.v1.json
  unity-export-trust.v1.json
  manifest.schema.json
  metrics.schema.json
  metrics-receipt.schema.json

scripts/eval/compare/
  lib.mjs
  capture-web.mjs
  capture-webgl.mjs
  capture-android.mjs
  unity-provenance.mjs
  normalize.mjs
  annotate.mjs
  metrics.mjs
  compare.mjs

tests/unit/evaluation/
  capture-compare.test.ts
  capture-compare-adversarial.test.ts
  capture-compare-normalize.test.ts
```

The JSON Schemas are the interchange contract. `lib.mjs` supplies the dependency-free runtime validator, conditional
anti-fake checks, hash verification, deterministic JSON and fail-closed file handling. Runtime validation is stricter
than plain JSON Schema where one field depends on another—for example, a captured VANDE runtime build must exactly
match the derived repository source identity.

## Capture manifest

Every `manifest.json` records:

- lane, evidence class, status, evaluator role and builder independence;
- rights basis and redistribution restriction;
- derived repository source ID, embedded build ID, installed/export artifact record and renderer/admission proof;
- exact app/package/version/store where applicable;
- UTC, host uptime and duration;
- device, OS, SoC/GPU, RAM, viewport, orientation, refresh, thermal/power/network/load fields, using `null` rather
  than a guess;
- scenario, seed, controls/input, assistance, hand, pitch, field, time scale and sequence completeness;
- capture method, structured recorder class/bit rate, resolution, frame rate, codec, audio method, perturbations and
  limitations;
- byte size and SHA-256 for every file;
- event, physics, replay, frame and annotation sidecar paths;
- a complete transform chain;
- per-metric applicability and excluded claims;
- expected scenario, observed deviations and every error.

An unavailable Unity WebGL manifest is still a useful result: it records the current source identity and exact reason,
contains no fake runtime file and has `status: not_available`.

## Capture commands

All examples write to `/tmp`. A path under `release/` is also permitted.

### Production web (Three.js or Classic)

Start the matching immutable production preview separately, then run:

```sh
node scripts/eval/compare/capture-web.mjs \
  --base http://127.0.0.1:4173 \
  --artifact-root dist \
  --renderer three-webgl \
  --expected-build-id "$(scripts/build-id.sh)" \
  --output-dir /tmp/vande-web-capture \
  --evaluator capture-operator-1
```

The artifact root is mandatory. The runner hashes its complete regular-file inventory and preflight-verifies every
served file byte-for-byte, including dynamic Vite chunks and Unity loader/data/framework/WASM files. During capture it
blocks service workers, rejects redirects, query-bearing request aliases, partial responses, popups/auxiliary pages,
dedicated workers, downloads, out-of-base/cross-origin requests and WebSockets, and
hash-verifies the response body actually consumed for every runtime request. Unity captures additionally require all
four manifest-declared Unity payloads to be observed. The sorted preflight and runtime results are hash-bound in the
artifact inventory. A page that merely copies expected DOM build/renderer attributes is rejected. The driver uses no
Practice test hook, queued swing or altered time scale. It chooses Random Over, enters through the
production controls, waits for the shipped input surface and sends a real keyboard attack. Because the action is
machine-generated, the result is diagnostic. Playwright video has no game audio. The tool records DOM phase changes,
runtime build ID and the renderer marker in `events.json`.

### Unity WebGL

```sh
node scripts/eval/compare/capture-webgl.mjs \
  --base http://127.0.0.1:4174 \
  --host-artifact-root dist-unity-preview \
  --export-root unity/VandePractice/Builds/WebGL \
  --output-dir /tmp/vande-webgl-capture \
  --evaluator capture-operator-1
```

The React host publication and Unity export are intentionally different roots. `--host-artifact-root` must name the
immutable React production artifact served at `--base`; it must contain an exact byte-for-byte publication of the
verified export under `unity/`. The runner verifies the independently trusted export first, compares the complete
hosted `unity/` subtree against that verified hash snapshot, preflight-fetches every host file, and hash-verifies every
runtime response. It additionally records armed and result presentation snapshots: Unity must visibly own the
full-screen input canvas with no armed React gesture layer, and its renderer/admission identity cannot change after the
input is sent. Armed ownership validation and exact-canvas latching occur atomically in one browser task, and only that
snapshot authorizes input. The exact armed canvas object is then latched through the result; disconnection,
replacement, relevant child-list mutation or transient `data-renderer` drift fails closed. This proves bounded runtime/DOM ownership only,
not human control feel, visual quality, performance or release readiness. A substituted, missing or extra hosted Unity
file, hidden/unused runtime, or late renderer label fails closed before it can support evidence.
The capture's `ArrowUp` action must also produce an authoritative dead-ball `attack` result; a timeout leave, defence or
missing result-intent marker fails closed and cannot be represented as a keyboard attack.

If either root is stale, altered, absent or source-mismatched, if the export lacks the pinned independently signed
exporter receipt, if the host/export binding differs, or if no live URL is supplied, the command returns exit code `3`
and a manifest with `status: NOT_AVAILABLE`. That is the correct result; do not substitute a retained web canvas.
Provisioning a future trust key requires an independently reviewed policy change and a new pinned trust artifact; a
builder-generated key is not qualifying provenance.

### Already-installed Android app

First obtain a current identity JSON from the existing Android Practice harness for the same source, installed app,
serial and renderer. Keep the app open at the intended starting state. Then run:

```sh
node scripts/eval/compare/capture-android.mjs \
  --serial DEVICE_SERIAL \
  --renderer unity-native \
  --identity-evidence release/practice-android/BUILD/RUN.json \
  --duration-seconds 30 \
  --bit-rate 12000000 \
  --human-input-confirmed \
  --output-dir /tmp/vande-android-capture \
  --evaluator capture-operator-1
```

Omit `--human-input-confirmed` unless a human actually operates the physical device during the whole capture. That
flag records the input method; it does not create a human-player result. The command:

1. proves the requested serial is connected;
2. pulls every installed APK split and derives the embedded build ID from the installed web bundle;
3. binds the pulled hashes to remote `sha256sum` observations before and after recording;
4. observes the current WebView build, renderer, admission and test-hook absence before and after recording;
5. requires VANDE to be both resumed and focused before and after recording;
6. treats the caller-supplied harness JSON only as corroboration, never the observed identity source;
7. rechecks repository source identity after recording;
8. samples exact Android release/API/build fingerprint/security patch/build ID before and after and rejects a change;
9. records the current screen for at most 180 seconds, pulls/hashes the MP4, and removes only its explicit temporary
   `/sdcard/<capture-id>.mp4`.

It does not install, launch, stop, uninstall or clear VANDE. Android recording has no synchronized audio. Run a
matched recorder-off control and an independently synchronized/high-speed method for performance, input or audio
claims.

### Controlled competitor on the same Android phone

Only after confirming a lawfully installed title on an owned phone and reviewing the applicable terms:

```sh
node scripts/eval/compare/capture-android.mjs \
  --competitor \
  --serial DEVICE_SERIAL \
  --package-id EXACT.PACKAGE.ID \
  --title "Exact installed title" \
  --store "Google Play" \
  --terms-reviewed \
  --human-input-confirmed \
  --whole-sequence-confirmed \
  --scenario grounded_drive \
  --output-dir /tmp/controlled-comparator \
  --evaluator capture-operator-1
```

The app must already be open; the script does not launch it or inject input. It derives the installed version from
Android's package manager, verifies that the same package is focused before and after recording, records only the
visible screen, marks redistribution prohibited and never pulls a competitor APK. Put scenario deviations in the
annotation/manifest deviation field; `--scenario` accepts only a preregistered class ID. Omit
`--whole-sequence-confirmed` unless the recording really retains the complete required sequence,
including failures, waits, errors and restarts. Keep the raw result outside Git.

## Normalization

Normalization never edits or replaces the raw file:

```sh
node scripts/eval/compare/normalize.mjs \
  --manifest /tmp/vande-web-capture/manifest.json \
  --role raw_video \
  --width 1280 \
  --height 720 \
  --fps 30 \
  --codec libx264 \
  --crf 18 \
  --output-dir /tmp/vande-web-normalized
```

The derived manifest contains the raw parent manifest, parent video hash, child hash and every ffmpeg parameter.
`ffprobe` is mandatory after encoding; observed width, height, FPS, codec and duration replace requested/guessed
metadata, including width-only or height-only scaling. Before the derived manifest is admitted, the shared canonical
media verifier independently re-counts selected video frames and re-binds the selected-stream duration to the exact
output hash. If
the parent has an artifact identity, the normalizer also copies that artifact into the immutable derived bundle,
verifies its hash and rewrites the pointer; derived evidence never relies on a dangling parent-relative path. It does
not silently crop, speed-change, interpolate or replace audio. Those operations are intentionally not implied by
normalization; add a new registered transform before supporting them.

## Annotation format

Create a hash-bound empty template:

```sh
node scripts/eval/compare/annotate.mjs \
  --manifest /tmp/vande-web-capture/manifest.json \
  --template \
  --evaluator annotator-a \
  --annotator-role primary \
  --independent \
  --output-dir /tmp/vande-annotation-template
```

Fill the copied template without changing its `captureId`, media hash or manifest hash. Each event has:

```json
{
  "id": "ball-release",
  "label": "ball_release",
  "atMs": 3456.7,
  "endMs": null,
  "frame": 104,
  "confidence": 0.9,
  "ambiguous": false,
  "region": { "x": 0.49, "y": 0.31, "width": 0.01, "height": 0.02 },
  "value": null,
  "note": null
}
```

Times are milliseconds from the start of the raw/selected video. Regions use normalized `[0,1]` viewport
coordinates. The validator rejects negative/out-of-duration times, out-of-frame rectangles, duplicate IDs and source
hash mismatches.

Registered labels used by `metrics.mjs` are:

- timing: `launch`, `setup_start`, `first_playable`, `dead_start`, `dead_end`, `result_visible`, `next_playable`;
- input/actions: `tap_before_first_playable`;
- ball regions: `ball_release`, `ball_bounce`, `ball_contact`;
- tracking samples: `ball_track_sample_visible`, `ball_track_sample_hidden`;
- layout regions: `decision_corridor`, `decision_corridor_occlusion`, `hud_region`;
- presentation: `camera_cut`, `persistent_control`;
- causality: `contact`, `impact_audio`, `physical_result`, `score_response`, `crowd_response`;
- reviewed contradiction: `outcome_replay_contradiction`.

To establish a reviewed zero instead of an unknown absence, add one of
`tap_before_first_playable_reviewed_count`, `camera_cut_reviewed_count`,
`persistent_control_reviewed_count` or `outcome_replay_contradiction_reviewed_count` with numeric `value: 0`.
If individual events also exist, their count must equal the explicit marker or the measure remains unavailable.

For ambiguous frames, create a second file with role `secondary`. Preserve both. A distinct independent adjudicator
creates a third completed file with role `adjudicator`, lists exactly the supplied primary and secondary hashes under
`adjudication.reviewedFiles`, and records at least one decision rather than overwriting either annotator. Empty
adjudicator templates, unknown hashes, duplicate reviewers or multiple files without valid adjudication are rejected
or remain incomplete and cannot yield measured values.

Validate and canonicalize a completed file:

```sh
node scripts/eval/compare/annotate.mjs \
  --manifest /tmp/vande-web-capture/manifest.json \
  --annotations completed-annotations.json \
  --evaluator annotator-a \
  --annotator-role primary \
  --independent \
  --output-dir /tmp/vande-annotations
```

This writes sidecar JSON only. It does not burn overlays into competitor frames or produce redistributable media.

## Metrics

```sh
node scripts/eval/compare/metrics.mjs \
  --manifest /tmp/vande-web-capture/manifest.json \
  --annotations /tmp/vande-annotations/annotations.json \
  --evaluator evaluator-b \
  --independent \
  --decode-frames \
  --output-dir /tmp/vande-metrics
```

`--decode-frames` uses ffmpeg frame hashes to report consecutive duplicate decoded frames. It is explicitly a
recording property, not engine FPS. Without the flag, that value is `NOT_AVAILABLE`.

The output reports raw values, units, sample size, timecodes, applicable frame uncertainty, limitations and CERI
evidence mapping. CERI mapping is availability only; every dimension remains unscored until its full evidence
contract exists. In particular:

- passive/machine video cannot score intent fidelity, mastery, embodiment, emotion or desire;
- unsynchronized/no-audio capture cannot measure contact-to-impact-audio offset;
- missing reviewed cuts, controls or contradictions are not assumed to be zero;
- diagnostic captures produce `diagnostic_only`, not measured human results.

The accompanying schema-v3 `metrics-receipt.json` is mandatory at comparison time. It binds the metrics bytes to the
manifest, fresh media probes and probe-tool identity, every annotation, selected valid annotation workflow, frozen
registration, exact visual-method artifact and exact metrics-tool hash. Comparison freshly re-probes the exact media,
requires byte-identical probe evidence in the receipt, and re-derives the measurements and CERI mapping; an orphaned
or hand-authored metrics JSON is rejected. Applicability is explicit: a missing metric key is `NOT_AVAILABLE`, never
implicitly eligible.

The following §9.5 measures have frozen definitions, units, applicability, direction and uncertainty bindings in
registration v3, but remain explicitly `NOT_AVAILABLE` until their registered calculation/review implementation and
qualifying evidence exist: local luminance contrast; camera shake/roll/horizon movement; bowler/bat jerk; foot slide;
bat-arc discontinuity; clipping; artifact/material defects; camera/result response timing; touch-target burden; and
text legibility. Artifact/material and text-legibility values additionally require the complete independent
primary/secondary/adjudicator workflow and the frozen checklist/threshold method. Their absence cannot become a
favourable result.

## Comparison

Supply matching manifest/metrics pairs in the intended reference order:

```sh
node scripts/eval/compare/compare.mjs \
  --manifest /tmp/vande/manifest.json \
  --metrics /tmp/vande-metrics/metrics.json \
  --receipt /tmp/vande-metrics/metrics-receipt.json \
  --manifest /tmp/comparator/manifest.json \
  --metrics /tmp/comparator-metrics/metrics.json \
  --receipt /tmp/comparator-metrics/metrics-receipt.json \
  --evaluator evaluator-c \
  --independent \
  --output-dir /tmp/vande-comparison
```

The result contains:

- exact app/build/renderer/environment and input hashes;
- scenario/mismatch table;
- raw metric table with status, units, samples and uncertainty;
- directionality from the byte- and semantic-hash-allowlisted frozen registration only, not an invented quality score;
- `NOT_COMPARABLE` for mismatched/unregistered scenarios, platform, device/OS/display, recorder method/class/bit rate,
  perturbation settings, uncertainty, incomplete sequences, diagnostic evidence, units or missing values;
- CERI evidence availability with every score `NOT SCORED`;
- explicit absence of New Player X and Expert Player X evidence;
- integrity findings and the smallest missing-evidence action;
- deterministic JSON, Markdown and an evidence index.

The report status is `INCOMPLETE_EVIDENCE_COMPARISON`. An independent evaluator must inspect the clips/timecodes and
apply the locked rubrics separately. A passive clip never establishes control feel, fairness, mastery, desire or
superiority.

## Focused tests

```sh
npx vitest run \
  tests/unit/evaluation/capture-compare.test.ts \
  tests/unit/evaluation/capture-compare-adversarial.test.ts \
  tests/unit/evaluation/capture-compare-normalize.test.ts
```

Coverage includes:

- build/renderer identity mismatch rejection;
- Unity fallback relabelling rejection;
- public-reference media redistribution rejection;
- annotation time and region bounds;
- overlap-safe area calculations;
- missing-data behavior (never implicit zero);
- Android identity rejection;
- transform parent/child provenance;
- scenario mismatch behavior;
- deterministic report rendering;
- forged Android identity, foreground/source/APK binding rejection;
- missing sidecar, fake adjudication and undeclared-applicability rejection;
- registration direction-flip and incompatible comparison rejection;
- historical registration preservation and active 31-metric registration allowlisting;
- OS, recorder method/class/bit-rate and perturbation mismatch rejection;
- all-file preflight plus canonical runtime-path, dynamic-chunk response-body and direct Unity export binding;
- query, popup, auxiliary-page, worker and unbound cross-context request rejection;
- structural Unity payload checks plus pinned independent exporter-signature provenance;
- exact Android fingerprint/security-patch/build-ID matching and clean/dirty embedded build-ID extraction;
- selected-video duration admission, including a real 1-second-video/10-second-audio exploit at annotation, metrics,
  receipt and comparison layers;
- frozen visual checklist/text thresholds and truthful NOT_AVAILABLE placeholders for all 31 registered measures;
- missing/tampered metrics-receipt and annotation-chain rejection;
- observed one-axis normalization metadata and arithmetic-mean ball diameter;
- parseable checked-in schemas.

The preserved failed v2 independent report and reproductions remain unchanged. A read-only v3 replay validates their
presence, frozen artifact hashes, repository typecheck and the complete focused suite:

```sh
node docs/evaluation/capture-compare/reviews/retest-v3/replay-v3.mjs
```

## Root-owned package scripts requested

`package.json` is root-owned, so this workstream does not edit it. The root may add exactly these convenience scripts:

```json
{
  "eval:capture:web": "node scripts/eval/compare/capture-web.mjs",
  "eval:capture:webgl": "node scripts/eval/compare/capture-webgl.mjs",
  "eval:capture:android": "node scripts/eval/compare/capture-android.mjs",
  "eval:capture:normalize": "node scripts/eval/compare/normalize.mjs",
  "eval:capture:annotate": "node scripts/eval/compare/annotate.mjs",
  "eval:capture:metrics": "node scripts/eval/compare/metrics.mjs",
  "eval:capture:compare": "node scripts/eval/compare/compare.mjs",
  "eval:capture:replay-v3": "node docs/evaluation/capture-compare/reviews/retest-v3/replay-v3.mjs",
  "test:capture-compare": "vitest run tests/unit/evaluation/capture-compare.test.ts tests/unit/evaluation/capture-compare-adversarial.test.ts tests/unit/evaluation/capture-compare-normalize.test.ts"
}
```

Adding scripts does not make a capture current. Every evidence cycle must derive a fresh source ID, capture the exact
runtime and preserve all failures.
