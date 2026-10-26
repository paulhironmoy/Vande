# Android release

VANDE Cricket ships to Google Play as a Capacitor 8 app. The Android app is a native shell around the same web build
as the PWA, plus three native plugins (Play Install Referrer, Keystore-backed secure storage, Google sign-in through
Credential Manager) and FCM push.

| | |
| --- | --- |
| Application id | `in.vande.cricket` (new; the civic prototype's `in.vande.republic` was never published) |
| Version | `versionName` in `android/app/build.gradle` (keep equal to `package.json` `version`), `versionCode` +1 per upload |
| SDK levels | min 24, target 36, compile 36 (`android/variables.gradle`) |
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
APP_LINKS_HOST=<domain> APP_LINKS_BASE_PATH= scripts/build-android.sh   # web build + cap sync + signed APK and AAB
scripts/build-android.sh --preview                                         # local test release: never upload
```

The script is the only supported way to build a release:

* it clears the local-testing switches (`CAP_WEBVIEW_DEBUG`, `CAP_LOCAL_HTTP`);
* it syncs Capacitor;
* it passes the App Links host to Gradle;
* it names preview artifacts `*-PREVIEW-*`.

Gradle's `verifyReleaseInputs` task (android/app/build.gradle) also refuses a release build that has no upload
keystore, no explicit `-PappLinksHost`, WebView debugging or mixed content switched on, or a web bundle that talks to a
local API. Preview builds (`-PpreviewRelease`) only warn.

Artifacts land in `release/` (gitignored):

* `vande-cricket-<version>-<code>-release.aab`: upload this.
* `…-release.apk`: for device testing.
* `SHA256SUMS-<version>-<code>.txt`.

The script prints `apksigner` certificate details. Check that the signer is `CN=VANDE Upload Key`, not the debug key.

`VITE_BUILD_TARGET=android` (set by the script) leaves the web-only pages (admin console, highlight render page) and
the web-only social card images out of the app bundle. The privacy and account-deletion pages ship in every build.

R8 and resource shrinking are off for 1.0.0, because Capacitor plugins load through reflection and most of the
size is the web bundle. Enabling them needs a full pass of `scripts/android-lifecycle.sh` on a minified build.

Firebase is configured not to create an installation id or token until the player turns notifications on (manifest
`firebase_messaging_auto_init_enabled=false`; the push plugin enables it on `register()`).

## Verify before uploading

1. `npm run typecheck:all`, `npm test`, `npm run test:render`, `npm run test:e2e` and `npm run test:flow` pass.
2. Smoke on the emulator or a device: `scripts/android-smoke.sh release/vande-cricket-<version>-<code>-release.apk`.
   It boots the AVD if no device is connected, installs, launches, taps, presses Back, captures screenshots in
   `release/smoke/`, and fails on any crash or ANR in logcat.
3. Lifecycle on the emulator or a device: `scripts/android-lifecycle.sh` builds a debug app wired to the local API over
   `adb reverse` and drives the real WebView with Playwright. It signs up, plays Daily Six, presses Home mid-ball and
   returns, kills the process mid-ball and relaunches (the same attempt resumes), then finishes with a verified result
   and checks logcat. The Android tree is reset to a clean bundle afterwards.
4. On a real mid-range phone, check:
   * the first Training over
   * a Friend Duel opened from a WhatsApp link, both with the app installed (App Link) and without it (web → install →
     the install referrer restores the invite)
   * locking and batting with flight mode toggled mid-innings (the outbox resends; the result stays sealed)
   * push permission asked only after the first duel
   * hardware Back on every screen
   * the 2D fallback with Low quality
   * TalkBack on the planner and the reveal
5. Upload the AAB to an **internal testing** track first and read the Play pre-launch report (crashes, accessibility,
   security warnings) before promoting.

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
