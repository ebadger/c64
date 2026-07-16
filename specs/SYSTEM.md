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
validation, plus cycle-integrated VIC-II, SID, and CIA devices and read-only mounted D64
execution — compiled once to a production WebAssembly artifact and exercised by native and
headless WASM parity tests. The static browser IDE (`web/client/`) integrates the production
assembler worker and production WASM machine with a validated examples gallery, and a deterministic
`dist/` build plus a GitHub Actions release pipeline deploy the gated bundle to GitHub Pages on
merged `main`; the Pages site is live at `https://ebadger.github.io/c64/`. Device and media fidelity is honestly
labelled in the layer specs (line-based VIC renderer, approximate SID filter, high-level
rather than cycle-level 1541 drive).

## Architecture at a glance

```text
Committed examples / ?src / ?code / localStorage
Bundled Pascual ROMs / local custom ROM selection
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
- **Development environment:** native CMake build plus Emscripten build, a static local web
  server, and Node/native/WASM/browser smoke and golden-vector tests.
- **Production environment:** live GitHub Pages at `https://ebadger.github.io/c64/`; no
  runtime backend or production secrets.

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
   selected manifest-verified bundled or complete custom RomSet -> emulator load ->
   deterministic cycles -> framebuffer/audio -> browser presentation.
2. **Boot BASIC:** selected manifest-verified bundled or complete custom RomSet + optional
   validated D64 -> configure/mount -> ROM reset vector -> deterministic cycles ->
   framebuffer/audio -> browser presentation.
3. **Download:** assembly result -> PRG serializer and D64 builder -> browser `Blob` ->
   user-controlled file download.
4. **Share/remix:** source -> base64url UTF-8 `?code` URL -> recipient decode -> editable
   project -> deterministic rebuild. Canonical `?src` examples resolve from committed files.
5. **Import media:** local D64 selection or curated `?d64` -> validation -> visible directory
   and selected PRG extraction -> explicit/detected entry -> emulated drive media + direct
   machine load, or reset-vector BASIC boot with the disk mounted -> deterministic execution
   and subsequent IEC/disk behavior. Eject removes drive-8 media without persisting bytes;
   imported bytes are not uploaded.
6. **Publish canonical example:** contributor changes committed source and `gallery.json` ->
   tests rebuild expected PRG/D64 -> GitHub pull request -> human review and merge.

## Implementation status

| Area | Status |
|------|--------|
| Product mission and architecture | Specified in this specialization PR |
| Template lineage and operating controls | Inherited and instantiated at template commit `66a14469787860a1b08918f4089f9070680bb3e9` |
| Machine core (CPU, bus/banking, ROM validation, lifecycle) | Implemented — deterministic C++17 core with native + WASM parity tests |
| VIC-II, SID/CIA/input | Implemented — cycle-integrated devices (line-based VIC renderer, approximate SID filter); honestly-labelled fidelity in the layer specs |
| Mounted D64 execution | Implemented — read-only browse/run/eject plus a high-level KERNAL LOAD/IEC trap (drive 8); not a cycle-level 1541 GCR drive |
| Assembler and PRG/D64 generation | Implemented — deterministic browser/Node pipeline in `src/` with Node golden-vector tests |
| ROM asset handling | Implemented — pinned Pascual BASIC/KERNAL + MEGA65 PXL chargen default with exact integrity/provenance/source gate; explicit complete custom-set override remains memory-only with unknown-digest confirmation |
| Web client, examples, and gallery | Implemented — static `web/client/` IDE (build worker, reset-vector BASIC boot, deterministic direct-entry Run, machine presentation/input, disk controls, sharing, downloads) and a validated `gallery.json`; the milestone-1 example visibly cycles its border while running |
| Native/WASM tests and build pipeline | Implemented — CMake native build/CTest, pinned Emscripten production `.wasm`, headless parity, and CI workflows |
| Production dist build + GitHub Pages deployment | Implemented and live — deterministic `dist/` build (`scripts/build/build-dist.mjs`), dist reference/integrity tests, external D64 interoperability (VICE `c1541`), a pinned Chromium/Firefox/WebKit browser matrix, and `.github/workflows/release.yml` deploying the gated artifact on merged `main` |
