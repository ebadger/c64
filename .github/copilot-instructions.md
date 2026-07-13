# Copilot Instructions for {{PROJECT_NAME}}

## Start with durable context

Read these before work:

1. `docs/LEARNINGS.md` — canonical workflow rules and capped durable lessons.
2. `docs/MISSION.md` — purpose and operating principles.
3. `specs/SYSTEM.md` — system overview and links to layer specs.

Read only the sub-specs needed for the task. Read `status/SYSTEM-STATUS.md` only for
runtime, deployment, environment, or verification work; it is not startup context.

Before changing inherited operating files, run
`node scripts/dev/review-template-updates.mjs check` and read
`specs/TEMPLATE-INHERITANCE.md`. Reconcile each upstream change deliberately; never
wholesale-merge template state over local product truth.

## How we work

- Update specs before code and trace every affected stored-data layer.
- Commit connected spec/layer changes atomically.
- Open a PR for {{CEO}}; never self-merge.
- Check PR state before pushing to an existing PR branch.
- Use the model-diverse review in `docs/CODE-REVIEW-PANEL.md` for behavior changes.
- Prefer deleting or consolidating governance over adding agents, reports, or ceremonies.
- Never put credentials or secret values in repository instructions, status, prompts, or
  workflow configuration.

After a pull, reset, checkout, switch, or branch change, re-read instruction files that
may have changed.

## Project context

- **Stack:** {{STACK}}
- **Domain:** {{ONE_LINE_DOMAIN_DESCRIPTION}}
- **Layers:** {{e.g. Data store (Postgres) → API (service) → Client (web/mobile)}}
- **Development:** {{how the project is built and run locally}}

## Code style

- {{Language/framework conventions — point at existing examples in the repo.}}
- {{Naming conventions, e.g. snake_case in SQL, camelCase in JSON.}}
