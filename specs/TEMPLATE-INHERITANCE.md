# Template Inheritance

> Contract for keeping projects created from
> [`ebadger/AIProjectTemplate`](https://github.com/ebadger/AIProjectTemplate)
> aligned with improvements to their shared AI operating system.

## Authority boundary

`ebadger/AIProjectTemplate` is the canonical source of truth for reusable AI-project
operating machinery: instructions, governance, agent patterns, review gates, hooks,
memory practices, and their supporting scripts and documentation.

Each specialization remains the source of truth for its own mission, product behavior,
architecture, domain rules, runtime configuration, and code. An upstream template change
must never overwrite local product truth or a deliberate local adaptation without review.

Credentials, secret values, runtime status, environment/deploy state, model selections,
custom role biographies, project-earned learnings, and scheduled-workflow definitions or
run state are always specialization-owned. They are never template update payloads.

## Persistent lineage

Every specialization keeps a tracked `.template-source` file containing:

- the canonical template repository and branch;
- the exact upstream commit through which changes have been reviewed; and
- the date that checkpoint was reviewed.

The checkpoint means **reviewed through**, not necessarily copied verbatim. It advances
only after every upstream change in the range has an explicit disposition.

For c64, the initial specialization was seeded from
`ebadger/AIProjectTemplate@66a14469787860a1b08918f4089f9070680bb3e9`. The
`.template-source` checkpoint records that exact inherited commit and the date on which the
specialization review was performed. Product specs, runtime status, examples, and emulator
implementation remain c64-owned even when adjacent operating files continue to inherit
template improvements. The initial 2026-07-14 check found no upstream commits beyond that
baseline, so this specialization adapts only downstream-owned product context and retains
the applicable inherited governance.

## Required review trigger

Specializations check for template changes before modifying inherited operating-system
files. A deliberate maintenance pass may also check on demand, but the mechanism must not
create per-session reports, scheduled reconciliation commits, or a periodic ceremony.

The check is informational and fails open when the network is unavailable. Available
updates must be reviewed promptly, but they do not block urgent product work.

## Reconciliation procedure

1. Run `node scripts/dev/review-template-updates.mjs check`.
2. Inspect the reported upstream commit range and diff. Never merge the template branch
   wholesale into the specialization.
3. Give each cohesive upstream change one disposition:
   - **Adopt** — port it unchanged.
   - **Adapt** — preserve its intent while fitting local constraints.
   - **Defer** — create a tracked follow-up with an owner or revisit condition.
   - **Not applicable** — record the concrete reason.
4. Implement adopted/adapted changes specs-first and verify them in the specialization.
5. Record the reviewed range and dispositions in the PR. After every change is accounted
   for, run `node scripts/dev/review-template-updates.mjs acknowledge <upstream-commit>` and
   commit the updated `.template-source` in the same PR.
6. Never self-merge; the specialization's decision-maker approves the reconciliation.

An acknowledgement records review, not blind compliance. Security, mission, legal, and
product constraints can justify adaptation or rejection when the rationale is explicit.

## Upstream feedback loop

When a specialization discovers a reusable improvement:

1. separate the project-agnostic mechanism from domain-specific details;
2. propose the reusable part to `ebadger/AIProjectTemplate` with the originating evidence;
3. link that upstream issue or PR from the specialization; and
4. once accepted upstream, reconcile the canonical version back into the specialization.

Project-specific behavior stays local. Reusable process improvements should not remain
permanent private forks: improve the template once, then let every specialization inherit
the result.

## Implementation status

| Mechanism | Status |
|-----------|--------|
| Persistent source checkpoint | Implemented |
| Read-only upstream change check | Implemented |
| Explicit checkpoint acknowledgement | Implemented |
| Before-change and PR workflow integration | Implemented |
| c64 initial seed checkpoint | Implemented at `66a14469787860a1b08918f4089f9070680bb3e9` |
