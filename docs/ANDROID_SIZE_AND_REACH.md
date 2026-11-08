# Android install size and India device reach

Status: binding engineering target and release-evidence contract for the active Stage 1 Practice build. It does not
claim that either target currently passes, and it does not open Chase or any later product stage.

Authority remains, in order, `docs/VANDE-PRODUCT-SEQUENCE.md`, `docs/VANDE-EXPERIENCE-CONSTITUTION.md`,
`docs/prompts/VANDE-INTERFACE-ASSET-CONSTITUTION.md`, `docs/ARCHITECTURE.md` and the locked rubrics. This document
turns the owner's two Android end goals into measurable constraints:

1. **at most 50 MB installed on a target Android phone**; and
2. **a complete, usable Practice experience on at least 90% of active Android smartphones in India**.

Size and reach are separate gates. Passing one never compensates for failing the other.

## 1. Meanings that cannot move after a result

### 1.1 “50 MB installed”

The size gate uses the definition and method in section 3. It is the **fresh on-device footprint after the player has
reached the first playable ball**, not the repository, source tree, universal debug APK, compressed AAB, web bundle or
APK code directory in isolation. It includes the base/configuration APKs, installed or extracted native libraries,
mandatory assets and the fresh app data and cache created through that point. Post-install downloaded game assets also
count; moving bytes behind a download is not a size pass.

The hard ceiling is **50,000,000 bytes**. This decimal definition is stricter than treating “MB” as MiB and removes
rounding ambiguity. The highest fresh post-first-ball footprint among devices that contribute to the 90% reach
numerator is the release result. Later session growth and user-generated data are reported separately, but fresh
data/cache are part of the gate and never excuse binary or asset growth.

### 1.2 “90% of Android devices in India”

The denominator is all **active, Google Play-certified Android smartphones in India** in the chosen data snapshot,
including Android Go and low-memory phones. Tablets, TVs, Wear OS, ChromeOS and devices without Google Play are
outside the declared phone product scope. An excluded phone still stays in the denominator: raising `minSdk`,
dropping an ABI, adding a required hardware feature or excluding a model does not make the reach percentage rise.

The snapshot must:

- describe India rather than worldwide shipments;
- weight active devices or active users, not count model names equally;
- identify its source, extraction time and trailing window;
- be no more than 30 days old at the release decision; and
- retain the raw export privately and a non-sensitive normalized summary under the release evidence directory.

Before VANDE has a representative Play install base, a country-weighted device dataset may support a **pre-release
projection** only. A Google Play catalogue count, an emulator list, shipments, a global Android-version chart or a
hand-picked phone list cannot prove the 90% result. If no suitable weighted India snapshot is available, the honest
result is **UNPROVEN**, not an estimate.

### 1.3 “Works”

A phone counts only when an accepted rendering path completes the Stage 1 Practice contract on that phone. Premium,
Balanced and Classic are all valid paths. Unity is not required on every phone; a safe, complete Classic fallback is
preferable to a broken 3D session. Classic must keep the same physics, scoring, input meaning and essential ball
readability, as the constitutions require.

Installation or launch alone does not mean “works”. Each counted compatibility cohort must satisfy the binary pass
contract in section 4. Unknown, unavailable, skipped and flaky results count as zero in the numerator.

## 2. Current repository audit

The following is a source-and-existing-evidence audit, not a release certificate.

| Area | Observed repository state | Consequence for the goals |
| --- | --- | --- |
| Android SDK floor | `android/variables.gradle` and `android/app/build.gradle` use minSdk 28, targetSdk 36 and compileSdk 36. The measured Stage 1 debug APK also reports 28/36. | Android 9 is the current constitutional floor. The `min 24` line in `docs/ANDROID_RELEASE.md` is stale and must not be used as evidence. Whether API 28+ reaches 90% in India needs the weighted snapshot. |
| Play filters | The current app manifest declares no camera, sensor, telephony, Vulkan or OpenGL feature requirement. The measured merged debug manifest has only Android's implied `android.hardware.faketouch` feature. | This avoids unnecessarily filtering phones. Re-audit the merged manifest and Play device catalogue after every dependency or Unity export change. |
| Orientation and screens | Menus may rotate; live Practice requests landscape at runtime and holds play behind a rotate overlay when a lock is unavailable. The manifest supports all screen-size buckets and does not force one Activity orientation. | Test tall screens, cut-outs, gesture navigation, multi-window and Android 16 large-screen/foldable behavior physically. A successful phone lock does not prove tablets or foldables. |
| Current non-Unity ABIs | `aapt2 dump badging` on the measured non-Unity debug APK reports `arm64-v8a`, `armeabi-v7a`, `x86` and `x86_64`. | ARM64 and 32-bit ARM are present in that artifact; x86/x86_64 are useful for engineering emulators. This must be rechecked on the production AAB's generated device APKs. |
| 16 KB memory pages | A superseded Unity-inclusive preview passed local APK/AAB ZIP and ELF 16 KB alignment checks for all packaged native libraries. No 16 KB-page runtime result or Play report exists. | Static alignment is not a compatibility pass. Every production split and every Unity/IL2CPP or third-party `.so` must also run on a 16 KB-page Android device. |
| Unity ABI | `VandeAndroidLibraryExporter.cs`, its receipt and `android/settings.gradle` require IL2CPP **ARM64 only**. A superseded linked preview packaged the Unity runtime for ARM64 while retaining non-Unity libraries/fallbacks for other ABI buckets; native fallback selection was not run on those cohorts. | Unity cannot currently be credited for ARMv7 reach. Prove the retained Three.js/Classic fallback is selected and complete there, or deliberately add and size-test ARMv7 Unity support if the weighted data requires it. |
| Unity memory shape | The implemented opt-in Unity-as-a-Library overlay keeps the Capacitor WebView alive while Unity is mounted. No physical low-memory result or complete Unity memory measurement exists. | A low-memory phone must skip Unity **before constructing `UnityPlayer`** and enter complete Classic unless this combined resident-memory shape passes on that cohort. Launching Unity, exhausting memory and then attempting fallback is not a pass. |
| Graphics fallback | The device benchmark selects Premium/Balanced or the complete Classic 2D stage. No WebGL 2, software rendering, repeated context loss, under-45 fps rendering or severe response latency goes to Classic. Quality changes only between balls. | This is the right reach architecture, but it needs physical evidence. A device that safely plays Classic counts; a device that enters Unity/3D and then fails does not. |
| RAM assumptions | `docs/PRACTICE.md` currently states a 3 GB minimum. The manifest cannot enforce that floor; the classifier uses the coarse `navigator.deviceMemory` hint and can reduce quality. Unity memory reporting is still incomplete. | Include sub-3-GB phones in the denominator. They count only after Classic survives the memory/lifecycle gate, or the weighted calculation proves the unsupported share still leaves at least 90%. |
| WebView compatibility | The app is a Capacitor WebView build and Vite emits ES2022. Existing Android evidence used WebView 133 on one API 36 arm64 emulator. No supported minimum WebView version is declared or tested. | API level alone is insufficient. Freeze a minimum supported WebView/Chrome major from real India data and test it, or lower the emitted JavaScript target/polyfill deliberately. Stale-WebView weight remains unproven. |
| Viewports | Browser automation covers the locked landscape viewports and a portrait rotate prompt. | Browser layout evidence is useful, but physical safe areas, density, OEM text scaling and touch geometry still need the device matrix. |
| Android evidence | Independent evidence passes launch, landscape, touch, lifecycle, process replacement and one uninterrupted over on one API 36 arm64 emulator with about 2.53 GB reported RAM. The GPU is translated through the Mac host. | This is engineering evidence only. It contributes **zero** to the physical-phone 90% numerator. |
| India distribution | No country-weighted Play/device export is present. | The current India reach result is **UNPROVEN**. |
| Unity evidence | Unity 6000.3.27f1 passed 217 EditMode tests; a provenance-bound desktop WebGL preview reached run-up; and a superseded linked Android preview passed static artifact gates. No installed native Unity round trip, phone performance, memory or thermal run exists. | These are implementation and static-preflight results only. Unity contributes no physical compatibility, installed-size or India-reach proof. Keep it opt-in and non-selecting until its independent gates pass. |
| Local APKs | The packaged `release/vande-cricket-1.0.0-1-release.apk` is 10,043,950 bytes, dated 2026-10-25, and reports minSdk 24. The independently measured Stage 1 debug APK is 20,004,386 bytes and reports minSdk 28. Current source also says minSdk 28. | These are different stale/non-production measurements and must not be combined. Neither is the current production-AAB post-first-ball proof; the 10.04 MB file cannot establish current minSdk, reach or SIZE-50. |

Stable existing Android evidence referenced above:
`release/product-sequence/stage-1-practice/independent/ANDROID-CANDIDATE6-d837769bd81c.md`, build
`38924bd+d837769bd81c`, 2026-10-26T13:11:46.962Z–13:13:35.335Z, Android 16/API 36
`sdk_gphone64_arm64`, WebView 133.0.6943.137. Expected: integrated launch, landscape, touch, lifecycle and six-ball
continuity pass with no crash/ANR. Observed: pass. Limitation: emulator and translated host GPU, not a phone.

### 2.1 Size deltas reported by the Practice wedge (2026-11-03)

These are builder measurements of source, web-bundle or Unity build-report bytes. None of them is the SIZE-50 measure
(section 3), and none measures reach. Each was measured against its own baseline snapshot (for example, the WORKER
snapshot of 04:19:57Z and CAMERA's shipped snapshot of 03:18Z), so the rows overlap and must not be added together.
Paths are under `release/product-sequence/stage-1-practice/wedge/` unless stated.

| Change | Measured delta (bytes) | What was measured | Affected cohorts | Source |
| --- | --- | --- | --- | --- |
| Work thread: `practice.worker.js` (new; it duplicates the physics, game and coach code) | +169,162 raw / +59,847 gzip -9 | Production web builds of one snapshot, without and with the WORKER files | Every Android WebView build, and the web | `worker/REPORT.md` §4 |
| Work thread and its UI items, total web delta (build final10) | +177,973 raw / +62,609 gzip -9 | The same; adds `PracticeRoute.js`, CSS, `sw.js` and `field.js` | The same | `worker/REPORT.md` addendum 3 |
| Camera: A3, the hand-over, gaze prewarm, straddle budgets and the eased eye | +6,974 raw / +2,624 raw-DEFLATE | Production web builds with the same BUILD_ID: `emotion.js` +6,458, `setup.js` +516 | Every Android cohort carrying the web assets: Three.js and Classic, and the Unity APK's `assets/public` | `camera/REPORT.md` addendum 3 |
| Placeholder contact sounds (54 MP3s) | +95,640 files; +17,319 minified manifest (+3,620 gzip); PWA precache +112,959 as the sum of the parts | Files and the manifest module; no "before" build on the same tree | Every Android cohort (the web assets ship in the base APK), web and PWA | `sound/SOUNDKIT-REPORT.md` §6 |
| Other web code: fielding, world and physics | Fielding +15,911 minified / +5,913 gzip -9; world +16,152 raw / +4,713 raw-DEFLATE; physics +3,531 minified / +1,426 gzip -9 (phases 1–2, physics entry only) | Per module or isolated builds | Every cohort carrying the web assets | `fielding/REPORT.md` §3; `world/REPORT.md` §3; `physics/phase2/REPORT.md` §10 |
| Unity textures: five procedural replacements | Source PNGs −1,608,008 (5,074,220 → 3,466,212). Imported storage: −1,045,837 for the plate (the T2 import change, 1,395,381 → 349,544); the later sky and plate re-renders left it unchanged | Source bytes, and Unity import facts on scratch copies | The Unity-admitted cohorts (ARM64, more than 3 GB) and the Unity WebGL preview | `textures/REPORT.md` and its addenda |
| Unity: applause takes, placeholder takes and the HUD theme | +41,392 applause; +65,800 for the 54 placeholders; +675,698 for the default HUD theme (the lean theme would save 675,594, but it is deferred) | StandaloneOSX BuildReport, packed | The Unity-admitted cohorts | `unity/REPORT.md` §5; `sound/SOUNDKIT-REPORT.md` §6; `unity/phase2/REPORT.md` §3 |
| Cover-drive batter candidates, **not in Unity** | Replacing the current six-file set (2,246,742): variant A −297,264, variant C −297,984. Batter-only bundle: A −286,856, C −287,576 | Raw source bytes of the candidate bundles, in scratch | None yet | `release/cover-drive/p2/REPORT-r3.md` §5 |
| Unity Android preview: IL2CPP OptimizeSize, Managed Stripping High and `link.xml` (addendum 8, build `38924bd+21a123f7d64b`) | APK 65,133,308 → **47,625,302**; AAB 30,746,640 → **26,858,576**; `libil2cpp.so` (arm64-v8a) 32,484,816 → 15,123,816 | Gradle preview artifacts (a preview, not a release); the size preflight passes, and the static compatibility preflight passes with a REVIEW (no Unity libraries on armeabi-v7a) | The Unity-admitted cohorts (ARM64, more than 3 GB) | `unity/phase2/REPORT.md` addendum 8 |
| Unity bridge decode speed (UNITY-6, 2026-11-07: rewritten strict JSON scan, exact decimal parse, streaming SHA-256, one decode worker thread) | Managed IL of the changed bridge, trace and contract classes 146,944 → 162,816 (+15,872); C# source +67,400 (12 changed and 4 new Runtime files, about half comments); APK and AAB delta **not measured** | IL byte counts of the changed classes from an Editor build, and source bytes; no player build, no APK | The Unity-admitted cohorts. One worker thread competes with the render thread on few-core or busy phones: **UNPROVEN** on any device (kill-switch `BridgeConstants.BackgroundDecodeEnabled`; WebGL decodes synchronously) | `release/product-sequence/stage-1-practice/wedge/humans/unity6/` |
| Unity JS bridge: hash the replay identity once, trust packets by identity (HOP-1, 2026-11-07) | Web build: initial index chunk (it holds `unityPractice.ts`) +2,434 raw / +851 gzip / about +840 brotli; 127 chunks and 4 initial scripts unchanged. Android+Unity build (stage, coordinator and guard bundled): all JS +3,045 raw / +1,056 gzip, 130 chunks and 8 initial scripts unchanged | Overlay builds of one source snapshot, `vite build`; no APK | Every Android cohort that carries the web assets (the change is in the initial chunk): the web, Three.js, Classic and the Unity-admitted cohorts. APK and AAB delta not measured | `release/product-sequence/stage-1-practice/wedge/humans/hop1/bundle-delta.txt` and `followup-bundle-delta.txt` |
| Unity Director: C# core and stage binding (UNITY-E1 and UNITY-E2, 2026-11-07) | Managed IL of the whole Runtime assembly compiled in Release: core +41,984 B (E1), stage binding +43,520 B (E2: 856,064 → 899,584); C# source +160,381 B in E2 (8 new files 152,102 and edits 8,279), E1's source in its `SIZE.txt`; parameters generated from `params.json`; no asset, manifest, dependency, ABI or native-library change. The world now references the Director, so it is not stripped (E1's note that it might be no longer holds) | Release compile of the Runtime assembly (`unity-e2/tools/ilsize.sh`), Unity Editor Mono; no APK | Unity-admitted ARM64 cohorts only (the code runs inside Unity; the Classic fallback cohorts are unaffected). APK, AAB, fresh-install and IL2CPP deltas, and every phone CPU, memory and thermal figure, are UNPROVEN (Editor Mono on an M1 Pro: tick median +14 µs, mean +63 µs with the bakes; the rig's life 8 to 12 µs per actor-frame while on) | `release/product-sequence/stage-1-practice/wedge/humans/unity-e2/SIZE.txt` and `results/director-cost.txt`, `.../unity-e1/SIZE.txt` |
| Final newline in two Android files (REPO-C2a, 2026-11-07): `android/app/src/main/res/xml/file_paths.xml` and `android/variables.gradle` | Whitespace only: one byte each; no resource, manifest, dependency, ABI or native-library change; expected APK delta 0 B, **not measured** (no APK was built for it) | The two files diffed; no build | Every Android cohort (expected unaffected) | UNPROVEN until the I1 APK is built and compared; `release/product-sequence/stage-1-practice/wedge/repo/C2A/INDEX.txt` |
| Lint round and unused `export` keywords (REPO-C2b, 2026-11-07): web `index-*.js` | Raw 376,465 → 376,460 B (−5); gzip 120,621 → 120,645 B (+24); initial transfer 420,272 → 420,315 B (+43 B, 410.5 kB of the 450 kB budget): minifier output, no code added | `vite build`, the same BUILD_ID, deterministic; no APK | Every Android cohort that carries the web assets (the Classic, Three.js and Unity-admitted cohorts); effect on APK and AAB bytes not measured | UNPROVEN until the I1 APK; `release/product-sequence/stage-1-practice/wedge/repo/C2B/INDEX.txt` |

| Android camera permission, three optional camera features and the permission helper `VandeCameraAccess` (2 Java classes, about 5.9 KB of source, no new library); Java contract version 6 to 7 (ANDROID, CHASE program, 2026-11-08) | Manifest source +12 lines (a comment, a blank line and four declarations: the permission and three features); packed manifest, `classes.dex` and APK/AAB deltas **not measured** yet (no build was made for them): UNPROVEN, with a self-imposed cap of 16,384 B of APK growth for the manifest lines and the helper together. The contract change is one digit | A source diff, and the same declarations on tiny manifests with aapt2 37.0.0 plus the repository's own checker (`ANDROID/phaseA/aapt-lab`): the permission alone fails the checker, with the three features not required it passes | Every Android cohort carries the permission. No required feature is added, so the Play filter is not narrowed by it (the Play device-catalogue count is UNPROVEN until an upload report exists). A phone without a front or any camera installs and hides Camera; low-memory, old-WebView and no-`DecompressionStream` cohorts may not run Camera: UNPROVEN | `release/product-sequence/stage-3-chase/ANDROID/INDEX.txt` (A-01, A-09, B-rows) |
| Camera pack (pose engine, worker, model) | 9,136,226 B of files at file level (engine.bin 3,273,970 + worker.bin 84,510 + model.bin 5,777,746, from `node_modules/.cache/vande-camera-pack`); APK and AAB entry bytes **not measured** yet. Default builds carry 0 B of it, by construction (`dropWebOnlyAssets`) and by the placement checks; only the `--everything` / `--camera-bundle` sideload build packages it. A store build would download it into app storage after opt-in (not exercised: nothing is deployed) | File sizes from the pack builder; no APK | The first-ball install is unchanged (0 B); only the sideload build and a player who opts in carry it. SIZE-50 stays "install + first playable ball, camera absent", with a second line "with the camera add-on" (ruling R-1) | `docs/ANDROID_RELEASE.md`; `ANDROID/phaseA/mediapipe-bytes` |
| Android policy tools: the camera shape and payload rules, the sideload add-on accounting (`check-android-release-compat.mjs`, `check-android-size.mjs`) | No artifact change | Tests: `npm run android:policy:test` 49 of 49 before, extended after (counts in the INDEX) | None; the tools got stricter, not looser | `ANDROID/INDEX.txt` |
| Unity venue add-on, sideload only (UNITY-CLIPS, 2026-11-08; export made with `VANDE_UNITY_VENUE=1`) | Unity library export 283,838,465 → 283,954,910 B (+116,445 B, +6 files: five data files under `unityLibrary/src/main/assets/bin/Data/` of 21,252 + 3,020 + 2,140 + 87,668 + 528 B = 114,608 B, `globalgamemanagers` +384 B, the venue receipt); APK/AAB/Play bytes **not measured** until the Step 2 build c | Editor export folder sizes (UNITY-CLIPS) and the two export receipts (ANDROID-2, `ANDROID-2/size-tool/real-exports-claim.txt`) | None in a default build or a release candidate (the default export carries none of it, and `scripts/build-android.sh` refuses a venue export outside `--preview` with `--venue-bake`/`--everything`); the owner's sideload build only | `ANDROID-2/INDEX.txt` P1-02, P1-03 |
| Android policy tools, Step 2 (ANDROID-2, 2026-11-08): `check-android-size.mjs --unity-export / --unity-default-export / --unity-venue-receipt` and the build-script guard | No artifact change | `npm run android:policy:test` 99 of 99 (87 before), 12 deliberate breaks of the new logic all caught | None; stricter: every doubt leaves the bytes in the counted remainder | `ANDROID-2/size-tool/`, `ANDROID-2/INDEX.txt` P1-02 |
| Android FINAL preview builds a, b, c on the frozen tree `b12356b+fe7d4a542771` (ANDROID-2, 2026-11-08; rebuilt by the independent evaluator EVAL-ANDROID-2, same sourceTreeSha256) | a standard: APK 17,303,528 / AAB 9,947,636 (last standard preview of 2026-10-27: 16,540,859 / 9,161,887, so +762,669 B = +4.61% / +785,749 B = +8.58%); b Unity: APK 48,778,216 / AAB 27,791,581 (before the Chase program 48,587,532 / 27,620,915, so +190,684 B = +0.39% / +170,666 B = +0.62%; 1,221,784 B under 50,000,000 as a universal APK, WARN above 45,000,000); c sideload everything: APK 57,313,984 / AAB 36,328,880 (APK without the three declared add-ons 48,786,282, 1,213,718 under 50,000,000). The evaluator's own rebuild of a is identical (17,303,528 B) and of b within 12 B (48,778,204 B). On an emulator the Unity build b measured 56,213,504 B at its first-ball screen before any ball (code 46,776,320 + data 9,437,184): an INDICATIVE FAIL of SIZE-50, see §3 | File bytes of the Gradle preview artifacts that `scripts/build-android.sh` made from the frozen tree; size tool, compatibility report and both preflights. The file bytes are NOT the SIZE-50 measure (fresh-installed through the first playable ball); the emulator figure is not a phone | a: every Android cohort carrying the web assets; b and c: the Unity-admitted cohorts (compat 26 PASS, 6 REVIEW: Unity libraries absent from armeabi-v7a) | `ANDROID-2/builds/{a-standard-final,b-unity-final,c-everything-final}/sizes.txt`; `EVAL/evalandroid2/EVIDENCE.md` E-EVALANDROID2-018 |

- The whole web `dist` measured 47,456,572 bytes after the WORKER files. That is not the Android fresh-install measure
  (`worker/REPORT.md`, filing note).
- The Unity exports in `public/unity/` and `unity/VandePractice/Builds/{WebGL,Android}` are stale: they predate the
  texture replacement and embed the withdrawn textures. They must be re-exported in I1 before any size or reach
  evidence (`eval-assets/VERDICT.md` 2.3–2.6 and the lead's actions). UNITY's addendum 8 made a new Android preview
  export at 14:45Z; it does not cover the WebGL export.
- **The Unity APK and what cannot shrink further** (`unity/phase2/REPORT.md` addendum 8):
  - The preview APK of 47,625,302 bytes is under the 50,000,000 cap but above the 45 MB warning line. An APK byte count
    is not the SIZE-50 measure (section 3).
  - UI Toolkit's `UIElementsModule` stays at about 37 MB of generated C++, which cannot be reduced: `UIDocument` pulls
    in the UXML factory registry, which references every built-in control, and Unity has no public alternative.
  - The built-in physics modules cannot be removed, because in Unity 6000.3.27f1 UI Toolkit depends on
    `com.unity.modules.physics`; the attempt was reverted byte for byte.
  - An optional owner click remains: Project Settings → Physics → GameObject SDK → None, which would drop the
    force-included PhysX backend and keep the module. Its saving is unmeasured.
  - The 16 KB runtime gate also remains UNPROVEN.
- **SIZE-50 and REACH-90 remain UNPROVEN.** There is no production AAB, Play split or physical-device evidence for any
  of these changes.

## 3. Android size gate: SIZE-50

The size gate is evaluated on the same production AAB and build ID as the reach gate. Debug APK size, source-tree
size, AAB file size, device-specific APK-set size and code-directory size are preflight diagnostics only. None can
pass SIZE-50 by itself.

For each device specification selected for the reach matrix:

1. generate the Play-equivalent device APK set from the production AAB and use the repository checker as a fail-fast
   preflight;
2. obtain an owner/device-lab-prepared clean phone or profile, install the generated set, launch the candidate and
   reach the first genuinely playable ball without skipping required initialization;
3. capture the authoritative Play Console installed-size result or equivalent complete Android `StorageStats`
   evidence for the package at that point. For `StorageStats`, calculate `getAppBytes() + getDataBytes()`; Android
   defines cache as a subset of data, so record `getCacheBytes()` for diagnosis but never add it a second time;
4. record ABI, density and locale, because they can change the delivered set; and
5. repeat for every device specification selected for the reach matrix, preserving both preflight and authoritative
   measurements.

Unity-as-a-Library and its mandatory assets count in full when they ship. Do not assume Play dynamic-feature or
asset delivery will remove those bytes: no such production architecture or evidence exists in this repository. Any
future install-time/on-demand design must be separately implemented, included in the first-playable-ball measurement
and proven compatible with Practice's offline requirement.

**Pass:** the maximum authoritative fresh post-first-ball footprint over every cohort counted in REACH-90 is at most
50,000,000 bytes, and the repository preflight checker also exits zero. A release fails if full app/data/cache storage
cannot be measured, if all delivered splits cannot be inspected, or if assets are fetched after install to conceal
them from the measurement.

**The sideload exception (rulings R-1 and R-15).** The owner's sideload "everything" build (`scripts/build-android.sh --preview --everything`) carries two
optional payloads that no default build may: the camera pack and the baked venue. `check-android-size.mjs --addon camera --addon venue` applies the unchanged
50,000,000-byte ceiling to everything except those payloads, only for a `-PREVIEW-` artifact with the matching name tag, only for files the pack's
`MANIFEST.json` declares (sizes and sha256 verified) or the venue's `.glb` files, each under a stored-byte cap, and (ruling R-48, with `--unity-export`) the five compiled data files of the Unity
venue add-on, found by comparing the export receipts of the sideload and the default export of one source tree, sha256-verified, 1,000,000 B stored at most (`docs/ANDROID_RELEASE.md`); it prints the ceiling result without the add-ons and
each add-on on its own line, labelled `SIDELOAD-EVERYTHING, NOT A RELEASE`. It never passes a release build, never hides baseline bytes, and its output is never
SIZE-50 evidence: that figure is the fresh install through the first playable ball with the camera add-on absent, reported with a second line "with the camera add-on".

The checked-in preflight is:

```sh
node scripts/check-android-size.mjs \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --aab android/app/build/outputs/bundle/release/app-release.aab

# Optional read-only package-code observation on an already-installed device; still partial.
node scripts/check-android-size.mjs --device --serial <serial>

node --test scripts/check-android-size.test.mjs

# Static installability/ABI/native-alignment checks; still not a reach certificate.
node scripts/check-android-release-compat.mjs \
  --apk android/app/build/outputs/apk/release/app-release.apk \
  --aab android/app/build/outputs/bundle/release/app-release.aab

npm run android:policy:test
```

`scripts/build-android.sh` runs both preflights automatically after the artifacts are produced. The size script uses
the 50,000,000-byte hard cap, warns above 45,000,000 bytes, can emit JSON and never installs, uninstalls, launches or
clears an app. Its optional `adb du -sk` result covers allocated package-code directories only; mutable data/cache and
possibly ART storage remain outside that partial metric. The static compatibility script rejects an elevated SDK
floor, install-filtering features/screens/libraries, missing material ARM ABI coverage, inconsistent APK/AAB native
inventories, invalid 16 KB ZIP alignment and any packaged native `PT_LOAD` alignment below 16 KB. It explicitly emits
UNPROVEN for installed size, weighted reach, Play splits and 16 KB runtime evidence.

Current non-Unity preview observation (2026-10-27T00:30:09Z; working-tree identifier
`38924bd+ca4c5fd1fe21`; host load `13.76 15.31 18.06`; no build timing is used as performance evidence): APK
16,540,859 bytes and AAB 9,161,887 bytes. Both pass the artifact preflight, leaving 33,459,141 and 40,838,113
artifact bytes respectively below the hard ceiling. Relative to the immediately preceding preview they changed by
+1,493 APK bytes and +4,697 AAB bytes after the low-memory/ABI gates and release checker were added. The APK reports
minSdk 28, targetSdk 36 and all four current ABIs. The policy suites pass 20/20. The static release checker finds no
required device filter, passes APK/AAB ARM ABI and native-inventory checks, passes 16 KB ZIP alignment, and verifies
all four packaged native libraries' `PT_LOAD` alignment in both artifacts. This preview uses the upload key but is not
a production candidate, contains no Unity export, has no 16 KB-device runtime result, and is not authoritative
installed-size evidence. Unity size and the full fresh post-first-ball footprint remain **UNPROVEN**.

## 4. India working-reach gate: REACH-90

### 4.1 Weighted calculation

Normalize the dataset into mutually exclusive compatibility cohorts. A cohort has one joint signature, at minimum:

```text
API band + WebView band + ABI + RAM band + GPU family/performance band
+ OEM/lifecycle family + screen/refresh/safe-area band
```

Let `w(c)` be cohort `c`'s share of the complete India-phone denominator and `pass(c)` be exactly 1 or 0. Then:

```text
installable_reach = sum(w(c) * installable(c))
working_reach     = sum(w(c) * installable(c) * pass(c))
```

The weights across all cohorts, including unsupported and unknown phones, must sum to 1. Unknown values and untested
cohorts use zero; do not renormalize them away. Keep at least four decimal places in the calculation and report the
final percentage to one decimal place.

**Pass:** both `installable_reach >= 0.900` and `working_reach >= 0.900` on one production build ID. The evidence
snapshot must be at most 30 days old and an independent evaluator must reproduce the calculation. A Play device
catalogue model count is reported separately and never substituted for these weighted values.

### 4.2 Binary cohort pass contract

A cohort earns `pass(c) = 1` only when its declared worst-case physical representative passes every applicable item
below on the production AAB's Play-equivalent APK set. A stronger phone cannot represent a weaker cohort.

| Gate | Required observation |
| --- | --- |
| Install | The correct ABI/density/language splits install from the candidate AAB; the package launches cold and returns after process replacement. First-install evidence comes from an owner/device-lab-prepared clean phone or profile—the repository agents do not uninstall the app or wipe its data. |
| Stage 1 flow | Practice opens without network or account, Random and Predefined are reachable, an uninterrupted six-ball over completes, a wicket ends an innings and the retained ten-over cap remains functional. |
| Safe renderer selection | The phone enters only a renderer it qualified for. Low-memory and unsupported-ABI cohorts skip Unity before Unity class loading or `UnityPlayer` construction. Any Unity unavailability, ABI mismatch, initialization failure, graphics loss or memory risk fails closed before a broken delivery and leaves complete Three.js/Classic play available. |
| Frame pacing | Over at least 30 complete deliveries per used tier: Premium p95 <= 18 ms; Balanced p95 <= 22.2 ms and p99 <= 33.3 ms; Classic p95 <= 33.3 ms; no in-delivery frame exceeds 100 ms. A low-tier phone must hold the complete Classic path at 30 fps; a capable phone must meet its 60 fps tier. |
| Input | At least 50 real touches per used tier: input-to-first-visible-bat-motion p95 <= 50 ms on Premium/Balanced and <= 67 ms on Classic. A high-speed-camera input-to-photon run is required for the locked CTL1 physical-device gate. |
| Thermal and memory | One ten-over session completes without crash, ANR, OS kill, corrupt state or uncontrolled degradation. Quality may step down only between balls. Record peak proportional-set memory, thermal status and the renderer before every over. |
| Lifecycle | HOME/return, process replacement, Activity recreation, audio focus loss, a call/interruption, screen lock, low-memory callback, graphics-context loss, Back and Unity load/unload where applicable preserve exactly one authoritative ball and score. |
| Display and access | Landscape/rotate behavior, cut-outs, safe areas, gesture navigation, 200% text, TalkBack, captions, reduced motion, muted audio and haptics-off remain usable; essential touch targets are at least 48 dp. |
| Offline | After installation, the complete Practice flow makes no external request and remains playable in airplane mode. |
| Stability | No app crash, ANR, WebView crash, fatal native log, Unity process exit or unrecovered black surface occurs in the complete run. |
| Size | The same device specification passes SIZE-50. |

One representative may cover a cohort only when it is at or below that cohort's declared CPU/GPU/RAM/display floor
and has the same ABI, API/WebView band and material OEM lifecycle behavior. Otherwise split the cohort. Any failure
sets the whole represented cohort to zero until corrected and independently rerun.

### 4.3 Low-memory and Unity-as-a-Library admission gate

Unity-as-a-Library retains the live Capacitor WebView, so VANDE must treat it as the combined WebView-plus-Unity
memory shape, not as Unity alone. A device is conservatively in the low-memory class when Android reports
`ActivityManager.isLowRamDevice()`, total RAM is 3 GB or less, or the app cannot determine memory safely before
renderer construction.

For that class the production behavior must be: decide at native startup, do **not** construct `UnityPlayer`, and
enter the complete Classic experience directly. Evidence must show the renderer decision precedes every Unity
class/native-library load, then show a ten-over Classic session plus the lifecycle and memory-pressure cases in
section 4.2 with no crash, ANR, low-memory kill, corrupt score or missing required Practice function. Trying Unity,
running short of memory and falling back afterwards is a failure.

For Android Go and other constrained cohorts, also record whether the build meets Android's stronger Build for
Billions guidance: less than 40 MB installed and no more than 150 MB proportional-set memory for a game. These are
reported cohort-quality thresholds rather than a redefinition of the owner's universal 50,000,000-byte ceiling. A
constrained cohort can contribute to working reach only after its complete Classic session passes the measured memory,
stability and lifecycle contract above; a nominally installable but repeatedly killed experience does not count.

The current verified Unity-export contract is ARM64-only. A 32-bit app process, preferred ABI other than
`arm64-v8a`, or unavailable ABI signal must likewise skip Unity before any Unity class/native-library load and enter
Three.js/Classic. Runtime routing protects the fallback but does not prove that Play generated a complete ARMv7 split;
the exact split and a physical ARMv7 fallback run remain mandatory whenever that cohort contributes to REACH-90.

A named low-memory cohort may become Unity-eligible only after an independent run on its worst-case physical
representative keeps the WebView alive and passes all of the following on the production artifact: ten cold
load/play/unload cycles, three complete ten-over sessions, HOME/return and process-replacement recovery, and an
Android low-memory/trim callback. Record total and available RAM, Android low-RAM classification, memory class,
per-process peak/median PSS before Unity, during delivery and after unload, thermal status, trim/LMK events and
renderer markers. The acceptance result is binary: zero crash, ANR, LMK, black surface, lost authoritative ball or
failed unload across the run. Until that evidence exists, its Unity admission flag remains off and only a passing
Classic run can contribute its weight to REACH-90.

### 4.4 16 KB memory-page compatibility gate

For every production APK split containing native code, including Unity, IL2CPP, plugins and transitive Android
libraries, all of these are required on the same build ID:

1. `zipalign -c -P 16 -v 4 <apk>` succeeds for each generated Play-equivalent APK containing `.so` files;
2. an ELF program-header audit enumerates every packaged `.so` and shows every `PT_LOAD` segment has
   `p_align >= 0x4000` (`2**14`); omitted or uninspectable libraries fail the gate;
3. a physical or virtual Android 15-or-later ARM64 device reports `16384` from `adb shell getconf PAGE_SIZE`, then
   installs the Play-equivalent split set, cold-launches, reaches the first playable ball, completes one over and
   passes the applicable Unity load/unload and lifecycle cases without linker, `dlopen`, native crash, ANR or black
   surface; and
4. Play Console/app-bundle inspection and pre-launch reporting show no 16 KB page-size incompatibility for the
   production AAB. A normal 4 KB-page Android representative must still pass; 16 KB support cannot regress it.

The zip and ELF checks are static preflights, not substitutes for the 16 KB runtime. A 16 KB failure sets each
affected cohort to zero. Re-run this gate whenever Unity/NDK/AGP changes or any native dependency, ABI, packaging or
compression setting changes. Preserve the native-library inventory, alignment output, device `PAGE_SIZE`, logcat
and Play report with the device evidence.

## 5. Mandatory physical matrix before weighting

The weighted export determines exact model selection. The matrix must nevertheless span all of these risk classes;
it is not enough to buy only the most popular mid-range phones.

| Risk class | Minimum real-phone coverage | Expected safe path |
| --- | --- | --- |
| Legacy floor | API 28/29; lowest material RAM bucket (including 2 GB/Android Go if present); PowerVR or the weakest material Mali GPU; 60 Hz | Classic |
| Budget | API 29–32; 3–4 GB; Mali-G5x/Helio-class and a budget OEM skin/battery saver | Classic or Balanced only if measured |
| Mass market | API 31–34; 4–6 GB; both Adreno 6xx and Mali-G6x; Samsung plus at least two of Xiaomi/Poco, Realme/Oppo/OnePlus, Vivo/iQOO and Transsion when their combined weight is material | Balanced |
| Current Android | API 35/36; current System WebView; gesture navigation and a display cut-out | Measured tier |
| High refresh | At least one 90 Hz and one 120 Hz phone, saver on and off | Measured tier without pacing instability |
| Large/variable display | A small/tall phone and a foldable or large-screen phone if they are inside the declared smartphone denominator | Safe layout or clear rotate behavior |
| ABI floor | ARM64; ARMv7 whenever it contributes to the target denominator or the Play artifact claims to support it | Unity only where its exact ABI exists; otherwise proven retained fallback |

At minimum cover Mali, Adreno and PowerVR; API 28/29, 30–33 and 34–36; 2/3 GB, 4 GB and 6+ GB where each bucket
exists in the dataset; 60, 90 and 120 Hz; and the OEM families needed to represent the weighted 90%. x86 emulator
runs remain engineering evidence and carry no India-phone weight.

The existing `docs/PRACTICE.md` physical-device examples are acquisition suggestions, not market weights and not a
substitute for this matrix calculation.

## 6. Evidence record and files

Every device row records:

- build ID from `scripts/build-id.sh`, production AAB SHA-256 and generated APK-set SHA-256;
- UTC start/end, host `uptime`, operator/evaluator role and evidence path;
- source dataset ID/date and exact cohort weight;
- manufacturer/model, API/release/security patch, OEM build/skin and Android Go state;
- primary ABI, total/available RAM, SoC, GPU/driver, display pixels/density/refresh, cut-out/fold state;
- device page size, packaged native-library inventory, APK zip-alignment output and every native `PT_LOAD` alignment;
- System WebView/Chrome version;
- delivered split names and bytes, installed-size result and first-session data/cache growth;
- selected renderer/tier/profile, assistance, hand, audio/haptic/motion/text settings;
- method, expected, observed, pass/fail for every row in section 4.2;
- complete raw frame/input/lifecycle/logcat output, with any timing run at one-minute host load above 20 labelled
  indicative only.

Suggested release evidence layout:

```text
release/android-size-reach/<build-id>/
  SNAPSHOT.md                 # source, date, scope and denominator
  cohorts.csv                 # normalized non-sensitive weights and pass flags
  SIZE.md                     # device-specific installed-size table
  REACH.md                    # formulas, result and limitations
  devices/<cohort-id>/        # harness JSON, raw logs and selected captures
  independent/VERDICT.md      # evaluator decision; builders do not certify themselves
```

The current Android harness already records build ID, UTC, host uptime, model, API, cores, RAM, display/viewport,
orientation, persisted-ball transitions, browser errors and logcat. It does **not** yet provide the full ABI, GPU,
driver, refresh-rate, OEM build, Android Go, System WebView, delivered-split, installed-footprint, thermal or
device-weight record above. Until those fields are captured by tooling or an evidence wrapper, complete them with
read-only device commands and preserve the raw output.

## 7. Release procedure

1. Freeze one candidate tree and build ID; build the production AAB through `scripts/build-android.sh` only.
2. Run the size checker, generate Play-equivalent APK sets for every selected device specification and verify the
   merged manifest/ABI/features. Run the complete 16 KB static and runtime gate. The highest counted installed
   footprint must pass SIZE-50.
3. Obtain the current weighted India smartphone snapshot, preserve its source metadata and construct the joint
   cohorts before device testing. Do not revise cohorts to hide a failed phone.
4. Select a worst-case physical representative for each cohort needed to reach 90%, plus every mandatory risk class
   in section 5.
5. Run the Android Practice harness with at least 30 complete deliveries per used tier, followed by the ten-over,
   lifecycle, offline, accessibility, thermal, memory and high-speed-camera checks.
6. Mark unknown/skipped/flaky cohorts zero, calculate both reach values and attach all failures.
7. Have an independent evaluator verify artifact identity, raw results, cohort mapping, formulas and SIZE-50 /
   REACH-90. Builders do not sign their own gate.
8. Upload only to Play internal testing, inspect the actual device-catalog exclusions, Play-generated size report and
   pre-launch report, and reconcile any difference before a broader release decision.

## 8. Change guard for all future implementation

Every Android-affecting change must report both deltas before acceptance:

```text
installed-size delta (bytes, by counted device spec)
installable-reach delta (weighted percentage points)
working-reach risk (cohorts added, removed or requiring rerun)
```

Recompute and rerun affected cohorts whenever a change:

- raises minSdk/target behavior, removes an ABI or adds a required manifest feature;
- changes Unity/NDK/IL2CPP, Capacitor, WebView requirements or emitted JavaScript syntax;
- adds or replaces native libraries, changes ELF/page alignment, models, textures, shaders, animations, audio,
  fonts or locales;
- raises peak memory, GPU/API requirements, internal render resolution or startup work;
- changes orientation, safe-area, lifecycle, input, renderer selection or fallback behavior; or
- changes AAB splitting, compression, asset delivery, minification or resource shrinking.

No implementation is allowed to spend unmeasured size or silently narrow device reach. Conversely, do not weaken
physics, scoring or essential ball readability merely to meet a low-end target; reduce presentation expense and use
the complete Classic path.

## 9. Current decision

- **SIZE-50:** UNPROVEN pending the production-AAB device-specific checker and a current candidate artifact. The
  wedge's builder deltas of 2026-11-03 are listed in §2.1; none of them is a SIZE-50 measurement.
- **REACH-90:** UNPROVEN pending a weighted India snapshot and the physical matrix.
- **16 KB pages:** static preflight passes only for the current non-Unity preview; production/Unity runtime support is
  UNPROVEN.
- **Safe implementation direction:** preserve minSdk 28 unless owner-approved evidence requires a constitutional
  change; keep required hardware features out of the manifest; preserve the complete Classic fallback; keep Unity
  optional/ARM64-only until its exact reach and size are measured; and treat every new art/audio/native dependency as
  spending both size and compatibility budget.

## 10. Primary platform references

- Android `StorageStats` definitions: <https://developer.android.com/reference/android/app/usage/StorageStats>
- Android Build for Billions device-capacity guidance: <https://developer.android.com/docs/quality-guidelines/build-for-billions/device-capacity>
- Android app-size and App Bundle guidance: <https://developer.android.com/topic/performance/reduce-apk-size>
- Android 16 KB page-size requirements: <https://developer.android.com/guide/practices/page-sizes>
- Google Play device reach and metrics: <https://support.google.com/googleplay/android-developer/answer/10770882>
- Google Play supported-device catalogue: <https://support.google.com/googleplay/android-developer/answer/9859371>
- Unity-as-a-Library limitations: <https://docs.unity3d.com/6000.0/Documentation/Manual/UnityasaLibrary.html>
- Unity-as-a-Library on Android: <https://docs.unity3d.com/6000.0/Documentation/Manual/UnityasaLibrary-Android.html>
