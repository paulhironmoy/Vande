#!/usr/bin/env bash
# Builds the Android release APK (device testing) and the signed AAB (Google Play).
#
# Usage: APP_LINKS_HOST=<domain> [APP_LINKS_BASE_PATH=] scripts/build-android.sh [--preview] [--unity]
#            [--camera-bundle] [--venue-bake] [--everything]
#   --skip-web   rejected: release candidates must rebuild and seal the web payload from the same source identity
#   --preview    a local test release: debug key allowed, preview App Links host; artifacts are named *-PREVIEW-* and
#                must never be uploaded
#   --unity      link the freshly verified Unity export; production selection remains gated by the accepted ADR
#   --camera-bundle  (needs --preview) package the camera pack (pose engine, worker, model) in the app: VITE_CAMERA_BUNDLED=1
#   --venue-bake     (needs --preview) package the baked venue GLB files in the app: VITE_VENUE_BAKED=1
#   --everything     (needs --preview) both of the above: the owner's sideload "everything" build, named *-EVERYTHING-*,
#                    labelled SIDELOAD-EVERYTHING, NOT A RELEASE. docs/ANDROID_RELEASE.md is the single source for these flags.
# The web bundle's own production values come from the environment (VITE_API_URL, VITE_PUBLIC_WEB_ORIGIN, ...).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
# Never let local device-testing switches reach a release bundle.
unset CAP_WEBVIEW_DEBUG CAP_LOCAL_HTTP

SKIP_WEB=0
PREVIEW=0
UNITY=0
CAMERA_BUNDLE=0
VENUE_BAKE=0
ENGINEERING_PREVIEW=0
for arg in "$@"; do
  case "$arg" in
    --skip-web) SKIP_WEB=1 ;;
    --preview) PREVIEW=1 ;;
    --unity) UNITY=1 ;;
    --camera-bundle) CAMERA_BUNDLE=1 ;;
    --venue-bake) VENUE_BAKE=1 ;;
    --everything) CAMERA_BUNDLE=1; VENUE_BAKE=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done
SIDELOAD=0
if [[ $CAMERA_BUNDLE == 1 || $VENUE_BAKE == 1 ]]; then SIDELOAD=1; fi
if [[ $SIDELOAD == 1 && $PREVIEW == 0 ]]; then
  # The optional payloads would put the camera pack and the baked venue into the first-ball install. A release candidate never carries them.
  echo "✗ --camera-bundle, --venue-bake and --everything build the owner's sideload test app and need --preview; a release candidate carries neither payload." >&2
  exit 2
fi
# The Unity export can carry the baked venue as a sideload add-on (made with VANDE_UNITY_VENUE=1; the receipt .vande-venue-addon.properties is
# written into the export folder, or kept beside it as Builds/Android.vande-venue-addon.properties because the sealed Gradle check of the export
# rejects any file in the folder that its receipt does not list). Only the owner's sideload build may bind such an export: a release candidate and
# the standard preview use the default one.
UNITY_EXPORT_DIR="$ROOT/unity/VandePractice/Builds/Android"
UNITY_VENUE_RECEIPT=""
for candidate in "$UNITY_EXPORT_DIR/.vande-venue-addon.properties" "$UNITY_EXPORT_DIR.vande-venue-addon.properties"; do
  if [[ -f $candidate ]]; then UNITY_VENUE_RECEIPT="$candidate"; break; fi
done
if [[ $UNITY == 1 && -n $UNITY_VENUE_RECEIPT ]]; then
  if [[ $PREVIEW == 0 || $VENUE_BAKE == 0 ]]; then
    echo "✗ The Unity export in unity/VandePractice/Builds/Android carries the sideload venue add-on ($UNITY_VENUE_RECEIPT), but this is not a --preview build with --venue-bake or --everything. A release candidate and the standard preview need the export made without VANDE_UNITY_VENUE." >&2
    exit 2
  fi
fi
# --- venue receipt move: begin (the policy tests in scripts/check-android-size.test.mjs run this exact block; the clone driver for the final build c sources it)
# Ruling R-56. The sealed Gradle check of the Unity export (android/settings.gradle) compares every file in Builds/Android with the files that
# .vande-export.properties lists and rejects any other, the venue receipt included. So for the Gradle run the receipt is moved BESIDE the folder
# (Builds/Android.vande-venue-addon.properties) and put back when the script ends; the EXIT trap below does that on a failure and on a signal too.
# A SIGKILL cannot be trapped: the receipt then stays beside the folder, where this script, the guard above and check-android-size.mjs find it.
VENUE_RECEIPT_INSIDE="$UNITY_EXPORT_DIR/.vande-venue-addon.properties"
VENUE_RECEIPT_BESIDE="$UNITY_EXPORT_DIR.vande-venue-addon.properties"
VENUE_RECEIPT_MOVED=0
venue_receipt_aside() {
  [[ -f $VENUE_RECEIPT_INSIDE ]] || return 0
  if [[ -e $VENUE_RECEIPT_BESIDE ]]; then
    echo "✗ The venue receipt exists both inside ($VENUE_RECEIPT_INSIDE) and beside ($VENUE_RECEIPT_BESIDE) the Unity export; remove one of them." >&2
    return 1
  fi
  mv -- "$VENUE_RECEIPT_INSIDE" "$VENUE_RECEIPT_BESIDE" || return 1
  VENUE_RECEIPT_MOVED=1
  echo "  venue receipt moved beside the Unity export for the Gradle run ($VENUE_RECEIPT_BESIDE); it goes back when this script ends"
}
venue_receipt_restore() {
  [[ $VENUE_RECEIPT_MOVED == 1 ]] || return 0
  if [[ -f $VENUE_RECEIPT_BESIDE && ! -e $VENUE_RECEIPT_INSIDE ]]; then
    mv -- "$VENUE_RECEIPT_BESIDE" "$VENUE_RECEIPT_INSIDE" || { echo "✗ could not put the venue receipt back inside the Unity export: $VENUE_RECEIPT_BESIDE" >&2; return 1; }
    VENUE_RECEIPT_MOVED=0
    echo "  venue receipt put back inside the Unity export"
    return 0
  fi
  echo "✗ not putting the venue receipt back: it is missing beside the export, or a file already sits inside ($VENUE_RECEIPT_BESIDE, $VENUE_RECEIPT_INSIDE)" >&2
  return 1
}
# --- venue receipt move: end
if [[ $CAMERA_BUNDLE == 1 && -n "${VITE_CAMERA_MODEL_BASE_URL:-}" ]]; then
  echo "✗ --camera-bundle packages the pose files in the app, but VITE_CAMERA_MODEL_BASE_URL (download them from a host) is also set; pick one." >&2
  exit 2
fi
if [[ $PREVIEW == 1 && $UNITY == 1 ]]; then
  # A preview Unity build is deliberately marked unqualified so it can collect
  # the first native input/latency evidence. Production Unity candidates never
  # inherit this escape hatch, even if the operator's shell exports the flag.
  ENGINEERING_PREVIEW=1
fi
if [[ $SKIP_WEB == 1 ]]; then
  echo "✗ --skip-web is not permitted for a sealed Android candidate; rebuild from the current source tree." >&2
  exit 2
fi

# The sealed Unity invocation (android/settings.gradle) admits only an android/local.properties that holds exactly `sdk.dir`
# for the sealed SDK. That file is machine-local and gitignored, so a fresh checkout has none: create it, never overwrite one.
if [[ $UNITY == 1 && ! -e $ROOT/android/local.properties ]]; then
  printf 'sdk.dir=%s\n' "$ANDROID_HOME" > "$ROOT/android/local.properties"
fi

BUILD_ID_START="$("$ROOT/scripts/build-id.sh")"
if [[ ! $BUILD_ID_START =~ ^[0-9a-f]{7,40}(\+[0-9a-f]{12})?$ ]]; then
  echo "✗ Invalid repository build ID: $BUILD_ID_START" >&2
  exit 1
fi
BUILD_SLUG="${BUILD_ID_START/+/-dirty-}"

INVOCATION_DIR=""
INVOCATION_CONTRACT=""
TRANSFORM_MANIFEST=""
STAGING_DIR=""
GRADLE_USER_HOME_SEALED=""
APK_CANDIDATE=""
AAB_CANDIDATE=""
BINDING_CANDIDATE=""
SUMS_CANDIDATE=""
APK_SIGNATURE_REPORT=""
APK_NAME=""
AAB_NAME=""
BINDING_NAME=""
SUMS_NAME=""
PROMOTION_COMPLETE=0

cleanup_candidates() {
  venue_receipt_restore || true
  [[ -z $APK_CANDIDATE ]] || rm -f -- "$APK_CANDIDATE"
  [[ -z $AAB_CANDIDATE ]] || rm -f -- "$AAB_CANDIDATE"
  [[ -z $BINDING_CANDIDATE ]] || rm -f -- "$BINDING_CANDIDATE"
  [[ -z $SUMS_CANDIDATE ]] || rm -f -- "$SUMS_CANDIDATE"
  [[ -z $APK_SIGNATURE_REPORT ]] || rm -f -- "$APK_SIGNATURE_REPORT"
  [[ -z $STAGING_DIR || ! -d $STAGING_DIR ]] || rmdir "$STAGING_DIR" 2>/dev/null || true
  if [[ -n $INVOCATION_DIR && -d $INVOCATION_DIR && $INVOCATION_DIR == */vande-unity-invocation.* ]]; then
    rm -rf -- "$INVOCATION_DIR"
  fi
}
trap cleanup_candidates EXIT
# A signal ends the script through exit, so the EXIT trap above always runs: the venue receipt goes back inside the export after Ctrl-C or kill too.
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
if [[ $UNITY == 1 ]]; then
  venue_receipt_aside
  if [[ -f $VENUE_RECEIPT_BESIDE ]]; then UNITY_VENUE_RECEIPT="$VENUE_RECEIPT_BESIDE"; fi
fi

VERSION="$(node -p "require('$ROOT/package.json').version")"
VERSION_CODE="$(grep -E '^\s*versionCode' "$ROOT/android/app/build.gradle" | awk '{print $2}')"
OUT="$ROOT/release"
mkdir -p "$OUT"
GRADLE_PROPS=()
if [[ $PREVIEW == 1 ]]; then
  GRADLE_PROPS+=("-PpreviewRelease=true")
  TAG="-PREVIEW"
  PREVIEW_LABEL=" — PREVIEW, never upload"
  BUILD_MODE="preview"
else
  if [[ -z "${APP_LINKS_HOST:-}" ]]; then
    echo "✗ Set APP_LINKS_HOST=<production domain> (and APP_LINKS_BASE_PATH if the app is not at the domain root), or pass --preview." >&2
    exit 1
  fi
  GRADLE_PROPS+=("-PappLinksBasePath=${APP_LINKS_BASE_PATH:-}" "-PappLinksHost=$APP_LINKS_HOST")
  TAG=""
  PREVIEW_LABEL=""
  BUILD_MODE="release"
fi
GRADLE_PROPS+=("-PvandeUnity=$UNITY")
if [[ $UNITY == 1 ]]; then TAG="$TAG-UNITY"; fi
# The sideload payload flags show in the file name: scripts/check-android-size.mjs only exempts an add-on whose tag matches.
if [[ $CAMERA_BUNDLE == 1 && $VENUE_BAKE == 1 ]]; then TAG="$TAG-EVERYTHING"
elif [[ $CAMERA_BUNDLE == 1 ]]; then TAG="$TAG-CAMERA"
elif [[ $VENUE_BAKE == 1 ]]; then TAG="$TAG-VENUE"; fi
SIZE_ADDON_ARGS=()
COMPAT_ADDON_ARGS=()
if [[ $CAMERA_BUNDLE == 1 ]]; then SIZE_ADDON_ARGS+=(--addon camera); COMPAT_ADDON_ARGS+=(--allow-camera-payload); fi
if [[ $VENUE_BAKE == 1 ]]; then SIZE_ADDON_ARGS+=(--addon venue); COMPAT_ADDON_ARGS+=(--allow-venue-payload); fi
# The size check finds the venue's compiled Unity data files by comparing the bound export with a default export of the same source tree
# (Builds/Android.final-default while the sideload export is swapped in; without it those few files stay in the counted remainder).
if [[ $UNITY == 1 && $VENUE_BAKE == 1 ]]; then
  SIZE_ADDON_ARGS+=(--unity-export "$UNITY_EXPORT_DIR")
  if [[ -n $UNITY_VENUE_RECEIPT ]]; then SIZE_ADDON_ARGS+=(--unity-venue-receipt "$UNITY_VENUE_RECEIPT"); fi
  if [[ -f $ROOT/unity/VandePractice/Builds/Android.final-default/.vande-export.properties ]]; then
    SIZE_ADDON_ARGS+=(--unity-default-export "$ROOT/unity/VandePractice/Builds/Android.final-default")
  fi
fi

# GRADLE_USER_HOME is a brand-new invocation-local directory below. The first
# configuration pass must be allowed to resolve the pinned build plugins into
# that isolated cache; `--offline` here makes every clean sealed invocation
# impossible before the actual build starts. The exact arguments and isolated
# home remain recorded in the invocation contract, and the main task vector is
# still independently sealed by android/settings.gradle.
PREFLIGHT_ARGS=(--no-daemon --console=plain --max-workers=2 -PvandeUnity=1 help)
WEB_ARGS=(npm run build)
SYNC_ARGS=(npx cap sync android)
GRADLE_SEALED_SYSTEM_PROPS=(
  -Dfile.encoding=UTF-8
  -Duser.country=US
  -Duser.language=en
  -Duser.variant=
)
GRADLE_ARGS=(--no-daemon --console=plain --max-workers=2 "${GRADLE_PROPS[@]}" assembleRelease bundleRelease)
if [[ $UNITY == 1 ]]; then
  for forbidden_variable in GRADLE_OPTS GRADLE_USER_HOME JAVA_OPTS JAVA_TOOL_OPTIONS JDK_JAVA_OPTIONS _JAVA_OPTIONS; do
    if [[ -n ${!forbidden_variable:-} ]]; then
      echo "✗ Unity binding rejects inherited $forbidden_variable; use the sealed invocation only." >&2
      exit 1
    fi
  done
  while IFS='=' read -r variable _; do
    if [[ $variable == ORG_GRADLE_PROJECT_* ]]; then
      echo "✗ Unity binding rejects inherited $variable; pass only the sealed Gradle properties." >&2
      exit 1
    fi
  done < <(env)

  INVOCATION_ID="$(node -p "require('node:crypto').randomBytes(16).toString('hex')")"
  if [[ ! $INVOCATION_ID =~ ^[0-9a-f]{32}$ ]]; then
    echo "✗ Cannot create a valid Unity invocation identity." >&2
    exit 1
  fi
  # One source revision may be built repeatedly. Keep every provenance set
  # unique so a later invocation can never overwrite an earlier binding.
  TAG="$TAG-$INVOCATION_ID"
  TEMP_ROOT="${TMPDIR:-/tmp}"
  TEMP_ROOT="${TEMP_ROOT%/}"
  INVOCATION_DIR="$(mktemp -d "$TEMP_ROOT/vande-unity-invocation.XXXXXX")"
  INVOCATION_DIR="$(cd "$INVOCATION_DIR" && pwd -P)"
  GRADLE_USER_HOME_SEALED="$INVOCATION_DIR/gradle-user-home"
  mkdir "$GRADLE_USER_HOME_SEALED"
  GRADLE_USER_HOME_SEALED="$(cd "$GRADLE_USER_HOME_SEALED" && pwd -P)"
  export GRADLE_USER_HOME="$GRADLE_USER_HOME_SEALED"
  INVOCATION_CONTRACT="$INVOCATION_DIR/unity-build-input.json"
  TRANSFORM_MANIFEST="$ROOT/android/app/build/outputs/vande-unity-binding/release/$INVOCATION_ID.json"
  GRADLE_PROPS+=(
    "-PvandeUnityBinding=1"
    "-PvandeUnityInvocationContract=$INVOCATION_CONTRACT"
    "-PvandeUnityInvocationId=$INVOCATION_ID"
    "-PvandeUnitySourceBuildId=$BUILD_ID_START"
  )
  GRADLE_ARGS=(
    --no-daemon --console=plain --max-workers=2
    "${GRADLE_SEALED_SYSTEM_PROPS[@]}"
    "${GRADLE_PROPS[@]}"
    assembleRelease bundleRelease :app:writeVandeUnityPayloadTransformManifest
  )

  BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -1)"
  if [[ -z $BUILD_TOOLS || ! -x $BUILD_TOOLS/apksigner || ! -x $JAVA_HOME/bin/jarsigner || ! -x $JAVA_HOME/bin/keytool ]]; then
    echo "✗ Sealed Android verifier toolchain is incomplete." >&2
    exit 1
  fi

  CONTRACT_ARGS=(
    create-invocation
    --root "$ROOT"
    --invocation-id "$INVOCATION_ID"
    --source-build-id "$BUILD_ID_START"
    --mode "$BUILD_MODE"
    --receipt "$ROOT/unity/VandePractice/Builds/Android/.vande-export.properties"
    --java-home "$JAVA_HOME"
    --android-home "$ANDROID_HOME"
    --gradle-user-home "$GRADLE_USER_HOME_SEALED"
    --apksigner "$BUILD_TOOLS/apksigner"
    --jarsigner "$JAVA_HOME/bin/jarsigner"
    --keytool "$JAVA_HOME/bin/keytool"
    --output "$INVOCATION_CONTRACT"
  )
  for argument in "${PREFLIGHT_ARGS[@]}"; do
    CONTRACT_ARGS+=(--preflight-arg "$argument")
  done
  for argument in "${WEB_ARGS[@]}"; do
    CONTRACT_ARGS+=(--web-arg "$argument")
  done
  CONTRACT_ARGS+=(
    --web-env "BUILD_ID=$BUILD_ID_START"
    --web-env "VITE_BUILD_TARGET=android"
    --web-env "VITE_UNITY_PRACTICE=$UNITY"
    --web-env "VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=$ENGINEERING_PREVIEW"
    --web-env "VITE_CAMERA_BUNDLED=$CAMERA_BUNDLE"
    --web-env "VITE_VENUE_BAKED=$VENUE_BAKE"
  )
  for argument in "${SYNC_ARGS[@]}"; do
    CONTRACT_ARGS+=(--sync-arg "$argument")
  done
  for argument in "${GRADLE_ARGS[@]}"; do
    CONTRACT_ARGS+=(--gradle-arg "$argument")
  done
  echo "▶ Sealing Unity build invocation $INVOCATION_ID"
  node "$ROOT/scripts/android-unity-payload-binding.mjs" "${CONTRACT_ARGS[@]}"
fi

echo "▶ VANDE Cricket v$VERSION (versionCode $VERSION_CODE, build $BUILD_ID_START, Unity=$UNITY, camera pack bundled=$CAMERA_BUNDLE, baked venue bundled=$VENUE_BAKE)$PREVIEW_LABEL"
if [[ $SIDELOAD == 1 ]]; then echo "  SIDELOAD-EVERYTHING, NOT A RELEASE: this app carries optional payloads that a default build must not; never upload it."; fi
echo "  JAVA_HOME=$JAVA_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1p'

cd "$ROOT"
echo "▶ Building sealed Android web bundle"
# Game only: the admin console, render page and WebGL Unity payload are web-only (vite.config.ts).
BUILD_ID="$BUILD_ID_START" VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE="$UNITY" \
  VITE_CAMERA_BUNDLED="$CAMERA_BUNDLE" VITE_VENUE_BAKED="$VENUE_BAKE" \
  VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW="$ENGINEERING_PREVIEW" "${WEB_ARGS[@]}"
if [[ ! -f dist/index.html ]]; then
  echo "✗ dist/index.html missing" >&2
  exit 1
fi
if find dist/unity -type f -print -quit 2>/dev/null | grep -q .; then
  echo "✗ Android web payload contains a duplicate Unity WebGL runtime." >&2
  exit 1
fi
# The optional payloads must be exactly as requested before Gradle spends minutes on them (scripts/check-android-size.mjs and
# check-android-release-compat.mjs then check the finished APK and AAB, which is the real gate).
if [[ $CAMERA_BUNDLE == 0 && -d dist/models ]] && find dist/models -type f -print -quit | grep -q .; then
  echo "✗ dist/models holds files in a build without --camera-bundle: the camera pack would reach the first-ball install." >&2
  exit 1
fi
if [[ $CAMERA_BUNDLE == 1 ]] && ! compgen -G "dist/models/pose/*/MANIFEST.json" >/dev/null; then
  echo "✗ --camera-bundle, but dist/models/pose/<id>/MANIFEST.json is missing: the camera pack was not built (see the [vande:camera-pack] warning above)." >&2
  exit 1
fi
HAS_GLB=0
if [[ -d dist/assets ]] && find dist/assets -name '*.glb' -print -quit | grep -q .; then HAS_GLB=1; fi
if [[ $VENUE_BAKE == 0 && $HAS_GLB == 1 ]]; then
  echo "✗ dist/assets holds .glb files in a build without --venue-bake: the baked venue would reach the first-ball install." >&2
  exit 1
fi
if [[ $VENUE_BAKE == 1 && $HAS_GLB == 0 ]]; then
  echo "✗ --venue-bake, but dist/assets holds no .glb file: the baked venue was not built." >&2
  exit 1
fi

echo "▶ Syncing Capacitor"
"${SYNC_ARGS[@]}"

if [[ $UNITY == 1 ]]; then
  # Runs after `cap sync` on purpose: android/app/capacitor.build.gradle applies the generated, gitignored
  # android/capacitor-cordova-android-plugins/cordova.variables.gradle, and android/app/src/main/assets/ is also created by
  # `cap sync`. On a fresh checkout Gradle cannot even configure the project before this point.
  echo "▶ Verifying the immutable Unity Android export"
  ( cd android && nice -n 15 ./gradlew "${PREFLIGHT_ARGS[@]}" )
fi

echo "▶ Gradle assembleRelease bundleRelease"
( cd android && nice -n 15 ./gradlew "${GRADLE_ARGS[@]}" )

if [[ $UNITY == 1 ]]; then
  echo "▶ Verifying Unity's literal JNI boundary survived R8"
  node "$ROOT/scripts/check-unity-r8.mjs" \
    --mapping "$ROOT/android/app/build/outputs/mapping/release/mapping.txt"
fi

BUILD_ID_END="$("$ROOT/scripts/build-id.sh")"
if [[ $BUILD_ID_END != "$BUILD_ID_START" ]]; then
  echo "✗ Source tree changed during Android build ($BUILD_ID_START → $BUILD_ID_END); artifacts are not sealed." >&2
  exit 1
fi

APK_SRC="android/app/build/outputs/apk/release/app-release.apk"
AAB_SRC="android/app/build/outputs/bundle/release/app-release.aab"
if [[ ! -f $APK_SRC || ! -f $AAB_SRC ]]; then
  echo "✗ Gradle did not produce both release artifacts." >&2
  exit 1
fi

APK_NAME="vande-cricket-$VERSION-$VERSION_CODE-$BUILD_SLUG$TAG-release.apk"
AAB_NAME="vande-cricket-$VERSION-$VERSION_CODE-$BUILD_SLUG$TAG-release.aab"
if [[ $UNITY == 1 ]]; then
  BINDING_NAME="vande-cricket-$VERSION-$VERSION_CODE-$BUILD_SLUG$TAG-payload-binding.json"
fi
SUMS_NAME="SHA256SUMS-$VERSION-$VERSION_CODE-$BUILD_SLUG$TAG.txt"
STAGING_DIR="$(mktemp -d "$OUT/.vande-android-candidate.XXXXXX")"
STAGING_DIR="$(cd "$STAGING_DIR" && pwd -P)"
APK_CANDIDATE="$STAGING_DIR/$APK_NAME"
AAB_CANDIDATE="$STAGING_DIR/$AAB_NAME"
if [[ $UNITY == 1 ]]; then
  BINDING_CANDIDATE="$STAGING_DIR/$BINDING_NAME"
fi
SUMS_CANDIDATE="$STAGING_DIR/$SUMS_NAME"
APK_SIGNATURE_REPORT="$STAGING_DIR/apksigner-report.txt"

echo "▶ Staging candidate outside release/ until every static gate passes"
cp "$APK_SRC" "$APK_CANDIDATE"
cp "$AAB_SRC" "$AAB_CANDIDATE"

echo "▶ Android size ceiling (45 MB headroom warning; 50 MB artifact failure)"
node "$ROOT/scripts/check-android-size.mjs" --warning-mb 45 --limit-mb 50 \
  --apk "$APK_CANDIDATE" --aab "$AAB_CANDIDATE" ${SIZE_ADDON_ARGS[@]+"${SIZE_ADDON_ARGS[@]}"}

BUILD_TOOLS="$(find "$ANDROID_HOME/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -1)"
echo "▶ Android static compatibility preflight ($BUILD_TOOLS)"
node "$ROOT/scripts/check-android-release-compat.mjs" \
  --apk "$APK_CANDIDATE" \
  --aab "$AAB_CANDIDATE" \
  --aapt2 "$BUILD_TOOLS/aapt2" \
  --zipalign "$BUILD_TOOLS/zipalign" ${COMPAT_ADDON_ARGS[@]+"${COMPAT_ADDON_ARGS[@]}"}

echo "▶ APK and AAB signature checks ($BUILD_TOOLS)"
if [[ $UNITY == 0 ]]; then
  "$BUILD_TOOLS/apksigner" verify --print-certs "$APK_CANDIDATE" > "$APK_SIGNATURE_REPORT"
  sed -n '1,4p' "$APK_SIGNATURE_REPORT"
  if ! LC_ALL=C "$JAVA_HOME/bin/jarsigner" -verify "$AAB_CANDIDATE" | grep -Fxq 'jar verified.'; then
    echo "✗ jarsigner rejected the AAB signature." >&2
    exit 1
  fi
else
  echo "  Unity candidate signatures are stable-snapshotted and receipt-bound by payload binding."
fi

if [[ $UNITY == 1 ]]; then
  if [[ ! -f $TRANSFORM_MANIFEST ]]; then
    echo "✗ Same-invocation Unity transform manifest is missing: $TRANSFORM_MANIFEST" >&2
    exit 1
  fi
  echo "▶ Binding exhaustive Unity assets/natives to the signed APK and AAB"
  node "$ROOT/scripts/android-unity-payload-binding.mjs" bind \
    --apk "$APK_CANDIDATE" \
    --aab "$AAB_CANDIDATE" \
    --contract "$INVOCATION_CONTRACT" \
    --transform-manifest "$TRANSFORM_MANIFEST" \
    --receipt "$ROOT/unity/VandePractice/Builds/Android/.vande-export.properties" \
    --source-build-id "$BUILD_ID_START" \
    --apksigner "$BUILD_TOOLS/apksigner" \
    --jarsigner "$JAVA_HOME/bin/jarsigner" \
    --keytool "$JAVA_HOME/bin/keytool" \
    --output "$BINDING_CANDIDATE"
fi

BUILD_ID_PROMOTE="$("$ROOT/scripts/build-id.sh")"
if [[ $BUILD_ID_PROMOTE != "$BUILD_ID_START" ]]; then
  echo "✗ Source tree changed before candidate promotion ($BUILD_ID_START → $BUILD_ID_PROMOTE)." >&2
  exit 1
fi

SUM_FILES=("$APK_NAME" "$AAB_NAME")
if [[ $UNITY == 1 ]]; then SUM_FILES+=("$BINDING_NAME"); fi
( cd "$STAGING_DIR" && shasum -a 256 "${SUM_FILES[@]}" > "$SUMS_NAME" )

echo "▶ Promoting validated candidate to release/ without overwrite"
PROMOTION_NAMES=("$APK_NAME" "$AAB_NAME" "$SUMS_NAME")
if [[ $UNITY == 1 ]]; then PROMOTION_NAMES+=("$BINDING_NAME"); fi
if [[ $UNITY == 1 ]]; then
  PROMOTION_ARGS=(promote-unity-set "$BINDING_CANDIDATE")
else
  PROMOTION_ARGS=(promote)
fi
for artifact_name in "${PROMOTION_NAMES[@]}"; do
  PROMOTION_ARGS+=("$STAGING_DIR/$artifact_name" "$OUT/$artifact_name")
done
node "$ROOT/scripts/android-exclusive-promote.mjs" "${PROMOTION_ARGS[@]}"
PROMOTION_COMPLETE=1

APK="$OUT/$APK_NAME"
AAB="$OUT/$AAB_NAME"
SUMS="$OUT/$SUMS_NAME"
if [[ $UNITY == 1 ]]; then BINDING="$OUT/$BINDING_NAME"; fi

echo "▶ Artifacts"
ARTIFACTS=("$APK" "$AAB")
if [[ $UNITY == 1 ]]; then ARTIFACTS+=("$BINDING"); fi
ls -la "${ARTIFACTS[@]}"
cat "$SUMS"
echo "✓ Done. Install for testing: $ANDROID_HOME/platform-tools/adb install -r \"$APK\""
if [[ $SIDELOAD == 1 ]]; then echo "  SIDELOAD-EVERYTHING, NOT A RELEASE: debug-key preview build for the owner's own phone; do not upload it."; fi
