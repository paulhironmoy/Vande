#!/usr/bin/env bash
# One command for the accessibility and robustness evidence (docs/PERFORMANCE.md §6 and §7; rubric A11Y1–A11Y7,
# PERF2–PERF5):
#   scripts/perf/run-a11y.sh [a11y|perf|all]      (default all)
# Runs the specs in the Playwright `practice` project, isolated from other runs (its own port, build and results),
# then writes the evidence records to release/player-experience/shared/perf/<build id>/EVIDENCE-E2E-<what>.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WHAT="${1:-all}"
cd "$ROOT"
BUILD="$(bash scripts/build-id.sh)"
OUT="release/player-experience/shared/perf/$BUILD"
mkdir -p "$OUT"
case "$WHAT" in
  a11y) SPECS=(tests/e2e/a11y-practice-screens.spec.ts tests/e2e/a11y-practice-captions.spec.ts) ;;
  perf) SPECS=(tests/e2e/perf-practice-runtime.spec.ts tests/e2e/perf-practice-tiers.spec.ts tests/e2e/perf-practice-determinism.spec.ts) ;;
  *) SPECS=(tests/e2e/a11y-practice-screens.spec.ts tests/e2e/a11y-practice-captions.spec.ts tests/e2e/perf-practice-runtime.spec.ts tests/e2e/perf-practice-tiers.spec.ts tests/e2e/perf-practice-determinism.spec.ts) ;;
esac
{ echo "build $BUILD"; echo "specs ${SPECS[*]}"; echo "started $(date -u +%FT%TZ)"; echo "uptime $(uptime)"; } | tee "$OUT/e2e-$WHAT.txt"
set +e
E2E_PRACTICE_PORT=4203 E2E_PRACTICE_DIST=dist-perf E2E_OUT=test-results-perf PLAYWRIGHT_JSON_OUTPUT_NAME="$OUT/e2e-$WHAT.json" \
  nice -n 15 npx playwright test --project=practice "${SPECS[@]}" --reporter=list,json
STATUS=$?
set -e
node scripts/perf/e2e-evidence.mjs --report "$OUT/e2e-$WHAT.json" --out "$OUT" --build "$BUILD" --name "E2E-$WHAT" --prefix "E-E2E-$(echo "$WHAT" | tr a-z A-Z)" | tee -a "$OUT/e2e-$WHAT.txt"
{ echo "finished $(date -u +%FT%TZ) (playwright exit $STATUS)"; echo "uptime $(uptime)"; } | tee -a "$OUT/e2e-$WHAT.txt"
exit $STATUS
