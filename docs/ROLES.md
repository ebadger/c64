# c64 — Lenses & Gates

The main session does the work. Optional custom agents are narrow specialist lenses, not
executives, biographies, or a hierarchy. ebadger owns product direction and merge
authority, including the item-level disposition of every independently validated release
blocker, material scope change, and review finding above the 30-minute implementation
threshold. The primary validates reviewer findings and disposes of everything else under
the materiality standard in `docs/CODE-REVIEW-PANEL.md`.

## Optional lenses

Create a lens only after a recurring, expensive decision class proves that general
repository instructions are insufficient. Start from `.github/agents/template-agent.md`,
declare least-privilege tools, and delete it when it no longer earns maintenance cost.

Do not seed projects with role rosters, personality biographies, dynamic runbooks, or
fixed model assumptions.

## Gates and controls

1. **Human merge authority.** Agents open PRs and stop; only ebadger merges through
   GitHub. Host pre-tool hook decisions are not an enforcement boundary.
2. **Specs and data flow.** Behavior changes update the relevant spec and trace affected
   source/assembler → artifact → emulator/device → bridge → client links.
3. **Dead branches stay dead.** `.githooks/pre-push` blocks a confirmed merged/closed PR
   branch before running expensive tests.
4. **Capped durable memory.** `docs/LEARNINGS.md` receives incident-triggered rules, not
   calendar reports.
5. **Model-diverse review.** Behavior-changing PRs use two explicit, runtime-available,
   read-only reviewer models selected relative to the primary. Reviewer findings are
   advisory until the primary validates a reproducible case, a supported/reachable contract
   violation, and material impact. Only an independently validated release blocker, a
   material scope change, or a finding estimated above 30 minutes pauses agent disposition
   until ebadger receives its evidence, effort estimate, and agent recommendation and
   decides its priority; re-review is delta-focused and accepted decisions are not
   re-litigated absent materially changed evidence, impact, or scope.
6. **Risk-based deterministic tests.** Configured critical-path evals are path-scoped and
   non-bypassable; routine tests may have a deliberate escape hatch.
7. **Deliberate template reconciliation.** Check canonical changes before modifying
   inherited operating files; never overwrite downstream-owned state or turn the check
   into scheduled reporting.
8. **Mission clock over org clock.** Delete or consolidate freely. Do not add agents,
   dashboards, ceremonies, scheduled governance, or meta-docs while higher-priority
   product needs remain.
9. **Self-modification needs ebadger.** Agents propose governance changes but never approve
   or merge them.

Disagreements and decision-gated review findings should identify evidence, effort, and
trade-offs, state the agent's recommendation, then leave the item-level scope decision to
ebadger. Handoffs should point to the relevant PR, issue, or commit rather than duplicate
its contents in a ledger.
