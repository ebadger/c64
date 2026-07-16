# Development setup

The repository provides the deterministic source-to-artifact pipeline (assembler, PRG, and
D64), the deterministic C++17 machine core (native + production WebAssembly), and the static
browser IDE in `web/client/`, plus the architecture and operating foundation.

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

## Build and test the machine core (native)

The deterministic C++17 machine core lives in `core/` with a CMake project. Requires CMake
≥ 3.20 and a C++17 compiler.

On Linux/macOS (compiler and CMake on PATH):

```sh
sh scripts/build/build-native.sh        # configure, build, and run CTest (build/native)
# or manually:
cmake -S core -B build/native -DCMAKE_BUILD_TYPE=Release
cmake --build build/native
ctest --test-dir build/native --output-on-failure
```

On Windows with Visual Studio 2022 (no global CMake/compiler needed), discover the bundled
toolchain and configure with Ninja from a Developer environment:

```powershell
$cmake = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
$ninja = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
$vc    = "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build\vcvars64.bat"
& $env:ComSpec /c "call `"$vc`" && `"$cmake`" -S core -B build\native -G Ninja -DCMAKE_MAKE_PROGRAM=`"$ninja`" -DCMAKE_CXX_COMPILER=cl && `"$cmake`" --build build\native"
# then: & "$cmake\..\ctest.exe" --test-dir build\native --output-on-failure
```

Adjust the edition (`Enterprise`/`Community`/`BuildTools`) and use `vswhere.exe` to locate the
install if it differs.

## Build the production WebAssembly artifact and run headless parity

The WASM build uses a pinned Emscripten toolchain (`scripts/build/emscripten-version.txt`,
currently **3.1.74**). Install it once (outside the repo, on a drive with several GB free):

```sh
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && python emsdk.py install 3.1.74 && python emsdk.py activate 3.1.74
```

Activate it (`source ./emsdk_env.sh`, or `emsdk_env.bat` on Windows) so `emcmake`/`emcc` are on
PATH, then build and test:

```sh
sh scripts/build/build-wasm.sh          # emits build/wasm/c64core.mjs + c64core.wasm
node --test tests/wasm/                  # headless native/WASM parity + smoke (needs both builds)
```

`tests/wasm/parity.test.mjs` runs the native `scenario_dump` and the WASM build over the same
C++ scenario suite and asserts their canonical JSON is byte-identical. The WASM tests skip
cleanly when an artifact is not built, so `node --test tests/` never fails for a missing build.

Never add copyrighted Commodore ROMs to satisfy a local or CI build. Use approved
redistributable replacements, the synthetic generated test ROMs in the core, or user-supplied
local files under [`specs/ROM-ASSETS.md`](./specs/ROM-ASSETS.md).

## Build, run, and test the static web client

The browser IDE in `web/client/` is static and serverless with no runtime dependency install.

Serve it for local development (the dev server roots at the repository so the app, `src/`,
`web/emulator/`, `examples/`, and `build/wasm/` are same-origin):

```sh
node scripts/dev/serve.mjs            # open http://127.0.0.1:8080/web/client/
node scripts/dev/serve.mjs --port 5173
```

Build the production WebAssembly artifact first (see the section above) so **Run** works. Because
no redistributable ROM set ships yet, Run also requires locally selected BASIC/KERNAL/character
ROM files; they stay in memory and are never uploaded, stored, or logged.

Test and verify:

```sh
node --test tests/web/               # environment-free web-client logic (URL/share/ROM/gallery/…)
node web/client/tools/build-gallery.mjs        # verify gallery.json golden vectors
node web/client/tools/build-gallery.mjs --write # regenerate gallery.json after intended changes
```

Browser end-to-end tests drive the real app against the actual production WASM artifact using a
headless Chromium. They need the WASM build and Playwright (an opt-in dev-only tool) and skip
cleanly when either is missing:

```sh
npm i --no-save playwright
npx playwright install chromium
node --test tests/e2e/               # E2E against build/wasm/c64core.mjs via scripts/dev/serve.mjs
```

The GitHub Pages deployment workflow is a later milestone and is not part of this build.
