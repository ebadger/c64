# Git hooks (`.githooks/`)

Repo-tracked git hooks. They are **not** active until you point git at this
directory (hooks can't be auto-installed by `git clone`):

```sh
scripts/dev/install-hooks.sh        # sets core.hooksPath=.githooks
# or, equivalently, from the repo root in any shell:
git config core.hooksPath .githooks
```

This sets local config in `.git/config`, so it applies to the whole repo
(including all worktrees on this machine). Run it once per clone.

## Hooks

### `pre-push`
Runs three independent guards on every `git push`. Configured tests fail closed.
The PR-state guard blocks only a state confirmed by GitHub and otherwise permits
offline/first pushes.

**1. LEARNINGS.md size-cap guard** (via `scripts/dev/check-learnings-budget.sh`).
`docs/LEARNINGS.md` is loaded into the model's context at the start of every
session, so it is a capped **Tier-1 rules digest** (~2,500 tokens); rare incident
narratives belong in `docs/learnings/archive/`. The guard blocks a push when the file
exceeds the cap, forcing priority-based distillation instead of unbounded growth.
- Counts **real tokens** with `tiktoken` when available (`pip install tiktoken`);
  otherwise falls back to a dependency-free character proxy.
- Override deliberately with `SKIP_LEARNINGS_BUDGET=1 git push ...`.

**2. PR-state guard.**
Blocks pushes to a branch whose PR is already **MERGED** or **CLOSED**. Once a PR
is merged its branch is stale; pushing more commits orphans them.
- Uses `gh pr list --head <branch> --state all` to look up PR state.
- Only blocks on a confirmed MERGED/CLOSED state with no competing OPEN PR.
- Override deliberately with `SKIP_PR_GUARD=1 git push ...`.

**3. Project test gate** (via `scripts/dev/pre-push-tests.sh`).
Runs the current operating tests before allowing a push. Product implementation paths are
already classified as critical and fail closed until the first implementation adds
`scripts/dev/test-critical-path.sh` with native/WASM/artifact verification. Routine tests
may be deliberately skipped; the configured critical-path eval may not. A non-zero result
always blocks the push.
