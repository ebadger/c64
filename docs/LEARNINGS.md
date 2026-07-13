# {{PROJECT_NAME}} — Learnings (Rules Digest)

> The always-loaded **Tier 1 rules digest**: durable rules + the one-line WHY that makes
> each correct. Rare incident deep dives live in `docs/learnings/archive/`, read on demand.
>
> _This is a template seed. Replace the example rules below with your project's real,
> earned learnings. **Keep the "How this file is maintained" section** —
> it is the mechanism that keeps this file small and high-signal forever._

---

## How this file is maintained

- **Tier 1, always loaded.** This is the compact digest read at session start. Rare
  incident narratives may live in `docs/learnings/archive/`, read **on demand only**.
- **Hard cap: 2,500 tokens** (≈9,500 chars). A `pre-push` guard enforces it
  (`scripts/dev/check-learnings-budget.sh`).
- **Incident-triggered, not calendar-triggered.** Do not create per-session, daily,
  weekly, or monthly learning commits. Add a rule only for recurrence, material
  money/data/safety risk, cross-layer breakage, or costly rework.
- **Priority-based distillation.** Every accepted learning is distilled to rule-shape
  (≤ ~3–5 lines): the rule + a one-line WHY +, only when needed, an archive link.
  Adding a learning that would breach the cap is the TRIGGER to first **dedup/merge**
  existing rules; if still over, **demote** the lowest-value rule's detail to the
  archive. Never just grow the file.
- **Repository history is not a process ledger.** Routine outcomes, token counts,
  session duration, and PR commentary do not earn files here. GitHub PRs/issues remain
  the record of their own work.
- **Promotion requires {{CEO}}'s approval.** This file is excluded from the
  mechanical merge authority of agents (see Workflow Rule §5).
- **Do not strip the WHY.** Distillation removes the long narrative, never the context
  that makes a rule correct.

---

## Workflow Rules (numbered — the canonical operating contract)

**§1. Layer checklist.** Before committing a change, verify every layer it could touch
(e.g. Data store → API/Service → Client/UI, plus the umbrella spec) for impact. WHY:
missing one layer silently breaks the only path the data actually flows through.

**§2. Think in data flow, not documents.** Specify every link of
`User action → request → server logic → write → read → response → render`.

**§3. Specs before code.** Specs are the source of truth; code follows specs. Update the
spec in the same change.

**§4. Commit atomically across layers.** A feature spanning multiple specs/layers updates
them all in one commit so history is consistent at every point.

**§5. Never self-merge.** Always open a PR and give {{CEO}} the link; merging is {{CEO}}'s
call, with no agent auto-merge exception. WHY: human merge authority is the final check on
agent self-modification. After any pull, reset, or branch change, re-read instruction files
that may have changed before continuing.

**§6. Always check PR state before pushing.** `git fetch origin {{DEFAULT_BRANCH}}` then
`gh pr view <n> --json state`; if **MERGED**, branch fresh off `origin/{{DEFAULT_BRANCH}}`
and open a new PR. WHY: pushing to a merged branch orphans the commit. Backed by the
`.githooks/pre-push` guard (`scripts/dev/install-hooks.sh`); it **fails open** when `gh`
is unavailable and is overridable with `SKIP_PR_GUARD=1` — a backstop, not a replacement
for the check.

**§7. Reconcile with the canonical project template.** Before changing inherited
operating files, run `node scripts/dev/review-template-updates.mjs check` and disposition
every pending upstream change as adopt, adapt, defer, or not applicable. Advance
`.template-source` only after all changes are accounted for, and propose reusable local
improvements back to
`ebadger/AIProjectTemplate`. WHY: private process forks drift and force every AI project to
rediscover the same improvements. The template governs shared operating machinery, never a
specialization's product truth; see `specs/TEMPLATE-INHERITANCE.md`.

**Worktree hygiene.** Never `git checkout`/merge `{{DEFAULT_BRANCH}}` from a session
worktree — branch off `origin/{{DEFAULT_BRANCH}}`. Don't rely on `--delete-branch` in a
worktree; verify `gh pr view <n> --json state,mergedAt` before retrying, and delete
branches explicitly (`git branch -D` + `git push origin --delete`).

---

## Seed engineering rules (universal — keep or prune to taste)

- **A documented-but-unbuilt endpoint is a tracked gap, not a freebie.** Grep the client
  for hardcoded/demo data papering over it.
- **Frontends must NEVER fabricate domain data** for a missing endpoint — render an
  explicit empty/"not available" state. WHY: a `// demo` placeholder ships looking
  identical to a real feature. After finding one, grep ALL screens for mock-derived literals.
- **Service/unit tests do NOT prove an HTTP-contract feature works.** Do a **live
  end-to-end smoke through the real endpoints** against the real data store before "done."
- **Enforce critical invariants in TWO places:** an app-level guard *and* a store-level
  constraint (e.g. a unique index), plus a test proving the constraint actually blocks the
  violation.
- **"Passes on an in-memory/dev store but fails on the real one" is the default risk** for
  any constraint that lives only in the production schema. Test constraints against a real
  instance of your production engine.

---

## Project-specific clusters (fill these in)

> Add topic-clustered rules here only as the project earns them — e.g. `## Data & money
> paths`, `## Frontend / caching`, `## Deploy / ops`. Merge overlapping rules into the
> relevant cluster **under the cap**.

---

*Topic-clustered and priority-distilled, not chronological — new learnings merge into the
relevant cluster under the cap (see "How this file is maintained").*
