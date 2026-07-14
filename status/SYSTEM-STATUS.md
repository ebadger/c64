# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-14 — Copilot milestone-1 source-pipeline session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic source-to-artifact pipeline runs and tests under Node; no emulator, WASM, or web app build |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |

## Run locally

The deterministic source-to-artifact pipeline (assembler → PRG → D64) runs under Node.js 18+
with no dependency install. From the repository root:

```sh
node --test tests/                 # full pipeline test suite (uses production modules in src/)
node examples/build-example.mjs    # verify committed example golden vectors
```

There is no emulator, WebAssembly artifact, web client, CMake project, or static server yet;
the browser IDE and C64 core described in the specs are not implemented.

## Verify the files that exist

From the repository root in a POSIX shell:

```sh
node scripts/dev/review-template-updates.mjs check
sh scripts/dev/check-learnings-budget.sh
sh -n .githooks/pre-push
sh -n scripts/dev/pre-push-tests.sh
sh -n scripts/dev/test-critical-path.sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
node --test tests/
node examples/build-example.mjs
```

Expected result: template lineage is current, the learnings digest is under budget, shell
syntax checks pass, all compliance policy tests pass, the pipeline test suite passes, and the
committed example rebuilds to its recorded golden `buildId`/PRG/D64. These checks validate the
milestone-1 pipeline; they do not validate an emulator or web client because neither exists.

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
| `scripts/dev/pre-push-tests.sh` | Run operating validations and, when critical-path files change, the non-bypassable pipeline eval. |
| `scripts/dev/test-critical-path.sh` | Product critical-path eval: full `node --test tests/` plus example golden-vector verification. |
| `scripts/dev/review-template-updates.mjs` | Check canonical policy changes and record reviewed checkpoints. |

## Current known gaps

- The emulator core, VIC-II, SID/CIA/input, WebAssembly build, ROM handling, web client, and
  GitHub Pages deployment described by the layer specs are not started.
- No redistributable replacement ROM set has been selected or legally reviewed.
- Generated D64 images are covered by byte-exact Node tests but have not been independently
  verified against external 1541 tooling or physical hardware.
- D64 import (`parseD64`/`mountD64`) validates geometry, the directory chain, and file chains,
  but does not yet validate full BAM consistency (DOS version, free-count/bitmap agreement,
  allocation conflicts); an image whose only defect is an inconsistent BAM is currently
  accepted. Tracked in ebadger/c64#2.
- No native/WASM golden vectors, browser compatibility matrix, or GitHub Pages workflow
  exist.
