# ADR: Unity rendering integration for Stage 1 Practice

- Status: **Accepted and implemented behind gates; release verification ongoing**
- Date: 2026-10-26
- Scope: Stage 1 Practice only
- Decision owner: VANDE owner/lead

## Context

VANDE's current TypeScript application owns the practice session, deterministic
delivery physics, contact resolution, score, dismissals and coaching. It already
has Three.js and Classic rendering paths. The new direction asks for Unity to
raise visual, animation, audio and tactile fidelity without creating a second
source of gameplay truth.

The Android host is a Capacitor `BridgeActivity`. A conventional separate Unity
Activity would pause that Activity and its WebView. That makes a live
Unity-input-to-TypeScript-result round trip unsafe unless background JavaScript
behavior is first proven. Unity 6000.3.27f1 and the required build modules are now
installed, and the same-Activity integration described below exists behind
independent build/runtime gates. This acceptance covers the architecture and
implemented boundary only; it is not a production-release or physical-device
certification.

## Decision

Mount a full-screen UaaL `UnityPlayer` view inside
the existing `BridgeActivity`. It covers the WebView but does not navigate away
from or pause the host Activity. The Android host must use Unity's supported
activity/service player API for the pinned Editor patch and forward the documented
lifecycle callbacks.

The same-Activity architecture and TypeScript authority boundary are accepted and
implemented behind opt-in gates. Production selection remains conditional: a
physical-device candidate must still prove that Capacitor JavaScript remains
scheduled, bridge messages remain ordered, audio focus behaves correctly,
Back/cancel is deterministic, Activity recreation is recoverable and unload
returns enough memory. Failure of any gate keeps Three.js/Classic active.

A dedicated full-screen Unity Activity is rejected for the TS-authoritative
slice because it normally pauses the WebView. It may be reconsidered only if an
instrumented device test proves the required JavaScript and bridge behavior while
paused, or a separate decision deliberately moves gameplay authority out of
TypeScript. Neither condition exists today.

## Authority boundary

| Concern | Authority | Unity responsibility |
| --- | --- | --- |
| Delivery inputs and seed | TypeScript | Consume validated values |
| Ball flight and contact physics | TypeScript | Play canonical samples |
| Bat input interpretation | TypeScript | Capture a bounded raw local pointer/gesture trace in Unity monotonic time, relay it and never persist it |
| Runs, wickets, legal ball and score | TypeScript | Never calculate or mutate |
| Session progression and coaching | TypeScript | Present supplied state only |
| Camera, animation, VFX, spatial audio, haptics | Unity | Render within supplied timing/events |
| Persistence, analytics and consent | Host/TypeScript | Emit no independent records |

The source-of-truth contract is mechanically enforced in the implemented boundary
and must remain enforced for release: a Unity result cannot contain runs, wicket
state or a score mutation. The foundation projects the canonical `host.result` ball/bat/fielder/event arrays
into presentation playback, validates the nested record/result/score shapes,
verifies the TypeScript replay digest over unchanged record/result bytes,
causally binds the result's seed, plan, complete flight, scene inputs, indices
and provisional swing to the accepted delivery, and exposes no scorer. The
shared seven-case fixture independently gates C# trace projection against a
TypeScript-produced canonical-trace digest.

## Per-ball flow

1. TypeScript creates an immutable delivery plan and canonical pre-contact flight.
2. The two runtimes exchange five bounded monotonic-clock samples,
   then the host selects one accepted sample and Unity ACKs
   `host.clock_selected`. Host timestamps are `performance.now()` milliseconds;
   Unity timestamps are `Time.realtimeSinceStartupAsDouble * 1000`. Wall time is never used.
3. Unity renders run-up/release/flight and arms touch only at the actual release.
   A touch already resting at release may become the shot only after intentional
   movement; lifting it without movement is ignored. The shot surface is the
   lower 46% of the view, and a stationary hold may wait without becoming a shot.
   Accepted samples use Unity's
   monotonic clock. `unity.release` and `unity.gesture` carry the accepted
   `clockSampleId`; the still-live WebView converts them to its clock.
4. TypeScript alone resolves intent, contact, score and outcome, then sends the
   canonical result and replay digest inline.
5. Unity verifies and plays that result, then emits one `unity.dead` echoing the
   host-issued digest. TypeScript de-duplicates it and alone advances the session.

A precomputed complete trace remains suitable for contract, export and presentation
validation. The physical-runtime candidate must measure the live contact round
trip before any claim of interactive parity. A timeout or mismatch aborts cleanly;
Unity must not predict a result to conceal latency.

## Transport contract

The primary v6 transport is the exact TypeScript packet
`{ sha256, body }`. `body` is sorted-key canonical JSON containing exactly one
envelope with `contractVersion`, `simVersion`, `buildId`, `sessionId`, nullable
`deliveryId`, `messageId`, increasing `sequence`, `sender`, `type` and `payload`.
The body is inline, limited to 1 MiB of UTF-8, and its exact bytes must match the
lowercase SHA-256 before parsing or state mutation. Archived bridge-v2
authoritative-result goldens measured approximately 275–369 KiB; bridge-v6 /
Practice-sim-v3 packet size remains pending regeneration of the shared v3
fixture. File indirection is therefore not introduced speculatively.

Each side maintains a bounded recent-message window and strictly increasing
sequence per sender. Sender/type direction, contract version 6, Practice sim
version 3, canonical shape, session/build identity, delivery identity and legal
phase are checked. Unknown versions, noncanonical bodies, missing/extra envelope
fields, malformed payloads, duplicates, out-of-order messages, oversized data,
clock mismatches and digest mismatches fail closed.

Contract v5 retains `host.dead_ball_ui` and `unity.dead_ball_action`. The host may
update bounded localized guidance while the same dead ball remains current.
Unity can emit at most one accepted `practice_ball` or `next_ball` request bound
to that delivery and its replay digest. A rejected, stale, paused, replaying or
duplicate request cannot consume the visible controls; an accepted request still
does not mutate an innings. TypeScript alone opens Coach Mode or advances play.

An app-private verified file-store interface remains source-only as a future
large-payload option. It must not be enabled unless physical-device profiling
proves inline transport inadequate. If adopted later, the host must use a safe
basename under `Context.filesDir`, reject links/traversal, write by atomic rename,
bound bytes and verify SHA-256; that requires a new compatible contract decision.

### Decode threading (UNITY-6, 2026-11-07)

Decoding a 280–456 KB result packet cost the Unity main thread 80–124 ms in one frame (Editor, Mono), so a typical result arrived after contact. The rule now: only the pure-managed decode of a packet of at least 160,000 characters runs on one worker thread and returns an immutable envelope or an exception; all guards, acknowledgements and callbacks run on the main thread in arrival order through one FIFO; every `Report*` call flushes it; teardown drops pending packets and a late decode is ignored; a worker that cannot start, WebGL, or `BridgeConstants.BackgroundDecodeEnabled = false` leaves the session synchronous, with the same decisions. The old bridge's decisions are recorded and pinned by `Tests/EditMode/BridgeEquivalence/`. The wire contract is unchanged (v6). A stroke-first split of the result (a v7 `host.stroke` before a slimmer `host.result`, optionally without the flight bytes that equal the delivery's) is documented in `release/product-sequence/stage-1-practice/wedge/humans/unity6/design-stroke-first.txt` and is **not** adopted: it needs the first measurement on a real phone.

### Trust by identity on the JS side (HOP-1, 2026-11-07)

`makeUnityPracticeResolution` canonicalises and hashes a result's {record, result} once and remembers the product in a module-level `WeakMap`, together with a 32-bit fingerprint of every number taken in the same turn; the coordinator's identity check, the packet builder, the protocol guard and the stage's equality check use the product only while the fingerprint still matches the live objects, and otherwise recompute exactly as before. `packUnityPracticeMessage` returns a frozen `{body, sha256}` and records its sender and type in a `WeakMap`; the platform `send()` forwards a packet found there without unpacking it again, and unpacks every other object (a copy, an altered packet, a packet received from elsewhere, a hand-built one). Nothing arriving from Unity or the network is ever in either map. The wire format, the packet bytes, the schemas and the contract version (v6) are unchanged; the shared wire goldens re-pack byte-identically. Not done: the WebGL bridge's own re-validation of outgoing packets (`src/platform/unityPracticeWeb.ts`, about 6.5 ms per result) because the Android product does not use that path; the Android Java validator is unchanged until a device number exists.

## Lifecycle

The state machine mirrors the TypeScript guard:
`cold -> loading -> ready -> scene-ready -> delivery -> resolved -> scene-ready`,
with `replaying`, `disposing`, `unloaded` and terminal `failed` states. At least
five accepted clock samples and one explicit host-selected sample are required
before scene setup and delivery.
Session/build ids cannot change mid-lifecycle; delivery completion must echo the
host-issued replay digest.

`IUnityPlayerLifecycleEvents.onUnityPlayerUnloaded` in the native host is the sole
authority that the physical Unity runtime unloaded. Destruction of the C# bridge
object never certifies an unload. The C# `unity.unloaded` packet means only that
the validated protocol reached its pre-native-unload boundary.

Exit means **unload**, never quit. The host removes the Unity view only after the
unload callback, restores WebView focus, and re-renders from authoritative
TypeScript state. There is deliberately no quit operation in the C# port. The
physical-runtime candidate must test Back during load/play/unload, Activity recreation, foreground and
background transitions, phone interruption, audio focus and repeated entry.

## Integration and ownership boundary

This ADR and `unity/VandePractice/**` are the files owned by this isolated Unity
foundation. Lead-owned integration now exists behind independent build-time
gates in:

- `android/settings.gradle` and host Gradle dependency/packaging configuration;
- `MainActivity`, the Capacitor plugin and the reflective UaaL lifecycle host;
- the TypeScript packet contract and platform adapter;
- build/release automation and evidence tooling.

The opt-in Gradle integration, same-Activity native host and schema-2 export gate
now exist. For frozen source identity `38924bd+05f72561424b`, the exact
Unity-inclusive preview APK is 43,584,653 bytes (SHA-256
`01b7c84bb555d4859d3751f9607b1ffb68f014c63c3584f44d634ec81184e43c`)
and the AAB is 21,769,253 bytes (SHA-256
`c7a190f37af829de01f84797a037fecf8350f832bb649cfe627ffeb00f236b44`).
They passed artifact-size, static compatibility, signature and native-library
alignment preflights. The exact installed APK also passed strict API-36 ARM64
emulator acceptance with fallback forbidden: `unity-native` was selected, real
touch saved one ball, HOME/resume and a fresh-process reclaim preserved state, an
uninterrupted over completed, and the native/WebView/crash/ANR error gates were
clean. The retained record is
`release/practice-android/38924bd-05f72561424b-unity-preview-release-fresh/android-exact-preview-release.json`.
Admission remained `engineering-preview-unqualified` (`benchmark_unavailable`).
This is not a physical-device runtime test and does not prove installed size,
India-weighted reach or physical lifecycle quality.
The C# handshake is operation-scoped:
`pendingOperationIdFromUnity`, `runtimeLoadedFromUnity`, `ReceivePacket`,
`emitFromUnity`, `readyFromUnity`, `PrepareForUnload` and
`unloadedFromUnity`. `unity.ready` is emitted only after `host.initialize` passes
SHA, canonical JSON, direction/version/sim, sequence, payload and lifecycle checks.

The runtime consumer is bound before readiness. It presents canonical
ball/bat/fielder playback, the owner-directed stable rear-shoulder camera, a
persistent setup rail and field PIP, and a release-armed lower touch region.
Characters, equipment and environment remain procedural engineering assets, and
runtime-generated rights-safe tones remain distinguishable but non-authentic
audio. No production character/equipment/stadium assets, motion-capture or
authentic recorded cricket sounds have been integrated. These are engineering
scaffolds, not accepted final art, animation, audio, haptics or accessibility
delivery.

No physical Android-device study or human-player study has been run for this
integration.

The renderer-local eligibility probe is an explicit bounded exchange:
`host.benchmark {benchmarkId,durationMs,warmupFrames,sampleCap,quality}` followed by
`unity.benchmark` echoing the id/quality and up to 1,200 raw positive Unity frame
intervals observed only after completed camera renders while representative proxy
Practice objects are animated. Duration is at most 10 seconds and warm-up at most 300 frames. Memory
and thermal values are nullable/`unknown` when not available. Context generation
and loss remain `null` because this source does not yet track them truthfully.
No shader variant collection exists in this scaffold, so `shaderWarmupCompleted`
is false and `shaderWarmupMs` is null rather than a fabricated measurement.
Because context-loss evidence remains unknown, the host must treat this probe as
non-selecting until truthful device instrumentation exists. Delivery-local render
windows separately emit sample count and >50 ms spikes immediately before dead ball.

The HUD can emit the session-level `unity.pause_request {reason:"player"}`; the
TypeScript authority applies the interruption/leave rule and decides when pause
begins. Unity never pauses or rewrites a live delivery on its own. There is no
separate native footwork/stance UI: Real mode derives intent from the shot's press
origin, while Learn and Play remain automatic. That contract still requires
physical input evidence before Unity can replace the current Practice surface.

The v2 protocol carries one atomic, delivery-bound Learn/Coach presentation block.
Ordinary Learn and exact-ball Coach retries remain on the Unity surface; progressive
stages expose only the host-authoritative landing, path and contact cues permitted for
that delivery. Demonstration and training close-up deliberately remain on the retained
renderer. Unity remains opt-in until the exported candidate passes independent visual,
lifecycle, size, reach and physical-device review.

The delivered Unity source and future feature areas under
`Assets/VandePractice/**` are reconciled in `docs/ARCHITECTURE.md`.

Generated Unity `launcher` code must not enter the app. Only `unityLibrary` may
be integrated. The web bundle requires both `VITE_BUILD_TARGET=android` and
`VITE_UNITY_PRACTICE=1`; Gradle independently requires `-PvandeUnity=1`; and the
host still requires native availability before selection. There is no server or
local runtime kill switch. Three.js/Classic remains installed and becomes the
immediate fallback before a ball begins or after a safely de-duplicated recovery.

## Toolchain constraint

The audited host uses minSdk 28, compile/target SDK 36, AGP 8.13.0, Gradle 8.14.3
and Android Studio's OpenJDK 21.0.10 for its current build. Unity is pinned to
6000.3.27f1 revision `672d562a42a7`; its generated export requirements are gated
before integration. Later Unity 6.3 patch releases may generate different
Gradle/AGP combinations and require a new inspected export. Do not copy Unity's SDK/NDK
or globally replace the working Android toolchain during integration verification.

## Required evidence gates

No production default may change until independent evidence records build id,
UTC time, physical device, settings, method, expected and observed result for:

1. WebView JavaScript liveness and ordered two-way messaging under the overlay.
2. Touch-to-TypeScript-to-trace latency at median, p95 and worst case, including
   thermal load; no hidden Unity-side scoring fallback.
3. Back, pause/resume, interruption, recreation and unload-only behavior.
4. Memory before load, peak play, after unload and after ten enter/exit cycles.
5. APK/AAB size, install success and ABI/asset packaging on supported devices.
6. 30/60 fps frame pacing, thermal behavior, battery and low-memory recovery.
7. Audio focus and accessibility/reduced-motion behavior.
8. Identical trace digest and exactly-once TypeScript score application across
   Unity, Three.js and Classic replay paths.

Independent evaluators own pass/fail under the repository's locked rubrics.
This ADR makes no experience-score or human-player claim.

## Smallest physical-runtime acceptance target

One precomputed practice ball must travel in validated inline canonical packets, be
rendered by a full-screen Unity view in the same `BridgeActivity`, complete
exactly once with the host-issued digest, and unload back to the unchanged
Practice screen. Five clock samples and explicit selection precede scene/delivery. Corrupt,
noncanonical, duplicate and out-of-order messages plus Back at every state are
required to fail safely. This target has not been demonstrated on a physical
Android device. If the host cannot keep TypeScript alive or unload predictably,
the release candidate is rejected and the existing renderer remains the path.
