# Code-Review Panel — Model-Diverse Review

Behavior-changing PRs receive two independent reviews through the runtime's actual
read-only `code-review` specialist. The reviewers are selected relative to the primary
model, not from a permanent roster.

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
   defense of the change.
4. Triage every material finding:
   - fix a true positive;
   - or record a short, checkable reason for overriding it.
5. If fixes change `HEAD`, commit them and repeat both reviews on the new exact range.
   The recorded `HEAD` must be the reviewed commit.
6. Put the compact record below in the PR body and open the PR for {{CEO}}.

Do not copy verbatim reviewer transcripts into a process ledger, create scorecard
reports, or schedule review harvesting. The PR record is enough.

## PR record

```text
## Model-diverse review
- Reviewed range: `<base-sha>...<head-sha>`
- Primary: `<model-id>`
- Reviewer 1: `<model-id>` — `<verdict>` — `<N findings>`
- Reviewer 2: `<model-id>` — `<verdict>` — `<N findings>`
- Resolution: `<N fixed>`, `<N overridden>`
  - Override: `<finding>` — `<checkable reason>` (omit when none)
```

An unresolved blocking finding goes to {{CEO}}. Reviewers advise, the primary triages,
and only {{CEO}} merges.
