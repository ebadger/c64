# c64 — Web Client Spec

> Static browser IDE, serverless sharing, presentation, autosave, and downloads.

---

## Purpose

The web client presents source editing, build diagnostics, emulator video/audio/input, share
and remix controls, gallery navigation, ROM selection, media import, and PRG/D64 downloads.
It is a static GitHub Pages application with no runtime API or secret.

## Contracts / Interfaces

Static assets include:

- `index.html` and versioned CSS/ES modules
- the production emulator `.wasm` and generated embind loader
- `gallery.json` plus committed example source and optional curated media
- approved redistributable ROM assets and their manifest, when available

`gallery.json` entries use a versioned shape:

```text
GalleryEntry {
  schema: 1
  id: string
  title: string
  description: string
  sourcePath: string
  expectedBuildId: string
  timingProfile: "pal-6569" | "ntsc-6567r8"
  curatedD64Path?: string
}
```

IDs match `[a-z0-9][a-z0-9-]{0,63}`. Paths are repository-relative, same-origin, and may not
contain `..`, an absolute URL, a leading slash, a backslash, a scheme (`:`), a protocol-relative
prefix (`//`), or a `%` escape; they are resolved against a documented static base (the
repository root), not the document location.

### Gallery project construction (deterministic)

A gallery entry declares source and timing but not the full project. The client constructs a
canonical `SourceProject` from an entry deterministically so its `expectedBuildId` is
CI-verifiable:

```text
project = { ...DEFAULT_PROJECT,
            source:        normalized text fetched from sourcePath,
            timingProfile: entry.timingProfile,
            name:          entry.id,
            outputName:    entry.id }
```

`expectedBuildId` must equal `computeBuildId(project, prg)` for that project. A committed
generator (`web/client/tools/build-gallery.mjs`) records the field and a Node test rebuilds
every entry and fails on drift, exactly like the example golden vectors. This gallery build of a
shared example is a distinct project from `examples/<name>/project.json` (different metadata) and
intentionally has its own `buildId`; the two golden records do not have to match.

## URL and local-state rules

- `?src=<id>` loads a committed gallery entry. The client constructs an ephemeral
  `SourceProject` from the fetched `sourcePath` plus the entry's `timingProfile`; every other
  field takes its documented `DEFAULT_PROJECT` value (`schema:1`, `runMode:"basic-sys"`,
  `loadAddress:$0801`, `outputName:"program"`, etc.). The entry's `expectedBuildId` is the
  build id of exactly that project and is guarded by a headless test so gallery source and its
  recorded id cannot silently diverge.
- `?code=<base64url>` decodes UTF-8 edited source into an ephemeral project using explicit
  documented default settings (the decoded string becomes `source`; all other fields take
  `DEFAULT_PROJECT` values). Padding is optional; standard base64 `+` and `/` are invalid.
- `?d64=<id>` may load only the curated same-origin D64 declared by that gallery entry.
- Precedence is `code` over `src` for source content. `d64` is independent but must resolve
  through a valid gallery ID. Unknown, duplicate, or malformed values produce a visible
  error and do not silently select another project.
- A `?code` URL is public bearer data: anyone with it can read/copy it, intermediaries may
  retain it, there is no revocation, and long source creates long URLs. The Share control
  states this before copying.
- Decoded source is capped at 256 KiB UTF-8. The client rejects larger payloads before
  allocation amplification and recommends downloading source instead.
- Autosave uses `c64.dev.v1.autosave` for canonical project JSON and
  `c64.dev.v1.preferences` for non-sensitive UI settings. Storage events are version checked.
  ROM and imported D64 bytes are never stored there.
- URL-loaded source remains editable and is a remix. The address bar is not mutated to
  include edits until the user explicitly invokes Share.

## IDE and emulator behaviour

- Initial UI areas: source editor, diagnostics, Run/Stop/Reset, machine profile, video,
  audio enable, keyboard/joystick help, artifact downloads, share, gallery, ROM status, and
  D64 import.
- Build runs through the dual-use assembler, preferably in a worker. Run is enabled only
  for the latest successful build and a valid ROM set.
- In-app **Run** loads the PRG and enters the machine-code entry at `runAddress` (for
  `basic-sys` this is the SYS target the generated stub jumps to). The app does not tokenize and
  RUN BASIC in-process; the *downloaded* PRG still autostarts via BASIC `RUN` on a stock machine
  per [`CODEGEN.md`](./CODEGEN.md). This keeps Run deterministic and ROM-agnostic and is the
  honestly-labelled in-app boundary.
- The WASM core runs in bounded cycle batches. The browser uses `requestAnimationFrame` and
  audio-buffer demand to pace presentation; it never changes the selected machine clock or
  skips emulated cycles to match display refresh.
- Input uses physical `KeyboardEvent.code` mappings and Gamepad snapshots, suppresses browser
  defaults only while emulator focus is active, and always provides a release-all path on
  blur/visibility loss.
- Audio begins only after a user gesture and recovers from suspended contexts visibly.
- Canvas scaling preserves C64 aspect intent and pixel edges. Presentation may drop old
  completed frames when behind but cannot mutate emulator state.
- Download controls create client-side `Blob` URLs, click a sanitized filename, and revoke
  the URL after use.
- Assembly errors, missing ROMs, unsupported browsers, WASM startup errors, and invalid
  media render explicit states. The client never fabricates successful output.

<<<<<<< HEAD
### Presentation palette (declared)

The canvas renderer maps each 4-bit VIC-II colour index through a fixed declared 16-entry RGBA
palette (the widely used "Pepto" PAL colodore-derived values). Palette selection is
presentation only and never affects machine state or collision logic (per `VIC-II.md`). Scaling
preserves the C64 pixel aspect intent and keeps pixel edges crisp (`image-rendering: pixelated`,
integer-friendly scaling); presentation may drop old completed frames when behind but never
mutates emulator state.

### Physical keyboard and joystick mapping (declared)

Input uses physical `KeyboardEvent.code` values (not `key`, so layout/locale and key-repeat do
not change the mapping) resolved to positions in the 8×8 C64 keyboard matrix, emitted to the core
as eight active-low column bytes. The mapping is a committed table
(`web/client/lib/keymap.js`). Joysticks are active-low (`bit0` up … `bit4` fire) from a declared
key set (default port 2) and optional `Gamepad` snapshots taken each frame. `RESTORE` maps to the
NMI input, not a printable key. Browser defaults are suppressed only while the emulator surface
holds focus, and every blur/visibility-loss path calls release-all so no key can stick.

## Browser and security boundaries
=======
## Emulator bridge contract

The web client integrates the deterministic C64 core (owned by [`EMULATOR.md`](./EMULATOR.md))
only through a single documented bridge module. The bridge binds to the embind **v0 WebAssembly
boundary** finalized in [`EMULATOR.md`](./EMULATOR.md) "v0 WebAssembly boundary" — the shared,
authoritative contract. Any change to it is coordinated with the emulator-core owner.

```text
// Loader: c64core.js exposes a DEFAULT-export Emscripten factory.
import createC64Core from "<path>/c64core.js";
const mod = await createC64Core();
const m = new mod.Machine(timingProfile);   // "pal-6569" | "ntsc-6567r8"

Machine {
  reset(): void
  setPC(addr: uint16): void
  loadPrg(prg: Uint8Array): { ok, loadAddress, endAddress, error }
  runCycles(cycles: uint32): uint32                       // cycles actually executed
  runFrame(): { cyclesRun, frameSequence, stopped }
  framebuffer(): Uint8Array   // FRESH COPY, "c64-indexed-8": 1 byte/pixel, 4-bit index 0..15
  frameWidth(): 384
  frameHeight(): 272
  readMem(addr: uint16): uint8
  writeMem(addr: uint16, value: uint8): void
  delete(): void
}
```

- The bridge exposes an async `createMachine({ createCore, timingProfile })` that resolves the
  factory and constructs `new Machine(timingProfile)`. The requested profile is passed through
  unchanged (not silently coerced); the core reports an invalid configuration via
  `ok()`/`configError()`, which the bridge surfaces as unavailable. A constructed instance is
  `delete()`d on any failure path so a native object never leaks. Until the `c64core.js`/
  `c64core.wasm` artifact is present in the deployment the bridge resolves to an explicit
  **unavailable** result with a stable reason; the Run control renders that state and the client
  never fabricates a framebuffer, cycle count, or memory read. The artifact is built separately
  and published as `core/build-wasm/c64core.js` (+ `.wasm`).
- **v0 ROM policy.** The v0 core runs **direct-mode** PRGs with no ROM: `loadPrg(prg)` loads at
  the header address but does **not** set the PC, so the client sequences
  `loadPrg -> setPC(runAddress) -> runFrame`/`runCycles -> framebuffer`. **basic-sys** boot needs
  KERNAL/CHARGEN ROMs and stays gated (`rom-set-missing`) until a ROM decision lands; that
  per-project gate is the client's Run logic, not the core factory.
- The framebuffer is **indexed** (`c64-indexed-8`), not RGBA: 384x272 with the 320x200 active
  window at offset (32, 36). The client owns the 16-colour C64 palette (index -> RGBA) and the
  canvas draw; it must not assume RGBA bytes.
- All wall-clock pacing (`requestAnimationFrame`, Web Audio scheduling, input polling) lives in
  the client. The bridge only advances the core through bounded `runCycles`/`runFrame` calls; it
  never changes the selected machine clock to match display refresh.
- Not in v0 (tracked with the emulator-core owner): D64 mounting, keyboard/joystick input,
  audio drain (SID is a register stub), and save states.


>>>>>>> origin/main

- Target current evergreen browsers with WebAssembly, ES modules, workers, Web Audio, and
  typed arrays. Missing capabilities are reported before initialization.
- The site uses a restrictive static Content Security Policy compatible with same-origin
<<<<<<< HEAD
  workers/WASM and no third-party scripts. The concrete policy, delivered by a `<meta
  http-equiv>` tag (Pages-compatible) and echoed by the dev server, is:

  ```text
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
  style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

  `'wasm-unsafe-eval'` is the minimum needed to compile the same-origin WebAssembly module; no
  `'unsafe-inline'`/`'unsafe-eval'` is used. There are no inline scripts or inline styles. The
  production WASM artifact is built with `-sDYNAMIC_EXECUTION=0` so embind generates no runtime
  JavaScript (`new Function`/`eval`), keeping it compatible with this policy (see
  `core/CMakeLists.txt` and [`EMULATOR.md`](./EMULATOR.md)).
=======
  workers/WASM and no third-party scripts. `frame-ancestors` is declared in the meta CSP as
  intent, but browsers ignore it there; anti-framing must be delivered as an HTTP response
  header (or `X-Frame-Options`) by the GitHub Pages deployment. Tracked as a deployment-milestone
  gap in `status/SYSTEM-STATUS.md`.
>>>>>>> origin/main
- Source is treated as data, never inserted as HTML or evaluated as JavaScript.
- No analytics, ads, accounts, uploads, remote code execution, cross-origin source fetches,
  or runtime write endpoints exist in the initial architecture.
- Canonical publishing is documented as a GitHub contribution flow; the app does not hold a
  GitHub token or create commits.

## Data flow

`gallery/query/autosave/user edit -> SourceProject -> assembler worker -> PRG/D64 + diagnostics
-> downloads and WASM machine -> frame/audio -> UI`; and `local ROM/D64 picker -> validation
-> in-memory emulator resources`. Canonical content changes only through GitHub PRs.

## Error handling

Errors have stable UI categories (`share`, `storage`, `build`, `rom`, `wasm`, `media`,
`audio`, `input`) and preserve editable source. Storage quota failure disables autosave with
a visible warning. Worker/WASM crashes stop Run and require explicit restart; the UI does
not continue showing a running state.

## Dependencies

- Upstream: [`CODEGEN.md`](./CODEGEN.md), [`MEDIA.md`](./MEDIA.md),
  [`ROM-ASSETS.md`](./ROM-ASSETS.md), committed gallery assets.
- Downstream: browser users and static GitHub Pages deployment.
- Runtime dependencies: generated emulator WASM/loader and static source assets only.

### Local development and end-to-end testing

The static app is served for local development and E2E by a dependency-light Node static server
(`scripts/dev/serve.mjs`) rooted at the repository so `/web/client/`, `/src/`, `/web/emulator/`,
`/examples/`, and `/build/wasm/` are same-origin. It sets correct MIME types
(`application/wasm`, `text/javascript`) and echoes the CSP. End-to-end tests
(`tests/e2e/`, Playwright, an opt-in dev-only tool) drive the real app against the **actual
production WASM artifact**; they skip cleanly when the artifact or the browser binaries are
absent, mirroring the headless WASM parity tests. Exact commands live in `SETUP.md`.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
<<<<<<< HEAD
| Static IDE shell | Implemented | Vanilla HTML/CSS/ES-module client under `web/client/` |
| Worker assembler integration | Implemented | Module worker imports the same `src/` modules as Node tests; stale-result sequencing |
| WASM video/audio/input bridge | Implemented | Uses the committed `web/emulator/c64.mjs`; browser pacing outside the core |
| URL share/remix and autosave | Implemented | `?code`/`?src`/`?d64`, bearer-data warning, namespaced autosave/preferences |
| Gallery and canonical PR flow | Implemented | `web/client/gallery.json` with a validated, reproducible border-flash entry |
| GitHub Pages deployment | Planned (milestone 5) | No workflow or live site yet; not claimed live |
=======
| Static IDE shell | Implemented | Vanilla `web/` client, restrictive CSP, source treated as data |
| Worker assembler integration | Implemented | Module worker imports the same `src/` pipeline as Node tests |
| Diagnostics panel | Implemented | Renders stable diagnostic codes/positions from `AssemblyResult` |
| PRG/D64 downloads | Implemented | Client-side `Blob` + pipeline `downloadFilename`; URLs revoked after use |
| URL share/remix and autosave | Implemented | `?code`/`?src`, 256 KiB decoded cap, public bearer-data Share warning, `c64.dev.v1.*` autosave |
| Gallery and canonical PR flow | Implemented (minimal) | `web/gallery.json` with the `border-flash` `?src` entry; build-id guarded by a test |
| Capability detection | Implemented | WASM, module workers, typed arrays, Blob/URL, storage; explicit unsupported state |
| WASM video/audio/input bridge | Documented stub | `emulatorBridge.v1.js` binds the embind v0 boundary; Run renders **emulator unavailable** until the `c64core.wasm` artifact is bundled. v0 runs direct-mode PRGs with no ROM; basic-sys Run stays ROM-gated |
| GitHub Pages deployment | Planned | No workflow or live site yet |
>>>>>>> origin/main
