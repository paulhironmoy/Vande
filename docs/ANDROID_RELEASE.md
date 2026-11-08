# Android release

VANDE Cricket ships to Google Play as a Capacitor 8 app. The default Android package uses the retained web renderers;
an explicitly selected build may additionally link the verified Unity-as-a-Library export for Practice presentation.
TypeScript remains authoritative for input, physics, scoring, replay and Coach in either package. The Android app also
contains three native plugins (Play Install Referrer, Keystore-backed secure storage, Google sign-in through
Credential Manager) and FCM push.

| | |
| --- | --- |
| Application id | `in.vande.cricket` (new; the civic prototype's `in.vande.republic` was never published) |
| Version | `versionName` in `android/app/build.gradle` (keep equal to `package.json` `version`), `versionCode` +1 per upload |
| SDK levels | min 28, target 36, compile 36 (`android/variables.gradle`) |
| Toolchain | JDK 21 (Android Studio's bundled JBR), Android SDK at `~/Library/Android/sdk` |
| Permissions (merged manifest) | `INTERNET`, `ACCESS_NETWORK_STATE`; `POST_NOTIFICATIONS` (asked only after a meaningful moment, never on first launch); `VIBRATE` (haptics); `CAMERA` (optional Camera batting: asked only after the player chooses Camera and has read the consent screen; `camera`, `camera.front` and `camera.autofocus` are declared `required="false"`, so no phone is filtered out; see below); FCM's `WAKE_LOCK` and `c2dm.permission.RECEIVE`; the Play install referrer's `BIND_GET_INSTALL_REFERRER_SERVICE`; AndroidX's app-private `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No microphone, location, contacts, storage or advertising id |
| Locales | `en`, `hi`, `bn`, `te`, `mr`, `ta`, `gu`, `kn`, `ml`, `pa` resources (push copy); all locales stay in the base module |

## Before the first production build

These are open launch blockers (`docs/LAUNCH_BLOCKERS.md`), and none of them can be done from the repository:

1. **Domain and App Links.** Choose the production web origin (for example `https://vandecricket.in`). Host
   `/.well-known/assetlinks.json` there, naming `in.vande.cricket` with the SHA-256 fingerprints of the Play app-signing
   certificate (Play Console → Test and release → App integrity) and the upload certificate. Build with
   `-PappLinksHost=<domain> -PappLinksBasePath=` (empty at the domain root). The Worker's `PUBLIC_WEB_ORIGIN` and
   the client's `VITE_PUBLIC_WEB_ORIGIN` must be the same origin and base path.
2. **Firebase.** Create the Firebase project and add the Android app `in.vande.cricket`. Place `google-services.json` at
   `android/app/google-services.json` (gitignored), and give the Worker its FCM service-account secret. Without the file, the
   build still succeeds and push stays off.
3. **Google sign-in.** Create the OAuth web client id (`VITE_GOOGLE_CLIENT_ID`, Worker `GOOGLE_CLIENT_IDS`) and the
   Android client for the app-signing SHA-1.
4. **Backend.** Provision the Cloudflare Worker, D1, R2, Queues and secrets (`docs/INFRASTRUCTURE.md`), and set
   `VITE_API_URL` for the build.

## Signing

* Release builds read `android/keystore.properties` (gitignored), which points at the upload keystore in
  `android/keystore/` (gitignored). Never print, copy into chat, or commit either file. Keep an offline backup in
  the owner's password manager, because losing the upload key needs a Play support reset.
* Use **Play App Signing**: Google holds the app-signing key and you upload with the upload key. The same upload key may
  serve several apps.
* Without `keystore.properties` a release build stops (Gradle `verifyReleaseInputs`). Only `--preview` builds may use
  the debug key, and their files are named `*-PREVIEW-*`.

## Build

```bash
# Production configuration comes from the environment (never from committed files):
export VITE_API_URL=https://api.<domain> VITE_PUBLIC_WEB_ORIGIN=https://<domain> VITE_PUSH_ENABLED=1 \
       VITE_GOOGLE_CLIENT_ID=<web client id> VITE_SUPPORT_EMAIL=<support address> VITE_OPERATOR_NAME="<legal name>"
APP_LINKS_HOST=<domain> APP_LINKS_BASE_PATH= scripts/build-android.sh          # retained-renderer release
APP_LINKS_HOST=<domain> APP_LINKS_BASE_PATH= scripts/build-android.sh --unity  # release with verified Unity export

scripts/build-android.sh --preview            # local retained-renderer package: never upload
scripts/build-android.sh --preview --unity    # local Unity-linked package: never upload
scripts/build-android.sh --preview --unity --everything   # the owner's sideload test app (see the next section): never upload
```

`--unity` does not create or repair a Unity export. After syncing Capacitor (Gradle cannot configure the project on a
fresh checkout before that) it asks Gradle to verify the existing immutable export, sets the Android web bridge and
Gradle module to the same Unity choice, and then links it. The sealed Unity invocation needs
`android/local.properties` holding exactly `sdk.dir`; when the file is absent the script writes it from `ANDROID_HOME`
and never overwrites one. The default build leaves Unity out and preserves the retained renderer package. A
Unity-linked artifact proves only that the export was accepted and packaged; it does not prove that Unity was selected
at runtime, passed its device qualification or met the player, performance, size or reach gates.

The script is the only supported way to build a release candidate:

* it clears the local-testing switches (`CAP_WEBVIEW_DEBUG`, `CAP_LOCAL_HTTP`);
* it freezes the build id from `scripts/build-id.sh`, passes that id into the web build and
  fails if the source identity changes before packaging finishes;
* it always rebuilds the Android web payload from that source identity; `--skip-web` is rejected;
* it rejects a duplicate WebGL Unity payload in the Android web bundle;
* it syncs Capacitor;
* it passes the App Links host to Gradle;
* it names preview artifacts `*-PREVIEW-*` and Unity-linked artifacts `*-UNITY-*`;
* it fails when the APK or AAB artifact preflight exceeds 50,000,000 bytes and warns above 45,000,000 bytes; and
* it runs the static compatibility preflight for SDK/manifest filters, ARM64 plus ARMv7 packaging, APK/AAB native
  consistency, 16 KB ZIP alignment and every packaged ELF `PT_LOAD` segment.

That artifact check is deliberately conservative, but it is not an installed-size certificate. The binding Android
gate is at most 50,000,000 bytes on device after a fresh install reaches the first playable ball. India working reach
must independently be at least 90.0% on a current weighted snapshot. Definitions, commands and evidence requirements
are in `docs/ANDROID_SIZE_AND_REACH.md`; both results remain UNPROVEN until the physical/Play evidence exists.

Gradle's `verifyReleaseInputs` task (android/app/build.gradle) also refuses a release build that has no upload
keystore, no explicit `-PappLinksHost`, WebView debugging or mixed content switched on, or a web bundle that talks to a
local API. Preview builds (`-PpreviewRelease`) only warn.

Artifacts land in `release/` (gitignored). The filename contains the frozen build identity, not merely the version:

* retained release: `vande-cricket-<version>-<code>-<build-slug>-release.{apk,aab}`;
* Unity-linked release: `vande-cricket-<version>-<code>-<build-slug>-UNITY-release.{apk,aab}`;
* retained preview: `vande-cricket-<version>-<code>-<build-slug>-PREVIEW-release.{apk,aab}`;
* Unity-linked preview: `vande-cricket-<version>-<code>-<build-slug>-PREVIEW-UNITY-release.{apk,aab}`; and
* checksums: `SHA256SUMS-<version>-<code>-<build-slug>[-PREVIEW][-UNITY].txt`.

`<build-slug>` is the build id with a dirty-tree `+` rendered as `-dirty-` so it is safe in a filename. Record both
the exact build id printed by the script and the APK/AAB SHA-256 values in the evidence. Only the non-preview AAB is
an upload candidate. Preview packages may use the debug key, use preview App Links and exist only for local
inspection; passing their static checks is not release, installed-size or reach evidence.

The script prints `apksigner` certificate details. Check that the signer is `CN=VANDE Upload Key`, not the debug key.

`VITE_BUILD_TARGET=android` (set by the script) leaves the web-only pages (admin console, highlight render page) and
the web-only social card images out of the app bundle. The privacy and account-deletion pages ship in every build.

R8 and resource shrinking stay off for the retained-renderer package. They are enabled for a Unity-linked release to
remove unreachable standalone-player resources and Java code; Unity supplies its consumer rules and VANDE's
reflective host rules remain in `android/app/proguard-rules.pro`. Any keep-rule or shrinker change requires the full
Practice lifecycle, renderer-selection and physical-device matrix again.

Firebase is configured not to create an installation id or token until the player turns notifications on (manifest
`firebase_messaging_auto_init_enabled=false`; the push plugin enables it on `register()`).

## Camera permission and the optional payloads (the sideload "everything" build)

**This section is the single source for the flag names** (`--camera-bundle`, `--venue-bake`, `--everything`, `VITE_CAMERA_BUNDLED`,
`VITE_VENUE_BAKED`); other documents point here.

### The camera permission

- The manifest declares `CAMERA` and, as `required="false"`, `android.hardware.camera`, `android.hardware.camera.front` and
  `android.hardware.camera.autofocus`. Without those three lines aapt2 turns the permission into a required back-camera feature (measured:
  `uses-implied-feature ... requested android.permission.CAMERA permission`) and Android's documentation says it also implies a required
  autofocus; Play would then filter out phones without them. `scripts/check-android-release-compat.mjs` (rule `camera-permission-shape`) fails
  a build that declares `CAMERA` without the three optional features, and any build that declares `RECORD_AUDIO` (nothing records sound).
- The page asks only after the player chooses Camera and accepts the consent screen. Capacitor's `BridgeWebChromeClient.onPermissionRequest`
  turns `getUserMedia({ video })` into the system dialog and then grants or denies the WebView request; the WebView keeps no grant, so every
  `getUserMedia` call goes through that path again. What that path cannot do is tell the page that the system will not ask again, or open
  this app's page in Settings (Capacitor hands any other URL to `ACTION_VIEW`; there is no web route). So a small native permission helper,
  `VandeCameraAccess` (`plugins/CameraAccessPlugin.java`, rulings R-14 and R-38), answers three questions and does nothing else:
  `getStatus()` returns `{camera: 'granted'|'prompt'|'prompt-with-rationale'|'denied', hasFrontCamera, hasAnyCamera}` without a dialog, `request()` shows
  the system dialog when the system will show one (it asks the system in every state except granted, so a stale remembered refusal cannot lock a player
  out) and resolves with the status, `openSettings()` opens this app's page in Settings. It opens no camera, sees no frame and writes no file; there is no
  capture code anywhere in `android/` (a test scans for it). The Troubleshooting screen also carries the words-only steps for Android, so the helper is an
  extra, not a dependency. R8 keeps it by name (Capacitor's consumer rule; `scripts/check-unity-r8.mjs` proves it in the Unity-linked, minified build).
- Frames never leave the WebView, are never stored and never reach native code.

### Gesture exclusion while batting

The system's inward Back swipe (gesture navigation, Android 10 and later) must not steal a stroke that starts near a side edge. The page tells the
native plugin `VandeSystemGestures` (`plugins/SystemGesturesPlugin.java`; page side `src/practice/ui/controls/gestureExclusion.ts`; request CONTROLS-3)
when a ball is being played: `setBattingExclusion({ active, heightFraction })`. While `active`, the two side strips of the lower part of the screen
(`BattingExclusion.rectangles`: band height at most 200 dp, strips 96 dp or a third of the width) are given to the app on the activity's decor view, so the
Web view and the Unity overlay are both covered; the rectangles are recomputed on every layout and rotation, cleared while the activity is paused and applied
again on resume. At the dead ball, in menus and in settings Back works as usual. The bottom home gesture cannot be excluded by any app; immersive mode is what
keeps a swipe there from leaving the game at once. No camera, no frame, no permission, no storage; a JUnit test covers the arithmetic.

### The optional payloads

Two payloads are kept out of every default build so the first-ball install does not carry them:

| Payload | Web build variable | Script flag | Where it lives in the artifacts |
| --- | --- | --- | --- |
| Camera pack: pose engine, worker, model (downloaded on demand by a store build; not exercised, nothing is deployed) | `VITE_CAMERA_BUNDLED=1` | `--camera-bundle` | `assets/public/models/pose/<id>/` (APK), `base/assets/public/models/pose/<id>/` (AAB), with a `MANIFEST.json` of names, byte counts and sha256 |
| Baked venue (web): the stadium GLB files and the two small chunks that load them (ruling R-41) | `VITE_VENUE_BAKED=1` | `--venue-bake` | `assets/public/assets/venue-p-*.glb`, `venue-b-*.glb` (hashed names, 164,412 B raw with the chunks `venueBaked-*.js` and `venuePacks-*.js`; APK), `base/...` (AAB) |
| Baked venue (Unity): compiled meshes and an atlas in the Unity player data (ruling R-48) | `VANDE_UNITY_VENUE=1` when the Unity export is made (not a build variable of this script) | none: the export that is bound decides | `assets/bin/Data/<hash>` (5 files, 114,608 B raw on the final export; APK), `base/assets/bin/Data/<hash>` (AAB); receipt `.vande-venue-addon.properties` (Unity writes it into the export folder, see below) |

`VITE_VENUE_OFF=1` drops the baked web venue from any build (the stand-in, Classic's painted bowl and the two 1280 px hero plates, 115,452 B, stay; they are part of the first-ball install). A `--venue-bake` build made with it stops at the `dist` check because no `.glb` file exists.

`--everything` sets both; every one of the three needs `--preview` (the script refuses otherwise), and `--camera-bundle` refuses a build that also sets
`VITE_CAMERA_MODEL_BASE_URL`. Artifact names carry `-EVERYTHING`, `-CAMERA` or `-VENUE` after `-PREVIEW` (and `-UNITY`), for example
`vande-cricket-<version>-<code>-<build-slug>-PREVIEW-UNITY-EVERYTHING-<invocation>-release.{apk,aab}`. Both variables are recorded in the sealed Unity
invocation. The build fails before Gradle if `dist` holds the camera pack or a `.glb` without its flag, or lacks them with it.

What the preflights do with these builds:

- `check-android-release-compat.mjs` (rules `<archive>-camera-payload`, `<archive>-venue-payload`) fails any APK or AAB that carries the camera pack
  or a `.glb` in its web payload unless `--allow-camera-payload` / `--allow-venue-payload` is passed, which the script does only for the matching flag.
- `check-android-size.mjs` keeps the 50,000,000-byte ceiling for everything except the declared add-on (ruling R-15). `--addon camera` / `--addon venue`
  apply **only** to a `-PREVIEW-` artifact that carries the matching tag, exempt only files the pack's `MANIFEST.json` declares (byte count and sha256 verified)
  or the venue's `.glb` files (and, with `--unity-export`, the Unity venue's compiled data files, see below), each within a stored-byte cap (camera 16,000,000; web venue 4,000,000; Unity venue 1,000,000), and always print both numbers: the ceiling check
  without the add-ons, and each add-on's bytes on its own line, with the label `SIDELOAD-EVERYTHING, NOT A RELEASE`. A release-named file, an undeclared
  file, a file outside those folders or a manifest mismatch stays in the remainder the ceiling is applied to. The tests build real zip files for each case.
- **The Unity venue add-on (ruling R-48).** An export made with `VANDE_UNITY_VENUE=1` (Unity batch mode, `-executeMethod Vande.Practice.Editor.VandeAndroidLibraryExporter.Export`; `docs/UNITY_PRACTICE_STATUS.md`)
  adds five compiled data files under `unityLibrary/src/main/assets/bin/Data/` (the three wedge meshes, the atlas and a small add-on object) and writes
  `.vande-venue-addon.properties` (`schema=vande-venue-addon-1`, `sideload=true`, the bytes and sha256 of its four SOURCE files) into the export folder; the export's
  `sourceTreeSha256` does not change. **The sealed Gradle check of the export (`android/settings.gradle`) compares every file of `Builds/Android` with the files listed in
  `.vande-export.properties` and rejects any other, this receipt included** (measured 2026-11-08T13:32Z: `unexpected=[.vande-venue-addon.properties]`), so for the Gradle run the receipt must sit
  BESIDE the folder as `Builds/Android.vande-venue-addon.properties`. Ruling R-56: `build-android.sh` moves it there itself when it binds the export (`venue_receipt_aside`) and puts it back when the
  script ends (`venue_receipt_restore`, run by the EXIT trap; INT, TERM and HUP end the script through `exit`, so a failed build and an interrupted one restore it too. Only SIGKILL cannot: the receipt then
  stays beside the folder, where the script, its guard and `check-android-size.mjs` (`--unity-venue-receipt`) find it, and `Builds/Android` is a default export again). The policy tests run the real script in
  scratch trees (a failing build, SIGINT, SIGTERM and SIGHUP while it runs, a default export, a non-Unity build) and the two functions themselves (already beside, both present, no overwrite). The clone driver
  for the debug variant of build c sources the same two functions. Three rules keep it out of everything but the owner's sideload build:
  1. `scripts/build-android.sh` refuses (exit 2, before any work) to bind an export that carries that receipt (inside or beside the folder) unless the build is `--preview` with `--venue-bake` or `--everything`.
     The standard preview (build b) and every release candidate use the export made without the variable; the sideload build (c) uses the venue export. The script binds only
     `unity/VandePractice/Builds/Android`, so the two exports are swapped by rename (never copy: 284 MB each): `mv Builds/Android Builds/Android.final-default && mv Builds/Android.final-venue Builds/Android`,
     build, then swap back.
  2. `check-android-size.mjs --addon venue --unity-export <bound export> [--unity-default-export <default export>]` (the script passes both; the second is
     `Builds/Android.final-default` when that folder holds a `.vande-export.properties`) validates the venue receipt (schema, `sideload=true`, sums, and that its four sha256 are the
     source files in the source tree the export was bound to), then finds the compiled files by comparing the two export receipts: the files only the venue export has under
     `unityLibrary/src/main/assets` (the default export must be of the same `sourceTreeSha256`, must carry no venue receipt, and must lack nothing the venue export has).
     Each is looked up in the artifact (`assets/<path>`, `base/assets/<path>`), compared by sha256 with the export receipt and exempted by its stored bytes within a cap of 1,000,000 B.
     The receipt alone cannot name them: it lists the four source files, which a player build does not store as FBX or PNG.
  3. Everything else stays in the remainder the ceiling is applied to: Unity files the venue export only *changes* (`globalgamemanagers`, `boot.config`, `unity_app_guid`), files it adds outside
     the assets folder, a file that is missing or differs, the whole add-on when no default export is given (the report says so), and everything in a release-named artifact.
  The size report gets a line `add-on venue-unity (...)` with the file count and bytes, `Unity venue receipt: ...`, and the changed or non-exempt files. Measured on the final
  exports (Editor, 2026-11-08): 5 added data files, 114,608 B raw, plus 3 changed files (`globalgamemanagers` +384 B, `boot.config`, `unity_app_guid`) and the receipt; APK/AAB/Play bytes are measured by the Step 2 builds, not here.
- Size reports always give two lines (ruling R-1): the first-ball install without the camera add-on is the SIZE-50 figure; the second line is the figure with it
  (bytes in the APK for the sideload build; bytes on disk after the download for a store build; the pack's download size on its own).

A sideload build is signed with the debug key, runs on the owner's own phone, and is **never** uploaded. It does not show the first-ball install size.

## Verify before uploading

1. Freeze one source identity. Record the output of `scripts/build-id.sh`, UTC time and host
   `uptime`; do not change source while producing or testing the candidate.
2. `npm run typecheck:all`, `npm test`, `npm run test:render`, `npm run test:e2e` and `npm run test:flow` pass. For a
   Unity candidate, its Unity tests/export verification must also pass on the same source identity.
3. Build exactly one intended variant through `scripts/build-android.sh` (add `--unity` only for the Unity-linked
   candidate). Do not use a preview artifact as the production candidate and do not reuse an older web bundle.
4. Smoke the exact APK:
   `scripts/android-smoke.sh release/vande-cricket-<version>-<code>-<build-slug>[-UNITY]-release.apk`. It boots the
   AVD if no device is connected, installs, launches, taps, presses Back, captures screenshots in `release/smoke/`,
   and fails on any crash or ANR in logcat. An emulator result is engineering evidence only.
5. Run the Practice lifecycle harness on a selected Android target. It installs over the existing app without wiping
   its data and drives the visible Stage 1 flow. For a Unity run use, for example:

   ```sh
   UNITY=1 ANDROID_SERIAL=<serial> scripts/android-practice.sh \
     release/practice-android/<build-id>-unity --label unity-native --deliveries 6
   ```

   A normal harness build freezes the repository build ID and embeds it in the Android web payload. Before any
   gameplay assertion, the harness reads the installed ID independently from the document root and its frozen
   evidence surface and requires both to match. `SKIP_BUILD=1` therefore requires an explicit
   `EXPECTED_BUILD_ID=<exact embedded id>`; the checkout identity is never substituted for an installed artifact.
   The harness then records the native plugin's exact `{available, reason, unityVersion}` admission result before
   gameplay. Its separate source-order check is labelled `STATIC_SOURCE_ONLY`: it cannot prove that a physical
   process avoided class or native-library loading.

   At every acquired live delivery `android-practice.mjs` writes a timestamped `rendererEvidence` row containing:

   * `renderer`, read from root `data-vande-practice-renderer`; the accepted exact values are `unity-native`,
     `unity-webgl`, `three-webgl` and `classic`, and a missing marker is recorded as `null`;
   * `admission`, read from root `data-vande-unity-practice`; `engineering-preview-unqualified` means the run is an
     explicitly unqualified engineering preview, while no such marker is recorded as `null`; and
   * `admissionReason`, read from `#vande-unity-engineering-preview[data-reason]` when present: `explicit_preview`,
     `benchmark_unavailable` or `qualification_incomplete`.

   `UNITY=1` fails by default unless the observed renderer is exactly `unity-native`; linking Unity or seeing a
   generic canvas is not accepted as renderer evidence. Use `--allow-unity-fallback` only for an intentionally named
   fallback cohort. That flag preserves the observed renderer/admission row but cannot certify Unity. Any row marked
   `engineering-preview-unqualified` is inspection evidence only and cannot qualify release admission.
6. On the exact production AAB's Play-equivalent splits, run the complete physical-device matrix in
   `docs/ANDROID_SIZE_AND_REACH.md`: Stage 1 Random and Predefined Practice, renderer admission before construction,
   an uninterrupted over, one ten-over thermal/memory session, lifecycle and process replacement, offline play,
   accessibility, display/safe-area behavior, 4 KB and 16 KB runtime compatibility, and the required per-tier frame
   and touch-latency samples. Low-memory phones must enter complete Classic directly; unsupported-ABI phones must
   enter a proven retained Three.js/Classic path. Both decisions must happen before any Unity class/native-library
   load. Debug harness or emulator success cannot replace these production-split observations.
7. Run `scripts/check-android-size.mjs` and `scripts/check-android-release-compat.mjs` on the exact APK/AAB (the build
   script already runs both, so preserve their output). Then obtain the Play installed-size report or equivalent
   fresh-device `StorageStats` measurement after reaching the first playable ball. APK, AAB, package-code and static
   results alone do not pass SIZE-50, REACH-90 or the 16 KB runtime gate.
8. Export a current India-weighted device snapshot, map the physical results to its complete cohorts, count unknown,
   excluded, skipped and flaky cohorts as zero, and have an independent evaluator reproduce installable reach,
   working reach and the maximum installed footprint. A Play catalogue model count is not REACH-90 evidence.
9. Upload only the exact non-preview AAB to an **internal testing** track first. Reconcile Play-generated splits,
   installed size, device-catalog exclusions, the pre-launch report and 16 KB findings before any promotion.

## Play Console checklist

* Store listing copy, screenshots and graphics: `docs/STORE_LISTING.md`.
* App content: privacy policy URL (hosted `PRIVACY_AND_CONSENT` summary), Data safety form (answers in
  `docs/STORE_LISTING.md`), ads (**No**: the ads adapter is disabled), in-app purchases (**none at launch**: billing is
  disabled), target audience 13+ and not designed for children, content rating questionnaire (no violence, no gambling,
  users interact through preset banter and reactions, and free-text room chat is off).
* Countries: India first. Pricing: free.
* Release notes: one line per user-visible change, never mentioning unreleased features.

## Versioning and rollback

* Bump `versionCode` for every upload and `versionName` together with `package.json` `version`.
* Play cannot roll back a released version. To revert, ship the previous code with a higher `versionCode`. Server-side
  kill switches (`VITE_KILL_ONLINE`, Worker route removal, engine version pinning) cover the backend
  (`docs/INFRASTRUCTURE.md`).
* Replays are versioned by engine. A new engine version keeps old versions in the registry, so old replays still verify.
