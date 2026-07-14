#!/bin/sh
# Current project test gate. Product paths fail closed until their deterministic eval exists.
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

run_routine_tests() {
  node --check .github/extensions/compliance-hooks/extension.mjs
  node --test .github/extensions/compliance-hooks/policy.test.mjs
  sh scripts/dev/check-learnings-budget.sh
}

CRITICAL_PATH_REGEX='^(src/|web/|tests?/|examples?/|assets?/|cmake/|scripts/(build|ci)/|\.github/workflows/|CMakeLists\.txt$|gallery\.json$)'

run_critical_eval() {
  critical_eval="scripts/dev/test-critical-path.sh"
  if [ ! -x "$critical_eval" ]; then
    echo "pre-push-tests: product critical-path eval is not implemented." >&2
    echo "Add $critical_eval with the first product implementation; product paths fail closed until then." >&2
    return 1
  fi
  "$critical_eval"
}

if [ "${SKIP_TEST_GUARD:-}" = "1" ]; then
  echo "pre-push-tests: routine tests deliberately skipped." >&2
else
  run_routine_tests
fi

if [ -z "${REFS_FILE:-}" ] || [ ! -f "$REFS_FILE" ]; then
  echo "pre-push-tests: cannot determine changed files for configured critical gate." >&2
  exit 1
fi

changed=$(mktemp)
trap 'rm -f "$changed"' EXIT
zero=0000000000000000000000000000000000000000
critical_changed=0

while read -r _local_ref local_sha remote_ref remote_sha; do
  [ "$local_sha" = "$zero" ] && continue
  case "$remote_ref" in refs/heads/*) ;; *) continue ;; esac

  : >"$changed"
  if [ "$remote_sha" = "$zero" ]; then
    base=$(git merge-base "$local_sha" "origin/main" 2>/dev/null || true)
    if [ -z "$base" ]; then
      echo "pre-push-tests: cannot find merge-base with origin/main." >&2
      exit 1
    fi
    git diff --name-only "$base" "$local_sha" >>"$changed"
  else
    git diff --name-only "$remote_sha" "$local_sha" >>"$changed"
  fi

  if sort -u "$changed" | grep -Eq "$CRITICAL_PATH_REGEX"; then
    checked_out=$(git rev-parse HEAD)
    if [ "$local_sha" != "$checked_out" ]; then
      echo "pre-push-tests: critical ref must be checked out before evaluation." >&2
      exit 1
    fi
    if [ -n "$(git status --porcelain)" ]; then
      echo "pre-push-tests: critical evaluation requires a clean worktree." >&2
      exit 1
    fi
    critical_changed=1
  fi
done <"$REFS_FILE"

if [ "$critical_changed" = "1" ]; then
  echo "pre-push-tests: product critical path changed; running non-bypassable eval." >&2
  run_critical_eval
fi
