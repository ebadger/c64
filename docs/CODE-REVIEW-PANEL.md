# Code-Review Panel — Model-Diverse Review

Behavior-changing PRs receive two independent reviews through the runtime's actual
read-only `code-review` specialist. The reviewers are selected relative to the primary
model, not from a permanent roster. Reviewer findings are **advisory input**: they
sharpen the primary's judgment, they do not by themselves obligate a fix, a human
escalation, or another review cycle. ebadger decides the priority of the small set of
findings that clear the materiality bar below.

This gate exists to catch real defects, not to run an unbounded audit. Preserve reviewer
independence and their raw evidence, but raise the bar for *acting* on that evidence to
the materiality standard defined here.

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
4. If two meaningfully diverse alternatives are unavailable, stop and tell ebadger the
   review gate cannot be satisfied. Do not silently reuse the primary.

Do not create or invoke standing reviewer agents. Invoke `task` twice with
`agent_type: "code-review"` and an explicit `model` parameter. That specialist is
read-only and reviews the repository diff directly.

## Materiality standard (how findings become actionable)

A reviewer finding is **advisory** until the primary independently validates all three of:

1. **Reproducible case** — a concrete input or sequence the primary can point to, not a
   hypothetical.
2. **Supported, reachable contract violation** — the behavior actually violates a spec or
   documented contract on a path the product supports and can reach; not an out-of-contract
   or unreachable construction.
3. **Material impact** — the effect matters under the release-blocking definition below or
   is otherwise a real user- or mission-affecting problem.

Only a finding the primary has validated on all three points is treated as a **confirmed
defect** eligible for a fix or escalation. Everything else is advisory: fix it if it is
genuinely trivial and correct, otherwise record it as a follow-up or a checkable override.

### Release-blocking impact (closed list)

A finding is **release-blocking** only when it is a confirmed defect in one of these
classes:

- security or privacy exposure;
- data corruption or wrong output on realistic supported input;
- data loss;
- crashes;
- common-path (typical supported usage) regression; or
- build or deploy failure.

Everything else is **non-blocking by default**, including theoretical or pathological edge
cases, optional hardening, defense-in-depth suggestions, style or docs nits, and
speculative "could this ever…" concerns. These become follow-ups when worth tracking, not
release gates.

### Classification and override

Preserve every reviewer's original blocking/non-blocking classification verbatim in the
record. The primary may **downgrade or override** a reviewer's classification by recording
a concise, checkable reason (for example: the input is out of contract, the path is
unreachable, the impact is immaterial, or the case does not reproduce). A reviewer using
the word "blocking" — on its own, without a validated release-blocking defect — does **not**
force human escalation; the validated materiality standard governs, not the label.

## Procedure

1. Finish and validate the implementation, then commit the candidate.
2. Record:
   - `BASE=$(git merge-base origin/main HEAD)`
   - `HEAD=$(git rev-parse HEAD)`
3. Independently invoke the two selected reviewers on the committed
   `<BASE>...<HEAD>` range. Give each the relevant spec/test context, not the author's
   defense of the change. Ask each reviewer to label every finding blocking or
   non-blocking and explain any blocking designation.
4. For each finding, apply the materiality standard: validate (or fail to validate) the
   reproducible case, the supported/reachable contract violation, and material impact.
   Preserve the reviewer's original classification, record your validation outcome, and
   estimate the implementation plus active validation effort for any confirmed defect.
5. Send only findings that clear the escalation gate below through ebadger before fixing,
   overriding a validated blocker's blocking status, deferring, or otherwise disposing of
   them. Dispose of everything else yourself under this policy.
6. If any finding is gated, present all decision packets and wait for every item-level
   decision. Do not edit, stage, commit, or re-run review on the candidate while a decision
   is pending.
7. Apply ebadger's decision for each gated finding:
   - **Implement now** — fix it in the current change.
   - **Do not implement** — leave it unchanged and record the accepted risk or override
     reason. For a blocker, ebadger also explicitly decides that it does not block.
   - **Re-scope or defer** — remove the affected scope or create the directed tracked
     follow-up.
8. Triage every finding that does not clear the escalation gate: fix it when it is a
   validated, genuinely trivial defect, or record a short, checkable reason for treating it
   as an override or a follow-up. This is the primary's call and does not pause for
   ebadger.
9. If a fix or re-scope changes `HEAD`, commit it and re-review — but see the delta-review
   and convergence rules below. The recorded `HEAD` must be the reviewed commit.

Do not copy verbatim reviewer transcripts into a process ledger, create scorecard
reports, or schedule review harvesting. The PR record is enough.

## Delta-focused re-review

The **initial** review covers the full candidate range. **Re-review after fixes is
delta-focused**: review only the new commits (the fixes) and the regression surface they
plausibly affect — not a fresh audit of unchanged code that already passed the initial
review.

- Match every re-review finding by substance against prior ebadger decisions and prior
  dispositions. Do not resurface an already-disposed finding on unchanged code.
- A new, unrelated, non-material finding discovered late is a **follow-up**, not a reason to
  restart the loop.
- Carry a prior ebadger decision forward without re-escalation. **Accepted human decisions
  are not re-litigated** unless the evidence, impact, or affected scope has materially
  changed; only then does it become a new gated finding.

## Convergence / stop condition

Stop reviewing and open the PR once **all** of these hold:

- the last commit's delta introduced no new confirmed release-blocking defect;
- no gated finding is awaiting an ebadger decision; and
- every remaining finding is disposed as a fix, a checkable override, or a tracked
  follow-up.

Re-review is bounded to the fix delta plus its regression surface. It does not reopen
unchanged code, already-accepted ebadger decisions, or non-material findings. If reviewers
keep surfacing only non-material or already-disposed points, the loop has converged —
record them as follow-ups and stop.

## ebadger decision gate

A finding enters this gate only when it is one of:

- an **independently validated release blocker** (a confirmed defect in a release-blocking
  class above that the primary has validated on all three materiality points and does not
  override); or
- a **material scope change** (the fix meaningfully changes what the PR does or its
  contract); or
- work whose **implementation plus active validation the primary estimates at more than 30
  minutes**.

The 30-minute test excludes passive wait time but includes the edits and active validation
needed for a complete fix. When genuinely uncertain whether a finding is a validated
release blocker or whether the estimate exceeds 30 minutes, escalate. A reviewer's
"blocking" label alone, an unvalidated concern, or a non-material edge case does **not**
enter this gate.

For each gated finding, present ebadger with:

- **Finding and classification:** a faithful, concise summary, its reviewer/source, the
  reviewer's original classification, and the primary's validation outcome (including any
  override reason).
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
undecided item `awaiting ebadger decision`.

## PR record

```text
## Model-diverse review
- Reviewed range: `<base-sha>...<head-sha>` (initial); re-review deltas: `<sha..sha, or none>`
- Primary: `<model-id>`
- Reviewer 1: `<model-id>` — `<verdict>` — `<N findings>`
- Reviewer 2: `<model-id>` — `<verdict>` — `<N findings>`
- Materiality triage: `<N confirmed defects>`, `<N advisory/not-validated>`, `<N follow-ups>`
  - Override: `<finding>` — reviewer class `<blocking/non-blocking>` → `<checkable reason>` (omit when none)
- ebadger-decision findings: `<none, or N escalated / N fixed / N accepted / N re-scoped>`
  - Finding: `<summary>`
    - Reviewer classification (preserved): `<blocking / non-blocking>`
    - Primary validation: `<validated release blocker / material scope change / >30min; + evidence>`
    - Effort estimate: `<implementation + active validation time>`
    - Agent recommendation: `<fix / do not fix / re-scope + rationale>`
    - ebadger decision:
      `<implement / do not implement / re-scope; blocker status if needed>`
    - Disposition: `<fix commit / accepted-risk reason / follow-up>`
- Convergence: `<confirmed — no new release-blocking defect in last delta; none awaiting decision>`
```

Reviewers advise, the primary validates findings and owns their disposition under the
materiality standard, ebadger decides the priority of every validated release blocker,
material scope change, or >30-minute item, and only ebadger merges.
