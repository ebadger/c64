# c64

**A zero-install browser development environment for Commodore 64 software.**

c64 is designed to let people write NMOS 6510 assembly, assemble it, run it in a software
C64 emulator, share and remix source, and download standard PRG and D64 files. The target is
a static GitHub Pages application with no runtime backend, accounts, database, or secrets.

> **Current status:** this repository contains the specialized mission, architecture, and
> operating foundation; the implemented deterministic source-to-artifact pipeline (NMOS 6510
> assembler, PRG serializer, and standard 35-track D64 builder/parser); the deterministic
> C++17 machine core — a complete documented NMOS 6510 CPU with cycle-integrated devices
> (VIC-II video, SID audio, two CIAs with keyboard/joystick/timers/TOD), read-only mounted D64
> execution via a high-level KERNAL LOAD/IEC trap, and framebuffer/audio/input APIs — compiled
> once to a production WebAssembly artifact and proven by native and byte-identical headless
> WASM parity tests; and the **static browser IDE** (`web/client/`) that integrates the
> production assembler in a worker and the production WASM machine into an editor, build,
> run/stop/reset, presentation, input, ROM/media handling, sharing, gallery, and downloads. The
> GitHub Pages deployment is a later milestone and is **not** live yet — run the IDE locally with
> the dev server below. Device/media fidelity is honestly labelled (line-based VIC renderer,
> approximate SID filter, high-level rather than cycle-level 1541 drive); in-app Run enters at
> the SYS target rather than tokenizing BASIC.

## User workflow

1. Serve the app locally (GitHub Pages hosting is a later milestone) and open it without
   installing a toolchain.
2. Edit NMOS 6510/6502 assembly in the browser.
3. Build deterministic PRG and D64 artifacts with the same assembler used by headless tests.
4. Run the PRG in the shared C++17 emulator core compiled to WebAssembly.
5. Share editable source through `?src` or base64url UTF-8 `?code`.
6. Download the standard PRG or D64 for external C64 tools or transfer to physical hardware.

Canonical examples will be curated through GitHub pull requests and `gallery.json`. URL
shares are public bearer data: anyone with the URL can read and copy the source, and long
source produces long URLs.

## Architecture

- **Emulator:** deterministic C++17 NMOS 6510 CPU, bus/banking, and cycle-integrated VIC-II,
  SID, and CIA devices with read-only mounted D64 execution are implemented; the browser IDE
  and gallery are specified but not yet implemented.
- **Execution:** one Emscripten/embind WebAssembly artifact for browser use and headless WASM
  tests; the same C++ sources also compile natively for diagnostics.
- **Code generation:** one dependency-light ES module assembler for browser and Node.js,
  targeting NMOS 6510/6502 semantics rather than 65C02 extensions.
- **Artifacts:** client-side PRG and standards-compatible 35-track D64 generation and D64
  import.
- **Client:** implemented static HTML/CSS/ES-module IDE (`web/client/`) with the build worker
  and browser pacing kept outside the deterministic core.
- **Hosting:** GitHub Pages deployment at `https://ebadger.github.io/c64/` is planned for a later
  milestone and is not live yet.

Start with [`specs/SYSTEM.md`](./specs/SYSTEM.md) for the full layer map and data flows.

## ROM and hardware boundary

Copyrighted Commodore BASIC, KERNAL, and character ROMs are not committed or distributed.
The application may ship only redistributable replacements and may accept user-supplied ROM
files locally.

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
tests/e2e/                  Browser E2E against the production WASM artifact (Playwright; skips if absent)
examples/                   Canonical assembler example fixtures
```

## Run the browser IDE locally

The IDE is static and serverless. Serve the repository root and open the client:

```sh
node scripts/dev/serve.mjs            # http://127.0.0.1:8080/web/client/
```

Build the production WebAssembly artifact first (see [`SETUP.md`](./SETUP.md)) so **Run** works;
without it you can still edit, build, and download PRG/D64. Because no redistributable ROM set
ships yet, Run also requires you to select local BASIC/KERNAL/character ROM files — they stay in
memory on your machine and are never uploaded, stored, or logged.

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
npm i --no-save playwright && npx playwright install chromium
node --test tests/e2e/            # browser E2E against the production WASM artifact
```

## Work on the repository

See [`SETUP.md`](./SETUP.md) for the currently available validation commands and
[`CONTRIBUTING.md`](./CONTRIBUTING.md) for product and review rules. The required tracked
git guards are activated per clone with:

```sh
git config core.hooksPath .githooks
```

Agents open pull requests for `ebadger` and never self-merge.
