## Summary

<!-- What product contract or operating behavior changed, and why? -->

## Verification

- [ ] Relevant specs and implementation-status tables match the code and runtime truth.
- [ ] The full source -> build -> PRG/D64 -> emulator -> browser/download flow was checked
      for affected layers.
- [ ] Deterministic vectors and native/WASM/browser checks required for this risk pass.
- [ ] No credentials, user ROM/media, copyrighted Commodore ROMs, generated output, or
      unrelated files are included.
- [ ] Behavior-changing diff received the required model-diverse review, or this PR is
      correctly exempt under `docs/CODE-REVIEW-PANEL.md`.
- [ ] Every blocker and every review finding estimated above one minute has an explicit
      item-level `ebadger` decision recorded below; none is awaiting a decision.
- [ ] If inherited operating files changed, canonical template changes were reviewed and
      every upstream change was dispositioned.

## Model-diverse review

<!-- Delete for an exempt prose-only PR. -->
- Reviewed range: `<base-sha>...<head-sha>`
- Primary: `<model-id>`
- Reviewer 1: `<model-id>` — `<verdict>` — `<N findings>`
- Reviewer 2: `<model-id>` — `<verdict>` — `<N findings>`
- Agent-triaged findings (non-blocking, <=1 minute): `<N fixed>`, `<N overridden>`
  - Override: `<finding>` — `<checkable reason>`
- `ebadger`-decision findings: `<none, or N escalated / N fixed / N accepted / N re-scoped>`
  - Finding: `<summary>`
    - Classification: `<blocking / non-blocking>`; estimate:
      `<implementation + active validation time>`
    - Agent recommendation: `<fix / do not fix / re-scope + rationale>`
    - `ebadger` decision:
      `<implement / do not implement / re-scope; blocker status if needed>`
    - Disposition: `<fix commit / accepted-risk reason / follow-up>`

## Template reconciliation

<!-- Keep only when inherited operating files changed. -->
- Reviewed upstream range: `<previous-sha>...<reviewed-sha>`
- Adopted/adapted: `<changes or none>`
- Deferred: `<changes + follow-up, or none>`
- Not applicable: `<changes + reason, or none>`

## Related issues

<!-- Closes #123 -->
