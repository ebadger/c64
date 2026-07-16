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
  schema: 2
  id: string
  title: string
  upstreamRepository: string
  revision: string
  sourceUrl: string
  sourceArchive: { path: string, bytes: uint32, sha256: string }
  licenses: {
    package: { id: "MIT", path: string }
    basic: { id: "MIT", path: string }
    chargen: {
      id: "LGPL-3.0-or-later"
      path: string
      companionPaths: string[]
    }
  }
  redistributionFiles: { path: string, bytes: uint32, sha256: string }[]
  roles: {
    basic:   { path: string, upstreamPath: string, bytes: 8192, sha256: string }
    kernal:  { path: string, upstreamPath: string, bytes: 8192, sha256: string }
    chargen: { path: string, upstreamPath: string, bytes: 4096, sha256: string }
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

The default set is
[`Pascual-Candel-Palazon/Pascuals-BASIC`](https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC),
pinned to revision `45da60da4d39f9f3950cdf957996c1743c53bb6e`. Its KERNAL and
project-owned build/test sources are MIT-licensed, its BASIC is mechanically derived from
Microsoft's MIT-licensed `BASIC-M6502` source, and its character generator is the MEGA65
OpenROMs PXL font redistributed under `LGPL-3.0-or-later`. The approved role files and
SHA-256 digests are:

| Role | Upstream file | Bytes | SHA-256 |
|------|---------------|------:|---------|
| BASIC | `bin/basic_c64.bin` | 8192 | `06480f4be4b62b545bbc4185c22befa8cc3b958fa15db31d74f82ffc03fec2e5` |
| KERNAL | `bin/kernal_c64.bin` | 8192 | `5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414` |
| CHARGEN | `bin/chargen.bin` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` |

The bundle also carries the exact GitHub source archive for that revision (165027 bytes,
SHA-256 `8cab283a172f3eb1473320e4be65894ec43d68ef0ff29c68c486f2d98ad665b2`)
and the complete applicable redistribution materials beside the ROM images: the package
MIT license, Microsoft's BASIC MIT license, the GPLv3/LGPLv3 texts required by the
chargen component, the MEGA65 notice, the chargen-specific notice, and c64's pinned
provenance record. Production assembly permits exactly the manifest-addressed images,
archive, and redistribution files; missing, extra, unsafe, or integrity-mismatched assets
fail the build.

Upstream describes this revision as a full Microsoft 6502 BASIC-derived interpreter with a
screen editor and IEC `LOAD`/`SAVE`/`VERIFY`. c64 treats those as upstream claims and asserts
only the supported paths it tests locally: reset-vector startup reaches the Pascual banner
and `READY.`, direct-entry assembly execution remains deterministic, and standard drive-8
loads use the high-level KERNAL LOAD boundary in [`MEDIA.md`](./MEDIA.md).

## Behaviour / Rules

- No Commodore-owned BASIC, KERNAL, or character ROM dump may be committed, bundled in
  generated assets, embedded in tests, copied into issues/PRs, or fetched by the app.
- User-supplied ROMs enter through local file selection or drag/drop, are size checked,
  hashed locally, and remain in browser memory for the session.
- The client loads the bundled manifest, all three role files, corresponding source archive, and
  every redistribution file from the same static app origin at startup. It validates manifest
  shape plus every byte count and exact SHA-256 before replacing the active set. A partial or
  mismatched package is rejected atomically.
- The ROM-source control defaults to **Bundled Pascual's BASIC/KERNAL**. Choosing **Custom local
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
| Redistributable default set | Implemented | Pinned Pascual's BASIC/KERNAL + MEGA65 PXL chargen; exact role/archive integrity gate; complete per-component licenses, notices, provenance, and corresponding source |
| User file picker | Implemented | Explicit custom source mode requires all three roles; size/digest validation, unknown-digest confirmation, memory-only |
| Persistent user-ROM cache | Deferred | Requires explicit privacy/storage design |
