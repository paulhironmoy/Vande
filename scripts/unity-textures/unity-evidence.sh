#!/bin/sh
# TEXTURES-track Unity evidence on a scratch COPY of unity/VandePractice (never the repository project).
#
#   unity-evidence.sh copy  <copyDir>                       rsync the project (with Library) into <copyDir>
#   unity-evidence.sh run   <copyDir> <outDir> <flights.json> [texturesDir]
#       optionally overwrite the five textures in the copy from [texturesDir], inject VandeTextureEvidence.cs, run the
#       evidence method, then the full EditMode suite, all in batchmode. Run it through the wedge's unity.sh lock.
#
# Builder evidence only: it renders and measures; it certifies nothing.
set -eu
UNITY=/Applications/Unity/Hub/Editor/6000.3.27f1/Unity.app/Contents/MacOS/Unity
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../.." && pwd)
TEX_REL=Assets/VandePractice/Runtime/Presentation/Resources/Textures
NAMES="pitch-balanced-albedo outfield-grass-albedo bat-willow-albedo sky-late-afternoon-panorama stadium-day-background-v2"

cmd=${1:-}
case "$cmd" in
  copy)
    dest=$2
    if pgrep -f "Unity.app/Contents/MacOS/Unity.*-projectPath $REPO/unity/VandePractice" >/dev/null 2>&1; then
      echo "a Unity process has the repository project open; not copying" >&2
      exit 3
    fi
    mkdir -p "$dest"
    rsync -a --delete --exclude Temp --exclude Logs --exclude Builds --exclude UserSettings \
      --exclude '*.csproj' --exclude '*.slnx' "$REPO/unity/VandePractice/" "$dest/"
    echo "copied $(date -u +%FT%TZ)"
    ;;
  run)
    copy=$2
    out=$3
    flights=$4
    textures=${5:-}
    mkdir -p "$out"
    if [ -n "$textures" ]; then
      for n in $NAMES; do cp "$textures/$n.png" "$copy/$TEX_REL/$n.png"; done
    fi
    mkdir -p "$copy/Assets/VandePractice/Editor/Evidence"
    cp "$HERE/unity/VandeTextureEvidence.cs" "$copy/Assets/VandePractice/Editor/Evidence/VandeTextureEvidence.cs"
    ( cd "$copy/$TEX_REL" && shasum -a 256 $(for n in $NAMES; do printf '%s.png ' "$n"; done) ) > "$out/textures-in-copy.sha256"
    echo "evidence start $(date -u +%FT%TZ) uptime: $(uptime)" > "$out/timing.txt"
    VANDE_EVIDENCE_OUT="$out" VANDE_F012_FLIGHTS="$flights" "$UNITY" -batchmode -projectPath "$copy" \
      -executeMethod Vande.Practice.Editor.Evidence.VandeTextureEvidence.Run -quit -logFile "$out/evidence.log" || \
      echo "evidence rc=$?" >> "$out/timing.txt"
    echo "evidence end $(date -u +%FT%TZ) uptime: $(uptime)" >> "$out/timing.txt"
    "$UNITY" -batchmode -projectPath "$copy" -runTests -testPlatform EditMode \
      -testResults "$out/editmode-results.xml" -logFile "$out/editmode.log" || \
      echo "editmode rc=$?" >> "$out/timing.txt"
    echo "editmode end $(date -u +%FT%TZ) uptime: $(uptime)" >> "$out/timing.txt"
    ;;
  facts)
    # facts <copyDir> <outDir> <buildTarget: OSXUniversal | Android | WebGL>: import facts for that target only.
    copy=$2
    out=$3
    target=$4
    mkdir -p "$out" "$copy/Assets/VandePractice/Editor/Evidence"
    cp "$HERE/unity/VandeTextureEvidence.cs" "$copy/Assets/VandePractice/Editor/Evidence/VandeTextureEvidence.cs"
    echo "facts $target start $(date -u +%FT%TZ) uptime: $(uptime)" >> "$out/timing.txt"
    VANDE_EVIDENCE_OUT="$out" "$UNITY" -batchmode -projectPath "$copy" -buildTarget "$target" \
      -executeMethod Vande.Practice.Editor.Evidence.VandeTextureEvidence.Facts -quit \
      -logFile "$out/facts-$target.log" || echo "facts $target rc=$?" >> "$out/timing.txt"
    echo "facts $target end $(date -u +%FT%TZ) uptime: $(uptime)" >> "$out/timing.txt"
    ;;
  *)
    echo "usage: unity-evidence.sh copy <copyDir> | run <copyDir> <outDir> <flights.json> [texturesDir] | facts <copyDir> <outDir> <target>" >&2
    exit 2
    ;;
esac
