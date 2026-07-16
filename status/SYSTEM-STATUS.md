# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-16 — Copilot merge-conflict resolution session_
_Last verified: 2026-07-15 — Copilot milestone-4 browser-IDE session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic pipeline + emulator-core subset (native CMake/CTest and pinned Emscripten/embind WASM with headless smoke test) + static `web/` IDE shell; Build/Download/Share work, while Run remains explicitly unavailable until the web runtime bundles and wires the core artifact |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |
| Development | Repository checkout | `http://127.0.0.1:8080/web/client/` via `node scripts/dev/serve.mjs` | Deterministic source-to-artifact pipeline, the C++17 machine core (native CMake/CTest and the production WASM artifact), and the static browser IDE (`web/client/`) integrating the production assembler worker and production WASM machine; served locally, no deployment |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist (milestone 5) |

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

The static browser IDE lives in `web/` and needs no build step. Serve the repository root over
HTTP and open `web/` (see `SETUP.md` for the exact commands and the manual browser smoke test):
node --test tests/                 # full pipeline + web-client tests (uses production modules in src/ and web/client/lib/)
node examples/build-example.mjs    # verify example golden vectors
node web/client/tools/build-gallery.mjs  # verify gallery.json golden vectors
node scripts/dev/serve.mjs         # serve the static browser IDE at http://127.0.0.1:8080/web/client/
```

The static browser IDE in `web/client/` runs the production assembler in a module worker and the
production WASM machine through `web/emulator/c64.mjs`. Edit/build/download work without the WASM
artifact; **Run** additionally requires the built WASM core and a locally selected ROM set (no
redistributable set ships, so ROM files are user-supplied and memory-only).

## Build and run the machine core

The deterministic C++17 machine core (CPU, bus/banking, ROM validation, lifecycle) builds
natively and to a production WebAssembly artifact. See [`SETUP.md`](./SETUP.md) for the exact
toolchain commands (including the Windows Visual Studio path and the pinned Emscripten 3.1.74
install). In short:

```sh
sh scripts/build/build-native.sh        # native CMake build + CTest (15 suites)
sh scripts/build/build-wasm.sh          # production build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/                  # headless native/WASM byte-identical parity + smoke
```

Build (assemble → PRG/D64), diagnostics, downloads, `?code`/`?src` share/remix, autosave, and
the `border-flash` gallery entry work today. Run is intentionally unavailable in the shipped
`web/` shell until the bundled artifact path is wired end to end and the ROM-dependent path is
finalized.
Implemented and verifiable now: the complete documented NMOS 6510 CPU, C64 memory
bus/banking and processor port, ROM-set validation and identity, machine lifecycle
(configure/reset/PRG-load/`runCycles`/debug), cycle-integrated VIC-II (raster/IRQ/bad-line/
sprites/modes/indexed framebuffer), SID (voices/ADSR/waveforms + approximate filter, mono float
audio), the two CIAs (ports/timers/TOD/keyboard/joystick/VIC-bank), read-only mounted D64
execution through a high-level KERNAL LOAD/IEC trap, the `setInput`/`copyFramebuffer`/
`drainAudio`/`mountD64` APIs, the embind projection, and the `web/emulator` ES wrapper. The
static browser IDE (`web/client/`) is implemented on top of these; the GitHub Pages deployment is
a later milestone and is not live. Device and media fidelity is honestly
labelled (line-based VIC renderer, approximate SID filter, high-level rather than cycle-level
1541 drive); see the layer specs.

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
test against it. These checks validate the pipeline, the emulator-core subset contract, and the
web client's headless smoke tests. The `web/` IDE itself is verified manually in a browser
(see `SETUP.md`).

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
committed example rebuilds to its recorded golden `buildId`/PRG/D64. These checks validate the
milestone-1 pipeline; they do not validate the machine core (see the core build/test commands
above and in `SETUP.md`) or a web client (which does not exist).

## Build and deployment status

| Step | State |
|------|-------|
| Install pinned Emscripten (3.1.74) | Implemented — `scripts/build/emscripten-version.txt`; commands in `SETUP.md` |
| Native CMake build + CTest | Implemented — `core/` project, `scripts/build/build-native.sh`, 15 test suites |
| WebAssembly build | Implemented — production embind loader `c64core.mjs` + `c64core.wasm` via `scripts/build/build-wasm.sh` |
| Node/native/WASM tests | Implemented — `tests/wasm/` byte-identical parity + smoke over the production artifact |
| CI workflow | Implemented — `.github/workflows/core.yml` builds native + WASM, runs all suites, and runs the browser E2E |
| Static asset build (IDE, gallery) | Implemented — `web/client/` IDE, build worker, `gallery.json`; no bundled ROM set (user-supplied, memory-only) |
| Web-client tests (Node + browser E2E) | Implemented — `tests/web/` (environment-free logic) and `tests/e2e/` (Playwright against the production WASM artifact; skips cleanly when absent) |
| GitHub Pages deploy | Not started (milestone 5) |

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

- The emulator-core subset covers the NMOS 6510 (documented opcodes only), the memory bus with
  I/O routing, and a minimal border/background VIC-II. Not yet implemented: VIC text/bitmap/
  sprite modes, bad lines, raster interrupts and mid-frame splits; SID audio synthesis and CIA
  timers/TOD/keyboard scanning (register shadows only); D64 mounting, input, save states, and
  sub-instruction cycle budgeting.
- The static `web/` client ships Build/Download/Share/gallery/autosave, but Run remains in an
  explicit unavailable state until the bundled emulator artifact is wired for direct-mode in the
  browser and the ROM-dependent run path is finalized.
- No redistributable replacement ROM set has been selected or legally reviewed. The current
  runnable target needs no ROMs; a ROM strategy decision is pending with ebadger.
- Template/operating-file reconciliation with upstream `ebadger/AIProjectTemplate` (through commit
  `0dda330`) is deferred to a dedicated PR and tracked in ebadger/c64#4; feature PRs do not fold
  it in and intentionally do not advance `.template-source`.
- The static browser IDE (`web/client/`) is implemented, but the GitHub Pages deployment is a
  later milestone (no workflow or live site yet). In-app **Run** enters the machine-code entry at
  the SYS target rather than tokenizing and running BASIC in-process; the downloaded PRG still
  autostarts via BASIC `RUN` on a stock machine per `specs/CODEGEN.md`.
- No redistributable ROM set ships, so the IDE requires user-supplied BASIC/KERNAL/character ROM
  files to Run; they are memory-only and never persisted. Edit/build/download work without them.
- VIC-II rendering is **line-based**, not pixel-cycle-exact within a raster line; mid-line
  register changes take effect at the next line. BA/AEC stalls are represented at bad-line +
  sprite-DMA granularity, not exact per-cycle BA edge timing.
- SID audio: the digital oscillators/waveforms/ADSR are modelled, but the analog filter and the
  6581-vs-8580 tonal differences are a deterministic **approximation** (no analog-perfect claim).
  SID output is float, so native/WASM byte-identical parity is asserted only over integer device
  state; SID audio is validated by native unit tests and a WASM smoke test.
- The mounted-D64 drive is a **high-level KERNAL LOAD/IEC trap** (drive 8, standard file and
  directory LOAD), not a cycle-level 1541 CPU/VIA/GCR drive. Custom drive code, fastloaders, and
  bit-level GCR access are not emulated (see `specs/MEDIA.md`).
- The CIA serial shift register (SDR) has limited support; full RS-232/serial timing is not
  modelled. Interrupts are sampled at instruction boundaries (the NMOS CLI/SEI/PLP enable delay
  is modelled).
- No redistributable replacement ROM set has been selected or legally reviewed; the core and
  its tests use only synthetic generated ROMs. No 1541 drive ROM is used by the high-level trap.
- Generated D64 images are covered by byte-exact Node tests but have not been independently
  verified against external 1541 tooling or physical hardware.
- D64 import validates geometry, the directory chain, and file chains, but does not yet validate
  full BAM consistency (DOS version, free-count/bitmap agreement, allocation conflicts); an image
  whose only defect is an inconsistent BAM is currently accepted. Tracked in ebadger/c64#2.
- No formal browser compatibility matrix is published; the app detects and reports missing
  capabilities before init, and the browser E2E pins Chromium. The GitHub Pages workflow does not
  exist yet (milestone 5).

