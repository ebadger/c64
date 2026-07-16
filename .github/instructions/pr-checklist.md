# PR check

Before opening a behavior-changing PR:

1. Confirm specs, affected layers, and implementation status agree.
2. Run the tests/evals required for the changed risk surface.
3. If inherited operating files changed, run the canonical template check and account for
   every upstream change under `specs/TEMPLATE-INHERITANCE.md`.
4. Commit the candidate and record its merge-base and HEAD SHAs.
5. Run two independent `code-review` specialists with explicit model IDs selected
   relative to the primary. For each finding, apply the materiality standard in
   `docs/CODE-REVIEW-PANEL.md`: validate (or fail to validate) a reproducible case, a
   supported/reachable contract violation, and material impact. Preserve each reviewer's
   original classification and estimate implementation plus active validation effort.
6. Escalate to ebadger only an independently validated release blocker, a material scope
   change, or a finding estimated above 30 minutes. Present each through the active session
   with its evidence, effort, and the agent's recommendation. Obtain an explicit item-level
   decision for each; if the execution context cannot request and await one, report the
   work blocked and stop.
7. After all decisions arrive, apply them and dispose of everything that did not clear the
   gate as a trivial validated fix, a checkable override, or a tracked follow-up.
8. Re-review after fixes is delta-focused on the new commits and their regression surface,
   not a fresh audit of unchanged code; do not re-litigate accepted decisions absent
   materially changed evidence, impact, or scope. Confirm the convergence condition holds
   and no gated finding awaits a decision, then put the compact SHA/model and decision
   record from `docs/CODE-REVIEW-PANEL.md` in the PR body.
9. Open the PR for ebadger and stop. Never merge it.

For runtime/deploy changes, update `status/SYSTEM-STATUS.md` without adding secret values.
