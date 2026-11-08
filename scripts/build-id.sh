#!/usr/bin/env bash
# Prints the build id of the working tree: the short HEAD sha, plus "+<12 hex>" when the tree has uncommitted changes (a
# hash of the tracked diff and of the untracked, non-ignored files). A clean checkout prints only the short sha.
#
# vite.config.ts runs it when BUILD_ID is not set; the Android, perf and evaluation scripts and the evidence records
# that AGENTS.md asks for use it too. It always measures the tree and ignores BUILD_ID on purpose: the "tree changed
# during the build" checks (scripts/build-android.sh, scripts/perf/run-perf.sh and others) compare two measurements.
# Needs git and bash 3.2 or later; works from any directory inside the repository.
set -euo pipefail
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
# shasum on macOS and most Linux, sha256sum (GNU coreutils) elsewhere; both print "<hash>  <name>".
if command -v shasum >/dev/null 2>&1; then sha256=(shasum -a 256); else sha256=(sha256sum); fi
head=$(git rev-parse --short HEAD)
if [ -z "$(git status --porcelain)" ]; then echo "$head"; exit 0; fi
# -r: do not run the hasher at all when no file is untracked (GNU xargs would otherwise hash an empty stdin).
fp=$( { git diff HEAD --binary; git ls-files --others --exclude-standard -z | sort -z | xargs -0 -r "${sha256[@]}" --; } | "${sha256[@]}" | cut -c1-12 )
echo "$head+$fp"
