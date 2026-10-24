# VANDE — Android Build & Signing

The Android app is the production web build wrapped by Capacitor 8 (`android/`). It runs fully offline and requests
only the `INTERNET` permission (used solely to load nothing — all assets are bundled; the permission is required by the
Capacitor WebView).

## Environment (this machine)

| Item | Value |
| --- | --- |
| Capacitor | `@capacitor/core` 8.5.x, `@capacitor/android` 8.5.x, plugins: app, haptics, share, filesystem, splash-screen, status-bar |
| JDK | 21 — `/Applications/Android Studio.app/Contents/jbr/Contents/Home` (Capacitor 8 / AGP 8.13 need JDK 21) |
| Android SDK | `/Users/hironmoy/Library/Android/sdk` (written to `android/local.properties`, gitignored) |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 (see `android/variables.gradle`) |
| Gradle / AGP | 8.14.3 (wrapper) / 8.13.0 |
| Application id | `in.vande.republic` |
| Emulator | AVD `vybe-pixel-api36-arm64` (Android 16 / API 36, arm64; use `-gpu host` on Apple silicon) |

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
```

## Build

```bash
npm run build && npx cap sync android          # copy dist/ into the Android project
cd android
./gradlew assembleDebug                        # app/build/outputs/apk/debug/app-debug.apk
./gradlew assembleRelease                      # app/build/outputs/apk/release/app-release.apk (signed with the upload key)
./gradlew bundleRelease                        # app/build/outputs/bundle/release/app-release.aab (Play upload)
```

Or in one step with artefacts copied to `release/` and SHA-256 sums printed: `scripts/build-android.sh`.

`npx cap open android` opens the project in Android Studio (optional; nothing requires the IDE).

## Signing — where the secrets are

Release builds are signed by the **upload keystore**. These files are gitignored and must be backed up to an encrypted
location (password manager + offline copy). Losing them blocks future updates (see `docs/ROLLBACK.md → Keystore loss`).

| Secret | Location |
| --- | --- |
| Upload keystore (PKCS12) | `android/keystore/vande-upload.jks` |
| Store/key password, alias | `android/keystore.properties` (`storeFile`, `storePassword`, `keyAlias=vande-upload`, `keyPassword`) |
| Copy of the credentials | `android/keystore/SECRETS.md` |
| Key details | RSA 2048, SHA256withRSA, validity 10 000 days, DN `CN=VANDE Upload Key, OU=VANDE, O=VANDE, L=Kolkata, ST=West Bengal, C=IN` |

`android/app/build.gradle` reads `keystore.properties` at configuration time. If the file or the keystore is missing,
release builds fall back to the **debug** key and Gradle prints a warning — such builds install for testing but Play
rejects them.

Print the certificate fingerprints (needed when enrolling in Play App Signing):

```bash
keytool -list -v -keystore android/keystore/vande-upload.jks -alias vande-upload \
  -storepass "$(grep storePassword android/keystore.properties | cut -d= -f2)" | grep -E "SHA1|SHA256"
```

## Play Console submission

1. Create the app (*VANDE: Republic Under Pressure*, Game → Strategy/Educational, free, no ads, no in-app purchases).
2. *Setup → App signing*: choose **Use Google-generated key** and upload the `.aab`; Google records the upload key from
   the bundle's signature.
3. Upload `release/vande-<version>-<code>-release.aab` to **Internal testing** first; install from the opt-in link.
4. Complete Data safety (no data collected or shared; all data on-device), Content rating, Target audience, and attach
   the Privacy page URL (`https://paulhironmoy.github.io/Vande/about/privacy`).
5. Promote to Production with a staged rollout (e.g. 20 % → 100 %).

## Emulator smoke test (headless)

Scripted: `scripts/android-smoke.sh release/vande-<version>-<code>-release.apk` boots the AVD if needed, installs,
launches, captures screenshots to `release/smoke/`, presses hardware Back and fails on any crash/ANR in logcat.

Use **host GPU** on Apple-silicon Macs. With `-gpu swiftshader_indirect` (software GL) the WebView logs
`tile memory limits exceeded` and screens can lag or ghost; with `-gpu host` (Metal translator) the game renders and
animates normally. The script defaults to `swiftshader_indirect` for CI portability; for visual checks start the
emulator yourself first:

```bash
emulator -avd vybe-pixel-api36-arm64 -no-window -no-audio -no-boot-anim -gpu host -no-snapshot-save &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
scripts/android-smoke.sh release/vande-1.0.0-1-release.apk
# Manual flow (1080×2400 Pixel-class AVD; coordinates are physical pixels)
adb shell input tap 540 2108   # Intro → "Begin your first crisis"
adb shell input tap 540 2230   # Opponents → "Begin chapter 1"
adb shell input tap 540 2250   # Briefing → "Take command"
adb shell input keyevent KEYCODE_BACK   # during play: pauses (pause sheet), does not leave the chapter
adb exec-out screencap -p > release/smoke/play.png
adb shell dumpsys activity activities | grep topResumedActivity
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime|CONSOLE|tile memory"
adb emu kill
```

Hardware Back is handled in the web layer through Capacitor's `App.addListener('backButton')` → the app's `back()`:
during a running chapter it pauses; on secondary screens it returns to Home; on Home it calls `App.exitApp()`.

### Verified release 1.0.0 (versionCode 1) — 23 Oct 2026

| Check | Result |
| --- | --- |
| Build | `scripts/build-android.sh --skip-web` — Gradle 8.14.3 / AGP 8.13.0 / JDK 21.0.10, `BUILD SUCCESSFUL in 1m 20s` |
| Artifacts | `release/vande-1.0.0-1-release.apk` 6.73 MB · `release/vande-1.0.0-1-release.aab` 6.66 MB · sums in `release/SHA256SUMS-1.0.0-1.txt` |
| Signature | APK v1+v2 and AAB signed by the upload key `CN=VANDE Upload Key, OU=VANDE, O=VANDE, L=Kolkata, ST=West Bengal, C=IN` (SHA-256 `26:B1:3E:5A:…:7B:85:A0`, valid to 2054) |
| Device | AVD `vybe-pixel-api36-arm64` — sdk_gphone64_arm64, Android 16 (API 36), WebView 133.0.6943.137, 1080×2400 |
| Install / launch | `adb install -r -g` → Success; `am start -W` Status ok, TotalTime 3.0–4.3 s (host GPU); `versionCode=1 versionName=1.0.0`; launcher activity `in.vande.republic/.MainActivity` |
| Screens | Intro, Home, Settings, opponent selection, briefing, gameplay (PixiJS WebGL map, timer, decisions, evidence tray) all render with correct fonts and layout |
| Back | Settings → Home ✓ · Opponents → Home ✓ · during play → pause sheet ✓ · Home → app leaves foreground (launcher resumed) ✓ |
| Logcat | No FATAL/ANR, no JS console errors, no asset 404s. Benign: `GL_INVALID_ENUM GetIntegerv` (PixiJS capability probe), `tile memory limits exceeded` (see note above; also seen briefly on host GPU while the opponent cards animate in) |
| Rendering | gfxinfo over the session: 2 247 frames, 13.5 % janky on the emulator (not representative of hardware) |

Known limitations observed on the emulator (web-layer items, tracked by the integrator): sticky footers on the
briefing and opponent screens let the card text behind them show through; `backdrop-filter` on static cards is the
likely source of the WebView tile-memory warnings.

## Troubleshooting

* `Unsupported class file major version` / `invalid source release 21` → `JAVA_HOME` is not JDK 21.
* `SDK location not found` → create `android/local.properties` with `sdk.dir=/Users/hironmoy/Library/Android/sdk`.
* `Could not resolve com.android.tools.build:gradle:8.13.0` → first build needs network access to Google's Maven.
* Splash/launcher icons look stale → `npx capacitor-assets generate --android` (sources in `resources/`) then rebuild.
* WebView shows a blank page → make sure `npm run build` produced `dist/` with base `/` (not `/Vande/`) before `cap sync`.
