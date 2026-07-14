# c64 — Learnings (Rules Digest)

> The always-loaded **Tier 1 rules digest**: durable rules + the one-line WHY that makes
> each correct. Rare incident deep dives live in `docs/learnings/archive/`, read on demand.
>
> c64 has no incident-derived product lessons yet. This file retains the inherited workflow
> contract plus mission-derived product invariants; add incident learnings only when they
> meet the thresholds below.

---

## How this file is maintained

- **Tier 1, always loaded.** This is the compact digest read at session start. Rare
  incident narratives may live in `docs/learnings/archive/`, read **on demand only**.
- **Hard cap: 2,500 tokens** (≈9,500 chars). A `pre-push` guard enforces it
  (`scripts/dev/check-learnings-budget.sh`).
- **Incident-triggered, not calendar-triggered.** Do not create per-session, daily,
  weekly, or monthly learning commits. Add a rule only for recurrence, material
  artifact/legal/privacy risk, cross-layer breakage, or costly rework.
- **Priority-based distillation.** Every accepted learning is distilled to rule-shape
  (≤ ~3–5 lines): the rule + a one-line WHY +, only when needed, an archive link.
  Adding a learning that would breach the cap is the TRIGGER to first **dedup/merge**
  existing rules; if still over, **demote** the lowest-value rule's detail to the
  archive. Never just grow the file.
- **Repository history is not a process ledger.** Routine outcomes, token counts,
  session duration, and PR commentary do not earn files here. GitHub PRs/issues remain
  the record of their own work.
- **Promotion requires ebadger's approval.** Agents propose the change through the normal
  PR process (see Workflow Rule §5).
- **Do not strip the WHY.** Distillation removes the long narrative, never the context
  that makes a rule correct.

---

## Workflow Rules (numbered — the canonical operating contract)

**§1. Layer checklist.** Before committing a change, verify every layer it could touch
(source/assembler → PRG/D64 → machine core/devices → WASM bridge → web client, plus the
umbrella spec). WHY: missing one layer silently breaks the only path the bytes or machine
state actually follow.

**§2. Think in data flow, not documents.** Specify every link of
`User edit/import/input → normalization → build/machine transition → artifact or device
state → browser presentation/download`.

**§3. Specs before code.** Specs are the source of truth; code follows specs. Update the
spec in the same change.

**§4. Commit atomically across layers.** A feature spanning multiple specs/layers updates
them all in one commit so history is consistent at every point.

**§5. Never self-merge.** Always open a PR and give ebadger the link; merging is ebadger's
call, with no agent auto-merge exception. WHY: human merge authority is the final check on
agent self-modification. Copilot pre-tool hooks are host-dependent prompts, not a proven
block on host tool execution; rely on human/GitHub approval. After any pull, reset, or
branch change, re-read instruction files that may have changed before continuing.

**§6. Always check PR state before pushing.** `git fetch origin main` then
`gh pr view <n> --json state`; if **MERGED**, branch fresh off `origin/main`
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

**§8. Escalate blockers and >1-minute review work before acting.** Present every blocking
finding and any finding estimated to require more than one minute to implement and validate
to ebadger with its evidence, risk/value, effort estimate, and the agent's recommendation to
fix, not fix, or re-scope it. Obtain an explicit item-level decision before disposition.
WHY: even non-blocking feedback can silently redirect execution away from ebadger's intent;
only non-blocking findings at or below one minute remain agent-triaged. See
`docs/CODE-REVIEW-PANEL.md`.

**Worktree hygiene.** Never `git checkout`/merge `main` from a session
worktree — branch off `origin/main`. Don't rely on `--delete-branch` in a
worktree; verify `gh pr view <n> --json state,mergedAt` before retrying, and delete
branches explicitly (`git branch -D` + `git push origin --delete`).

---

## c64 product invariants

- **A specified-but-unbuilt emulator feature is a tracked gap, not a demo opportunity.**
  Render it as unavailable and keep implementation status honest.
- **Determinism spans the full artifact path.** Shared source must rebuild byte-identical
  PRG and D64 output, and browser/headless execution must use the same production WASM core.
- **ROM provenance is part of correctness.** Never commit or fetch copyrighted Commodore
  ROMs; bundle only reviewed redistributable replacements and keep user bytes local.
- **Hardware scope stops at files.** Standard PRG/D64 downloads are supported; custom
  transfer devices, firmware, PCB/HDL, and other physical 3RIC work are not.

---

*Topic-clustered and priority-distilled, not chronological — new learnings merge into the
relevant cluster under the cap (see "How this file is maintained").*
