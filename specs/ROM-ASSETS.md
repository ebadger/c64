# c64 — ROM Assets Spec

> Legal, private, and reproducible handling of BASIC, KERNAL, and character ROM data.

---

## Purpose

The ROM asset layer supplies the emulator with a complete identified ROM set without
committing or distributing copyrighted Commodore ROMs. The application may bundle only
redistributable replacement ROMs and may accept user-selected originals locally.

## Contracts / Interfaces

```text
RomDescriptor {
  role: "basic" | "kernal" | "chargen"
  size: uint32
  sha256: string
  licenseId: string | null
  source: "bundled-replacement" | "user-supplied"
}

RomSet {
  schema: 1
  id: string
  basic: Uint8Array
  kernal: Uint8Array
  chargen: Uint8Array
  descriptors: RomDescriptor[3]
}
```

Expected sizes are BASIC 8192 bytes, KERNAL 8192 bytes, and character ROM 4096 bytes.
`RomSet.id` is SHA-256 over ordered role names, byte lengths, and bytes. The canonical preimage
is the ASCII tag `c64-romset\0` followed, for each role in the fixed order basic, kernal,
chargen, by the role id, a `\0` separator, the little-endian 32-bit byte length, another `\0`,
and the raw bytes. Per-role descriptor digests are plain SHA-256 over that role's bytes. The
core computes these with its own dependency-free SHA-256 so native and WebAssembly builds
produce identical digests (verified by byte-identical native/WASM parity tests).

Bundled replacement metadata includes source repository/version, license text, build
provenance, and immutable digest. The legal right to redistribute must be reviewed before
the bytes enter the repository.

## Behaviour / Rules

- No Commodore-owned BASIC, KERNAL, or character ROM dump may be committed, bundled in
  generated assets, embedded in tests, copied into issues/PRs, or fetched by the app.
- User-supplied ROMs enter through local file selection or drag/drop, are size checked,
  hashed locally, and remain in browser memory for the session.
- Initial implementation does not persist user ROM bytes. A future opt-in persistent cache
  requires an explicit storage/privacy design and clear/delete controls; localStorage is not
  used for binary ROMs.
- ROM bytes never enter `?code`, `?src`, local source autosave, telemetry, error reports,
  or log text. Only a digest and role may appear in local diagnostics.
- The default zero-install experience requires a complete redistributable replacement set.
  If none is approved and bundled, the UI must honestly require user-supplied files rather
  than downloading unofficial images or pretending emulation is ready.
- Mixed ROM sets are allowed only when each role passes size validation and the resulting
  set receives a distinct deterministic ID. Known incompatible combinations may be blocked
  by metadata.
- Tests use redistributable fixtures or synthetic ROMs designed for tests.

## Data flow

`bundled replacement manifest or user file picker -> byte/size/digest validation -> RomSet
in memory -> MachineConfig -> emulator`; metadata may flow to reproducibility diagnostics,
but user ROM bytes never flow back to the application network or source-sharing state.

## Error handling

- Missing roles produce `rom-set-incomplete` and disable Run while leaving edit/build and
  artifact downloads available.
- Wrong lengths produce `rom-size`; unrecognized digests are allowed as user-supplied only
  when sizes are correct and the user confirms the role.
- A bundled digest mismatch is a build/deployment integrity failure, not a recoverable
  substitution.
- File read failures identify the role and preserve any previously valid in-memory set.

## Dependencies

- Upstream: approved replacement-ROM sources/licenses or local user selection.
- Downstream: [`EMULATOR.md`](./EMULATOR.md), [`WEB-CLIENT.md`](./WEB-CLIENT.md),
  deterministic machine-test fixtures.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| ROM manifest and validation | Implemented (core) | Size + SHA-256 checks, deterministic set id, per-role digests; `rom-set-incomplete`/`rom-size` errors; memory-only |
| Synthetic test fixtures | Implemented | Legally-clean generated ROMs (with valid vectors) drive native/WASM tests; no Commodore bytes |
| Redistributable default set | Unselected | Legal/license review required before bundling |
| User file picker | Not started | Owned by the web client; memory-only initial behavior |
| Persistent user-ROM cache | Deferred | Requires explicit privacy/storage design |
