# c64

**A zero-install browser development environment for Commodore 64 software.**

c64 is designed to let people write NMOS 6510 assembly, assemble it, run it in a software
C64 emulator, share and remix source, and download standard PRG and D64 files. The target is
a static GitHub Pages application with no runtime backend, accounts, database, or secrets.

> **Current status:** this repository contains the specialized mission, architecture, and
> operating foundation; the implemented deterministic source-to-artifact pipeline (NMOS 6510
> assembler, PRG serializer, and standard 35-track D64 builder/parser); the deterministic
> C++17 machine core — a complete documented NMOS 6510 CPU plus stable undocumented opcode
> families, with cycle-integrated devices (VIC-II video, SID audio, two CIAs with
> keyboard/joystick/timers/TOD), and read-only mounted D64 execution through an independent
> 1541 CPU, selected 6522 VIA surface, wired IEC, and deterministic GCR tracks — compiled
> once to a production WebAssembly artifact and proven by native and byte-identical headless
> WASM parity tests; the **static browser IDE** (`web/client/`) that integrates the production
> assembler in a worker and the production WASM machine through a 3RIC-compatible terminal
> shell, emulator-first responsive workspace, integrated physical-layout C64 virtual keyboard,
> exact-result Build & Run, compact sample selector, Boot BASIC, direct-entry run/stop/reset,
> presentation, input, D64 directory/run/eject controls,
> bundled Pascual/custom-ROM handling, sharing, gallery, and downloads; and the **release
> pipeline** — a deterministic `dist/` build, external D64 interoperability verification (VICE
> `c1541`), a pinned Chromium/Firefox/WebKit browser matrix, and a GitHub Pages deploy workflow.
> The Pages site is live at [`https://ebadger.github.io/c64/`](https://ebadger.github.io/c64/);
> merged `main` updates deploy only after the complete release gate passes.
> Device/media fidelity is honestly labelled (line-based VIC renderer, approximate SID filter,
> and a bounded digital rather than analog/flux-level 1541); Boot BASIC executes the bundled ROM
> cold-start, while in-app source/disk Run remains a deterministic direct-entry path at the
> selected SYS/entry target.

## User workflow

1. Serve the app locally, or use the GitHub Pages deployment once published, and open it
   without installing a toolchain.
2. Edit NMOS 6510/6502 assembly in the browser.
3. Choose **Build & Run** (or `Ctrl`/`Command`+`Enter`) to build and start the exact successful
   result, or **Build only** to produce deterministic PRG and D64 artifacts without starting it.
4. Boot into Pascual's BASIC at the ROM reset vector, or run the built PRG directly in the
   shared C++17 emulator core compiled to WebAssembly; use either the physical keyboard or the
   integrated C64-layout virtual keyboard.
5. Import a D64 for BASIC/KERNAL drive-8 access, or choose a PRG from its directory and supply an entry address when it has no
   detectable BASIC `SYS` target, and run or eject it without reloading the page.
6. Share editable source through `?src` or base64url UTF-8 `?code`.
7. Download the standard PRG or D64 for external C64 tools or transfer to physical hardware.

Canonical examples will be curated through GitHub pull requests and `gallery.json`. URL
shares are public bearer data: anyone with the URL can read and copy the source, and long
source produces long URLs.

## Architecture

- **Emulator:** deterministic C++17 NMOS 6510 CPU, bus/banking, cycle-integrated VIC-II, SID,
  and CIA devices, plus an independently scheduled 1541 CPU/VIA/IEC/GCR subsystem for read-only
  mounted D64 execution; the browser IDE and gallery are implemented on top.
- **Execution:** one Emscripten/embind WebAssembly artifact for browser use and headless WASM
  tests; the same C++ sources also compile natively for diagnostics.
- **Code generation:** one dependency-light ES module assembler for browser and Node.js,
  targeting NMOS 6510/6502 semantics rather than 65C02 extensions.
- **Artifacts:** client-side PRG and standards-compatible 35-track D64 generation and D64
  import.
- **Client:** implemented static HTML/CSS/ES-module IDE (`web/client/`) with the build worker
  and browser pacing kept outside the deterministic core.
- **Hosting:** live static GitHub Pages at `https://ebadger.github.io/c64/`. The deterministic
  `dist/` build and `release.yml` deploy the gated artifact on merged `main`.

Start with [`specs/SYSTEM.md`](./specs/SYSTEM.md) for the full layer map and data flows.

## ROM and hardware boundary

Proprietary Commodore BASIC, KERNAL, character, and drive ROM dumps are not committed or
distributed. The application ships pinned redistributable Pascual BASIC/KERNAL ROMs, the MEGA65
PXL chargen, and clean-room Pascual DOS-1541 firmware with complete per-component
licenses/notices and corresponding source. A complete user-supplied C64 ROM trio can replace the
bundled trio locally for the current page session while the bundled drive firmware remains active.

This project ends at software emulation and standard PRG/D64 interoperability. It does not
include custom transfer devices, firmware, PCBs, HDL, KiCad, GAL/address-decode logic, or
other physical 3RIC hardware work.

## Repository map

```text
docs/MISSION.md             Product purpose and boundary
docs/LEARNINGS.md           Capped operating rules
specs/SYSTEM.md             System overview
specs/EMULATOR.md           CPU, bus, deterministic core, WASM API
specs/VIC-II.md             Raster/video contract
specs/IO.md                 SID, CIA, keyboard, joystick, IEC-facing signals
specs/CODEGEN.md            Assembler and PRG entry contract
specs/MEDIA.md              PRG/D64 generation and import
specs/ROM-ASSETS.md         ROM licensing, privacy, and validation
specs/WEB-CLIENT.md         Static IDE, sharing, autosave, presentation
status/SYSTEM-STATUS.md      Current implementation and environment truth
src/                        Deterministic pipeline (assembler, PRG, D64) — browser + Node ES modules
core/                       Deterministic C++17 machine core (CPU, bus, ROM, lifecycle), CMake, native tests, embind
web/emulator/               ES-module wrapper for the production WebAssembly core
web/client/                 Static browser IDE (HTML/CSS/ES modules), build worker, gallery.json
scripts/dev/serve.mjs       Dependency-light static dev server (repo root, correct MIME + CSP)
tests/                      Node golden-vector and behavior tests for the pipeline
tests/web/                  Node tests for the web client's environment-free logic
tests/wasm/                 Headless native/WASM parity and smoke tests
tests/e2e/                  Browser matrix E2E (Chromium/Firefox/WebKit) vs the production dist bytes (Playwright; skips if absent)
tests/dist/                 Production dist reference/MIME/determinism/CSP invariants
tests/interop/              External D64 interoperability via VICE c1541 (skips if absent; PROVENANCE.md)
scripts/build/build-dist.mjs  Deterministic production dist/ assembler (flattened, base-path-agnostic, sha256 manifest)
.github/workflows/release.yml Release gate (PR) + GitHub Pages deploy (merged main)
examples/                   Canonical assembler example fixtures
```

## Run the browser IDE locally

The IDE is static and serverless. Serve the repository root and open the client:

```sh
node scripts/dev/serve.mjs            # http://127.0.0.1:8080/web/client/
```

Build the production WebAssembly artifact first (see [`SETUP.md`](./SETUP.md)) so **Boot BASIC**
and **Run** work; without it you can still edit, build, and download PRG/D64. The emulator uses
the pinned, redistributable Pascual C64 and drive set by default. The ROM panel can replace the
C64 BASIC/KERNAL/character trio for the current page session while retaining the bundled drive
firmware; custom bytes are never uploaded, stored, or logged. The Media panel validates an
imported D64 immediately, makes it available to Boot BASIC, lists its directory, runs a selected
PRG at its detected or explicit entry address, and ejects drive 8 without resetting the running
machine.

## Build and test

The source-to-artifact pipeline runs under Node.js 18+ with no dependency install:

```sh
node --test tests/                 # full pipeline + web + headless WASM tests (WASM/E2E skip if unbuilt)
node --test tests/web/             # environment-free web-client logic tests only
node examples/build-example.mjs    # verify example golden vectors
node web/client/tools/build-gallery.mjs  # verify gallery.json golden vectors
```

The deterministic C++17 machine core builds natively and to a production WebAssembly artifact.
See [`SETUP.md`](./SETUP.md) for the exact toolchain commands (Visual Studio on Windows, and the
pinned Emscripten 3.1.74 install):

```sh
sh scripts/build/build-native.sh   # native CMake build + CTest
sh scripts/build/build-wasm.sh     # production build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/            # byte-identical native/WASM parity + smoke
npm i --no-save playwright && npx playwright install chromium firefox webkit
node --test tests/e2e/            # browser matrix E2E against the production dist bytes
node scripts/build/build-dist.mjs && node scripts/dev/verify-dist.mjs   # production dist + integrity
sudo apt-get install -y vice && node --test tests/interop/   # external D64 interop (Linux; VICE c1541)
```

The full release gate (all of the above, non-skipping, across the pinned browser matrix and with
external interop, plus the GitHub Pages deploy on merged `main`) runs in
[`.github/workflows/release.yml`](./.github/workflows/release.yml).

## Work on the repository

See [`SETUP.md`](./SETUP.md) for the currently available validation commands and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for product and review rules. The required tracked
git guards are activated per clone with:

```sh
git config core.hooksPath .githooks
```

Agents open pull requests for `ebadger` and never self-merge.
