# Code-Review Panel — Model-Diverse Review

Behavior-changing PRs receive two independent reviews through the runtime's actual
read-only `code-review` specialist. The reviewers are selected relative to the primary
model, not from a permanent roster. Every blocker and every finding estimated to take more
than one minute to implement and validate is a decision checkpoint for {{CEO}}, not
something an agent may silently resolve or dismiss.

## Scope

Run the panel for application code, specs, schema/migrations, API or client contracts,
behavior-defining configuration, build/deploy code, custom agents, instructions, and
compliance hooks. Narrative prose, status-only updates, comments, and typo fixes are
exempt unless they change behavior.

## Select reviewers at runtime

1. Record the primary model's exact ID.
2. Inspect the models currently available to the `task` tool.
3. Choose two explicit reviewer model IDs:
   - neither may be the primary model;
   - prefer a different provider/model family from the primary;
   - prefer different providers/model families from each other.
4. If two meaningfully diverse alternatives are unavailable, stop and tell {{CEO}} the
   review gate cannot be satisfied. Do not silently reuse the primary.

Do not create or invoke standing reviewer agents. Invoke `task` twice with
`agent_type: "code-review"` and an explicit `model` parameter. That specialist is
read-only and reviews the repository diff directly.

## Procedure

1. Finish and validate the implementation, then commit the candidate.
2. Record:
   - `BASE=$(git merge-base origin/{{DEFAULT_BRANCH}} HEAD)`
   - `HEAD=$(git rev-parse HEAD)`
3. Independently invoke the two selected reviewers on the committed
   `<BASE>...<HEAD>` range. Give each the relevant spec/test context, not the author's
   defense of the change. Ask each reviewer to label every finding blocking or
   non-blocking and explain any blocking designation.
4. Before acting, classify every finding and estimate the implementation plus required
   validation effort. Preserve every reviewer's blocking designation.
5. Send every blocker and every finding estimated above one minute through the decision
   gate below before fixing, overriding, downgrading, deferring, or otherwise disposing of
   it.
6. If any finding is gated, present all decision packets and wait for every item-level
   decision. Do not edit, stage, commit, or re-run review on the candidate while a decision
   is pending.
7. Apply {{CEO}}'s decision for each gated finding:
   - **Implement now** — fix it in the current change.
   - **Do not implement** — leave it unchanged and record the accepted risk or override
     reason. For a blocker, {{CEO}} also explicitly decides that it does not block.
   - **Re-scope or defer** — remove the affected scope or create the directed tracked
     follow-up.
8. Triage findings that are both non-blocking and estimated at one minute or less: fix a
   true positive or record a short, checkable reason for overriding it.
9. If a fix or re-scope changes `HEAD`, commit it and repeat both reviews on the new exact
   range. The recorded `HEAD` must be the reviewed commit.
10. On re-review, match findings by substance against prior {{CEO}} decisions. Carry a
    decision forward without re-escalation only when the affected scope, classification,
    evidence, and recommendation are materially unchanged; otherwise treat it as a new
    gated finding and return to step 5.
11. Confirm no gated finding is awaiting a decision, put the compact record below in the PR
   body, and open the PR for {{CEO}}.

Do not copy verbatim reviewer transcripts into a process ledger, create scorecard
reports, or schedule review harvesting. The PR record is enough.

## {{CEO}} decision gate

A finding enters this gate when either condition is true:

- a reviewer labels it blocking, says it must be fixed before merge, or the primary raises
  it to blocking; or
- the primary estimates that implementation plus required validation will take more than
  one minute.

The one-minute test applies regardless of severity, including medium- and low-severity
feedback. It excludes passive wait time but includes the edits and active validation needed
for a complete fix. When uncertain whether the estimate exceeds one minute, escalate. The
primary must not relabel reviewer-blocking feedback as non-blocking before escalation.

For each gated finding, present {{CEO}} with:

- **Finding and classification:** a faithful, concise summary, its reviewer/source, and
  whether it is blocking.
- **Evidence and risk/value:** the affected behavior, likely impact or benefit, and material
  uncertainty.
- **Effort estimate:** the expected implementation and active validation time.
- **Agent recommendation:** fix now, do not fix, or re-scope/defer, with the rationale and
  expected scope or trade-off.
- **Decision requested:** whether to spend current-change scope on this specific item and,
  for a blocker, whether it blocks the change.

Present findings through the active session's human-decision channel and pause for the
answer. If the execution context cannot request and await a decision, report the work
blocked and stop; do not represent the review as complete or open the PR. Multiple findings
may be presented together for context, but each requires a distinct decision. Mark every
undecided item `awaiting {{CEO}} decision`.

## PR record

```text
## Model-diverse review
- Reviewed range: `<base-sha>...<head-sha>`
- Primary: `<model-id>`
- Reviewer 1: `<model-id>` — `<verdict>` — `<N findings>`
- Reviewer 2: `<model-id>` — `<verdict>` — `<N findings>`
- Agent-triaged findings (non-blocking, <=1 minute): `<N fixed>`, `<N overridden>`
  - Override: `<finding>` — `<checkable reason>` (omit when none)
- {{CEO}}-decision findings: `<none, or N escalated / N fixed / N accepted / N re-scoped>`
  - Finding: `<summary>`
    - Classification: `<blocking / non-blocking>`; estimate:
      `<implementation + active validation time>`
    - Agent recommendation: `<fix / do not fix / re-scope + rationale>`
    - {{CEO}} decision:
      `<implement / do not implement / re-scope; blocker status if needed>`
    - Disposition: `<fix commit / accepted-risk reason / follow-up>`
```

Reviewers advise, the primary owns trivial non-blocking triage and recommendations,
{{CEO}} decides the priority of every gated finding, and only {{CEO}} merges.
