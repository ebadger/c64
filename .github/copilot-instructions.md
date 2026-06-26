# Copilot Instructions for {{PROJECT_NAME}}

## Before Starting Any Work

Read these at session start (the `compliance-hooks` extension also injects the start
checklist automatically):

1. `docs/LEARNINGS.md` — **canonical** workflow rules (§1–6) + distilled lessons (the
   always-loaded Tier-1 digest, capped ~2,500 tokens). This is the source of truth for how
   we work; the rules below are a pointer, not a second copy. Full incident narratives live
   in `docs/learnings/` — read on demand.
2. `docs/MISSION.md` — organization purpose and operating principles.
3. `specs/SYSTEM.md` — umbrella overview of the system + links to every sub-spec.
4. `status/SYSTEM-STATUS.md` — runtime env, credentials, scripts, verification commands.

Then read **only the sub-spec(s) for the layer you'll actually touch** — don't load all of
them speculatively. Deep dives (runbooks, changelog) are read on demand, not at start-up.

## How We Work (canonical: docs/LEARNINGS.md §1–6)

- **Specs first, code second.** Update specs before implementing.
- **Trace all layers** for any stored-data feature: Data store → API/Service → Client.
- **Never self-merge.** Always open a PR and give {{CEO}} the link in the chat.
- **Commit atomically** across specs/layers.
- **Check PR state before pushing** (`gh pr view <n> --json state`).
- **Mission clock > org clock.** Don't create net-new org/process artifacts while the
  product has unmet, higher-priority needs — fix the product first. Slimming org machinery
  is always fine; adding it waits. (See `docs/ROLES.md` gates.)
- After implementing, **update the implementation status** in the relevant spec.
- See a better way to work? Add it to `docs/SUGGESTIONS.md`.

## Project Context

- **Stack**: {{STACK}}
- **Domain**: {{ONE_LINE_DOMAIN_DESCRIPTION}}
- **Layers**: {{e.g. Data store (Postgres) → API (service) → Client (web/mobile)}}
- **Dev environment**: {{how/where the project is built and run locally}}
- **Production**: {{where it runs in prod, and the URL if public}}

## Code Style

- {{Language/framework conventions — point at existing examples in the repo.}}
- {{Naming conventions, e.g. snake_case in SQL, camelCase in JSON.}}
