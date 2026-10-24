#!/usr/bin/env bash
# Builds the Android release APK (for device testing) and the signed AAB (for Play distribution).
# Usage: scripts/build-android.sh [--skip-web]
#   --skip-web   reuse the existing dist/ instead of running `npm run build`
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
VERSION="$(node -p "require('$ROOT/package.json').version")"
VERSION_CODE="$(grep -E '^\s*versionCode' "$ROOT/android/app/build.gradle" | awk '{print $2}')"
OUT="$ROOT/release"

echo "▶ VANDE v$VERSION (versionCode $VERSION_CODE)"
echo "  JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

cd "$ROOT"
if [[ "${1:-}" != "--skip-web" ]]; then
  echo "▶ Building web bundle"
  npm run build
fi
if [[ ! -f dist/index.html ]]; then
  echo "✗ dist/index.html missing" >&2
  exit 1
fi

echo "▶ Syncing Capacitor"
npx cap sync android

if [[ ! -f android/keystore.properties ]]; then
  echo "⚠ android/keystore.properties not found: the AAB will be signed with the DEBUG key and cannot be uploaded to Play." >&2
fi

echo "▶ Gradle assembleRelease bundleRelease"
( cd android && ./gradlew --no-daemon --console=plain assembleRelease bundleRelease )

mkdir -p "$OUT"
APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
APK="$OUT/vande-$VERSION-$VERSION_CODE-release.apk"
AAB="$OUT/vande-$VERSION-$VERSION_CODE-release.aab"
cp "$APK_SRC" "$APK"
cp "$AAB_SRC" "$AAB"

BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
echo "▶ Signature check ($BUILD_TOOLS)"
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | head -4 || true

echo "▶ Artifacts"
ls -la "$APK" "$AAB"
shasum -a 256 "$APK" "$AAB" | tee "$OUT/SHA256SUMS-$VERSION-$VERSION_CODE.txt"
echo "✓ Done. Install for testing: $ANDROID_HOME/platform-tools/adb install -r \"$APK\""
