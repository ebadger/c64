# Development setup

The repository provides the deterministic source-to-artifact pipeline (assembler, PRG, and
D64) plus the architecture and operating foundation. There is no emulator or web application
to build or run yet.

## Current requirements

- Git
- Node.js 18+ with the built-in test runner
- A POSIX shell for tracked shell guards (Git Bash is sufficient on Windows)
- GitHub CLI only when checking or opening pull requests

The pipeline has no runtime dependencies, so no `npm install` step is required.

## Activate repository guards

From the repository root:

```sh
git config core.hooksPath .githooks
```

This is local git configuration and must be activated once per clone. The tracked pre-push
hook enforces the learnings budget, protects merged/closed PR branches, and runs the
project-owned test gate (which includes the non-bypassable pipeline critical-path eval below).

## Build and test the source-to-artifact pipeline

From the repository root:

```sh
node --test tests/                     # full pipeline test suite (production modules in src/)
node examples/build-example.mjs        # verify committed example golden vectors (buildId/PRG/D64)
node examples/build-example.mjs --write  # regenerate example expectations after intended changes
```

`npm test` runs the same suite (`node --test tests/`). The pipeline modules in `src/` are
dependency-light ES modules; the identical files run in modern browsers and in Node.js. The
suite also includes headless smoke tests for the web client's pure modules (`tests/web-*.test.mjs`):
the base64url share codec, the gallery entry/build-id guard, the worker build core, storage
autosave, capability detection, and the emulator-bridge unavailable contract.

## Serve and smoke-test the static web client

The browser IDE in `web/` is a static, dependency-light client that runs the `src/` pipeline in
a Web Worker. There is no build step: serve the **repository root** over HTTP (so that
`web/…` and `src/…` and `examples/…` are all same-origin) and open `web/`.

From the repository root, use any static file server, for example:

```sh
python3 -m http.server 8080          # then open http://localhost:8080/web/
# or: npx --yes http-server . -p 8080 -c-1
```

Opening a `file://` URL will not work: ES-module workers and the restrictive Content Security
Policy require an HTTP origin.

Manual browser smoke test (evergreen Chrome/Firefox/Edge/Safari):

1. Open `http://localhost:8080/web/`. The status line reads "Ready".
2. Press **Build**. Diagnostics show "No diagnostics" and the Build panel shows a 64-hex
   build id plus load/run addresses.
3. Press **Download PRG** and **Download D64**; the downloaded bytes are exactly the assembler
   output (the `.prg` is 2-byte load address + image).
4. In the **Examples** row choose "Border flash" and press **Load**, then **Build**; it
   assembles cleanly. Loading `http://localhost:8080/web/?src=border-flash` does the same from
   the URL, and `?code=<base64url>` restores shared source.
5. Press **Share…**; the panel shows the public-bearer-data warning before you copy the link.
6. The **Emulator** panel shows an explicit "EMULATOR UNAVAILABLE" state and Run/Reset stay
   disabled — expected until the WASM core and a ROM set land. The client never fabricates a
   running emulator.

## Validate the operating foundation

```sh
node scripts/dev/review-template-updates.mjs check
sh scripts/dev/check-learnings-budget.sh
sh -n .githooks/pre-push
sh -n scripts/dev/pre-push-tests.sh
sh -n scripts/dev/test-critical-path.sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
```

These commands validate the operating files. They do not build or test an emulator.

## Emulator core: native build and tests

The deterministic C++17 emulator core lives in `core/`. A native build gives fast unit and
golden-vector tests; the WebAssembly build below produces the production artifact the browser
and headless tests share.

Prerequisites:

- CMake 3.20+
- A C++17 host toolchain (MSVC 2019+/Build Tools, Clang, or GCC)

From the repository root:

```sh
# Configure and build the native static core + test executable.
cmake -S core -B core/build-native
cmake --build core/build-native --config Debug

# Run the golden-vector unit tests (CPU opcodes/flags/cycles + machine critical path).
ctest --test-dir core/build-native -C Debug --output-on-failure
```

On Windows with Visual Studio, `cmake -S core -B core/build-native -G "Visual Studio 17 2022"
-A x64` selects the MSVC toolset explicitly. On Linux/macOS the default generator works; drop
`--config`/`-C Debug` for single-config generators.

## Emulator core: pinned Emscripten/embind WebAssembly build

This produces `core/build-wasm/c64core.js` (an ES-module loader) and `core/build-wasm/c64core.wasm`,
the production artifact loaded by both the browser and the headless WASM smoke test.

Install the pinned Emscripten SDK once (reproducible; downloads its own clang/node):

```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install 3.1.64     # emsdk.bat on Windows
./emsdk activate 3.1.64
```

The Emscripten CMake integration requires a Ninja or Make generator (the Visual Studio generator
is not compatible). Install Ninja if needed (e.g. from https://github.com/ninja-build/ninja/releases).
Then, with the emsdk environment active (`source ./emsdk_env.sh`, or `emsdk_env.bat` on Windows):

```sh
emcmake cmake -S core -B core/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build core/build-wasm
```

With `cmake`, `ninja`, and the emsdk environment already on `PATH`, the same two commands are
available as a convenience alias: `npm run build:wasm`. (`npm run test:wasm` runs just the
headless smoke test below.)

Run the headless smoke test against the freshly built artifact (it exercises the same assembler
output and the same `.wasm` the browser uses):

```sh
node --test tests/wasm-smoke.test.mjs   # part of `node --test tests/`; skips if unbuilt
```

`node --test tests/` runs the whole suite and the WASM smoke test skips gracefully when
`core/build-wasm/c64core.js` is absent, so the pipeline gate stays green without the toolchain.

## Core test fixtures

The core tests consume fixtures generated from the `src/` assembler (no ROMs involved):

```sh
node tools/gen-core-fixtures.mjs           # verify committed fixtures match the assembler
node tools/gen-core-fixtures.mjs --write   # regenerate core/tests/fixtures/* after intended changes
```

## Still planned (not implemented)

Static web-asset assembly, the browser IDE/gallery, ROM asset handling, SID/CIA devices, and
GitHub Pages deployment are not built yet. Each implementing change must add its exact commands
here and update `status/SYSTEM-STATUS.md`.

Never add copyrighted Commodore ROMs to satisfy a local or CI build. Use approved
redistributable replacements, synthetic test ROMs, or user-supplied local files under
[`specs/ROM-ASSETS.md`](./specs/ROM-ASSETS.md). The emulator-core targets above need no ROMs.
