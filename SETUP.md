# SETUP — instantiate a new project from this template

This turns the template into a working project's operating system. Budget ~30 minutes.

## 0. Get a copy

Either click **"Use this template"** on GitHub, or:

```sh
git clone https://github.com/ebadger/AIProjectTemplate.git my-new-project
cd my-new-project
```

Keep the template history until after placeholder stamping so the script can identify
tracked files and record the exact source commit. You can start fresh history after step 1.
If you use GitHub's template button, record the exact 40-character
`ebadger/AIProjectTemplate` commit at creation time; GitHub creates unrelated history, so
the instantiation script cannot recover that provenance safely afterward.

## 1. Stamp the global placeholders

The template uses two kinds of placeholders:

- **Global tokens** — one value, used in many files. Replaced automatically by the script.
- **Prose placeholders** — per-file fill-in spots (mission text, spec contracts, lens
  roles). You write these by hand; the script lists which files still contain them.

```sh
cp template.config.example template.config
# edit template.config
scripts/dev/instantiate.sh --dry-run template.config   # preview
scripts/dev/instantiate.sh template.config             # apply
```

### Global token reference

| Token | Meaning | Example |
|-------|---------|---------|
| `{{PROJECT_NAME}}` | System/company name | `Acme Widgets Platform` |
| `{{CEO}}` | Owner / final decision-maker handle | `ebadger` |
| `{{REPO_SLUG}}` | `owner/repo` | `ebadger/acme` |
| `{{DEFAULT_BRANCH}}` | Default branch | `main` |
| `{{MISSION_ONE_LINER}}` | Session-start banner sentence | `pays kids to master math` |
| `{{STACK}}` | One-line tech stack | `.NET 9, Postgres 16` |
| `{{PROD_URL}}` | Production URL (if public) | `https://example.com` |
| `{{TEMPLATE_BASE_REF}}` | Exact canonical template commit inherited | Required for GitHub-generated projects; direct clones auto-detect |
| `{{TEMPLATE_REVIEW_DATE}}` | Initial lineage review date | Today's UTC date if blank |

The script seeds `.template-source` from the exact inherited commit. It auto-detects that
commit only when `origin` is the canonical template clone; otherwise
`TEMPLATE_BASE_REF` is required. The checkpoint must describe what was actually inherited,
never merely today's upstream HEAD.

To start fresh history, do it only after the script succeeds:

```sh
rm -rf .git
git init -b {{DEFAULT_BRANCH}}
git remote add origin https://github.com/{{REPO_SLUG}}.git
git add .
git commit -m "Instantiate {{PROJECT_NAME}}"
```

> No bash? On Windows you can do the same replacements with your editor's
> find-in-files, or run `instantiate.sh` under WSL/Git Bash.

## 2. Verify the template lineage

```sh
cat .template-source
node scripts/dev/review-template-updates.mjs check
```

This read-only check compares the recorded checkpoint with
`ebadger/AIProjectTemplate:main`; it never merges upstream into the specialization. Keep
`.template-source` tracked. It requires Node (the same runtime used by the compliance
extension). Follow `specs/TEMPLATE-INHERITANCE.md` whenever updates appear.

## 3. Activate the mechanical guards

```sh
git config core.hooksPath .githooks      # or: scripts/dev/install-hooks.sh
pip install tiktoken                      # optional: exact LEARNINGS token counting
```

## 4. Wire the pre-push test gate (optional but recommended)

```sh
cp scripts/dev/pre-push-tests.sh.example scripts/dev/pre-push-tests.sh
chmod +x scripts/dev/pre-push-tests.sh
# edit it to run your stack's tests (dotnet test / npm test / pytest / go test / ...)
```

## 5. Fill in the prose placeholders

Work through the files the script flagged (search for `{{`):

- `docs/MISSION.md` — your real mission + the one sentence that justifies every task.
- `specs/SYSTEM.md` — the umbrella overview; name your **critical path** explicitly.
- `specs/_TEMPLATE.md` → copy to one sub-spec **per layer** (`DATABASE.md`, `API.md`, …).
- `status/SYSTEM-STATUS.md` — how to run + verify the system.
- `.github/copilot-instructions.md` — stack, layers, code style.
- `.github/extensions/compliance-hooks/extension.mjs` — tune `SPEC_PATTERNS` to your layer
  directories so the cross-layer check fires on the right edits.

## 6. Build your agent roster (only as needed)

- The two **reviewers** (`gpt-reviewer`, `gemini-reviewer`) are ready to use — just update
  the `model:` pins to the current strongest model from each vendor.
- Add **lenses** from `.github/agents/template-lens-agent.md` when a real, recurring class
  of expensive decision justifies one. Heed the **mission-clock gate** (`docs/ROLES.md` #6):
  don't add org machinery faster than the product needs it.

## 7. Verify

```sh
# Canonical template lineage is configured:
node scripts/dev/review-template-updates.mjs check
# LEARNINGS cap guard runs clean:
sh scripts/dev/check-learnings-budget.sh
# Extension parses (needs Node):
node --check .github/extensions/compliance-hooks/extension.mjs
```

Then start a Copilot CLI session in the repo — you should see the session-start checklist
injected automatically. You're live.

---

## What you just inherited

A condensed map of the machinery and why each piece exists:

| Piece | What it buys you |
|-------|------------------|
| `docs/LEARNINGS.md` + `docs/learnings/` + budget guard | **Capped, tiered memory** — durable rules stay loaded every session without unbounded growth crowding out task context. |
| `.githooks/pre-push` | **Mechanical backstop** — caps LEARNINGS, runs your test gate, blocks pushes to merged/closed PR branches, for *any* caller. |
| `.github/extensions/compliance-hooks` | **Governance-as-code** — injects the right checklist at the right moment; hard-stops self-merge and pushes to dead branches. |
| `.github/instructions/*` | The **refreshing checklists** the extension injects (session start, commit, push, PR, merge-block, cross-layer). |
| `.github/agents/*` | The **agent template** — anti-sycophancy core + model-diverse review panel. |
| `.template-source` + `review-template-updates.mjs` | **Living template lineage** — discover shared improvements, reconcile them deliberately, and retain an auditable checkpoint. |
| `docs/ROLES.md` | **Lenses & gates** — the org model, the non-negotiable gates, and the mission-clock rule. |
| `docs/CODE-REVIEW-PANEL.md` | The **multi-model review** procedure and its kill criterion. |
| `specs/` | **Specs-as-source-of-truth** scaffolding + the cross-layer discipline. |
| `docs/SUGGESTIONS.md` | A standing **process-improvement funnel** so good ideas accrete. |
