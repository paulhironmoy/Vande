#!/usr/bin/env bash
# Snapshot the working tree for evaluation (never touches the repo's own build or git state):
#   scripts/eval/snapshot.sh <scratch-dir> <port>
# 1. records scripts/build-id.sh before and after copying, and refuses a snapshot taken while the tree changed;
# 2. copies the tree (no node_modules, dist*, test-results*, release, android, .git), node_modules symlinked;
# 3. typechecks (recorded, not required), then builds the test-hooks bundle (dist-eval) and the production bundle
#    (dist-prod);
# 4. serves dist-eval on <port> in the background (pid in <dir>/serve.pid).
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEST="${1:?scratch dir}"
PORT="${2:?port}"
mkdir -p "$DEST"
before=$(bash "$REPO/scripts/build-id.sh")
rsync -a --delete --exclude node_modules --exclude 'dist*' --exclude 'test-results*' --exclude 'playwright-report*' \
  --exclude release --exclude android --exclude .git --exclude store-assets --exclude dev-dist "$REPO/" "$DEST/"
after=$(bash "$REPO/scripts/build-id.sh")
[ -e "$DEST/node_modules" ] || ln -s "$REPO/node_modules" "$DEST/node_modules"
{
  echo "build-id-before: $before"
  echo "build-id-after: $after"
  echo "taken: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "uptime: $(uptime)"
  git -C "$REPO" status --short
} > "$DEST/SNAPSHOT.txt"
if [ "$before" != "$after" ]; then echo "tree changed during the copy ($before → $after): retry" >&2; exit 3; fi
# The copy has no .git, so vite.config.ts cannot derive the id itself: the builds embed the id measured above.
export BUILD_ID="$after"
cd "$DEST"
(npx tsc -p tsconfig.app.json --noEmit > typecheck.log 2>&1; echo "typecheck exit $?" >> SNAPSHOT.txt)
(VITE_PRACTICE_TEST_HOOKS=1 npx vite build --outDir dist-eval --emptyOutDir > build-hooks.log 2>&1; echo "build-hooks exit $?" >> SNAPSHOT.txt)
(npx vite build --outDir dist-prod --emptyOutDir > build-prod.log 2>&1; echo "build-prod exit $?" >> SNAPSHOT.txt)
if [ -f serve.pid ]; then kill "$(cat serve.pid)" 2>/dev/null || true; fi
nohup npx vite preview --outDir dist-eval --port "$PORT" --strictPort > serve.log 2>&1 &
echo $! > serve.pid
echo "$after"
