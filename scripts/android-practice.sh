#!/usr/bin/env bash
# Android Practice smoke, lifecycle and optional performance diagnostics. Builds a debug app, installs over the
# existing app without clearing data, and drives only the selected device. The default Stage 0 build has HOOKS=0.
#
# Usage: scripts/android-practice.sh [evidence dir] [android-practice.mjs flags]
# Environment:
#   ANDROID_SERIAL=<serial>  required when more than one ready device is attached
#   BOOT=1                   boot AVD when no device is attached; AVD=<name>, CORES=<n>, EMULATOR_PORT=<even port>,
#                            RAM_MB=<MiB>, BOOT_TIMEOUT_SEC=<seconds>
#   HOOKS=1                  preserve the optional Practice diagnostic API (never used by the default Stage 0 run)
#   SKIP_BUILD=1             reuse the existing APK; requires EXPECTED_BUILD_ID=<exact embedded source identity>
#   EXPECTED_BUILD_ID=<id>   required with SKIP_BUILD; optional assertion for a fresh build
#   UNITY=1                  opt in to the verified Unity Practice export for both web and Gradle builds
#   ARTIFACT_MODE=sealed     use only an admitted release APK; requires absolute APK_PATH, EXPECTED_APK_SHA256,
#                            EXPECTED_BUILD_ID, absolute UNITY_PAYLOAD_BINDING_PATH, its exact
#                            EXPECTED_UNITY_PAYLOAD_BINDING_SHA256, UNITY=1, HOOKS=0 and explicit
#                            ANDROID_SERIAL. Never builds/syncs.
#   REQUIRE_PACKAGE_ABSENT=1 sealed mode must prove the package absent before its sole `adb install -r` operation
#   ANDROID_ADB_SERVER_ADDRESS=127.0.0.1 and a non-default ANDROID_ADB_SERVER_PORT are mandatory in sealed mode;
#                            use a dedicated server with ADB_LOCAL_TRANSPORT_MAX_PORT=5553 and
#                            ADB_MDNS_AUTO_CONNECT=0 so Playwright cannot enumerate unrelated devices;
#                            ADB_SERVER_SOCKET must be unset because it overrides the explicit endpoint
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/release/practice-android}"
[ $# -gt 0 ] && shift
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
AVD="${AVD:-vybe-pixel-api36-arm64}"
BOOT_TIMEOUT_SEC="${BOOT_TIMEOUT_SEC:-180}"
EMULATOR_PORT="${EMULATOR_PORT:-5554}"
export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
UNITY="${UNITY:-0}"
SKIP_BUILD="${SKIP_BUILD:-0}"
HOOKS="${HOOKS:-0}"
ARTIFACT_MODE="${ARTIFACT_MODE:-debug}"
REQUIRE_PACKAGE_ABSENT="${REQUIRE_PACKAGE_ABSENT:-0}"
SEALED=0
if [ "$UNITY" != 0 ] && [ "$UNITY" != 1 ]; then
  echo "UNITY must be exactly 0 or 1 (received '$UNITY')." >&2
  exit 2
fi
if [ "$SKIP_BUILD" != 0 ] && [ "$SKIP_BUILD" != 1 ]; then
  echo "SKIP_BUILD must be exactly 0 or 1 (received '$SKIP_BUILD')." >&2
  exit 2
fi
if [ "$HOOKS" != 0 ] && [ "$HOOKS" != 1 ]; then
  echo "HOOKS must be exactly 0 or 1 (received '$HOOKS')." >&2
  exit 2
fi
if [ "$REQUIRE_PACKAGE_ABSENT" != 0 ] && [ "$REQUIRE_PACKAGE_ABSENT" != 1 ]; then
  echo "REQUIRE_PACKAGE_ABSENT must be exactly 0 or 1 (received '$REQUIRE_PACKAGE_ABSENT')." >&2
  exit 2
fi
case "$ARTIFACT_MODE" in
  debug) ;;
  sealed)
    SEALED=1
    SKIP_BUILD=1
    if [ "${BOOT:-0}" != 0 ]; then
      echo "ARTIFACT_MODE=sealed refuses BOOT=1; boot and own the target separately." >&2
      exit 2
    fi
    if [ -z "${ANDROID_SERIAL:-}" ]; then
      echo "ARTIFACT_MODE=sealed requires an explicit ANDROID_SERIAL." >&2
      exit 2
    fi
    if [ "$ANDROID_SERIAL" = emulator-5582 ]; then
      echo "ARTIFACT_MODE=sealed refuses protected serial emulator-5582." >&2
      exit 2
    fi
    if [ "${ANDROID_ADB_SERVER_ADDRESS:-}" != 127.0.0.1 ]; then
      echo "ARTIFACT_MODE=sealed requires ANDROID_ADB_SERVER_ADDRESS=127.0.0.1." >&2
      exit 2
    fi
    if [[ ! ${ANDROID_ADB_SERVER_PORT:-} =~ ^[1-9][0-9]{0,4}$ ]] \
      || [ "$ANDROID_ADB_SERVER_PORT" -gt 65535 ] \
      || [ "$ANDROID_ADB_SERVER_PORT" -eq 5037 ]; then
      echo "ARTIFACT_MODE=sealed requires an explicit non-default ANDROID_ADB_SERVER_PORT from 1 through 65535." >&2
      exit 2
    fi
    if [ "${ADB_LOCAL_TRANSPORT_MAX_PORT:-}" != 5553 ]; then
      echo "ARTIFACT_MODE=sealed requires ADB_LOCAL_TRANSPORT_MAX_PORT=5553." >&2
      exit 2
    fi
    if [ "${ADB_MDNS_AUTO_CONNECT:-}" != 0 ]; then
      echo "ARTIFACT_MODE=sealed requires ADB_MDNS_AUTO_CONNECT=0." >&2
      exit 2
    fi
    if [ "${ADB_SERVER_SOCKET+x}" = x ]; then
      echo "ARTIFACT_MODE=sealed requires ADB_SERVER_SOCKET to be unset." >&2
      exit 2
    fi
    if [ "$UNITY" != 1 ] || [ "$HOOKS" != 0 ]; then
      echo "ARTIFACT_MODE=sealed requires UNITY=1 and HOOKS=0." >&2
      exit 2
    fi
    if [ -z "${APK_PATH:-}" ] || [[ "$APK_PATH" != /* ]]; then
      echo "ARTIFACT_MODE=sealed requires an absolute APK_PATH." >&2
      exit 2
    fi
    if [[ "$(basename "$APK_PATH")" =~ [Dd][Ee][Bb][Uu][Gg] ]]; then
      echo "ARTIFACT_MODE=sealed refuses debug APK naming." >&2
      exit 2
    fi
    if [[ ! ${EXPECTED_APK_SHA256:-} =~ ^[0-9a-f]{64}$ ]]; then
      echo "ARTIFACT_MODE=sealed requires EXPECTED_APK_SHA256 as 64 lowercase hexadecimal characters." >&2
      exit 2
    fi
    if [ -z "${EXPECTED_BUILD_ID:-}" ]; then
      echo "ARTIFACT_MODE=sealed requires EXPECTED_BUILD_ID." >&2
      exit 2
    fi
    ;;
  *)
    echo "ARTIFACT_MODE must be exactly debug or sealed (received '$ARTIFACT_MODE')." >&2
    exit 2
    ;;
esac
if [ "$SEALED" = 1 ]; then
  # This pure flag/environment preflight must remain before every artifact read,
  # output-directory write and ADB/device operation.
  if [[ "$OUT" != /* ]]; then OUT="$ROOT/$OUT"; fi
  GATE_A_EVIDENCE_OUT="$OUT" node "$ROOT/scripts/android-gate-a-preflight.mjs" "$@"
  if [ ! -f "$APK_PATH" ] || [ -L "$APK_PATH" ]; then
    echo "ARTIFACT_MODE=sealed requires APK_PATH to be a regular, non-symlink file." >&2
    exit 2
  fi
  if [ -e "$OUT" ]; then
    echo "ARTIFACT_MODE=sealed requires a new evidence directory: $OUT" >&2
    exit 2
  fi
fi
if [ "$SEALED" != 1 ] && [ "$UNITY" = 1 ] && [ "$SKIP_BUILD" = 1 ]; then
  echo "UNITY=1 cannot be combined with SKIP_BUILD=1: the script cannot prove that an existing APK contains the verified Unity export." >&2
  exit 2
fi
cd "$ROOT"

SOURCE_BUILD_ID_START="$(scripts/build-id.sh)"
if [[ ! $SOURCE_BUILD_ID_START =~ ^[0-9a-f]{7,40}(\+[0-9a-f]{12})?$ ]]; then
  echo "Invalid repository build identity: '$SOURCE_BUILD_ID_START'." >&2
  exit 2
fi
if [ "$SEALED" = 1 ]; then
  EVIDENCE_BUILD_ID="$EXPECTED_BUILD_ID"
  if [ "$SOURCE_BUILD_ID_START" != "$EVIDENCE_BUILD_ID" ]; then
    echo "ARTIFACT_MODE=sealed expected build $EVIDENCE_BUILD_ID, but current source is $SOURCE_BUILD_ID_START." >&2
    exit 2
  fi
elif [ "$SKIP_BUILD" = 1 ]; then
  if [ -z "${EXPECTED_BUILD_ID:-}" ]; then
    echo "SKIP_BUILD=1 requires EXPECTED_BUILD_ID=<exact build identity embedded in the APK>." >&2
    exit 2
  fi
  EVIDENCE_BUILD_ID="$EXPECTED_BUILD_ID"
else
  EVIDENCE_BUILD_ID="$SOURCE_BUILD_ID_START"
  if [ -n "${EXPECTED_BUILD_ID:-}" ] && [ "$EXPECTED_BUILD_ID" != "$EVIDENCE_BUILD_ID" ]; then
    echo "EXPECTED_BUILD_ID=$EXPECTED_BUILD_ID does not match the source identity being built ($EVIDENCE_BUILD_ID)." >&2
    exit 2
  fi
fi
if [[ ! $EVIDENCE_BUILD_ID =~ ^[0-9a-f]{7,40}(\+[0-9a-f]{12})?$ ]]; then
  echo "EXPECTED_BUILD_ID is not a valid repository build identity: '$EVIDENCE_BUILD_ID'." >&2
  exit 2
fi
if [ -n "${BUILD_ID:-}" ] && [ "$BUILD_ID" != "$EVIDENCE_BUILD_ID" ]; then
  echo "BUILD_ID=$BUILD_ID conflicts with the evidence identity $EVIDENCE_BUILD_ID." >&2
  exit 2
fi

if [ "$SEALED" = 1 ]; then
  BUILD_TOOLS="$(find "$SDK/build-tools" -mindepth 1 -maxdepth 1 -type d -print | sort -V | tail -1)"
  APKSIGNER="$BUILD_TOOLS/apksigner"
  UNITY_RECEIPT="$ROOT/unity/VandePractice/Builds/Android/.vande-export.properties"
  if [ -z "$BUILD_TOOLS" ] || [ ! -x "$APKSIGNER" ]; then
    echo "ARTIFACT_MODE=sealed requires an executable Android SDK apksigner." >&2
    exit 2
  fi
  verify_gate_a_unity_payload() {
    local output_file="$1"
    local source_bracket_output_file="$2"
    node "$ROOT/scripts/android-gate-a-unity-admission.mjs" \
      --root "$ROOT" \
      --sidecar "$UNITY_PAYLOAD_BINDING_PATH" \
      --expected-sidecar-sha256 "$EXPECTED_UNITY_PAYLOAD_BINDING_SHA256" \
      --apk "$SEALED_INSTALL_APK" \
      --expected-apk-sha256 "$EXPECTED_APK_SHA256" \
      --expected-build-id "$EVIDENCE_BUILD_ID" \
      --receipt "$UNITY_RECEIPT" \
      --apksigner "$APKSIGNER" \
      --output "$output_file" \
      --source-bracket-output "$source_bracket_output_file"
  }
fi

BOOTED_SERIAL=""
EMULATOR_PID=""
DEVICE_SERIAL=""
ANDROID_TOUCHED=0

cleanup() {
  if [ "$ANDROID_TOUCHED" = 1 ]; then
    echo "▶ Restoring the Android tree to a clean, no-hook, no-Unity bundle"
    if [ "${HOOKS:-0}" = 1 ] || [ "$UNITY" = 1 ]; then
      CLEAN_BUILD_ID="$(scripts/build-id.sh)"
      nice -n 15 env -u VITE_PRACTICE_TEST_HOOKS -u VITE_API_URL -u VITE_API_LOCAL -u VITE_COMMUNITY_API_URL \
        BUILD_ID="$CLEAN_BUILD_ID" VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE=0 \
        VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=0 \
        npx vite build --outDir dist-android --emptyOutDir >/dev/null
    fi
    CAP_WEB_DIR=dist-android env -u CAP_WEBVIEW_DEBUG -u CAP_LOCAL_HTTP npx cap sync android >/dev/null
  fi
  if [ -n "$BOOTED_SERIAL" ] && [ -n "$EMULATOR_PID" ] && kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo "▶ Shutting down emulator $BOOTED_SERIAL started by this script"
    "$ADB" -s "$BOOTED_SERIAL" emu kill >/dev/null 2>&1 || true
  elif [ -n "$EMULATOR_PID" ] && kill -0 "$EMULATOR_PID" 2>/dev/null; then
    echo "▶ Stopping emulator process $EMULATOR_PID started by this script"
    kill "$EMULATOR_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [ "$SEALED" = 1 ]; then
  mkdir -m 700 "$OUT"
  SEALED_INSTALL_APK="$OUT/sealed-artifact/${APK_PATH##*/}"
else
  mkdir -p "$OUT"
  SEALED_INSTALL_APK=""
fi
if [ "$SEALED" = 1 ]; then
  echo "▶ Copying and admitting a private sealed Unity APK before any ADB/device operation"
  node scripts/android-sealed-artifact.mjs \
    --source-apk "$APK_PATH" \
    --private-apk "$SEALED_INSTALL_APK" \
    --expected-sha256 "$EXPECTED_APK_SHA256" \
    --expected-build-id "$EVIDENCE_BUILD_ID" \
    --output "$OUT/sealed-artifact-admission.json"
  verify_gate_a_unity_payload \
    "$OUT/unity-payload-binding-admission.json" \
    "$OUT/unity-payload-binding-admission-source-bracket.json"
  UNITY_ADMISSION_FILE_SHA256="$(shasum -a 256 "$OUT/unity-payload-binding-admission.json" | awk '{ print $1 }')"
  UNITY_ADMISSION_BRACKET_FILE_SHA256="$(shasum -a 256 "$OUT/unity-payload-binding-admission-source-bracket.json" | awk '{ print $1 }')"
elif [ "$UNITY" = 1 ]; then
  echo "▶ Verifying the opt-in Unity export before touching the web bundle or device"
  ( cd android && nice -n 15 ./gradlew --offline --no-daemon --console=plain -q --max-workers=2 -PvandeUnity=1 help )
fi

ready_devices() {
  "$ADB" devices | awk 'NR > 1 && $2 == "device" { print $1 }'
}

all_attached_devices() {
  "$ADB" devices | awk 'NR > 1 && NF >= 2 { print $1 " " $2 }'
}

prepare_device() {
  # These commands are idempotent and never supply or bypass a PIN, password or pattern. A credential-protected
  # keyguard stays protected and the later visible-UI preflight fails safely until the owner unlocks it.
  "$ADB" -s "$DEVICE_SERIAL" shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1 || true
  "$ADB" -s "$DEVICE_SERIAL" shell wm dismiss-keyguard >/dev/null 2>&1 || true
}

select_ready_device() {
  local requested="${ANDROID_SERIAL:-}"
  local ready count
  ready="$(ready_devices)"
  if [ -n "$requested" ]; then
    if ! printf '%s\n' "$ready" | awk -v serial="$requested" '$0 == serial { found=1 } END { exit !found }'; then
      echo "ANDROID_SERIAL=$requested is not a ready adb device. Attached devices:" >&2
      all_attached_devices >&2
      return 1
    fi
    DEVICE_SERIAL="$requested"
    return
  fi
  count="$(printf '%s\n' "$ready" | awk 'NF { count++ } END { print count+0 }')"
  if [ "$count" -eq 1 ]; then
    DEVICE_SERIAL="$(printf '%s\n' "$ready" | awk 'NF { print; exit }')"
  elif [ "$count" -gt 1 ]; then
    echo "Several ready Android devices are attached; set ANDROID_SERIAL explicitly:" >&2
    printf '%s\n' "$ready" >&2
    return 1
  else
    return 2
  fi
}

selection_status=0
select_ready_device || selection_status=$?
if [ "$selection_status" -ne 0 ]; then
  if [ "$selection_status" -ne 2 ]; then exit "$selection_status"; fi
  attached="$(all_attached_devices)"
  if [ -n "$attached" ]; then
    echo "No ready device is available, and an offline/unauthorized device already exists; refusing ambiguous emulator ownership:" >&2
    printf '%s\n' "$attached" >&2
    exit 1
  fi
  if [ "${BOOT:-0}" != 1 ]; then
    echo "No ready Android device. Attach one, set ANDROID_SERIAL, or run with BOOT=1." >&2
    exit 1
  fi
  if ! printf '%s\n' "$EMULATOR_PORT" | awk '$1 >= 5554 && $1 <= 5682 && $1 % 2 == 0 { ok=1 } END { exit !ok }'; then
    echo "EMULATOR_PORT must be an even console port from 5554 through 5682." >&2
    exit 1
  fi
  if [ -n "${RAM_MB:-}" ] && ! printf '%s\n' "$RAM_MB" | awk '$1 ~ /^[0-9]+$/ && $1 >= 1024 && $1 <= 16384 { ok=1 } END { exit !ok }'; then
    echo "RAM_MB must be an integer from 1024 through 16384 MiB." >&2
    exit 1
  fi

  BOOTED_SERIAL="emulator-$EMULATOR_PORT"
  echo "▶ Booting $AVD as $BOOTED_SERIAL headless (-gpu host${CORES:+, $CORES cores}${RAM_MB:+, $RAM_MB MiB RAM})"
  emulator_args=(-avd "$AVD" -port "$EMULATOR_PORT" -gpu host -no-window -no-audio -no-boot-anim -no-snapshot)
  if [ -n "${CORES:-}" ]; then emulator_args+=(-cores "$CORES"); fi
  if [ -n "${RAM_MB:-}" ]; then emulator_args+=(-memory "$RAM_MB"); fi
  "$SDK/emulator/emulator" "${emulator_args[@]}" >"$OUT/emulator-${CORES:-default}.log" 2>&1 &
  EMULATOR_PID=$!
  deadline=$((SECONDS + BOOT_TIMEOUT_SEC))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$EMULATOR_PID" 2>/dev/null; then
      echo "The emulator process exited before boot completed; see $OUT/emulator-${CORES:-default}.log" >&2
      exit 1
    fi
    if printf '%s\n' "$(ready_devices)" | awk -v serial="$BOOTED_SERIAL" '$0 == serial { found=1 } END { exit !found }' \
      && [ "$("$ADB" -s "$BOOTED_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; then
      break
    fi
    sleep 2
  done
  if [ "$("$ADB" -s "$BOOTED_SERIAL" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" != 1 ]; then
    echo "Emulator did not complete boot within ${BOOT_TIMEOUT_SEC}s; see $OUT/emulator-${CORES:-default}.log" >&2
    exit 1
  fi
  DEVICE_SERIAL="$BOOTED_SERIAL"
  echo "  booted $DEVICE_SERIAL: $("$ADB" -s "$DEVICE_SERIAL" shell nproc | tr -d '\r') cores"
fi

if [ "$SEALED" = 1 ]; then
  SEALED_ATTACHED_DEVICES="$(all_attached_devices)"
  if [ "$SEALED_ATTACHED_DEVICES" != "$DEVICE_SERIAL device" ]; then
    echo "ARTIFACT_MODE=sealed requires its dedicated ADB server to expose exactly ANDROID_SERIAL=$DEVICE_SERIAL as ready; observed:" >&2
    printf '%s\n' "${SEALED_ATTACHED_DEVICES:-none}" >&2
    exit 2
  fi
  {
    printf 'host=%s\n' "$ANDROID_ADB_SERVER_ADDRESS"
    printf 'port=%s\n' "$ANDROID_ADB_SERVER_PORT"
    printf 'serial=%s\n' "$DEVICE_SERIAL"
    printf 'inventory=%s device\n' "$DEVICE_SERIAL"
  } >"$OUT/adb-isolation.txt"
fi

prepare_device
echo "▶ Target device: $DEVICE_SERIAL"
echo "▶ Expected installed build identity: $EVIDENCE_BUILD_ID (ARTIFACT_MODE=$ARTIFACT_MODE, SKIP_BUILD=$SKIP_BUILD)"
if [ "$SKIP_BUILD" != 1 ]; then
  echo "▶ Debug build $EVIDENCE_BUILD_ID (offline Practice, HOOKS=${HOOKS:-0}, UNITY=$UNITY, maximum 2 Gradle workers)"
  ANDROID_TOUCHED=1
  if [ "$UNITY" = 1 ]; then
    if [ "${HOOKS:-0}" = 1 ]; then
      nice -n 15 env -u VITE_API_URL -u VITE_API_LOCAL -u VITE_COMMUNITY_API_URL VITE_BUILD_TARGET=android \
        BUILD_ID="$EVIDENCE_BUILD_ID" VITE_PRACTICE_TEST_HOOKS=1 VITE_UNITY_PRACTICE=1 \
        VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=1 \
        npx vite build --outDir dist-android --emptyOutDir >/dev/null
    else
      nice -n 15 env -u VITE_PRACTICE_TEST_HOOKS -u VITE_API_URL -u VITE_API_LOCAL -u VITE_COMMUNITY_API_URL \
        BUILD_ID="$EVIDENCE_BUILD_ID" VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE=1 \
        VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=1 \
        npx vite build --outDir dist-android --emptyOutDir >/dev/null
    fi
  elif [ "${HOOKS:-0}" = 1 ]; then
    nice -n 15 env -u VITE_API_URL -u VITE_API_LOCAL -u VITE_COMMUNITY_API_URL \
      BUILD_ID="$EVIDENCE_BUILD_ID" VITE_BUILD_TARGET=android VITE_PRACTICE_TEST_HOOKS=1 VITE_UNITY_PRACTICE=0 \
      VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=0 \
      npx vite build --outDir dist-android --emptyOutDir >/dev/null
  else
    nice -n 15 env -u VITE_PRACTICE_TEST_HOOKS -u VITE_API_URL -u VITE_API_LOCAL -u VITE_COMMUNITY_API_URL \
      BUILD_ID="$EVIDENCE_BUILD_ID" VITE_BUILD_TARGET=android VITE_UNITY_PRACTICE=0 \
      VITE_UNITY_PRACTICE_ENGINEERING_PREVIEW=0 \
      npx vite build --outDir dist-android --emptyOutDir >/dev/null
  fi
  CAP_WEB_DIR=dist-android CAP_WEBVIEW_DEBUG=1 npx cap sync android >/dev/null
  ( cd android && nice -n 15 ./gradlew --no-daemon --console=plain -q --max-workers=2 "-PvandeUnity=$UNITY" assembleDebug )
  SOURCE_BUILD_ID_END="$(scripts/build-id.sh)"
  if [ "$SOURCE_BUILD_ID_END" != "$SOURCE_BUILD_ID_START" ]; then
    echo "Source identity changed during the evidence build ($SOURCE_BUILD_ID_START -> $SOURCE_BUILD_ID_END); refusing an unsealed APK." >&2
    exit 1
  fi
fi

if [ "$SEALED" = 1 ]; then
  if [ ! -f "$OUT/unity-payload-binding-admission.json" ] \
    || [ -L "$OUT/unity-payload-binding-admission.json" ] \
    || [ "$(shasum -a 256 "$OUT/unity-payload-binding-admission.json" | awk '{ print $1 }')" != "$UNITY_ADMISSION_FILE_SHA256" ] \
    || [ ! -f "$OUT/unity-payload-binding-admission-source-bracket.json" ] \
    || [ -L "$OUT/unity-payload-binding-admission-source-bracket.json" ] \
    || [ "$(shasum -a 256 "$OUT/unity-payload-binding-admission-source-bracket.json" | awk '{ print $1 }')" != "$UNITY_ADMISSION_BRACKET_FILE_SHA256" ]; then
    echo "Initial Unity payload admission evidence changed before the install transaction." >&2
    exit 2
  fi
  for evidence_file in unity-payload-binding-preinstall-recheck.json unity-payload-binding-preinstall-recheck-source-bracket.json unity-payload-binding-final-recheck.json unity-payload-binding-final-recheck-source-bracket.json preinstall-pm-path.stdout.txt preinstall-pm-path.stderr.txt preinstall-pm-path-status.txt package-absence.json preinstall-device-identity.json preinstall-artifact-check.json install-artifact-final-check.json install-artifact-post-check.json post-install-package-inventory.json install-transaction-start.json install.stdout.txt install.stderr.txt install-status.txt install-transaction.json; do
    if [ -e "$OUT/$evidence_file" ]; then
      echo "Refusing to overwrite sealed-install evidence: $OUT/$evidence_file" >&2
      exit 2
    fi
  done
  echo "▶ Binding exact Android identity before the install transaction"
  node scripts/android-device-identity.mjs \
    --serial "$DEVICE_SERIAL" \
    --adb "$ADB" \
    --output "$OUT/preinstall-device-identity.json"
  echo "▶ Recording preinstall package state"
  set +e
  "$ADB" -s "$DEVICE_SERIAL" shell pm path in.vande.cricket \
    >"$OUT/preinstall-pm-path.stdout.txt" 2>"$OUT/preinstall-pm-path.stderr.txt"
  PREINSTALL_STATUS=$?
  set -e
  printf '%s\n' "$PREINSTALL_STATUS" >"$OUT/preinstall-pm-path-status.txt"
  node scripts/android-gate-a-receipt.mjs package-absence \
    --status-file "$OUT/preinstall-pm-path-status.txt" \
    --stdout-file "$OUT/preinstall-pm-path.stdout.txt" \
    --stderr-file "$OUT/preinstall-pm-path.stderr.txt" \
    --output "$OUT/package-absence.json"

  node scripts/android-sealed-artifact.mjs \
    --admission "$OUT/sealed-artifact-admission.json" \
    --output "$OUT/preinstall-artifact-check.json"
  verify_gate_a_unity_payload \
    "$OUT/unity-payload-binding-preinstall-recheck.json" \
    "$OUT/unity-payload-binding-preinstall-recheck-source-bracket.json"
  node scripts/android-gate-a-receipt.mjs start-install \
    --output "$OUT/install-transaction-start.json" \
    --serial "$DEVICE_SERIAL" \
    --package-id in.vande.cricket \
    --build-id "$EVIDENCE_BUILD_ID" \
    --admission-file "$OUT/sealed-artifact-admission.json" \
    --artifact-check-file "$OUT/preinstall-artifact-check.json" \
    --unity-admission-file "$OUT/unity-payload-binding-admission.json" \
    --unity-admission-source-bracket-file "$OUT/unity-payload-binding-admission-source-bracket.json" \
    --unity-preinstall-recheck-file "$OUT/unity-payload-binding-preinstall-recheck.json" \
    --unity-preinstall-source-bracket-file "$OUT/unity-payload-binding-preinstall-recheck-source-bracket.json" \
    --unity-sidecar-path "$UNITY_PAYLOAD_BINDING_PATH" \
    --expected-unity-sidecar-sha256 "$EXPECTED_UNITY_PAYLOAD_BINDING_SHA256" \
    --absence-file "$OUT/package-absence.json" \
    --device-identity-file "$OUT/preinstall-device-identity.json"

  echo "▶ Installing the exact admitted sealed APK with -r (no uninstall or clear)"
  node scripts/android-sealed-artifact.mjs \
    --admission "$OUT/sealed-artifact-admission.json" \
    --output "$OUT/install-artifact-final-check.json"
  verify_gate_a_unity_payload \
    "$OUT/unity-payload-binding-final-recheck.json" \
    "$OUT/unity-payload-binding-final-recheck-source-bracket.json"
  set +e
  "$ADB" -s "$DEVICE_SERIAL" install -r "$SEALED_INSTALL_APK" \
    >"$OUT/install.stdout.txt" 2>"$OUT/install.stderr.txt"
  INSTALL_STATUS=$?
  set -e
  # This is deliberately the first operation after the install subprocess
  # returns: a mutate/read/restore interleaving must fail before any completion
  # receipt can exist.
  node scripts/android-sealed-artifact.mjs \
    --admission "$OUT/sealed-artifact-admission.json" \
    --output "$OUT/install-artifact-post-check.json"
  printf '%s\n' "$INSTALL_STATUS" >"$OUT/install-status.txt"
  cat "$OUT/install.stdout.txt"
  if [ "$INSTALL_STATUS" -ne 0 ]; then
    cat "$OUT/install.stderr.txt" >&2
    exit "$INSTALL_STATUS"
  fi
  node scripts/android-gate-a-receipt.mjs capture-installed-inventory \
    --adb "$ADB" \
    --serial "$DEVICE_SERIAL" \
    --package-id in.vande.cricket \
    --expected-artifact-sha256 "$EXPECTED_APK_SHA256" \
    --output "$OUT/post-install-package-inventory.json"
  node scripts/android-gate-a-receipt.mjs finish-install \
    --start-file "$OUT/install-transaction-start.json" \
    --artifact-check-file "$OUT/install-artifact-final-check.json" \
    --unity-final-recheck-file "$OUT/unity-payload-binding-final-recheck.json" \
    --unity-final-source-bracket-file "$OUT/unity-payload-binding-final-recheck-source-bracket.json" \
    --post-install-artifact-check-file "$OUT/install-artifact-post-check.json" \
    --inventory-file "$OUT/post-install-package-inventory.json" \
    --status-file "$OUT/install-status.txt" \
    --stdout-file "$OUT/install.stdout.txt" \
    --stderr-file "$OUT/install.stderr.txt" \
    --output "$OUT/install-transaction.json"
else
  ls -la android/app/build/outputs/apk/debug/app-debug.apk
  "$ADB" -s "$DEVICE_SERIAL" install -r android/app/build/outputs/apk/debug/app-debug.apk
fi

echo "▶ Practice lifecycle and uninterrupted-over run (logcat preserved; evidence is limited to this run's timestamp)"
if [ "$SEALED" = 1 ]; then
  SEALED_PRE_PLAYWRIGHT_DEVICES="$(all_attached_devices)"
  if [ "$SEALED_PRE_PLAYWRIGHT_DEVICES" != "$DEVICE_SERIAL device" ]; then
    echo "ARTIFACT_MODE=sealed refuses to start Playwright unless its dedicated ADB server still exposes exactly $DEVICE_SERIAL as ready; observed:" >&2
    printf '%s\n' "${SEALED_PRE_PLAYWRIGHT_DEVICES:-none}" >&2
    exit 2
  fi
  printf 'pre-playwright-inventory=%s device\n' "$DEVICE_SERIAL" >>"$OUT/adb-isolation.txt"
fi
ANDROID_SERIAL="$DEVICE_SERIAL" HOOKS="$HOOKS" UNITY="$UNITY" SKIP_BUILD="$SKIP_BUILD" \
  ARTIFACT_MODE="$ARTIFACT_MODE" REQUIRE_PACKAGE_ABSENT="$REQUIRE_PACKAGE_ABSENT" \
  SEALED_APK_PATH="${SEALED_INSTALL_APK:-${APK_PATH:-}}" EXPECTED_APK_SHA256="${EXPECTED_APK_SHA256:-}" \
  EXPECTED_BUILD_ID="$EVIDENCE_BUILD_ID" node scripts/android-practice.mjs "$OUT" "$@"
