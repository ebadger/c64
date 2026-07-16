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

## Planned application toolchain

Application implementation will add a CMake-based native C++17 build, a pinned Emscripten
toolchain for the production WebAssembly artifact, static web asset assembly, Node/native/
WASM smoke tests, and GitHub Pages deployment. The implementing change must add exact,
reproducible commands here and in `status/SYSTEM-STATUS.md`; do not treat this plan as an
existing build.

Never add copyrighted Commodore ROMs to satisfy a local or CI build. Use approved
redistributable replacements, synthetic test ROMs, or user-supplied local files under
[`specs/ROM-ASSETS.md`](./specs/ROM-ASSETS.md).
