# c64 — System Overview

> The umbrella spec. Read this at session start, then load only the sub-specs for the layer
> being changed.

---

## What this system is

c64 is a zero-install, static web development environment for Commodore 64 software. A user
can edit NMOS 6510 assembly, deterministically build the same source into a PRG and a D64,
run the PRG through a WebAssembly C64 emulator, share the source through a URL or curated
example, and download standard artifacts for external tools or physical hardware.

This repository currently contains the specialized product and architecture foundation, the
implemented deterministic source-to-artifact pipeline (assembler, PRG, and D64), and the
deterministic C++17 machine core: a complete documented NMOS 6510 CPU, C64 bus/banking and ROM
validation, compiled once to a production WebAssembly artifact and exercised by native and
headless WASM parity tests. The VIC-II, SID/CIA/input devices, mounted disk media, web client,
examples gallery, and deployment workflow are planned and are not yet implemented.

## Architecture at a glance

```text
Committed examples / ?src / ?code / localStorage
                       |
                       v
          Static browser client on GitHub Pages
              |                         |
              v                         v
   Dual-use JS assembler         C++17 deterministic core
      (browser + Node)          compiled once to WASM/embind
              |                         |
              +---- PRG bytes ----------+
              |                         |
              +---- D64 builder     video/audio/input
              |
              +---- client-side downloads

GitHub pull requests curate canonical examples and gallery.json.
There is no runtime API, account system, database, or secret.
```

- **Stack:** C++17; Emscripten/embind WebAssembly; dependency-light ES modules; vanilla
  HTML/CSS/JavaScript; Node.js headless tests; static GitHub Pages hosting.
- **Development environment (planned):** native CMake build plus Emscripten build, a static
  local web server, and Node/native/WASM smoke and golden-vector tests.
- **Production environment (planned):** GitHub Pages at
  `https://ebadger.github.io/c64/`; no runtime backend or production secrets.

## Sub-specs

| Layer | Spec | Covers |
|-------|------|--------|
| Emulator core | [`EMULATOR.md`](./EMULATOR.md) | NMOS 6510, memory bus/banking, deterministic execution, WASM boundary |
| VIC-II | [`VIC-II.md`](./VIC-II.md) | PAL/NTSC raster timing, video registers, sprites, interrupts, framebuffer |
| SID, CIA, and input | [`IO.md`](./IO.md) | Audio, timers, ports, keyboard, joystick, IEC-facing signals |
| Code generation | [`CODEGEN.md`](./CODEGEN.md) | Assembler contract, project model, PRG layout, entry behavior, diagnostics |
| Media | [`MEDIA.md`](./MEDIA.md) | PRG/D64 validation, deterministic disk construction, import, downloads |
| ROM assets | [`ROM-ASSETS.md`](./ROM-ASSETS.md) | Redistributable replacements, user-supplied ROMs, validation, privacy |
| Web client | [`WEB-CLIENT.md`](./WEB-CLIENT.md) | IDE state, URL sharing, autosave, gallery, worker/pacing behavior |
| AI operating system | [`TEMPLATE-INHERITANCE.md`](./TEMPLATE-INHERITANCE.md) | Canonical template lineage and reconciliation boundary |

## Cross-cutting concerns

- **Auth model:** none. Read, edit, run, remix, and download are anonymous. GitHub identity
  is used only when a contributor opens a pull request outside the running application.
- **Canonical writes:** the application has none. Curated examples and `gallery.json` change
  only through repository pull requests.
- **Local state:** source autosave and non-sensitive preferences use namespaced browser
  storage. URL shares are public bearer data with no ownership, privacy, or revocation.
- **Determinism:** normalized source, assembler version, project settings, timing profile,
  ROM identity, and emulator inputs must produce byte-identical artifacts and repeatable
  machine-state traces. Browser wall-clock pacing is not part of the deterministic core.
- **ROM/legal boundary:** copyrighted Commodore ROMs are never committed, bundled, fetched,
  uploaded, or embedded in shares. Only redistributable replacements may ship.
- **Interoperability boundary:** physical-hardware support is limited to standard PRG and
  D64 downloads. No custom hardware or transfer stack is part of the system.
- **Critical path:** `source project -> deterministic assembly -> byte-exact PRG -> valid
  D64 -> load in the same WASM core -> observable machine result`. Golden vectors and
  headless smoke tests must protect this path before product code is considered shipped.

## Primary data flows

1. **Edit and run:** user edit -> normalized source project -> assembler -> PRG bytes ->
   emulator load -> deterministic cycles -> framebuffer/audio -> browser presentation.
2. **Download:** assembly result -> PRG serializer and D64 builder -> browser `Blob` ->
   user-controlled file download.
3. **Share/remix:** source -> base64url UTF-8 `?code` URL -> recipient decode -> editable
   project -> deterministic rebuild. Canonical `?src` examples resolve from committed files.
4. **Import media:** local D64 selection or curated `?d64` -> validation -> emulated drive
   media -> deterministic IEC/disk behavior. Imported bytes are not uploaded.
5. **Publish canonical example:** contributor changes committed source and `gallery.json` ->
   tests rebuild expected PRG/D64 -> GitHub pull request -> human review and merge.

## Implementation status

| Area | Status |
|------|--------|
| Product mission and architecture | Specified in this specialization PR |
| Template lineage and operating controls | Inherited and instantiated at template commit `66a14469787860a1b08918f4089f9070680bb3e9` |
| Machine core (CPU, bus/banking, ROM validation, lifecycle) | Implemented — deterministic C++17 core with native + WASM parity tests |
| VIC-II, SID/CIA/input | Not started (explicit unavailable device boundary in the core) |
| Assembler and PRG/D64 generation | Implemented — deterministic browser/Node pipeline in `src/` with Node golden-vector tests |
| ROM asset handling | Implemented in the core (validation, digests, memory-only); no redistributable set selected; web picker not started |
| Web client, examples, and gallery | Not started (one canonical assembler example fixture exists under `examples/`) |
| Native/WASM tests and build pipeline | Implemented — CMake native build/CTest, pinned Emscripten production `.wasm`, headless parity, and a CI workflow |
| GitHub Pages deployment | Planned; no workflow or deployed site exists yet |
