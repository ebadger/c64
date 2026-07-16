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

BundledRomManifest {
  schema: 1
  id: string
  title: string
  upstreamRepository: string
  revision: string
  licenseId: string
  licensePath: string
  sourceUrl: string
  sourceArchive: { path: string, bytes: uint32, sha256: string }
  roles: {
    basic:   { path: string, bytes: 8192, sha256: string }
    kernal:  { path: string, bytes: 8192, sha256: string }
    chargen: { path: string, bytes: 4096, sha256: string }
  }
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
provenance, corresponding source, and immutable digests. The legal right to redistribute
must be reviewed before the bytes enter the repository.

The default set is the generic C64 build from
[`MEGA65/open-roms`](https://github.com/MEGA65/open-roms), pinned to revision
`ad178dbe4d48cd6a317737a8e0e7e662f7e33d32` and distributed under
`LGPL-3.0-or-later` (with the upstream package's noted MIT-licensed BASIC portions). The
approved role files and SHA-256 digests are:

| Role | Upstream file | Bytes | SHA-256 |
|------|---------------|------:|---------|
| BASIC | `bin/basic_generic.rom` | 8192 | `54a1464b4b27c9dc61bbd62a818fdd12ec99af9089111005a5add0ad0e6bd5ec` |
| KERNAL | `bin/kernal_generic.rom` | 8192 | `88e86ed3d0c710edab8f90ad146faa8de1ead11f43494b176c7b54724ca721c6` |
| CHARGEN | `bin/chargen_openroms.rom` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` |

The bundle also carries the complete pinned upstream source archive (SHA-256
`7e7fb6e775a0d820e8605107fec168e17ab232ad1172bc788bbc492996fcf229`) and the upstream
license texts beside the ROM images.

The set is suitable for the assembly-first in-app execution path. It is not represented as a
complete replacement for original BASIC: upstream still lists most BASIC commands and some
system functions as incomplete.

## Behaviour / Rules

- No Commodore-owned BASIC, KERNAL, or character ROM dump may be committed, bundled in
  generated assets, embedded in tests, copied into issues/PRs, or fetched by the app.
- User-supplied ROMs enter through local file selection or drag/drop, are size checked,
  hashed locally, and remain in browser memory for the session.
- The client loads the bundled manifest and all three role files from the same static app
  origin at startup. It validates manifest shape, role sizes, and exact SHA-256 values before
  replacing the active set. A partial or mismatched download is rejected atomically.
- The ROM-source control defaults to **Bundled MEGA65 OpenROMs**. Choosing **Custom local
  ROM files** clears the bundled set and requires a complete BASIC/KERNAL/CHARGEN trio; it
  never silently mixes a custom role with roles from the bundled set. Switching back reloads
  and revalidates the bundled set.
- If multiple file reads overlap for the same custom role, only the most recent picker
  selection may update that role; stale completions and stale read errors are ignored.
- ROM-source selection and custom bytes are session-only. Reloading the page returns to the
  bundled default; no ROM bytes or custom-selection state enter local storage.
- Initial implementation does not persist user ROM bytes. A future opt-in persistent cache
  requires an explicit storage/privacy design and clear/delete controls; localStorage is not
  used for binary ROMs.
- ROM bytes never enter `?code`, `?src`, local source autosave, telemetry, error reports,
  or log text. Only a digest and role may appear in local diagnostics.
- The default zero-install experience uses the approved bundled replacement set. The app
  never fetches ROMs from an external runtime origin or substitutes unreviewed images.
- Mixed ROM sets are allowed only when each role passes size validation and the resulting
  set receives a distinct deterministic ID. Known incompatible combinations may be blocked
  by metadata.
- Tests use redistributable fixtures or synthetic ROMs designed for tests.

## Data flow

`same-origin bundled manifest + role files OR user file picker -> byte/size/digest validation
-> atomic active RomSet in memory -> MachineConfig -> emulator`; metadata may flow to
reproducibility diagnostics, but user ROM bytes never flow back to the application network
or source-sharing state.

## Error handling

- Missing roles produce `rom-set-incomplete` and disable Run while leaving edit/build and
  artifact downloads available.
- Wrong lengths produce `rom-size`; unrecognized digests are allowed as user-supplied only
  when sizes are correct and the user confirms the role.
- A malformed bundled manifest produces `rom-manifest`; a same-origin fetch failure produces
  `rom-fetch`; a size or digest mismatch produces `rom-integrity`. These leave Run disabled
  and direct the user to retry or choose custom local files; they never fall back silently.
- A bundled digest mismatch is both a client-visible startup failure and a build/deployment
  integrity failure, not a recoverable substitution.
- File read failures identify the role and preserve any previously valid in-memory set.

## Dependencies

- Upstream: approved replacement-ROM sources/licenses or local user selection.
- Downstream: [`EMULATOR.md`](./EMULATOR.md), [`WEB-CLIENT.md`](./WEB-CLIENT.md),
  deterministic machine-test fixtures.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| ROM manifest and validation | Implemented | Same-origin manifest loader; exact size/SHA-256 checks; atomic activation; deterministic set id; explicit manifest/fetch/integrity errors |
| Synthetic test fixtures | Implemented | Legally-clean generated ROMs (with valid vectors) drive native/WASM tests; no Commodore bytes |
| Redistributable default set | Implemented | Pinned generic MEGA65 OpenROMs set; exact role/archive integrity gate; complete licenses, provenance, and corresponding source |
| User file picker | Implemented | Explicit custom source mode requires all three roles; size/digest validation, unknown-digest confirmation, memory-only |
| Persistent user-ROM cache | Deferred | Requires explicit privacy/storage design |
