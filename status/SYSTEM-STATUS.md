# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-15 — Copilot milestone-2a emulator-core session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Source-to-artifact pipeline (Node) plus the emulator-core subset: native CMake/CTest build and a pinned Emscripten/embind WASM build with a headless smoke test. No web app yet |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |

## Run locally

The deterministic source-to-artifact pipeline (assembler → PRG → D64) runs under Node.js 18+
with no dependency install. From the repository root:

```sh
node --test tests/                 # full pipeline + core-fixture + WASM smoke tests
node examples/build-example.mjs    # verify committed example golden vectors
```

The deterministic emulator-core subset in `core/` builds and tests natively (CMake/CTest) and to
WebAssembly (pinned Emscripten 3.1.64 / embind). Exact, reproducible commands — native build,
`ctest`, `emcmake` WASM build, and the headless smoke test — are in
[`SETUP.md`](../SETUP.md). The WASM smoke test in `node --test tests/` skips gracefully until the
artifact is built, so the pipeline gate stays green without the C++/Emscripten toolchain.

The web client, examples gallery, ROM handling, SID/CIA devices, and static server described in
the specs are not implemented yet.

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
committed example rebuilds to its recorded golden `buildId`/PRG/D64. The suite also rebuilds the
core fixture from the assembler and, when the WASM artifact is present, runs the headless smoke
test against it. These checks validate the pipeline and the emulator-core subset; they do not
validate a web client, which does not exist yet.

## Build and deployment status

| Step | Status |
|------|--------|
| Install pinned Emscripten (3.1.64) | Implemented — see `SETUP.md`; downloads a self-contained toolchain |
| Native CMake build + CTest | Implemented — `core/` static lib and golden-vector tests |
| WebAssembly build (embind) | Implemented — `core/build-wasm/c64core.{js,wasm}` production artifact |
| Node/native/WASM tests | Implemented — native golden vectors + headless smoke test on the production `.wasm` |
| Static asset build (IDE, gallery, ROM manifest) | Not started |
| GitHub Pages deploy | Not started — publish only after all builds and tests pass |

Each remaining step's implementation PR must add exact commands and update this status.

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

- The emulator-core subset covers the NMOS 6510 (documented opcodes only), the memory bus with
  I/O routing, and a minimal border/background VIC-II. Not yet implemented: VIC text/bitmap/
  sprite modes, bad lines, raster interrupts and mid-frame splits; SID audio synthesis and CIA
  timers/TOD/keyboard scanning (register shadows only); D64 mounting, input, save states, and
  sub-instruction cycle budgeting. The web client and GitHub Pages deployment are not started.
- No redistributable replacement ROM set has been selected or legally reviewed. The current
  runnable target needs no ROMs; a ROM strategy decision is pending with ebadger.
- Generated D64 images are covered by byte-exact Node tests but have not been independently
  verified against external 1541 tooling or physical hardware.
- D64 import (`parseD64`/`mountD64`) validates geometry, the directory chain, and file chains,
  but does not yet validate full BAM consistency (DOS version, free-count/bitmap agreement,
  allocation conflicts); an image whose only defect is an inconsistent BAM is currently
  accepted. Tracked in ebadger/c64#2.
- No native/WASM golden vectors, browser compatibility matrix, or GitHub Pages workflow
  exist.
