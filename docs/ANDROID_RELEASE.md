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
| Permissions (merged manifest) | `INTERNET`, `ACCESS_NETWORK_STATE`; `POST_NOTIFICATIONS` (asked only after a meaningful moment, never on first launch); `VIBRATE` (haptics); FCM's `WAKE_LOCK` and `c2dm.permission.RECEIVE`; the Play install referrer's `BIND_GET_INSTALL_REFERRER_SERVICE`; AndroidX's app-private `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No location, contacts, camera, storage or advertising id |
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
