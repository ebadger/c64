# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-15 — Copilot milestone-5 release session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | `http://127.0.0.1:8080/web/client/` via `node scripts/dev/serve.mjs` | Deterministic source-to-artifact pipeline, the C++17 machine core (native CMake/CTest and the production WASM artifact), and the static browser IDE (`web/client/`) integrating the production assembler worker and production WASM machine; served locally, no deployment |
| Production | GitHub Pages (deployable/pending) | `https://ebadger.github.io/c64/` | Deterministic `dist/` build + `release.yml` deploy the gated artifact on merged `main`; **not yet live** while this PR is unmerged. Deploys the exact bytes verified by the release gate; no runtime backend or secret |

## Run locally

The deterministic source-to-artifact pipeline (assembler → PRG → D64) runs under Node.js 18+
with no dependency install. From the repository root:

```sh
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
committed example rebuilds to its recorded golden `buildId`/PRG/D64. These checks validate the
milestone-1 pipeline; they do not on their own validate the machine core or the web client (both
of which are implemented — see the core build/test and web-client/browser-E2E commands above and
in `SETUP.md`).

## Build and deployment status

| Step | State |
|------|-------|
| Install pinned Emscripten (3.1.74) | Implemented — `scripts/build/emscripten-version.txt`; commands in `SETUP.md` |
| Native CMake build + CTest | Implemented — `core/` project, `scripts/build/build-native.sh`, 15 test suites |
| WebAssembly build | Implemented — production embind loader `c64core.mjs` + `c64core.wasm` via `scripts/build/build-wasm.sh` |
| Node/native/WASM tests | Implemented — `tests/wasm/` byte-identical parity + smoke over the production artifact |
| CI workflow | Implemented — `.github/workflows/release.yml` (authoritative release gate: native + WASM + full browser matrix + external interop + dist build/integrity + Pages deploy on main) and `.github/workflows/core.yml` (fast per-branch feedback) |
| Static asset build (IDE, gallery) | Implemented — `web/client/` IDE, build worker, `gallery.json`; no bundled ROM set (user-supplied, memory-only) |
| Production dist build + integrity | Implemented — `scripts/build/build-dist.mjs` assembles a clean, flattened, base-path-agnostic `dist/` with a sha256 `asset-manifest.json`; `scripts/dev/verify-dist.mjs` + `tests/dist/` verify references/MIME/determinism/CSP; WASM required (fail-not-skip) |
| Web-client tests (Node + browser matrix E2E) | Implemented — `tests/web/` (environment-free logic) and `tests/e2e/` (Playwright Chromium/Firefox/WebKit against the production `dist` bytes at `/` and `/c64/`; skips locally, required in CI) |
| External D64 interoperability | Implemented — `tests/interop/` verifies 35-track directory metadata + byte-exact extracted PRG via VICE `c1541` (provisioned reproducibly, no committed binary; `tests/interop/PROVENANCE.md`) |
| GitHub Pages deploy | Implemented (deployable/pending) — `release.yml` deploys the gated `dist/` on merged `main` via official Pages actions; live only after a `main` deploy succeeds |

The remaining fidelity/legal gaps are tracked below; the deployment machinery is implemented.

## Configuration and secrets

There are no application runtime variables, credentials, or secrets. Pages hosting is static and
secret-free. User-supplied ROM and D64 bytes are local inputs, not configuration, and never
repository or CI data.

## Key scripts

| Script | Current purpose |
|--------|-----------------|
| `scripts/dev/install-hooks.sh` | Set `core.hooksPath=.githooks`. |
| `scripts/dev/check-learnings-budget.sh` | Enforce the durable-rules budget. |
| `scripts/dev/pre-push-tests.sh` | Run operating validations and, when critical-path files change, the non-bypassable pipeline eval. |
| `scripts/dev/test-critical-path.sh` | Product critical-path eval: full `node --test tests/` plus example golden-vector verification. |
| `scripts/dev/review-template-updates.mjs` | Check canonical policy changes and record reviewed checkpoints. |
| `scripts/build/build-dist.mjs` | Assemble the clean, flattened, base-path-agnostic production `dist/` with a sha256 manifest. |
| `scripts/dev/verify-dist.mjs` | Verify the assembled `dist/` (manifest hashes, required files, CSP, no leaks). |
| `scripts/dev/require-release-artifacts.mjs` | Release gate: fail (not skip) when the production WASM artifact is missing. |

## Current known gaps

- In-app **Run** resets, loads the PRG, and enters the assembled machine code at the SYS target
  (`runAddress`); it does **not** run the ROM's BASIC cold-start or tokenize/`RUN` the stub
  in-process. The *downloaded* PRG still autostarts via BASIC `RUN` on a stock machine per
  `specs/CODEGEN.md`. This is the reconciled, honestly-labelled boundary — an in-process BASIC
  `RUN` path could not be validated on the release gate because no BASIC/KERNAL ROM ships and tests
  use only synthetic ROM fixtures (copyrighted ROMs are forbidden).
- No redistributable ROM set ships, so the IDE requires user-supplied BASIC/KERNAL/character ROM
  files to Run; they are memory-only and never persisted. Edit/build/download work without them.
- **Web Audio is optional.** When a browser provides no Web Audio (e.g. headless WebKit), the
  emulator still loads, builds, runs video, accepts input, and downloads artifacts, but sound is
  unavailable and the audio control is disabled and labelled.
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
- Generated D64 images are now independently verified against **external software tooling** (VICE
  `c1541`: 35-track directory metadata + byte-exact extracted PRG). This is a **software**
  interoperability claim only — it does not verify physical 1541 hardware, real GCR flux/timing, or
  fastloaders.
- D64 import validates geometry, the directory chain, and file chains, but does not yet validate
  full BAM consistency (DOS version, free-count/bitmap agreement, allocation conflicts); an image
  whose only defect is an inconsistent BAM is currently accepted. Tracked in ebadger/c64#2.
- The published browser matrix pins Playwright Chromium, Firefox, and WebKit and drives the full
  journey against the production `dist` bytes at `/` and `/c64/`; capability detection/fallback is
  tested honestly. It does not exercise physical devices or non-Playwright browser builds.

