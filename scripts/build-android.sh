#!/usr/bin/env bash
# Builds the Android release APK (device testing) and the signed AAB (Google Play).
#
# Usage: APP_LINKS_HOST=<domain> [APP_LINKS_BASE_PATH=] scripts/build-android.sh [--skip-web] [--preview]
#   --skip-web   reuse the existing dist/ instead of running `npm run build` (it must be a VITE_BUILD_TARGET=android build)
#   --preview    a local test release: debug key allowed, preview App Links host; artifacts are named *-PREVIEW-* and
#                must never be uploaded
# The web bundle's own production values come from the environment (VITE_API_URL, VITE_PUBLIC_WEB_ORIGIN, ...).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Never let local device-testing switches reach a release bundle.
unset CAP_WEBVIEW_DEBUG CAP_LOCAL_HTTP

SKIP_WEB=0
PREVIEW=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --preview) PREVIEW=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

VERSION="$(node -p "require('$ROOT/package.json').version")"
VERSION_CODE="$(grep -E '^\s*versionCode' "$ROOT/android/app/build.gradle" | awk '{print $2}')"
OUT="$ROOT/release"
GRADLE_PROPS=()
if [[ $PREVIEW == 1 ]]; then
  GRADLE_PROPS+=("-PpreviewRelease")
  TAG="-PREVIEW"
else
  if [[ -z "${APP_LINKS_HOST:-}" ]]; then
    echo "✗ Set APP_LINKS_HOST=<production domain> (and APP_LINKS_BASE_PATH if the app is not at the domain root), or pass --preview." >&2
    exit 1
  fi
  GRADLE_PROPS+=("-PappLinksHost=$APP_LINKS_HOST" "-PappLinksBasePath=${APP_LINKS_BASE_PATH:-}")
  TAG=""
fi

echo "▶ VANDE Cricket v$VERSION (versionCode $VERSION_CODE)${TAG:+ — PREVIEW, never upload}"
echo "  JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

cd "$ROOT"
if [[ $SKIP_WEB == 0 ]]; then
  echo "▶ Building web bundle"
  # Game only: the admin console and render page are web-only (vite.config.ts).
  VITE_BUILD_TARGET=android npm run build
fi
if [[ ! -f dist/index.html ]]; then
  echo "✗ dist/index.html missing" >&2
  exit 1
fi

echo "▶ Syncing Capacitor"
npx cap sync android

echo "▶ Gradle assembleRelease bundleRelease"
( cd android && ./gradlew --no-daemon --console=plain "${GRADLE_PROPS[@]}" assembleRelease bundleRelease )

mkdir -p "$OUT"
APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
APK="$OUT/vande-cricket-$VERSION-$VERSION_CODE$TAG-release.apk"
AAB="$OUT/vande-cricket-$VERSION-$VERSION_CODE$TAG-release.aab"
cp "$APK_SRC" "$APK"
cp "$AAB_SRC" "$AAB"

BUILD_TOOLS="$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)"
echo "▶ Signature check ($BUILD_TOOLS)"
"$BUILD_TOOLS/apksigner" verify --print-certs "$APK" | head -4 || true

echo "▶ Artifacts"
ls -la "$APK" "$AAB"
shasum -a 256 "$APK" "$AAB" | tee "$OUT/SHA256SUMS-$VERSION-$VERSION_CODE$TAG.txt"
echo "✓ Done. Install for testing: $ANDROID_HOME/platform-tools/adb install -r \"$APK\""
