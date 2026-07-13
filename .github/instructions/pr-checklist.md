# PR check

Before opening a behavior-changing PR:

1. Confirm specs, affected layers, and implementation status agree.
2. Run the tests/evals required for the changed risk surface.
3. If inherited operating files changed, run the canonical template check and account for
   every upstream change under `specs/TEMPLATE-INHERITANCE.md`.
4. Commit the candidate and record its merge-base and HEAD SHAs.
5. Run two independent `code-review` specialists with explicit model IDs selected
   relative to the primary; triage findings and re-run after material fixes.
6. Put the compact SHA/model record from `docs/CODE-REVIEW-PANEL.md` in the PR body.
7. Open the PR for {{CEO}} and stop. Never merge it.

For runtime/deploy changes, update `status/SYSTEM-STATUS.md` without adding secret values.
