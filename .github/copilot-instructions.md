# Copilot Instructions for c64

## Session start

Read these before work:

1. `docs/LEARNINGS.md` — canonical workflow rules and capped durable lessons.
2. `docs/MISSION.md` — product purpose and software-only boundary.
3. `specs/SYSTEM.md` — current architecture and links to every layer contract.

Read only the sub-specs needed for the task. Read `status/SYSTEM-STATUS.md` for runtime,
deployment, environment, or verification work; it is not startup context.

Before changing inherited operating files, run
`node scripts/dev/review-template-updates.mjs check` and read
`specs/TEMPLATE-INHERITANCE.md`. Reconcile upstream changes deliberately; never replace c64
product truth with template content.

## How we work

- Update specs before code and trace the complete affected data flow.
- Commit connected spec/layer changes atomically.
- Open a PR for `ebadger`; never self-merge.
- Check PR state before pushing to an existing PR branch.
- Use the model-diverse review in `docs/CODE-REVIEW-PANEL.md` for behavior changes.
- Treat reviewer findings as advisory until the primary validates a reproducible case, a
  supported/reachable contract violation, and material impact. Escalate to `ebadger` — with
  evidence, effort, and a fix/do-not-fix/re-scope recommendation — only an independently
  validated release blocker, a material scope change, or work estimated above 30 minutes;
  take no disposition action on those until that item has a decision. Preserve each
  reviewer's classification but let the primary override it with concise checkable
  evidence; a reviewer's "blocking" label alone does not force escalation. Dispose of
  everything else as a trivial fix, override, or follow-up.
- Keep planned and implemented behavior distinct in specs, README, and status.
- Prefer deleting or consolidating governance over adding agents, reports, or ceremonies.
- Never put credentials, secret values, copyrighted ROM bytes, or user-supplied binary
  assets in repository instructions, prompts, logs, or workflow configuration.

After a pull, reset, checkout, switch, or branch change, re-read instruction files that may
have changed.

## Project context

- **Stack:** C++17, Emscripten/embind WebAssembly, dependency-light ES modules, vanilla
  HTML/CSS/JavaScript, CMake, and Node/native/WASM tests.
- **Domain:** deterministic browser-based Commodore 64 assembly development and software
  emulation with standard PRG/D64 interoperability.
- **Layers:** source project -> assembler -> PRG/D64 -> deterministic C64 core
  (CPU/bus/VIC-II/SID/CIA/media) -> thin WASM bridge -> static web client.
- **Hosting:** planned GitHub Pages with no runtime backend, database, account system, or
  secret.
- **Current development:** architecture foundation only. Use commands in `SETUP.md`; no
  application build exists yet.

## Engineering constraints

- Browser pacing, DOM operations, Web Audio scheduling, and file pickers stay outside the
  deterministic C++ core.
- Browser and headless tests use the same production WASM execution artifact.
- The assembler targets NMOS 6510/6502, not 65C02, and must run unchanged in browser and
  Node.js.
- Shared source must rebuild byte-identical PRG and D64 output for the same version/settings.
- Errors cross layer boundaries as explicit stable results; do not add broad catches,
  silent fallbacks, fabricated output, or unlabelled emulation approximations.
- Bundle only ROM replacements with proven redistribution rights. User-supplied ROM/D64
  bytes remain local and never enter source shares or telemetry.
- Physical-hardware work ends at downloadable standard artifacts.

## Code style

- C++: C++17, RAII value ownership, fixed-width integer types at hardware boundaries, no
  exceptions across the embind API, and deterministic state transitions.
- JavaScript: standards-based ES modules, browser/Node shared logic free of environment
  globals, camelCase values/functions, PascalCase classes/types, and explicit typed-array
  ownership.
- Keep hardware register constants and timing profiles named and centralized; avoid magic
  numbers outside the owning layer.
- Add comments only for hardware timing, legal provenance, or non-obvious invariants.
