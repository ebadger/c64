# {{PROJECT_NAME}} — Incident Learning Archive

`docs/LEARNINGS.md` is the capped, always-loaded rules digest. This directory is only for
rare deep dives needed to explain a durable rule; it is not a session log or reporting
cadence.

## When an archive file is justified

Create one only when the event meets at least one threshold:

1. The same failure class recurred.
2. It caused or plausibly risked material money, data, safety, or authorization harm.
3. It exposed cross-layer or contract breakage.
4. It caused substantial rework and the root cause cannot be explained by a short rule.

Routine successes, token reports, session duration, PR summaries, and one-off trivia stay
out of the repository. GitHub PRs and issues already record their own history.

## Format

Use `archive/YYYY-MM-DD-short-slug.md` and keep it factual:

- impact and evidence;
- root cause;
- the durable rule promoted to `docs/LEARNINGS.md`;
- links to the source PR/issue when available.

Archive files and rule promotions use the normal PR process. Agents never self-merge them.
