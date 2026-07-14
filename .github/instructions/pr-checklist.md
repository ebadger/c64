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
6. Before acting on review feedback, present every blocker and every finding estimated
   above one minute through the active session with its evidence, effort, and the agent's
   recommendation. Obtain an explicit item-level decision for each; if the execution
   context cannot request and await one, report the work blocked and stop.
7. After all decisions arrive, apply them and triage non-blocking findings estimated at one
   minute or less.
8. Re-run both reviewers after fixes or re-scoping. Confirm no gated finding awaits a
   decision and put the compact SHA/model and decision record from
   `docs/CODE-REVIEW-PANEL.md` in the PR body.
9. Open the PR for {{CEO}} and stop. Never merge it.

For runtime/deploy changes, update `status/SYSTEM-STATUS.md` without adding secret values.
