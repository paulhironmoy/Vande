#!/usr/bin/env bash
# Android lifecycle smoke on an emulator or device: builds a DEBUG app that talks to the local API over
# `adb reverse`, runs scripts/android-lifecycle.mjs (HOME and process kill mid-innings), then resets the Android tree
# to a clean, non-debug bundle. Debug-only switches: CAP_WEBVIEW_DEBUG and CAP_LOCAL_HTTP at sync, and the debug
# network-security config (cleartext to 127.0.0.1 only). Release builds refuse all of them (android/app/build.gradle).
# Usage: scripts/android-lifecycle.sh [screenshot dir]   (needs a booted emulator/device; port 8787 free)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release/lifecycle}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
mkdir -p "$OUT"
cd "$ROOT"

cleanup() {
  [[ -n "${API_PID:-}" ]] && kill "$API_PID" 2>/dev/null || true
  "$ADB" reverse --remove tcp:8787 >/dev/null 2>&1 || true
  echo "▶ Resetting the Android tree to a clean bundle"
  VITE_BUILD_TARGET=android npx vite build >/dev/null
  env -u CAP_WEBVIEW_DEBUG -u CAP_LOCAL_HTTP npx cap sync android >/dev/null
}
trap cleanup EXIT

echo "▶ Debug build against the local API"
VITE_BUILD_TARGET=android VITE_API_LOCAL=1 npx vite build >/dev/null
CAP_WEBVIEW_DEBUG=1 CAP_LOCAL_HTTP=1 npx cap sync android >/dev/null
( cd android && ./gradlew --no-daemon --console=plain -q assembleDebug )
"$ADB" install -r android/app/build/outputs/apk/debug/app-debug.apk
"$ADB" reverse tcp:8787 tcp:8787

echo "▶ Local API"
node backend/local/serve.mjs --engine real > "$OUT/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do curl -sf http://127.0.0.1:8787/v1/health >/dev/null && break; sleep 1; done

echo "▶ Lifecycle run"
"$ADB" logcat -c || true
node scripts/android-lifecycle.mjs "$OUT"
