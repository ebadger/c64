# c64 — Runtime Reference

> Downstream-owned current state. Planned architecture belongs in specs; this file records
> only what can actually be run or verified now, plus clearly labeled next-state plans.

_Last verified: 2026-07-15 — Copilot milestone-2b web-client session_

## Environments

| Environment | Current location | URL | State |
|-------------|------------------|-----|-------|
| Development | Repository checkout | None | Deterministic pipeline + static `web/` IDE run locally; Build/Download/Share work, Run renders an explicit emulator-unavailable state; no WASM core |
| Production | Planned GitHub Pages | `https://ebadger.github.io/c64/` | Not deployed; no workflow or site assets exist |

## Run locally

The deterministic source-to-artifact pipeline (assembler → PRG → D64) runs under Node.js 18+
with no dependency install. From the repository root:

```sh
node --test tests/                 # full pipeline + web-client smoke tests (production modules in src/ and web/)
node examples/build-example.mjs    # verify committed example golden vectors
```

The static browser IDE lives in `web/` and needs no build step. Serve the repository root over
HTTP and open `web/` (see `SETUP.md` for the exact commands and the manual browser smoke test):

```sh
python3 -m http.server 8080        # then open http://localhost:8080/web/
```

Build (assemble → PRG/D64), diagnostics, downloads, `?code`/`?src` share/remix, autosave, and
the `border-flash` gallery entry work today. Run is intentionally unavailable: there is no
WebAssembly emulator core or ROM set yet, so the client shows an explicit unavailable state and
never fabricates execution.

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
pipeline and the web client's headless smoke tests; they do not validate an emulator because the
WebAssembly core does not exist yet. The `web/` IDE itself is verified manually in a browser
(see `SETUP.md`).

## Planned build and deployment (not implemented)

| Planned step | Required outcome |
|--------------|------------------|
| Install pinned Emscripten | Reproducible C++17-to-WASM toolchain |
| Native CMake build | Fast emulator unit/golden tests |
| WebAssembly build | Production embind loader and `.wasm` static assets |
| Static asset build | IDE, gallery, examples, approved ROM manifest/assets |
| Node/native/WASM tests | Same assembler and production WASM artifact in headless smoke tests |
| GitHub Pages deploy | Publish only after all builds and tests pass |

The implementation PR that adds each step must add exact commands and update this status.

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

- The emulator core, VIC-II, SID/CIA/input, WebAssembly build, ROM handling, and GitHub Pages
  deployment described by the layer specs are not started here. The `web/` IDE ships Build/
  Download/Share/gallery/autosave, but its Run control stays in an explicit unavailable state
  because the `c64core.wasm` artifact is not present in this deployment. The emulator bridge
  (`web/modules/emulatorBridge.v1.js`) binds the finalized embind v0 boundary; once the artifact
  is bundled, **direct-mode** Run can be enabled with no ROM (loadPrg → setPC → runFrame), while
  **basic-sys** Run remains gated on the pending ROM decision. Wiring the live run loop (palette,
  canvas blit, rAF pacing) is a tracked follow-up.
- No redistributable replacement ROM set has been selected or legally reviewed.
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
