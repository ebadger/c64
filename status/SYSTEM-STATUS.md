# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-16 — Copilot merge-conflict resolution session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic pipeline + emulator-core subset (native CMake/CTest and pinned Emscripten/embind WASM with headless smoke test) + static `web/` IDE shell; Build/Download/Share work, while Run remains explicitly unavailable until the web runtime bundles and wires the core artifact |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |

## Run locally

The deterministic source-to-artifact pipeline (assembler → PRG → D64) runs under Node.js 18+
with no dependency install. From the repository root:

```sh
node --test tests/                 # full pipeline + core-fixture + WASM smoke tests
node examples/build-example.mjs    # verify committed example golden vectors
```

The deterministic emulator-core subset in `core/` builds and tests natively (CMake/CTest) and to
WebAssembly (pinned Emscripten 3.1.64 / embind). Exact, reproducible commands — native build,
`ctest`, `emcmake` WASM build, and the headless smoke test — are in
[`SETUP.md`](../SETUP.md). The WASM smoke test in `node --test tests/` skips gracefully until the
artifact is built, so the pipeline gate stays green without the C++/Emscripten toolchain.

The static browser IDE lives in `web/` and needs no build step. Serve the repository root over
HTTP and open `web/` (see `SETUP.md` for the exact commands and the manual browser smoke test):

```sh
python3 -m http.server 8080        # then open http://localhost:8080/web/
```

Build (assemble → PRG/D64), diagnostics, downloads, `?code`/`?src` share/remix, autosave, and
the `border-flash` gallery entry work today. Run is intentionally unavailable in the shipped
`web/` shell until the bundled artifact path is wired end to end and the ROM-dependent path is
finalized.

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
committed example rebuilds to its recorded golden `buildId`/PRG/D64. The suite also rebuilds the
core fixture from the assembler and, when the WASM artifact is present, runs the headless smoke
test against it. These checks validate the pipeline, the emulator-core subset contract, and the
web client's headless smoke tests. The `web/` IDE itself is verified manually in a browser
(see `SETUP.md`).

## Build and deployment status

| Step | Status |
|------|--------|
| Install pinned Emscripten (3.1.64) | Implemented — see `SETUP.md`; downloads a self-contained toolchain |
| Native CMake build + CTest | Implemented — `core/` static lib and golden-vector tests |
| WebAssembly build (embind) | Implemented — `core/build-wasm/c64core.{js,wasm}` production artifact |
| Node/native/WASM tests | Implemented — native golden vectors + headless smoke test on the production `.wasm` |
| Static asset build (IDE, gallery, ROM manifest) | Not started |
| GitHub Pages deploy | Not started — publish only after all builds and tests pass |

Each remaining step's implementation PR must add exact commands and update this status.

## Configuration and secrets

There are no application runtime variables, credentials, or secrets. Planned Pages hosting
must remain static and secret-free. User-supplied ROM and D64 bytes are local inputs, not
configuration and never repository or CI data.

## Key scripts

| Script | Current purpose |
|--------|-----------------|
| `scripts/dev/install-hooks.sh` | Set `core.hooksPath=.githooks`. |
| `scripts/dev/check-learnings-budget.sh` | Enforce the durable-rules budget. |
| `scripts/dev/pre-push-tests.sh` | Run operating validations and, when critical-path files change, the non-bypassable pipeline eval. |
| `scripts/dev/test-critical-path.sh` | Product critical-path eval: full `node --test tests/` plus example golden-vector verification. |
| `scripts/dev/review-template-updates.mjs` | Check canonical policy changes and record reviewed checkpoints. |

## Current known gaps

- The emulator-core subset covers the NMOS 6510 (documented opcodes only), the memory bus with
  I/O routing, and a minimal border/background VIC-II. Not yet implemented: VIC text/bitmap/
  sprite modes, bad lines, raster interrupts and mid-frame splits; SID audio synthesis and CIA
  timers/TOD/keyboard scanning (register shadows only); D64 mounting, input, save states, and
  sub-instruction cycle budgeting.
- The static `web/` client ships Build/Download/Share/gallery/autosave, but Run remains in an
  explicit unavailable state until the bundled emulator artifact is wired for direct-mode in the
  browser and the ROM-dependent run path is finalized.
- No redistributable replacement ROM set has been selected or legally reviewed. The current
  runnable target needs no ROMs; a ROM strategy decision is pending with ebadger.
- Template/operating-file reconciliation with upstream `ebadger/AIProjectTemplate` (through commit
  `0dda330`) is deferred to a dedicated PR and tracked in ebadger/c64#4; feature PRs do not fold
  it in and intentionally do not advance `.template-source`.
- Generated D64 images are covered by byte-exact Node tests but have not been independently
  verified against external 1541 tooling or physical hardware.
- The `web/` client is covered by headless smoke tests for its pure modules; end-to-end browser
  behavior (worker build, downloads, canvas) is verified manually per `SETUP.md`, not in CI.
- Anti-framing is not yet enforced: the meta CSP `frame-ancestors` is ignored by browsers, so
  the GitHub Pages deployment must send `frame-ancestors 'none'` (or `X-Frame-Options`) as an
  HTTP header. Low risk today (static, no accounts/privileged actions); tracked for the
  deployment milestone.
- Upstream template drift is pending reconciliation (`node scripts/dev/review-template-updates.mjs
  check` reports changes beyond the seed commit). This milestone-2b PR does not reconcile it and
  does not advance `.template-source`; full template reconciliation is tracked in ebadger/c64#4.
- D64 import (`parseD64`/`mountD64`) validates geometry, the directory chain, and file chains,
  but does not yet validate full BAM consistency (DOS version, free-count/bitmap agreement,
  allocation conflicts); an image whose only defect is an inconsistent BAM is currently
  accepted. Tracked in ebadger/c64#2.
- No native/WASM golden vectors, browser compatibility matrix, or GitHub Pages workflow
  exist.
