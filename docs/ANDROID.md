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
| Emulator | AVD `vybe-pixel-api36-arm64` |

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

```bash
emulator -avd vybe-pixel-api36-arm64 -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 3; done
adb install -r android/app/build/outputs/apk/release/app-release.apk     # or the debug APK
adb logcat -c
adb shell am start -n in.vande.republic/.MainActivity
sleep 8
adb shell dumpsys activity activities | grep -E "mResumedActivity|topResumedActivity"  # app in foreground
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime|Capacitor/Console" | head -40  # no crashes, console output
adb exec-out screencap -p > release/smoke-android.png                                  # visual check
adb shell input keyevent KEYCODE_BACK                                                  # Back navigation
adb emu kill
```

Hardware Back is handled in the web layer through Capacitor's `App.addListener('backButton')` → the app's `back()`;
on the Home screen it minimises the app (`App.minimizeApp()`) instead of exiting abruptly.

## Troubleshooting

* `Unsupported class file major version` / `invalid source release 21` → `JAVA_HOME` is not JDK 21.
* `SDK location not found` → create `android/local.properties` with `sdk.dir=/Users/hironmoy/Library/Android/sdk`.
* `Could not resolve com.android.tools.build:gradle:8.13.0` → first build needs network access to Google's Maven.
* Splash/launcher icons look stale → `npx capacitor-assets generate --android` (sources in `resources/`) then rebuild.
* WebView shows a blank page → make sure `npm run build` produced `dist/` with base `/` (not `/Vande/`) before `cap sync`.
