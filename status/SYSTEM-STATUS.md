# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-14 — Copilot repository-specialization session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Foundation docs and operating validation only; no app build |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |

## Run locally

There is no application runtime yet. No emulator, assembler, web client, CMake project, npm
package, generated WebAssembly, or static server configuration exists in this repository.

## Verify the files that exist

From the repository root in a POSIX shell:

```sh
node scripts/dev/review-template-updates.mjs check
sh scripts/dev/check-learnings-budget.sh
sh -n .githooks/pre-push
sh -n scripts/dev/pre-push-tests.sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
```

Expected result: template lineage is current, the learnings digest is under budget, shell
syntax checks pass, and all compliance policy tests pass. These checks do not validate a C64
implementation because one is not present.

## Planned build and deployment (not implemented)

| Planned step | Required outcome |
|--------------|------------------|
| Install pinned Emscripten | Reproducible C++17-to-WASM toolchain |
| Native CMake build | Fast emulator unit/golden tests |
| WebAssembly build | Production embind loader and `.wasm` static assets |
| Static asset build | IDE, gallery, examples, approved ROM manifest/assets |
| Node/native/WASM tests | Same assembler and production WASM artifact in headless smoke tests |
| GitHub Pages deploy | Publish only after all builds and tests pass |

The implementation PR that adds each step must add exact commands and update this status.

## Configuration and secrets

There are no application runtime variables, credentials, or secrets. Planned Pages hosting
must remain static and secret-free. User-supplied ROM and D64 bytes are local inputs, not
configuration and never repository or CI data.

## Key scripts

| Script | Current purpose |
|--------|-----------------|
| `scripts/dev/install-hooks.sh` | Set `core.hooksPath=.githooks`. |
| `scripts/dev/check-learnings-budget.sh` | Enforce the durable-rules budget. |
| `scripts/dev/pre-push-tests.sh` | Run current operating validations and reserve a fail-closed product critical-path gate. |
| `scripts/dev/review-template-updates.mjs` | Check canonical policy changes and record reviewed checkpoints. |

## Current known gaps

- All product implementation described by the layer specs is not started.
- No redistributable replacement ROM set has been selected or legally reviewed.
- No native/WASM golden vectors, browser compatibility matrix, or external D64
  interoperability checks exist.
- No Pages workflow or deployed URL exists.
