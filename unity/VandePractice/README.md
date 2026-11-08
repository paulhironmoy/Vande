# VANDE Practice Unity foundation

This directory is the opt-in Unity-as-a-Library (UaaL) presentation for Stage 1
Practice. Unity 6000.3.27f1 and its Android support are installed locally, and
WebGL/Android engineering exports have been produced. Generated exports are
ignored build inputs and become stale whenever authored source changes. Unity
does not replace the working Three.js/Classic renderers until its exact rebuilt
candidate passes the release gates below.

The TypeScript application remains authoritative for delivery physics, contact,
scoring, dismissal, session state and coaching. Unity validates and plays a
canonical visual trace; it must not invent or revise a result. The intended host
is a full-screen Unity player view mounted in the existing Capacitor
`BridgeActivity`, so the covered WebView can remain alive for the per-ball
TypeScript round trip. That lifecycle and latency assumption is a mandatory
device spike, not a verified fact. See
`../../docs/decisions/UNITY-PRACTICE-INTEGRATION.md`.

## Current contents

- The exact TypeScript contract-v6/simulation-v3 `{sha256, body}` packet/envelope, canonical JSON check,
  1 MiB inline-body ceiling, direction validation and SHA-256 integrity.
- Per-sender sequence protection, the five host-required monotonic-clock samples
  plus an explicit host-selected sample, and a fail-closed Practice lifecycle.
- Runtime-created `VandeBridge` GameObject with the Android callback names used
  by the optional host, ACK/ready/error/release/gesture/dead/unloaded emitters,
  and unload-only behavior.
- A production presentation layer behind readiness: a textured pitch/outfield,
  stadium and deterministic crowd, law-scale stumps/bails, seam/shine ball,
  willow bat, role-specific bowler run-up/follow-through, articulated batter,
  keeper and fielders, persistent setup rail/field PIP and a batter-eye camera
  held at 64 degrees horizontal FOV as aspect changes. Characters remain
  procedural and do not yet meet the photoreal close-up bar.
- Release-armed raw touch capture in the lower 46% batting region. A finger
  already resting at release may become the one shot only after intentional
  post-release movement; lifting it without movement is not a shot. An unmoved
  hold can wait indefinitely, top HUD/PIP touches stay out of batting, and
  input-to-visible bat response is measured only after the camera completes a
  rendered frame.
- A host-authoritative pause request from the Unity HUD. TypeScript applies the
  live-ball interruption/leave consequence; Unity does not pause or score it.
- An app-private file-store abstraction reserved for a future profiling-backed
  large-payload optimization; it is not part of the launch protocol.
- Projection of authoritative `host.result` ball/bat/fielder/event arrays into a
  canonical deterministic trace-v2 presentation, including the bounded planar
  batter root, planted `batterPosture.crouchM` and exact
  `batterMotion {startT, contactT, endT}` anchors selected by TypeScript, plus nested record/result/score
  validation, replay-digest verification, a shared-fixture trace-digest parity
  gate and playback with no scoring API. Unity applies the root and articulated posture statically for the
  full canonical trace, keeps both feet planted, and never infers body timing from a bat/contact event. Result
  seed, plan, full flight, scene
  values, indices and any provisional swing are causally bound to the accepted
  delivery.
- A renderer-local benchmark exchange capped at 10 seconds, 300 warm-up frames
  and 1,200 raw positive completed-render intervals while a representative
  procedural Practice workload is active. A hidden/non-rendering player cannot
  complete it. Context-loss counters and isolated shader warm-up remain
  null/false because this source does not track them truthfully; the host must
  treat that unknown context evidence as non-selecting.
- Delivery-window completed-render statistics reset at each delivery and report
  exact sample count plus intervals over 50 ms immediately before dead ball.
- Runtime-generated, rights-safe cues distinguish pitch/bat/edge/pad/wicket/field
  events; event-causal haptics and captions are wired through the production
  feedback policy. The synthesized clips are engineering fallbacks, not authentic
  recorded cricket audio.
- Contract-v2 per-delivery Learn/Coach guidance. Ordinary Learn and exact-ball
  Coach retries stay in Unity with stage-bounded landing/path/contact cues;
  demonstration and close-up deliberately use the retained renderer.
- Edit-mode NUnit source tests for protocol, lifecycle, transport, causal
  binding, benchmark bounds, touch arming/region/rest behavior, horizontal FOV,
  follow-through, proxy audio routing, delayed-result reconciliation and replay
  behavior. A cross-runtime test consumes the single TypeScript-generated
  seven-case full-wire fixture at `tests/fixtures/unity-practice/practice-v3.json`
  without copying it into Unity. Fixture v3 and its locked payload SHA are pending
  regeneration after the simulation-v3 physics/schema work stabilizes. The same artifact must include
  frozen corpus-selected `reachProxies` for both-mirror planted-foot/ordered-hand evidence; Unity's
  shared-golden test is explicitly ignored until that exact artifact exists.
- A batch-safe Android `unityLibrary` exporter that refuses to overwrite an
  existing export, emits a cryptographic provenance receipt only after success,
  and never commits a launcher.

Generated Gradle and WebGL exports exist locally but are rebuildable, ignored
artifacts; they are not release evidence and currently predate the latest source.
The presentation uses original project code plus three registered, generated
albedo candidates. It has no accepted final human-character or authentic-audio
pack. Asset provenance is in `docs/ASSET_REGISTER.md`; Unity source ownership
under `Assets/VandePractice/**` is recorded in `docs/ARCHITECTURE.md`.

## Tooling prerequisite

Unity Hub, Unity 6000.3.27f1 and Android Build Support are installed and active
on this machine. `ProjectSettings/ProjectVersion.txt` pins revision
`672d562a42a7`; use that exact editor for tests and exports.

The existing Android host build uses Android Studio's OpenJDK 21.0.10. Treat
Unity's bundled OpenJDK and generated Gradle/AGP requirements as export inputs
to inspect, not as permission to replace that working host toolchain globally.

Do not silently upgrade the editor patch or generated Gradle/AGP inputs. A patch
change requires a fresh compile, full EditMode run, exports and provenance receipt.

## Run edit-mode tests

In the Editor, open **Window > General > Test Runner**, choose **EditMode**, and
run all tests in `Vande.Practice.EditMode.Tests`.

After setting `UNITY_VERSION` to the installed and approved patch, the equivalent
macOS command is:

```sh
"/Applications/Unity/Hub/Editor/${UNITY_VERSION}/Unity.app/Contents/MacOS/Unity" \
  -batchmode \
  -projectPath "/Users/hironmoy/Vande/Vande/unity/VandePractice" \
  -runTests -testPlatform EditMode \
  -testResults "/private/tmp/vande-unity-editmode-results.xml" \
  -logFile "/private/tmp/vande-unity-editmode.log"
```

Do not add `-nographics` to this full EditMode command. The suite contains a retained pixel assertion that calls
`Camera.Render`; Unity 6000.3.27f1's NullGfx path reproducibly exited 139 before writing XML. On the unchanged
`4a376ae+a30c5baf0122` runtime tree, the graphics-enabled Metal run completed 767/767 tests and the exact pixel
test passed. This is a command correction, not permission to skip the assertion. Preserve failed NullGfx logs as
historical evidence.

Do not add `-quit` to Unity 6000.3.27f1's `-runTests` command: it can exit after import before the test runner starts.
The test runner exits the process itself.

## Export the Android library

An export is a local input to the bridge/lifecycle spike. It does not approve
Unity as the default renderer or authorize a release.

1. Ensure `unity/VandePractice/Builds/Android` is absent or empty; the exporter
   deliberately refuses to overwrite it.
2. In the Editor, select **VANDE > Export Android unityLibrary**, or run:

   ```sh
   "/Applications/Unity/Hub/Editor/${UNITY_VERSION}/Unity.app/Contents/MacOS/Unity" \
     -batchmode -nographics \
     -projectPath "/Users/hironmoy/Vande/Vande/unity/VandePractice" \
     -executeMethod Vande.Practice.Editor.VandeAndroidLibraryExporter.Export \
     -logFile "/private/tmp/vande-unity-export.log" \
     -quit
   ```

3. The ignored export appears at `Builds/Android`. The host consumes its
   `unityLibrary` module with `-PvandeUnity=1`; sibling generated Gradle inputs
   are sealed and copied only so that module can be built. Never commit or ship
   the generated `launcher` application.
4. A successful exporter writes ignored
   `Builds/Android/.vande-export.properties`. The receipt binds the export to the
   exact Editor patch, Android/IL2CPP/ARM64/minSdk settings, current authored
   Unity source/settings, and schema-3 deterministic path, executable-bit and
   SHA-256 manifests for all regular files under `Assets`, `Packages`,
   `ProjectSettings` and the complete generated Android tree. Only the root
   receipt excludes itself. The exporter and Gradle gate reject symbolic links,
   special files and every missing, unexpected, content-modified or mode-modified
   entry. Never create or edit this receipt by hand. Any source or export change
   requires a new export to a deliberately emptied output directory. Host builds
   verify the sealed tree, copy the complete export into
   `android/build/vande-unity-import`, compile only that disposable copy, and
   revalidate the canonical export and receipt when Gradle finishes.
5. Keep both independent build-time gates off by default. The web bundle needs
   `VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE=1`; Gradle separately needs
   `-PvandeUnity=1`; and native availability must still pass before selection.
   There is no server/local runtime kill switch. Three.js/Classic must remain the
   default fallback until all ADR gates pass.
6. Reconcile the Unity export's Gradle, Android Gradle Plugin, Java, manifest,
   native ABI and packaging requirements with VANDE's host versions. Never alter
   the host toolchain merely to make an unverified export compile.

## Android build gate and operator commands

The Unity module is absent from ordinary Android builds even when an ignored
export happens to exist. `android/settings.gradle` includes `:unityLibrary` only
when `-PvandeUnity=1` is explicit and every receipt/version/digest check passes.
The property accepts only `0` or `1`.

Check the safe default without building an APK:

```sh
cd /Users/hironmoy/Vande/Vande/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew --offline --no-daemon --console=plain --max-workers=2 \
  -PvandeUnity=0 projects
```

The output must not list `:unityLibrary`. After a successful export, exercise
the fail-closed gate explicitly:

```sh
cd /Users/hironmoy/Vande/Vande/android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
  ./gradlew --offline --no-daemon --console=plain --max-workers=2 \
  -PvandeUnity=1 projects
```

That command is only a configuration check. It is not a Unity compile or a
device result. A missing, malformed, stale, hand-modified, wrong-version or
wrong-settings export fails before Gradle includes the module and tells the
operator to re-export.

The no-Editor regression builds a synthetic export in a temporary directory
and proves that the gate accepts its complete manifest while rejecting missing,
unexpected, modified and symbolic-link inputs:

```sh
cd /Users/hironmoy/Vande/Vande
node scripts/test-unity-export-gate.mjs
```

This verifies the Gradle receipt consumer only; it does not execute the Unity
exporter, compile Unity C#, or replace the Editor export gate.

Once that check passes and a specific device is selected, the supported debug
spike command is:

```sh
cd /Users/hironmoy/Vande/Vande
UNITY=1 ANDROID_SERIAL=emulator-5554 scripts/android-practice.sh \
  release/unity-practice-android
```

Replace `emulator-5554` with the serial from `adb devices` for the selected
test device.

`UNITY=1` is intentionally required. The script sets the web build keys
`VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE=1` and the independent Gradle
link key `-PvandeUnity=1`, builds with at most two Gradle workers, and records
that Unity was requested in the evidence JSON. It refuses
`UNITY=1 SKIP_BUILD=1`, because an existing APK cannot prove how it was built.
On exit it restores a no-hook, no-Unity web bundle. Omitting `UNITY` forces both
Unity opt-in gates to their disabled values, preserving the normal
Three.js/Classic build even if `.env` or Gradle user properties try to opt in
implicitly.

The production `scripts/build-android.sh` path intentionally does not enable
Unity. Do not make or upload a Unity release until the ADR's physical-device,
lifecycle, parity, performance, provenance and independent review gates pass.

It must also pass the binding Android distribution contract in
`../../docs/ANDROID_SIZE_AND_REACH.md`: no more than 50,000,000 bytes fresh
installed through the first playable ball and at least 90.0% India-weighted
working phone reach. An APK/AAB byte count is only a fail-fast preflight. A
Unity-inclusive candidate additionally needs Play-generated split inspection,
the exact merged manifest, ABI/native-library closure, 16 KB static and runtime
checks, full installed-footprint measurement and combined WebView-plus-Unity
PSS. Unity-as-a-Library cannot be assumed to arrive later as a Play dynamic
feature; keep its runtime and mandatory first-play assets inside the measured
budget.

The native host refuses Unity before loading its player class when Android marks
the phone low-RAM, reports current memory pressure, reports at most
3,000,000,000 bytes of RAM, or cannot provide a trustworthy memory signal. It
rechecks immediately before construction. Those cohorts must receive the
complete Three.js/Classic path and must never be counted as Unity-capable without
new independent physical evidence.

The current export contract is ARM64-only. The host therefore also refuses Unity
before class loading when the app process is 32-bit, the preferred process/device
ABI is not `arm64-v8a`, or the ABI signal is unavailable. It returns
`unsupported_native_abi` and preserves Three.js/Classic. Do not interpret that
runtime routing as proof of Play split completeness or ARMv7 working reach.

The opt-in Android host owns `UnityPlayer` creation, lifecycle forwarding,
full-screen view attachment/removal and the native-to-JavaScript bridge. Its
default non-Unity Java compile was reported passing by the lead; Unity linking
and runtime behavior have not been tested. On exit it must request Unity unload
and wait for the unload callback; it must never call Unity quit because quitting
terminates the host process.

The native handshake is fixed: C# reads `pendingOperationIdFromUnity()`, calls
`runtimeLoadedFromUnity(operationId)`, receives the initial packet at
`VandeBridge.ReceivePacket`, then—only after full validation—sends the ACK through
`emitFromUnity(operationId, packet)` and ready through
`readyFromUnity(operationId, packet)`. Java calls
`VandeBridge.PrepareForUnload("")` before native unload.
Destroying the C# bridge object never calls `unloadedFromUnity`: only the
required native `IUnityPlayerLifecycleEvents.onUnityPlayerUnloaded` callback may
certify that the physical runtime unloaded.

The benchmark request/response payloads are exact and correlation-safe:
`host.benchmark` carries `benchmarkId`, duration, warm-up frames, sample cap and
quality; `unity.benchmark` echoes the id/quality with raw Unity intervals,
warm-up metadata, graphics identity, nullable memory/context values and thermal
state. `shaderWarmupCompleted` is currently false and `shaderWarmupMs` null;
there is no authored shader variant collection to measure independently.

## First vertical slice

The smallest allowed delivery is one hard-coded, precomputed practice ball:

1. TypeScript creates one canonical bridge-v6 `host.initialize` packet. The body is
   inline, at most 1 MiB, and protected by lowercase SHA-256.
2. Android mounts Unity over the still-resumed WebView and sends the packet only
   after the runtime-loaded handshake. C# validates checksum, canonical form,
   version, sim version, direction, session, sequence and payload before ACK and
   `unity.ready`.
3. Host and Unity complete five monotonic clock pings, then host sends
   and Unity ACKs `host.clock_selected`. A scene and delivery are rejected until
   that accepted sample is selected.
4. Unity plays one host-authoritative ball/bat/fielder trace without calculating
   a score. Input arms only at release; release, pointer and gesture timestamps
   use Unity realtime milliseconds plus the accepted `clockSampleId`.
5. TypeScript resolves and sends the authoritative result/replay digest. Unity
   recomputes it over the unchanged canonical record/result bytes, reports
   completion once and echoes it; TypeScript alone applies the result.
6. Back/cancel requests unload, removes the Unity view after confirmation, and
   reveals the unchanged Practice session.
7. Any version, digest, lifecycle or timeout failure returns to Three.js/Classic
   before state is applied twice.

No broader gameplay or later product stage belongs in this slice.

## Still blocked / unverified

- Unity is installed and C# compilation, EditMode suites, WebGL export, Android
  `unityLibrary` export and a linked engineering build have run. The checked-in
  source has changed since the latest exports, so both artifacts must be rebuilt
  before another runtime judgement or release decision.
- No physical-device evidence exists for WebView liveness, touch/bridge latency,
  frame pacing, audio focus, memory after unload, repeated lifecycle entry, APK
  size or context-loss recovery.
- No Unity-inclusive installed-size evidence or India-weighted working-reach
  result exists. SIZE-50, REACH-90 and Unity's 16 KB runtime compatibility are
  **UNPROVEN**.
- People and animation are still original procedural art. Cricket props,
  stadium, crowd and three generated albedo candidates are integrated, but
  characters, materials and synthesized audio do not meet the requested
  photoreal/authentic close-up bar. Haptics/captions are implemented; physical
  accessibility and listening evidence is still missing.
- Canonical result footwork now drives live and replay character presentation.
  The existing gesture remains the batting control; no separate native stance
  selector has been introduced.
- The v5 protocol carries delivery-bound Learn/Coach guidance. Ordinary Learn
  and exact-ball Coach retries stay in Unity; demonstration and close-up remain
  on the retained renderer by design.
