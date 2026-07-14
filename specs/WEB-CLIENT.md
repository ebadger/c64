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

- `?src=<id>` loads a committed gallery entry.
- `?code=<base64url>` decodes UTF-8 edited source into an ephemeral project using explicit
  documented default settings. Padding is optional; standard base64 `+` and `/` are invalid.
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

## Browser and security boundaries

- Target current evergreen browsers with WebAssembly, ES modules, workers, Web Audio, and
  typed arrays. Missing capabilities are reported before initialization.
- The site uses a restrictive static Content Security Policy compatible with same-origin
  workers/WASM and no third-party scripts.
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
| Static IDE shell | Not started | Vanilla client planned |
| Worker assembler integration | Not started | Same module as Node tests |
| WASM video/audio/input bridge | Not started | Browser pacing outside core |
| URL share/remix and autosave | Not started | Public bearer-data warning required |
| Gallery and canonical PR flow | Not started | `gallery.json` not yet created |
| GitHub Pages deployment | Planned | No workflow or live site yet |
