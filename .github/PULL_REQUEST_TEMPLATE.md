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
- [ ] Reviewer findings were validated against the materiality standard; every
      independently validated release blocker, material scope change, and finding above 30
      minutes has an explicit item-level `ebadger` decision recorded below, and none is
      awaiting a decision.
- [ ] The review reached the convergence condition in `docs/CODE-REVIEW-PANEL.md` (no new
      release-blocking defect in the last delta; all findings disposed as fix, override, or
      follow-up).
- [ ] If inherited operating files changed, canonical template changes were reviewed and
      every upstream change was dispositioned.

## Model-diverse review

<!-- Delete for an exempt prose-only PR. -->
- Reviewed range: `<base-sha>...<head-sha>` (initial); re-review deltas: `<sha..sha, or none>`
- Primary: `<model-id>`
- Reviewer 1: `<model-id>` — `<verdict>` — `<N findings>`
- Reviewer 2: `<model-id>` — `<verdict>` — `<N findings>`
- Materiality triage: `<N confirmed defects>`, `<N advisory/not-validated>`, `<N follow-ups>`
  - Override: `<finding>` — reviewer class `<blocking/non-blocking>` → `<checkable reason>`
- `ebadger`-decision findings: `<none, or N escalated / N fixed / N accepted / N re-scoped>`
  - Finding: `<summary>`
    - Reviewer classification (preserved): `<blocking / non-blocking>`
    - Primary validation: `<validated release blocker / material scope change / >30min; + evidence>`
    - Effort estimate: `<implementation + active validation time>`
    - Agent recommendation: `<fix / do not fix / re-scope + rationale>`
    - `ebadger` decision:
      `<implement / do not implement / re-scope; blocker status if needed>`
    - Disposition: `<fix commit / accepted-risk reason / follow-up>`
- Convergence: `<confirmed — no new release-blocking defect in last delta; none awaiting decision>`

## Template reconciliation

<!-- Keep only when inherited operating files changed. -->
- Reviewed upstream range: `<previous-sha>...<reviewed-sha>`
- Adopted/adapted: `<changes or none>`
- Deferred: `<changes + follow-up, or none>`
- Not applicable: `<changes + reason, or none>`

## Related issues

<!-- Closes #123 -->
