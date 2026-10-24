#!/usr/bin/env bash
# Boots the headless emulator (or uses a connected device), installs the APK, launches VANDE,
# captures screenshots, presses hardware Back, and fails on any crash/ANR in logcat.
# Usage: scripts/android-smoke.sh release/vande-1.0.0-1-release.apk
set -euo pipefail

APK="${1:?usage: scripts/android-smoke.sh <path-to-apk>}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
AVD="${AVD:-vybe-pixel-api36-arm64}"
PKG="in.vande.republic"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
OUT="${OUT:-release/smoke}"
mkdir -p "$OUT"

"$ADB" start-server >/dev/null
if ! "$ADB" devices | tail -n +2 | grep -qE "^(emulator-[0-9]+|[0-9A-Za-z._:-]+)[[:space:]]+(device|offline)"; then
  echo "▶ Booting emulator $AVD (headless)…"
  nohup "$EMU" -avd "$AVD" -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot-save \
    > "$OUT/emulator.log" 2>&1 &
  echo $! > "$OUT/emulator.pid"
fi

"$ADB" wait-for-device
echo "▶ Waiting for boot…"
for _ in $(seq 1 150); do
  if [[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]]; then break; fi
  sleep 2
done
[[ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == "1" ]] || { echo "✗ emulator did not boot"; exit 1; }
"$ADB" shell input keyevent 82 >/dev/null 2>&1 || true
echo "  device: $("$ADB" shell getprop ro.product.model | tr -d '\r') · Android $("$ADB" shell getprop ro.build.version.release | tr -d '\r')"

echo "▶ Installing $APK"
"$ADB" install -r -g "$APK"
"$ADB" logcat -c || true

echo "▶ Launching"
"$ADB" shell am start -W -n "$PKG/.MainActivity" | tr -d '\r' | grep -E "Status|TotalTime" || true
sleep 10
"$ADB" exec-out screencap -p > "$OUT/01-launch.png"
"$ADB" shell input tap 540 1800 >/dev/null 2>&1 || true   # generic tap near the primary action area
sleep 3
"$ADB" exec-out screencap -p > "$OUT/02-after-tap.png"
echo "▶ Hardware Back"
"$ADB" shell input keyevent KEYCODE_BACK
sleep 2
"$ADB" exec-out screencap -p > "$OUT/03-after-back.png"

echo "▶ Checking logcat for crashes"
if "$ADB" logcat -d | grep -E "FATAL EXCEPTION|Process $PKG .*has died|ANR in $PKG" ; then
  echo "✗ crash or ANR detected"; exit 1
fi
if "$ADB" shell pidof "$PKG" >/dev/null 2>&1; then
  echo "✓ $PKG is running (pid $("$ADB" shell pidof "$PKG" | tr -d '\r'))"
else
  echo "ℹ app process not in foreground after Back (expected if Back left the launch screen)"
fi
"$ADB" logcat -d | grep -iE "chromium|console" | tail -20 > "$OUT/webview-console.log" || true
echo "✓ Smoke test complete — screenshots in $OUT"
