# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-15 — Copilot milestone-2 machine-core session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic source-to-artifact pipeline plus the C++17 machine core (native CMake/CTest and the production WASM artifact) build and test; no VIC/SID/CIA devices, disk media, web app, or deployment |
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

## Build and run the machine core

The deterministic C++17 machine core (CPU, bus/banking, ROM validation, lifecycle) builds
natively and to a production WebAssembly artifact. See [`SETUP.md`](./SETUP.md) for the exact
toolchain commands (including the Windows Visual Studio path and the pinned Emscripten 3.1.74
install). In short:

```sh
sh scripts/build/build-native.sh        # native CMake build + CTest (9 suites)
sh scripts/build/build-wasm.sh          # production build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/                  # headless native/WASM byte-identical parity + smoke
```

Implemented and verifiable now: the complete documented NMOS 6510 CPU, C64 memory
bus/banking and processor port, ROM-set validation and identity, machine lifecycle
(configure/reset/PRG-load/`runCycles`/debug), the embind projection, and the `web/emulator`
ES wrapper. VIC-II, SID/CIA/input, mounted D64, framebuffer/audio, the browser IDE, and Pages
deployment are not implemented; device and media operations return the stable `unavailable`
error and are reported unavailable.

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
milestone-1 pipeline; they do not validate the machine core (see the core build/test commands
above and in `SETUP.md`) or a web client (which does not exist).

## Build and deployment status

| Step | State |
|------|-------|
| Install pinned Emscripten (3.1.74) | Implemented — `scripts/build/emscripten-version.txt`; commands in `SETUP.md` |
| Native CMake build + CTest | Implemented — `core/` project, `scripts/build/build-native.sh`, 9 test suites |
| WebAssembly build | Implemented — production embind loader `c64core.mjs` + `c64core.wasm` via `scripts/build/build-wasm.sh` |
| Node/native/WASM tests | Implemented — `tests/wasm/` byte-identical parity + smoke over the production artifact |
| CI workflow | Implemented — `.github/workflows/core.yml` builds native + WASM and runs all suites |
| Static asset build (IDE, gallery, ROM manifest/assets) | Not started |
| GitHub Pages deploy | Not started |

The remaining steps' implementation PRs must add exact commands and update this status.

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

- VIC-II, SID/CIA/input, mounted disk media, framebuffer/audio, the web client, and GitHub
  Pages deployment described by the layer specs are not started. The machine core exposes an
  explicit device boundary and returns the `unavailable` error for those operations.
- Machine-core timing is exact at instruction granularity (documented cycle counts plus
  page-cross/branch penalties); sub-instruction bus phasing is deferred until a clocked device
  needs it (milestone 3).
- No redistributable replacement ROM set has been selected or legally reviewed; the core and
  its tests use only synthetic generated ROMs.
- Generated D64 images are covered by byte-exact Node tests but have not been independently
  verified against external 1541 tooling or physical hardware.
- D64 import (`parseD64`/`mountD64`) validates geometry, the directory chain, and file chains,
  but does not yet validate full BAM consistency (DOS version, free-count/bitmap agreement,
  allocation conflicts); an image whose only defect is an inconsistent BAM is currently
  accepted. Tracked in ebadger/c64#2.
- No native/WASM golden vectors, browser compatibility matrix, or GitHub Pages workflow
  exist.
