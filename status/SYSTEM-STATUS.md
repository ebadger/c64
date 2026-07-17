# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-16 — disk browse/run/eject and animated-example candidate_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | `http://127.0.0.1:8080/web/client/` via `node scripts/dev/serve.mjs` | Deterministic source-to-artifact pipeline, the C++17 machine core (native CMake/CTest and the production WASM artifact), and the static browser IDE (`web/client/`) integrating the production assembler worker, production WASM machine, and D64 directory/run/eject controls |
| Production | GitHub Pages | `https://ebadger.github.io/c64/` | Live static deployment. `release.yml` rebuilds and deploys the exact gated `dist/` artifact on merged `main`; no runtime backend or secret |

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
artifact; **Boot BASIC** and **Run** additionally require the built WASM core. The pinned Pascual
BASIC/KERNAL set with MEGA65 PXL chargen and the clean-room Pascual DOS-1541 firmware load by
default. The explicit complete custom C64-ROM override remains memory-only while retaining the
bundled drive firmware.
A valid local or curated D64 immediately exposes its directory; a selected PRG runs at a detected
first-line BASIC `SYS` target or a user-supplied entry address, and **Eject** removes drive-8 media
without stopping or resetting the CPU.

## Build and run the machine core

The deterministic C++17 machine core (CPU, bus/banking, ROM validation, lifecycle) builds
natively and to a production WebAssembly artifact. See [`SETUP.md`](./SETUP.md) for the exact
toolchain commands (including the Windows Visual Studio path and the pinned Emscripten 3.1.74
install). In short:

```sh
sh scripts/build/build-native.sh        # native CMake build + CTest (17 suites)
sh scripts/build/build-wasm.sh          # production build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/                  # headless native/WASM byte-identical parity + smoke
```

Implemented and verifiable now: the complete documented NMOS 6510 CPU plus the declared stable
undocumented opcode families, C64 memory
bus/banking and processor port, ROM-set validation and identity, machine lifecycle
(configure/reset/PRG-load/`runCycles`/debug), cycle-integrated VIC-II (raster/IRQ/bad-line/
sprites/modes/indexed framebuffer), SID (voices/ADSR/waveforms + approximate filter, mono float
audio), the two CIAs (ports/timers/TOD/keyboard/joystick/VIC-bank), and read-only mounted D64
execution through an independent 1 MHz 1541 CPU, selected 6522 VIA surface, wired IEC, and
deterministic rotating GCR tracks. The `setInput`/`copyFramebuffer`/
`drainAudio`/`mountD64`/`unmountD64` APIs, the embind projection, and the `web/emulator` ES
wrapper. The static browser IDE (`web/client/`) is implemented on top of these, and the GitHub
Pages deployment is live. Device and media fidelity is honestly labelled (line-based VIC
renderer, approximate SID filter, and a bounded digital rather than analog/flux-level 1541); see
the layer
specs.

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
| Native CMake build + CTest | Implemented — `core/` project, `scripts/build/build-native.sh`, 17 test suites |
| WebAssembly build | Implemented — production embind loader `c64core.mjs` + `c64core.wasm` via `scripts/build/build-wasm.sh` |
| Node/native/WASM tests | Implemented — `tests/wasm/` byte-identical parity + smoke over the production artifact |
| CI workflow | Implemented — `.github/workflows/release.yml` (authoritative release gate: native + WASM + full browser matrix + external interop + dist build/integrity + Pages deploy on main) and `.github/workflows/core.yml` (fast per-branch feedback) |
| Static asset build (IDE, gallery, ROMs) | Implemented — `web/client/` IDE, build worker, Boot BASIC, D64 directory/run/eject controls, visibly animated canonical example, `gallery.json`, bundled pinned Pascual C64 and DOS-1541 ROMs, and complete memory-only custom C64-set override |
| Production dist build + integrity | Implemented — `scripts/build/build-dist.mjs` assembles a clean, flattened, base-path-agnostic `dist/` with a sha256 `asset-manifest.json`; `scripts/dev/verify-dist.mjs` + `tests/dist/` verify references/MIME/determinism/CSP and the exact Pascual binary/license/notice/source allowlist; WASM required (fail-not-skip) |
| Web-client tests (Node + browser matrix E2E) | Implemented — `tests/web/` (environment-free logic) and `tests/e2e/` (Playwright Chromium/Firefox/WebKit against the production `dist` bytes at `/` and `/c64/`; skips locally, required in CI). The deep Build & Run E2E waits for the program's observable RAM write rather than treating browser pacing state as proof that a machine batch executed. |
| External D64 interoperability | Implemented — `tests/interop/` verifies 35-track directory metadata + byte-exact extracted PRG via VICE `c1541` (provisioned reproducibly, no committed binary; `tests/interop/PROVENANCE.md`) |
| GitHub Pages deploy | Implemented and live — `release.yml` deploys the gated `dist/` on merged `main` via official Pages actions |

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
| `scripts/build/build-drive-rom.mjs` | Reproduce or verify the reviewed wildcard-compatible DOS-1541 ROM from the exact pinned upstream binary. |
| `scripts/build/build-dist.mjs` | Assemble the clean, flattened, base-path-agnostic production `dist/` with a sha256 manifest. |
| `scripts/dev/verify-dist.mjs` | Verify the assembled `dist/` (manifest hashes, required files, CSP, no leaks). |
| `scripts/dev/require-release-artifacts.mjs` | Release gate: fail (not skip) when the production WASM artifact is missing. |

## Current known gaps

- **Boot BASIC** configures/powers on at the ROM reset vector and optionally mounts the selected
  D64 first. In-app source/disk **Run** remains distinct: it resets, loads the PRG, and enters the
  selected machine-code target directly. Reset restarts the last BASIC/program mode and preserves
  mounted media; Stop changes browser pacing only.
- The pinned Pascual BASIC/KERNAL set, MEGA65 PXL chargen, and clean-room DOS-1541 firmware are
  the default and ship with complete per-component license texts/notices, provenance, and
  corresponding source. A complete custom BASIC/KERNAL/character set can replace the C64 trio
  for one page session while the bundled drive firmware remains active; custom bytes and source
  selection are never persisted.
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
- The mounted-D64 drive is a bounded digital 1541 model: an independent 1 MHz NMOS CPU, selected
  6522 surface required by the bundled clean-room DOS, open-collector IEC, and deterministic
  rotating GCR tracks. It is not analog/flux accurate, writable, or compatible with software
  that depends on private entry points from Commodore's proprietary ROM. Uploaded fastloaders
  work only within that explicit CPU/VIA/GCR surface (see `specs/MEDIA.md`).
- The CIA serial shift register (SDR) has limited support; full RS-232/serial timing is not
  modelled. Interrupts are sampled at instruction boundaries (the NMOS CLI/SEI/PLP enable delay
  is modelled).
- No proprietary Commodore ROM dump ships. Core conformance tests retain synthetic generated ROMs;
  production drive execution uses the pinned MIT clean-room Pascual DOS-1541 image and c64's
  audited wildcard patch.
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
