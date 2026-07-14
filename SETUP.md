# Setup

Use this repository as a GitHub template or direct clone, then perform the one-time
bootstrap below.

## 1. Preserve and stamp provenance

Keep template history until placeholder stamping so the script can identify tracked files
and, for direct clones, the exact source commit. GitHub-generated repositories have
unrelated history, so record the exact 40-character template commit at creation time.

```sh
cp template.config.example template.config
scripts/dev/instantiate.sh --dry-run template.config
scripts/dev/instantiate.sh template.config
```

Global tokens are `PROJECT_NAME`, `CEO`, `REPO_SLUG`, `DEFAULT_BRANCH`, `STACK`,
`PROD_URL`, `TEMPLATE_BASE_REF`, and `TEMPLATE_REVIEW_DATE`. A direct canonical clone can
auto-detect `TEMPLATE_BASE_REF`; a GitHub-generated project must supply it.

The script seeds `.template-source` from the exact inherited commit. The checkpoint means
"reviewed through," not "copy this commit blindly."

## 2. Fill project-owned seeds

- `docs/MISSION.md` — mission and operating principles.
- `specs/SYSTEM.md` — architecture, layers, and critical path.
- `specs/_TEMPLATE.md` — copy once per real layer.
- `status/SYSTEM-STATUS.md` — runtime commands and non-secret configuration names.
- `.github/copilot-instructions.md` — project context and code conventions.
- `.github/extensions/compliance-hooks/policy.mjs` — layer path patterns.

Never commit credentials or secret values. Runtime status, mission/spec content, learned
rules, custom agents, model choices, and automation schedules are project-owned.

## 3. Verify lineage

```sh
cat .template-source
node scripts/dev/review-template-updates.mjs check
```

The check is read-only. Run it before changing inherited operating files and follow
`specs/TEMPLATE-INHERITANCE.md` when updates appear. Do not schedule it to generate routine
commits or reports.

## 4. Activate mechanical guards

```sh
git config core.hooksPath .githooks
cp scripts/dev/pre-push-tests.sh.example scripts/dev/pre-push-tests.sh
chmod +x scripts/dev/pre-push-tests.sh
```

Configure routine tests, which may honor a deliberate `SKIP_TEST_GUARD=1`, and
critical-path deterministic evals, which must be non-bypassable and run only from the
clean, checked-out commit being pushed.

## 5. Keep agents minimal

Do not create reviewer agents. For behavior-changing PRs, follow
`docs/CODE-REVIEW-PANEL.md` and invoke the runtime's read-only `code-review` specialist
twice with explicit model IDs selected relative to the primary.

Create another custom agent only when a recurring, expensive decision class earns one.
Start from `.github/agents/template-agent.md` and retain least-privilege tools.

## 6. Validate

```sh
node scripts/dev/review-template-updates.mjs check
sh scripts/dev/check-learnings-budget.sh
sh -n .githooks/pre-push
sh -n scripts/dev/pre-push-tests.sh.example
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
scripts/dev/instantiate.sh --dry-run template.config.example
```

## Updating downstream projects

Review canonical changes as a normal PR. Adopt, adapt, defer, or mark each cohesive change
not applicable, then acknowledge the reviewed commit with
`review-template-updates.mjs acknowledge <full-sha>`.

Never overwrite or transport credentials, runtime/deploy state, mission or product spec
content, project-earned learnings, model assumptions, custom rosters/biographies, or
scheduled-workflow definitions and run history.
