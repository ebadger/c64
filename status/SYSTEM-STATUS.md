# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-15 — Copilot milestone-3 devices/media session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic source-to-artifact pipeline plus the C++17 machine core with cycle-integrated VIC/SID/CIA devices and read-only mounted D64 execution (native CMake/CTest and the production WASM artifact) build and test; no web app or deployment |
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
sh scripts/build/build-native.sh        # native CMake build + CTest (14 suites)
sh scripts/build/build-wasm.sh          # production build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/                  # headless native/WASM byte-identical parity + smoke
```

Implemented and verifiable now: the complete documented NMOS 6510 CPU, C64 memory
bus/banking and processor port, ROM-set validation and identity, machine lifecycle
(configure/reset/PRG-load/`runCycles`/debug), cycle-integrated VIC-II (raster/IRQ/bad-line/
sprites/modes/indexed framebuffer), SID (voices/ADSR/waveforms + approximate filter, mono float
audio), the two CIAs (ports/timers/TOD/keyboard/joystick/VIC-bank), read-only mounted D64
execution through a high-level KERNAL LOAD/IEC trap, the `setInput`/`copyFramebuffer`/
`drainAudio`/`mountD64` APIs, the embind projection, and the `web/emulator` ES wrapper. The
browser IDE and Pages deployment are not implemented. Device and media fidelity is honestly
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
committed example rebuilds to its recorded golden `buildId`/PRG/D64. These checks validate the
milestone-1 pipeline; they do not validate the machine core (see the core build/test commands
above and in `SETUP.md`) or a web client (which does not exist).

## Build and deployment status

| Step | State |
|------|-------|
| Install pinned Emscripten (3.1.74) | Implemented — `scripts/build/emscripten-version.txt`; commands in `SETUP.md` |
| Native CMake build + CTest | Implemented — `core/` project, `scripts/build/build-native.sh`, 14 test suites |
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

- The web client (browser IDE), examples gallery, and GitHub Pages deployment described by the
  layer specs are not started.
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
- No browser compatibility matrix or GitHub Pages workflow exists.

