# {{PROJECT_NAME}} — System Status

> The **current runtime reality** of the system: how to run it, where it lives, how to
> verify it's healthy. Read at session start. Keep it lean and *current* — stale status is
> worse than no status. Move historical detail to `status/CHANGELOG.md` and deep runbooks to
> `docs/runbooks/`.

_Last updated: {{DATE}} — {{by whom}}_

---

## Environments

| Environment | Where | URL | Notes |
|-------------|-------|-----|-------|
| Dev | {{local / WSL / container}} | {{http://localhost:PORT}} | {{...}} |
| Production | {{host}} | {{https://...}} | {{...}} |

## How to run it (dev)

```
{{the exact commands to build and start the system locally}}
```

## How to verify it's healthy

```
{{the exact command(s) — e.g. curl a health endpoint — and the expected output}}
```

## Credentials & secrets (dev only — NEVER commit real secrets)

| What | Where it's configured | Dev value |
|------|----------------------|-----------|
| {{DB connection}} | {{env var / config file}} | {{dev-only placeholder}} |

> Real production secrets live outside the repo (env, secret store). Do not commit secrets.

## Key scripts

| Script | Purpose |
|--------|---------|
| `scripts/dev/install-hooks.sh` | Activate the git `pre-push` guards (run once per clone). |
| `scripts/dev/check-learnings-budget.sh` | Enforce the `docs/LEARNINGS.md` token cap. |
| `scripts/dev/pre-push-tests.sh` | (You create this from `.example`) the project's pre-push test gate. |

## Current state / known gaps

- {{What's deployed, what's in flight, what's broken. Keep it honest and short.}}
