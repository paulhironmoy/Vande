#!/usr/bin/env bash
# One command for the Practice performance evidence (docs/PERFORMANCE.md §4; rubric PERF1, PERF2, PERF4, CTL1):
#   scripts/perf/run-perf.sh [evidence|quick]      (default evidence: about 100 minutes; quick: about 15)
# 1. records the build id (scripts/build-id.sh) and `uptime`;
# 2. builds this tree's Practice test-hooks build into dist-perfh (VITE_PRACTICE_TEST_HOOKS=1; the harness only uses
#    its read-only calls: state, stats, lastFlight) and the production build into dist-perfprod (startup, as shipped);
# 3. runs the matrix (scripts/perf/practice-matrix.mjs) one browser at a time, real touches through CDP;
# 4. writes the evidence records, distributions and histograms to release/player-experience/shared/perf/<build id>/.
# Nothing else may run heavy work on the machine meanwhile: every record carries the uptime it was measured at.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SET="${1:-evidence}"
cd "$ROOT"
BUILD="$(bash scripts/build-id.sh)"
OUT="release/player-experience/shared/perf/$BUILD"
# Bulk raw data stays out of release/ (AGENTS.md); only the records, distributions and histograms go there.
RUNS="test-results-perf/runs-$BUILD-$SET"
mkdir -p "$RUNS" "$OUT"
{ echo "build $BUILD"; echo "set $SET"; echo "started $(date -u +%FT%TZ)"; echo "uptime $(uptime)"; } | tee "$OUT/run-$SET.txt"
VITE_PRACTICE_TEST_HOOKS=1 npx vite build --outDir dist-perfh --emptyOutDir >/dev/null
npx vite build --outDir dist-perfprod --emptyOutDir >/dev/null
[ "$(bash scripts/build-id.sh)" = "$BUILD" ] || { echo "the tree changed during the build: rerun"; exit 1; }
nice -n 15 node scripts/perf/practice-matrix.mjs --dist dist-perfh --set "$SET" --out "$RUNS" | tee "$OUT/matrix-$SET.log"
node scripts/perf/perf-evidence.mjs --runs "$RUNS" --out "$OUT" --build "$BUILD" | tee -a "$OUT/run-$SET.txt"
# Startup on the production build as shipped (launch → interactive → first delivery), first and returning visits.
STARTUP_RUNS=3; [ "$SET" = quick ] && STARTUP_RUNS=1
nice -n 15 node scripts/perf/practice-startup.mjs --dist dist-perfprod --runs "$STARTUP_RUNS" --out "$OUT" --build "$BUILD" | tee -a "$OUT/run-$SET.txt"
{ echo "finished $(date -u +%FT%TZ)"; echo "uptime $(uptime)"; } | tee -a "$OUT/run-$SET.txt"
# The Stage 0 baseline (docs/VANDE-PRODUCT-SEQUENCE.md §2, item 7) is recorded beside the release evidence.
mkdir -p release/product-sequence/stage-0/perf
cp "$OUT/EVIDENCE.md" "release/product-sequence/stage-0/perf/FRAME-TIME-$BUILD-$SET.md"
cp "$OUT/EVIDENCE-STARTUP.md" "release/product-sequence/stage-0/perf/STARTUP-$BUILD-$SET.md"
