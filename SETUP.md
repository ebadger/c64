# Development setup

The repository is currently an architecture and operating foundation. There is no emulator
or web application to build or run yet.

## Current requirements

- Git
- Node.js with the built-in test runner
- A POSIX shell for tracked shell guards (Git Bash is sufficient on Windows)
- GitHub CLI only when checking or opening pull requests

## Activate repository guards

From the repository root:

```sh
git config core.hooksPath .githooks
```

This is local git configuration and must be activated once per clone. The tracked pre-push
hook enforces the learnings budget, protects merged/closed PR branches, and runs the
project-owned test gate.

## Validate the current foundation

```sh
node scripts/dev/review-template-updates.mjs check
sh scripts/dev/check-learnings-budget.sh
sh -n .githooks/pre-push
sh -n scripts/dev/pre-push-tests.sh
node --check .github/extensions/compliance-hooks/extension.mjs
node --test .github/extensions/compliance-hooks/policy.test.mjs
```

These commands validate the files that exist today. They do not build or test an emulator.

## Planned application toolchain

Application implementation will add a CMake-based native C++17 build, a pinned Emscripten
toolchain for the production WebAssembly artifact, static web asset assembly, Node/native/
WASM smoke tests, and GitHub Pages deployment. The implementing change must add exact,
reproducible commands here and in `status/SYSTEM-STATUS.md`; do not treat this plan as an
existing build.

Never add copyrighted Commodore ROMs to satisfy a local or CI build. Use approved
redistributable replacements, synthetic test ROMs, or user-supplied local files under
[`specs/ROM-ASSETS.md`](./specs/ROM-ASSETS.md).
