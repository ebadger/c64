# PR check

Before opening a behavior-changing PR:

1. Confirm specs, affected layers, and implementation status agree.
2. Run the tests/evals required for the changed risk surface.
3. If inherited operating files changed, run the canonical template check and account for
   every upstream change under `specs/TEMPLATE-INHERITANCE.md`.
4. Commit the candidate and record its merge-base and HEAD SHAs.
5. Run two independent `code-review` specialists with explicit model IDs selected
   relative to the primary; classify each finding and estimate implementation plus active
   validation effort.
6. Triage only non-blocking findings estimated at one minute or less. Before acting on any
   blocker or finding estimated above one minute, present its evidence, effort, and the
   agent's recommendation to {{CEO}} and obtain an explicit item-level decision.
7. Re-run both reviewers after fixes or re-scoping. Confirm no gated finding awaits a
   decision and put the compact SHA/model and decision record from
   `docs/CODE-REVIEW-PANEL.md` in the PR body.
8. Open the PR for {{CEO}} and stop. Never merge it.

For runtime/deploy changes, update `status/SYSTEM-STATUS.md` without adding secret values.
