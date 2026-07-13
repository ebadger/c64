# AIProjectTemplate

**A small, reusable governance layer for software projects operated with AI agents.**

This repository is not an application skeleton. It provides durable project instructions,
spec discipline, human merge authority, mechanical pre-push guards, deliberate template
lineage, and model-diverse review without importing a standing AI organization.

## Controls worth inheriting

1. **Capped, incident-triggered memory.** `docs/LEARNINGS.md` contains only durable rules
   that meet a recurrence or material-risk/rework threshold. Rare narratives live in
   `docs/learnings/archive/`; there are no daily, weekly, or monthly learning reports.
2. **Mechanical authority boundaries.** The Copilot extension denies agent self-merge.
   The git pre-push hook blocks confirmed merged/closed PR branches and configured test
   failures.
3. **Specs and data flow.** Behavior changes update the relevant spec and trace every
   affected Data store → API/Service → Client link.
4. **Relative model-diverse review.** Two runtime-available, read-only `code-review`
   specialists use explicit model IDs selected relative to the primary. Exact SHAs and
   models are recorded in the PR, without a duplicate review ledger.
5. **Deliberate inheritance.** `.template-source` records the reviewed canonical commit;
   a read-only updater reports changes for adopt/adapt/defer/not-applicable review without
   overwriting local product truth.
6. **Mission-clock discipline.** Product work outranks new agents, dashboards, scheduled
   governance, ceremonies, and meta-documentation. Deletion is always allowed.

## Repository map

```text
.github/
  copilot-instructions.md
  agents/template-agent.md
  instructions/
  extensions/compliance-hooks/
.githooks/pre-push
.template-source
scripts/dev/
  instantiate.sh
  review-template-updates.mjs
docs/
  LEARNINGS.md
  learnings/archive/
  MISSION.md
  ROLES.md
  CODE-REVIEW-PANEL.md
specs/
  SYSTEM.md
  TEMPLATE-INHERITANCE.md
status/SYSTEM-STATUS.md
SETUP.md
```

## Inheritance boundary

`scripts/dev/instantiate.sh` performs one-time bootstrap. Later,
`review-template-updates.mjs` only reports canonical changes and advances a reviewed
checkpoint after explicit reconciliation; it never copies files automatically.

| Durable template material | Downstream-owned; never overwrite or propagate |
|---------------------------|-----------------------------------------------|
| Generic merge/test guards and their tests | Credentials, secret values, or secret-store output |
| Generic review and specs/data-flow policy | Runtime status, environment values, deploy state |
| Minimal least-privilege agent skeleton | Model pins, agent rosters, role biographies, dynamic runbooks |
| Capped-memory and lineage mechanisms | Mission/spec content, learned project rules, scheduled-workflow records |

Do not copy scheduler databases, disabled workflow records, or communication state between
projects. Check lineage before changing inherited operating files, not as a recurring
commit/report ceremony.

See [`SETUP.md`](./SETUP.md) to instantiate the template.
