# SETUP — instantiate a new project from this template

This turns the template into a working project's operating system. Budget ~30 minutes.

## 0. Get a copy

Either click **"Use this template"** on GitHub, or:

```sh
git clone https://github.com/{{REPO_SLUG}}.git my-new-project
cd my-new-project
rm -rf .git && git init     # start fresh history (optional)
```

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

> No bash? On Windows you can do the same replacements with your editor's
> find-in-files, or run `instantiate.sh` under WSL/Git Bash.

## 2. Activate the mechanical guards

```sh
git config core.hooksPath .githooks      # or: scripts/dev/install-hooks.sh
pip install tiktoken                      # optional: exact LEARNINGS token counting
```

## 3. Wire the pre-push test gate (optional but recommended)

```sh
cp scripts/dev/pre-push-tests.sh.example scripts/dev/pre-push-tests.sh
chmod +x scripts/dev/pre-push-tests.sh
# edit it to run your stack's tests (dotnet test / npm test / pytest / go test / ...)
```

## 4. Fill in the prose placeholders

Work through the files the script flagged (search for `{{`):

- `docs/MISSION.md` — your real mission + the one sentence that justifies every task.
- `specs/SYSTEM.md` — the umbrella overview; name your **critical path** explicitly.
- `specs/_TEMPLATE.md` → copy to one sub-spec **per layer** (`DATABASE.md`, `API.md`, …).
- `status/SYSTEM-STATUS.md` — how to run + verify the system.
- `.github/copilot-instructions.md` — stack, layers, code style.
- `.github/extensions/compliance-hooks/extension.mjs` — tune `SPEC_PATTERNS` to your layer
  directories so the cross-layer check fires on the right edits.

## 5. Build your agent roster (only as needed)

- The two **reviewers** (`gpt-reviewer`, `gemini-reviewer`) are ready to use — just update
  the `model:` pins to the current strongest model from each vendor.
- Add **lenses** from `.github/agents/template-lens-agent.md` when a real, recurring class
  of expensive decision justifies one. Heed the **mission-clock gate** (`docs/ROLES.md` #6):
  don't add org machinery faster than the product needs it.

## 6. Verify

```sh
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
| `docs/ROLES.md` | **Lenses & gates** — the org model, the non-negotiable gates, and the mission-clock rule. |
| `docs/CODE-REVIEW-PANEL.md` | The **multi-model review** procedure and its kill criterion. |
| `specs/` | **Specs-as-source-of-truth** scaffolding + the cross-layer discipline. |
| `docs/SUGGESTIONS.md` | A standing **process-improvement funnel** so good ideas accrete. |
