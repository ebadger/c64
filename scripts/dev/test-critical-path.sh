#!/bin/sh
# Product critical-path evaluation for the deterministic source-to-artifact pipeline
# (milestone 1). This is the non-bypassable gate invoked by scripts/dev/pre-push-tests.sh
# whenever critical-path files (src/, tests/, examples/, ...) change. It fails closed.
#
# It runs the full Node test suite against the production modules in src/ and verifies that
# every committed example still rebuilds to its recorded golden buildId/PRG/D64.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "test-critical-path: node is required but was not found on PATH." >&2
  exit 1
fi

echo "test-critical-path: running pipeline test suite..." >&2
node scripts/dev/run-node-tests.mjs tests

echo "test-critical-path: verifying example golden vectors..." >&2
node examples/build-example.mjs
