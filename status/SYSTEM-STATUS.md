# {{PROJECT_NAME}} — Runtime Reference

> Downstream-owned, task-loaded state. Read this only for runtime, deployment,
> environment, or verification work. Template updates must never overwrite it.

_Last verified: {{DATE}} — {{by whom}}_

## Environments

| Environment | Location | URL |
|-------------|----------|-----|
| Development | {{local / container}} | {{http://localhost:PORT}} |
| Production | {{host}} | {{PROD_URL}} |

## Run locally

```text
{{exact build/start commands}}
```

## Verify health

```text
{{exact verification command and expected result}}
```

## Configuration (names and locations only)

| Variable/config | Purpose | Where supplied |
|-----------------|---------|----------------|
| `{{VARIABLE_NAME}}` | {{purpose}} | {{local env / secret manager / CI setting}} |

Never record credential values, tokens, connection strings, private keys, or copied
secret-store output here. Store all secrets outside the repository.

## Key scripts

| Script | Purpose |
|--------|---------|
| `scripts/dev/install-hooks.sh` | Activate repo-tracked pre-push guards. |
| `scripts/dev/check-learnings-budget.sh` | Enforce the durable-rules budget. |
| `scripts/dev/pre-push-tests.sh` | Project-owned routine and critical-path test gate. |
| `scripts/dev/review-template-updates.mjs` | Review canonical policy changes and record an explicit checkpoint. |
