#!/usr/bin/env bash
# Android Practice smoke and lifecycle on an emulator or device: builds a DEBUG app (WebView debugging on, offline,
# no API), installs it over any existing install (data is kept: never `pm clear`, never uninstall), runs
# scripts/android-practice.mjs, then resets the Android tree to a clean, non-debug bundle.
# The web bundle is built into dist-android (CAP_WEB_DIR), so the e2e suites' dist/ is never touched.
# Usage: scripts/android-practice.sh [screenshot dir]   (needs a booted emulator or a device with USB debugging)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release/practice-android}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
mkdir -p "$OUT"
cd "$ROOT"

cleanup() {
  echo "▶ Resetting the Android tree to a clean bundle"
  CAP_WEB_DIR=dist-android env -u CAP_WEBVIEW_DEBUG -u CAP_LOCAL_HTTP npx cap sync android >/dev/null
}
trap cleanup EXIT

echo "▶ Debug build (offline Practice)"
VITE_BUILD_TARGET=android npx vite build --outDir dist-android --emptyOutDir >/dev/null
CAP_WEB_DIR=dist-android CAP_WEBVIEW_DEBUG=1 npx cap sync android >/dev/null
( cd android && ./gradlew --no-daemon --console=plain -q assembleDebug )
ls -la android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk

echo "▶ Practice lifecycle run"
"$ADB" logcat -c || true
node scripts/android-practice.mjs "$OUT"
