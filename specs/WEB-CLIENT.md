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
- the pinned Pascual's BASIC/KERNAL set plus MEGA65 PXL chargen and clean-room Pascual DOS-1541
  drive ROM, their manifest, per-component licenses/notices, provenance, and corresponding source

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
  ROM and imported D64 bytes are never stored there. ROM-source selection is also not
  persisted: every new page load starts from the bundled default.
- URL-loaded source remains editable and is a remix. The address bar is not mutated to
  include edits until the user explicitly invokes Share.

## IDE and emulator behaviour

- The presentation shell intentionally shares 3RIC Studio's compact terminal visual language:
  a full-height near-black surface (`#0b0e0c`), bright and dim phosphor greens (`#33ff66` and
  `#1d6b33`), a readable secondary green (`#75bd89`), a dark panel surface (`#11140f`), system
  monospace text, and one-pixel controls. Dim green is structural (borders/dividers); normal-size
  secondary text uses the lighter green and maintains at least 4.5:1 contrast on its declared
  surfaces. The client loads no external font or style dependency. On wide screens the emulator
  is the left, screen-first column (up to 640 CSS pixels) and the assembler is the flexible right
  column (up to 780 CSS pixels), with C64-specific utility panels below. The two columns wrap
  without horizontal page scrolling, and the narrow layout keeps emulator then editor source
  order.
- Initial UI areas: a compact machine toolbar; source editor and diagnostics; Build & Run,
  build-only, run-last-build, Boot BASIC, Stop, and Reset controls; machine profile; video and
  audio; a collapsed virtual C64 keyboard directly below the display; keyboard/joystick help;
  artifact downloads; share; gallery; ROM status; and D64 import/directory/run/eject.
  Reorganization for the sibling-site layout must not hide or remove any C64-specific workflow.
- Build runs through the dual-use assembler, preferably in a worker. The same-origin,
  manifest-verified Pascual's BASIC/KERNAL set with the MEGA65 PXL chargen loads by default.
  **Boot BASIC** is enabled when the ROM set is ready; source **Run** additionally requires a
  current successful build. An explicit ROM-source control can switch to a complete custom
  local BASIC/KERNAL/CHARGEN trio for the current page session.
- **Build & Run** is the primary source action. It immediately snapshots the current
  source/name/timing settings, submits that project to the worker, and runs only the exact newest
  successful result from that request. A subsequent source/name/timing edit cancels the pending
  run intent; a failed, superseded, or stale build never starts the machine. **Build** remains
  available for artifact-only work and **Run** restarts the current non-stale successful build.
  `Ctrl+Enter` (or `Command+Enter` on macOS) in the source editor invokes the same Build & Run
  path and suppresses the textarea newline for that chord only.
- Valid gallery entries populate both the descriptive gallery cards and a compact **Sample**
  selector in the assembler bar. Choosing a sample follows the same validated source/remix load
  path as its gallery card and does not auto-run it. Source selection does not eject already
  mounted media (D64 remains independent), but every newer gallery or explicit disk action
  invalidates an older in-flight curated-D64 fetch so late media cannot attach to a newer source.
- Switching ROM source stops execution and replaces the set atomically. Custom mode starts
  empty and cannot inherit individual bundled roles, avoiding unsupported mixed sets.
- In-app **Run** resets the machine (power-on), loads the PRG, and enters the machine-code entry
  at `runAddress` (for `basic-sys` this is the SYS target the generated stub jumps to). It does
  not run the ROM's BASIC cold-start or tokenize and `RUN` the stub in-process; the *downloaded*
  PRG still autostarts via BASIC `RUN` on a stock machine per [`CODEGEN.md`](./CODEGEN.md). This
  keeps source Run deterministic and ROM-agnostic. It is distinct from Boot BASIC and the UI
  must never label a directly entered PRG as a BASIC boot.
- **Boot BASIC** configures/powers on with the active ROM set, mounts a selected valid D64 on
  drive 8 when present, and starts pacing from the ROM reset vector without loading a PRG or
  overriding PC. The run status identifies this as BASIC, not as a started program. Stop stops
  pacing only and preserves the booted machine. Reset performs another power-on reset into BASIC,
  preserving the core's mounted-media state; if a disk has been ejected, Reset does not remount it.
- D64 selection validates media immediately and renders every directory entry, with the first
  PRG preselected. It never auto-runs a file. **Run selected PRG** extracts the selected PRG,
  uses a structurally detected first-line tokenized BASIC `SYS` target when present, otherwise
  requires an explicit hexadecimal (`$C000`/`0xC000`) or decimal (`49152`) uint16 entry address,
  then follows the same configure/mount/load/set-PC path as source Run. Reset restarts whichever
  mode was most recently started: reset-vector BASIC boot, source build, or disk PRG. The D64
  controls visibly repeat the [`MEDIA.md`](./MEDIA.md) compatibility boundary: drive 8 uses a
  clean-room DOS ROM with a cycle-scheduled CPU, selected 6522 surface, wired IEC, and rotating
  digital GCR; writable/protected media, analog flux, and private entry points from Commodore's
  original ROM are not claimed. The emulator fidelity note also states the
  [`EMULATOR.md`](./EMULATOR.md) CPU boundary: declared stable undocumented NMOS families execute,
  while unstable/JAM/65C02 encodings stop with an explicit fault.
- **Eject** clears the file input, directory, entry address, and in-memory selected bytes, and
  unmounts drive 8 from an already configured machine without stopping or resetting execution.
  Invalid replacement media reports a `media` error and preserves the prior valid disk.
- The canonical **Border flash** gallery program continuously cycles declared VIC-II border
  colours with a deterministic CPU-cycle delay long enough for browser presentation to expose
  multiple distinct frames; it must not complete all visible writes before the first frame.
- The WASM core runs in bounded cycle batches. The browser uses `requestAnimationFrame` and
  audio-buffer demand to pace presentation; it never changes the selected machine clock or
  skips emulated cycles to match display refresh.
- Input combines physical `KeyboardEvent.code` mappings, virtual C64 matrix-key presses, and
  Gamepad snapshots. Browser defaults are suppressed only while emulator display focus is active;
  display blur releases held physical keys, while window blur, visibility loss, keyboard-panel
  collapse, and Stop provide release-all paths for both physical and virtual input.
- Audio begins only after a user gesture and recovers from suspended contexts visibly.
- Canvas scaling preserves C64 aspect intent and pixel edges. Presentation may drop old
  completed frames when behind but cannot mutate emulator state.
- Download controls create client-side `Blob` URLs, click a sanitized filename, and revoke
  the URL after use.
- Assembly errors, bundled-ROM manifest/fetch/integrity failures, missing custom ROMs,
  unsupported browsers, WASM startup errors, and invalid media render explicit states. The
  client never fabricates successful output.

### Presentation palette (declared)

The canvas renderer maps each 4-bit VIC-II colour index through a fixed declared 16-entry RGBA
palette (the widely used "Pepto" PAL colodore-derived values). Palette selection is
presentation only and never affects machine state or collision logic (per `VIC-II.md`). Scaling
preserves the C64 pixel aspect intent and keeps pixel edges crisp (`image-rendering: pixelated`,
integer-friendly scaling); presentation may drop old completed frames when behind but never
mutates emulator state.

### Physical and virtual keyboard mapping (declared)

Input uses physical `KeyboardEvent.code` values (not `key`, so layout/locale and key-repeat do
not change the mapping) resolved to positions in the 8×8 C64 keyboard matrix, emitted to the core
as eight active-low column bytes. The mapping is a committed table
(`web/client/lib/keymap.js`). Two declared shifted-code aliases bridge common host punctuation to
different C64 positions: `Shift+Quote` emits C64 `Shift+2` (`"`), and `Shift+Digit8` emits the
dedicated C64 `*` key while consuming host Shift. Joysticks are active-low (`bit0` up … `bit4`
fire) from a declared key set (default port 2) and optional `Gamepad` snapshots taken each frame.
`RESTORE` maps to the NMI input, not a printable key. Browser defaults are suppressed only while
the emulator surface holds focus. Display focus moving within the emulator region releases
physical input only;
external blur and visibility-loss paths call release-all so no key can stick.

The integrated virtual keyboard is a collapsed `<details>` panel directly below the canvas. Its
key order follows the original C64 physical layout: the left-arrow/number row, QWERTY row,
RUN/STOP + SHIFT LOCK home row, C= + dual-SHIFT bottom row, centered space bar, two physical
cursor keys, and the separate vertical F1/F2 through F7/F8 column. Every actionable key is backed
by a named matrix position from the same committed keymap; SHIFT LOCK mechanically models a
persistent left SHIFT, and RESTORE drives the NMI input. It does not translate labels through the
host keyboard layout or inject text.

Touchscreen SHIFT, CTRL, and C= keys are one-shot modifiers: activating one toggles its visible
latched state, and the next non-modifier virtual key sends the complete chord for a bounded
presentation-layer pulse before consuming the latch. SHIFT LOCK remains active until explicitly
toggled or release-all. Paired cursor and function keycaps expose their shifted legends (up/left
and F2/F4/F6/F8) rather than inventing extra physical keys.

Pointer/touch activation restores display focus without scrolling; keyboard or assistive-
technology activation leaves focus on the key. A focus-only control immediately before the
display moves to the virtual-keyboard summary, and physical `Shift+Tab` remains browser focus
navigation so the emulator cannot trap keyboard users. The responsive layout preserves the C64
row/function-column relationship at desktop widths and scales the whole keyboard within the
machine panel at phone widths without page-level horizontal scrolling.

## Browser and security boundaries

- Target current evergreen browsers. **Required** capabilities (missing any one is a hard,
  pre-initialization `capability` error): WebAssembly, ES modules, Web Workers, typed arrays,
  `TextEncoder`/`TextDecoder`, DOM, Canvas 2D, URL APIs, and `localStorage`. **Optional**
  capabilities degrade gracefully instead of blocking the app: **Web Audio** is optional — when it
  is absent (e.g. some headless WebKit builds) the emulator still loads, builds, runs video,
  accepts input, and downloads artifacts, but the audio control is disabled and honestly labelled
  ("Audio unavailable in this browser"). Capability status is computed before initialization.
- The release browser matrix pins Playwright **Chromium, Firefox, and WebKit** and drives the full
  user journey against the production `dist/` bytes at both the localhost root (`/`) and the GitHub
  Pages project base (`/c64/`), asserting base-path independence and honest optional-capability
  fallback (see `tests/e2e/matrix.e2e.test.mjs`).
- The site uses a restrictive static Content Security Policy compatible with same-origin
  workers/WASM and no third-party scripts. The concrete policy, delivered by a `<meta
  http-equiv>` tag (Pages-compatible) and echoed by the dev server, is:

  ```text
  default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';
  style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self';
  object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  ```

  `'wasm-unsafe-eval'` is the minimum needed to compile the same-origin WebAssembly module; no
  `'unsafe-inline'`/`'unsafe-eval'` is used. There are no inline scripts or inline styles. The
  production WebAssembly artifact is built with Emscripten `-sDYNAMIC_EXECUTION=0` so embind
  generates no runtime JavaScript (`new Function`/`eval`) and the generated loader contains none;
  it therefore loads under this policy without any `'unsafe-eval'` relaxation (see
  `core/CMakeLists.txt` and [`EMULATOR.md`](./EMULATOR.md)). A dist reference test rejects any
  absolute/external asset URL and the browser-matrix E2E runs under the deployed CSP with zero
  console CSP violations.
- Source is treated as data, never inserted as HTML or evaluated as JavaScript.
- Bundled C64 and drive ROM replacements are committed release assets fetched only from the same app origin at runtime.
  Their pinned source revision, license, sizes, and hashes ship beside them; production
  assembly independently rechecks the allowlisted files before emitting `dist/`.
- No analytics, ads, accounts, uploads, remote code execution, cross-origin source fetches,
  or runtime write endpoints exist in the initial architecture.
- Canonical publishing is documented as a GitHub contribution flow; the app does not hold a
  GitHub token or create commits.

## Data flow

`gallery/query/autosave/user edit -> SourceProject -> assembler worker -> PRG/D64 + diagnostics
-> downloads and WASM machine -> frame/audio -> UI`; `physical key or virtual key pointer event
-> normalized active-low matrix/RESTORE snapshot -> WASM machine`; and `bundled same-origin ROM manifest or
local ROM picker -> integrity validation -> atomic in-memory RomSet`, plus `local/curated D64
-> validation -> directory selection -> PRG extraction + explicit/detected entry -> mounted
read-only media and WASM machine`. Canonical content changes only through GitHub PRs.

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

### Production build and deployment (`dist/`)

`scripts/build/build-dist.mjs` assembles a clean, flattened, app-rooted `dist/` containing only the
files the deployed site needs: `index.html`, `main.js`, `styles.css`, `buildWorker.js`, `lib/`, the
shared assembler `pipeline/` (from `src/`), the `emulator/` wrapper, the production
`wasm/c64core.{mjs,wasm}`, `gallery.json` and its referenced example sources, a
manifest-verified `roms/` subtree containing only the approved Pascual C64 and 1541 ROM sets and their
per-component licenses/notices/provenance/corresponding source, a `THIRD-PARTY-NOTICES.md` inventory, and a content-derived
`asset-manifest.json` (sha256 + byte size + MIME per file). It emits no source maps, private
inputs, Commodore ROM dumps, or user-supplied bytes.

- **Base-path independence.** Every asset reference resolves relatively (ES module specifiers and
  `import.meta.url` math, relative `fetch`/`new URL`, relative HTML `href`/`src`), so the same
  `dist/` works unchanged at the localhost root (`/`) and under the GitHub Pages project base
  (`/c64/`) with no absolute-path breakage. The build rewrites only the small, anchored set of
  cross-tree specifiers the flattening changes and fails loudly if an anchor is missing.
- **Determinism.** Inputs are copied byte-for-byte and the manifest/notices are pure functions of
  content (no timestamps or commit ids), so repeated clean builds from the same commit and pinned
  toolchain are byte-identical (WASM bytes are reproducible only to the extent the pinned Emscripten
  toolchain is; the release records the toolchain out of band).
- **Release gate.** The production WASM artifact is **required** by default; the build fails (never
  silently skips) when `build/wasm/c64core.{mjs,wasm}` is missing. `--allow-missing-wasm` is for
  inspection-only dev builds and is never used on the release path.
- **Post-deploy identity gate.** The release build records the sha256 of its generated
  `asset-manifest.json` and passes that identity to the Pages deploy job. After deployment, a
  reusable smoke check uses cache-busting requests and bounded retries to require that Pages serves
  that exact manifest, a valid releasable manifest structure, and byte/hash/MIME-correct critical
  artifacts (`index.html`, its direct stylesheet/module references, the production WASM binary, and
  the bundled 1541 ROM). A stale but otherwise healthy prior deployment, presentation-copy match,
  partial propagation, malformed manifest, or arbitrary HTTP 200 response fails the release.
- Reference/MIME/determinism/CSP invariants are enforced by `tests/dist/`.

### Local development and end-to-end testing

The static app is served for local development and E2E by a dependency-light Node static server
(`scripts/dev/serve.mjs`). For local dev it roots at the repository so `/web/client/`, `/src/`,
`/web/emulator/`, `/examples/`, and `/build/wasm/` are same-origin; the browser E2E instead serves
the assembled `dist/` (the actual deployable bytes). It sets correct MIME types
(`application/wasm`, `text/javascript`) and echoes the CSP. End-to-end tests
(`tests/e2e/`, Playwright, an opt-in dev-only tool) drive the real app against the **actual
production WASM artifact** in `dist/` across the Chromium/Firefox/WebKit matrix. Locally they skip
cleanly when the artifact or a browser binary is absent; on the release path CI sets
`C64_E2E_REQUIRE` so a missing artifact or required browser **fails** rather than skips. Exact
commands live in `SETUP.md`.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Static IDE shell | Implemented | Vanilla HTML/CSS/ES-module client under `web/client/` |
| Worker assembler integration | Implemented | Module worker imports the same `src/` modules as Node tests; stale-result sequencing |
| WASM video/audio/input bridge | Implemented | Uses the committed `web/emulator/c64.mjs`; browser pacing outside the core; physical and virtual keys share the active-low matrix path |
| Integrated virtual C64 keyboard | Implemented | Collapsed responsive physical-layout panel with one-shot SHIFT/CTRL/C=, persistent SHIFT LOCK, RESTORE NMI, paired cursor/function legends, accessible focus escape, and release-all safety |
| URL share/remix and autosave | Implemented | `?code`/`?src`/`?d64`, bearer-data warning, namespaced autosave/preferences |
| Gallery and canonical PR flow | Implemented | `web/client/gallery.json` with a validated, reproducible border-flash entry |
| Default and custom ROM selection | Implemented | Bundled, pinned Pascual BASIC/KERNAL + MEGA65 PXL chargen and clean-room DOS-1541 load and verify by default; explicit memory-only complete custom C64 set override |
| BASIC boot and direct-entry execution | Implemented | Reset-vector Boot BASIC is distinct from deterministic source/disk PRG entry; Stop preserves machine state and Reset restarts the active mode |
| D64 import controls | Implemented | Immediate directory validation, BASIC boot with selected media, selected-PRG run with explicit/detected entry, reset continuity, and live drive-8 eject |
| GitHub Pages deployment | Implemented and live | Deterministic `dist/` build (`scripts/build/build-dist.mjs`) + release workflow (`.github/workflows/release.yml`) deploy the gated artifact to Pages on merged `main`, then require its exact manifest identity and critical bytes through a bounded propagation smoke |
