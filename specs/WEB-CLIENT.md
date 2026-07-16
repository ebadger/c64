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
contain `..`, an absolute URL, or a leading slash.

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



- Target current evergreen browsers with WebAssembly, ES modules, workers, Web Audio, and
  typed arrays. Missing capabilities are reported before initialization.
- The site uses a restrictive static Content Security Policy compatible with same-origin
  workers/WASM and no third-party scripts. `frame-ancestors` is declared in the meta CSP as
  intent, but browsers ignore it there; anti-framing must be delivered as an HTTP response
  header (or `X-Frame-Options`) by the GitHub Pages deployment. Tracked as a deployment-milestone
  gap in `status/SYSTEM-STATUS.md`.
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

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Static IDE shell | Implemented | Vanilla `web/` client, restrictive CSP, source treated as data |
| Worker assembler integration | Implemented | Module worker imports the same `src/` pipeline as Node tests |
| Diagnostics panel | Implemented | Renders stable diagnostic codes/positions from `AssemblyResult` |
| PRG/D64 downloads | Implemented | Client-side `Blob` + pipeline `downloadFilename`; URLs revoked after use |
| URL share/remix and autosave | Implemented | `?code`/`?src`, 256 KiB decoded cap, public bearer-data Share warning, `c64.dev.v1.*` autosave |
| Gallery and canonical PR flow | Implemented (minimal) | `web/gallery.json` with the `border-flash` `?src` entry; build-id guarded by a test |
| Capability detection | Implemented | WASM, module workers, typed arrays, Blob/URL, storage; explicit unsupported state |
| WASM video/audio/input bridge | Documented stub | `emulatorBridge.v1.js` binds the embind v0 boundary; Run renders **emulator unavailable** until the `c64core.wasm` artifact is bundled. v0 runs direct-mode PRGs with no ROM; basic-sys Run stays ROM-gated |
| GitHub Pages deployment | Planned | No workflow or live site yet |
