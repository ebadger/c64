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
dependency-light ES modules; the identical files run in modern browsers and in Node.js.

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

## Planned application toolchain (not yet implemented)

The static web client, examples/gallery assembly, and GitHub Pages deployment are not built
yet. The implementing change must add exact, reproducible commands here and in
`status/SYSTEM-STATUS.md`; do not treat that plan as an existing build.
