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

## Persistent lineage

Every specialization keeps a tracked `.template-source` file containing:

- the canonical template repository and branch;
- the exact upstream commit through which changes have been reviewed; and
- the date that checkpoint was reviewed.

The checkpoint means **reviewed through**, not necessarily copied verbatim. It advances
only after every upstream change in the range has an explicit disposition.

## Required review triggers

Specializations check for template changes:

1. at the start of every working session;
2. before changing inherited operating-system files; and
3. during the Process & Learning periodic retrospective.

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
| Session-start and PR workflow integration | Implemented |
