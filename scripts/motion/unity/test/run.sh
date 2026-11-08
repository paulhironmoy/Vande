#!/bin/sh
# Builds and runs the C# VMP1 cross-check outside the Unity editor, with Unity's bundled .NET 6 host and Roslyn.
#
#   scripts/motion/unity/test/run.sh <outDir>
#
# Steps:
# 1. Dump: node runs dump.mjs, which uses the reference vmp.ts.
# 2. Compile the core against .NET Standard 2.1 (Unity 6's API level), C# 9, warnings as errors.
# 3. Compile-check the Unity adapter (UNITY_5_3_OR_NEWER) together with UNITY's real ProductionCharacterContracts.cs
#    and ProductionCharacterMotion.cs, which it reads but does not change.
# 4. Compile CrossCheck.cs against the tested core DLL and run it.
# 5. Run AdapterCheck.cs: the Unity adapter, mirrorForRig included, on the real ProductionCharacterPose.
#    The script exits 0 only if both pass.
#
# On the shared machine run this through the heavy-job wrapper (2 slots, nice -n 15).
set -eu
OUT=${1:?usage: run.sh <outDir>}
HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
SCRIPTING=${UNITY_SCRIPTING:-/Applications/Unity/Hub/Editor/6000.3.27f1/Unity.app/Contents/Resources/Scripting}
DOTNET="$SCRIPTING/NetCoreRuntime/dotnet"
CSC="$SCRIPTING/DotNetSdkRoslyn/csc.dll"
NETSTD="$SCRIPTING/NetStandard/ref/2.1.0/netstandard.dll"
CORE_FX="$SCRIPTING/NetCoreRuntime/shared/Microsoft.NETCore.App/6.0.21"
UNITY_CORE="$SCRIPTING/Managed/UnityEngine/UnityEngine.CoreModule.dll"
CHARS="$REPO/unity/VandePractice/Assets/VandePractice/Runtime/Presentation/Production/Characters"
SRC="$REPO/scripts/motion/unity/VandeMotionPack.cs"
mkdir -p "$OUT/build"

echo "[run] uptime: $(uptime)"
echo "[run] dump (vmp.ts) $(date -u +%FT%TZ)"
node "$HERE/dump.mjs" "$OUT"

echo "[run] compile core (netstandard 2.1, C# 9) $(date -u +%FT%TZ)"
"$DOTNET" "$CSC" -nologo -noconfig -nostdlib -langversion:9.0 -warn:4 -warnaserror+ -optimize+ -deterministic \
  -target:library -out:"$OUT/build/VandeMotionPack.dll" -r:"$NETSTD" "$SRC"

echo "[run] compile-check the Unity adapter with ProductionCharacterContracts.cs $(date -u +%FT%TZ)"
"$DOTNET" "$CSC" -nologo -noconfig -nostdlib -langversion:9.0 -warn:4 -optimize+ -deterministic -target:library \
  -define:UNITY_5_3_OR_NEWER -define:UNITY_6000_0_OR_NEWER -define:UNITY_ANDROID -define:ENABLE_IL2CPP \
  -out:"$OUT/build/VandeMotionPack.UnityCheck.dll" -r:"$NETSTD" -r:"$UNITY_CORE" \
  "$SRC" "$CHARS/ProductionCharacterContracts.cs" "$CHARS/ProductionCharacterMotion.cs"

echo "[run] compile harness (.NET 6) $(date -u +%FT%TZ)"
REFS=""
for a in System.Private.CoreLib System.Runtime System.Console System.Text.Json System.Memory System.Collections \
  System.Linq System.Reflection.Primitives System.Reflection.Emit.ILGeneration System.Runtime.InteropServices.RuntimeInformation \
  System.Security.Cryptography.Algorithms System.Security.Cryptography.Primitives System.Threading System.Threading.Thread \
  System.Text.Encodings.Web System.Runtime.Extensions netstandard; do
  REFS="$REFS -r:$CORE_FX/$a.dll"
done
# shellcheck disable=SC2086
"$DOTNET" "$CSC" -nologo -noconfig -nostdlib -langversion:9.0 -warn:4 -optimize+ -target:exe \
  -out:"$OUT/build/CrossCheck.dll" $REFS -r:"$OUT/build/VandeMotionPack.dll" "$HERE/CrossCheck.cs"
printf '{"runtimeOptions":{"tfm":"net6.0","framework":{"name":"Microsoft.NETCore.App","version":"6.0.21"},"configProperties":{"System.GC.Server":false}}}' \
  > "$OUT/build/CrossCheck.runtimeconfig.json"

echo "[run] compile the adapter check (Unity adapter on .NET 6) $(date -u +%FT%TZ)"
mkdir -p "$OUT/adapter"
AREFS=""
for a in System.Private.CoreLib System.Runtime System.Console System.Runtime.Extensions netstandard mscorlib; do
  AREFS="$AREFS -r:$CORE_FX/$a.dll"
done
# shellcheck disable=SC2086
"$DOTNET" "$CSC" -nologo -noconfig -nostdlib -langversion:9.0 -warn:4 -optimize+ -target:exe -define:UNITY_5_3_OR_NEWER \
  -out:"$OUT/adapter/AdapterCheck.dll" $AREFS -r:"$UNITY_CORE" \
  "$SRC" "$CHARS/ProductionCharacterContracts.cs" "$CHARS/ProductionCharacterMotion.cs" "$HERE/AdapterCheck.cs"
cp "$UNITY_CORE" "$OUT/adapter/"
printf '{"runtimeOptions":{"tfm":"net6.0","framework":{"name":"Microsoft.NETCore.App","version":"6.0.21"}}}' \
  > "$OUT/adapter/AdapterCheck.runtimeconfig.json"

echo "[run] cross-check $(date -u +%FT%TZ) uptime: $(uptime)"
cd "$OUT/build"
rc=0
"$DOTNET" CrossCheck.dll "$OUT" || rc=$?
echo "[run] adapter check $(date -u +%FT%TZ)"
cd "$OUT/adapter"
"$DOTNET" AdapterCheck.dll "$REPO"/public/practice/motion/*.vmp "$OUT"/packs/*.vmp || rc=$?
echo "[run] done rc=$rc $(date -u +%FT%TZ) uptime: $(uptime)"
exit $rc
