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

Build the production WebAssembly artifact first (see the section above) so **Run** works. The app
loads and verifies the pinned MEGA65 OpenROMs generic set by default. Use the ROM-source selector
for a complete local BASIC/KERNAL/character override; custom files stay in memory and are never
uploaded, stored, or logged.

Test and verify:

```sh
node --test tests/web/               # environment-free web-client logic (URL/share/ROM/gallery/…)
node web/client/tools/build-gallery.mjs        # verify gallery.json golden vectors
node web/client/tools/build-gallery.mjs --write # regenerate gallery.json after intended changes
```

Browser end-to-end tests drive the real app against the actual production WASM artifact — assembled
into the deployable `dist/` — across the pinned Playwright browser matrix (Chromium, Firefox,
WebKit) at both the localhost root (`/`) and the GitHub Pages project base (`/c64/`). They need the
WASM build and Playwright (an opt-in dev-only tool) and skip cleanly when either is missing:

```sh
npm i --no-save playwright
npx playwright install chromium firefox webkit
node --test tests/e2e/               # full matrix + deep journey against the production dist bytes
```

On the release path CI sets `C64_E2E_REQUIRE=1` so a missing artifact or required browser **fails**
instead of skipping. WebKit's headless build has no Web Audio; the app treats Web Audio as an
optional capability and runs without sound there (the audio control is disabled and labelled), which
the matrix test asserts as honest fallback.

## Build the production dist and verify integrity

Assemble the deployable static bundle into a clean `dist/`. The production WASM artifact must be
built first (the build fails, by design, if it is missing):

```sh
node scripts/build/build-dist.mjs                 # clean, flattened, base-path-agnostic dist/
node scripts/dev/verify-dist.mjs                  # manifest hashes, required files, CSP, no leaks
node --test tests/dist/                           # reference/MIME/determinism/CSP invariants
node scripts/build/build-dist.mjs --allow-missing-wasm   # inspection-only dev build (NOT releasable)
```

`dist/` is base-path independent: the same bytes serve unchanged at `/` and under `/c64/`. Repeated
clean builds from the same commit and pinned toolchain are byte-identical; `dist/asset-manifest.json`
records a sha256 + byte size + MIME per file. No source maps, private inputs, proprietary Commodore
ROMs, or user-supplied bytes are emitted. The only ROM images are the manifest-allowlisted MEGA65
OpenROMs files, shipped with complete license texts, provenance, and pinned corresponding source.

## External D64 interoperability (VICE `c1541`)

Independently verify generated D64 images against a third-party tool (no binary is committed). On
Linux/CI, install VICE (`sudo apt-get install -y vice` provides `c1541`); the test finds it on PATH,
or set `C64_C1541=/path/to/c1541`. It verifies 35-track directory metadata and byte-exact extracted
PRG bytes; provenance is in [`tests/interop/PROVENANCE.md`](./tests/interop/PROVENANCE.md).

```sh
node --test tests/interop/            # skips locally when c1541 is absent
C64_INTEROP_REQUIRE=1 node --test tests/interop/   # release gate: FAIL (not skip) if c1541 missing
```

## Release pipeline and GitHub Pages

`.github/workflows/release.yml` is the authoritative release gate. On pull requests it runs every
gate (foundation, Node/golden, native + CTest, production WASM, `require-release-artifacts`, the full
browser matrix, external interop, and the production dist build + integrity) with the same pinned
tools — Emscripten `3.1.74`, Node 18, Playwright Chromium/Firefox/WebKit, and VICE `c1541` — and
uploads the static `dist/` as a Pages artifact for inspection only. On a push to `main` it rebuilds
from source and deploys the exact gated artifact to GitHub Pages via the official actions (least
permissions, concurrency-serialized, with a post-deploy smoke check). Nothing auto-merges. The live
site is `https://ebadger.github.io/c64/`; it changes only after a successful `main` deployment.
`core.yml` remains a fast per-branch feedback lane.
