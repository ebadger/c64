# c64 — ROM Assets Spec

> Legal, private, and reproducible handling of C64 and 1541 ROM data.

---

## Purpose

The ROM asset layer supplies the emulator with a complete identified C64 ROM set and drive ROM without
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

DriveRom {
  schema: 1
  id: string
  bytes: Uint8Array
  descriptor: {
    role: "drive1541"
    size: 16384
    sha256: string
    licenseId: string | null
    source: "bundled-replacement" | "user-supplied"
  }
}

BundledRomManifest {
  schema: 4
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
    kernal:  {
      path: string
      upstreamPath: string
      bytes: 8192
      sha256: string
      basePath: string
      baseSha256: string
      patch: { path: string, bytes: uint32, sha256: string }
    }
    chargen: { path: string, upstreamPath: string, bytes: 4096, sha256: string }
  }
  drive: {
    id: string
    title: string
    upstreamRepository: string
    revision: string
    sourceUrl: string
    sourceArchive: { path: string, bytes: uint32, sha256: string }
    license: { id: "MIT", path: string }
    redistributionFiles: { path: string, bytes: uint32, sha256: string }[]
    baseRom: {
      path: string
      upstreamPath: "dos.bin"
      bytes: 16384
      sha256: string
    }
    patch: { path: string, bytes: uint32, sha256: string }
    rom: {
      path: string
      upstreamPath: "dos.bin"
      bytes: 16384
      sha256: string
      baseSha256: string
    }
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
The drive ROM is a separate 16384-byte identity so replacing drive firmware never changes the
C64 `RomSet.id`. `DriveRom.id` is the plain SHA-256 of its bytes.

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

| Role | Upstream file | Bytes | Upstream SHA-256 | Runtime SHA-256 |
|------|---------------|------:|-----------------|----------------|
| BASIC | `bin/basic_c64.bin` | 8192 | `06480f4be4b62b545bbc4185c22befa8cc3b958fa15db31d74f82ffc03fec2e5` | same as upstream |
| KERNAL | `bin/kernal_c64.bin` | 8192 | `5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414` | `dbf227205959580b188d5e93c9f1cffb6e19897957af6d2525c88e5e72ab6f06` |
| CHARGEN | `bin/chargen.bin` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` | same as upstream |

The bundle also carries the exact GitHub source archive for that revision (165027 bytes,
SHA-256 `8cab283a172f3eb1473320e4be65894ec43d68ef0ff29c68c486f2d98ad665b2`)
and the complete applicable redistribution materials beside the ROM images: the package
MIT license, Microsoft's BASIC MIT license, the GPLv3/LGPLv3 texts required by the
chargen component, the MEGA65 notice, the chargen-specific notice, and c64's pinned
provenance record. Production assembly permits exactly the manifest-addressed images,
archive, and redistribution files; missing, extra, unsafe, or integrity-mismatched assets
fail the build.

The published KERNAL is preserved as `kernal-upstream.rom`. It is an approved shipped ROM
image only at the pinned path, 8192-byte size, upstream digest above, Pascual project MIT
license (`LICENSE.txt`), and provenance record (`PROVENANCE.md`) tied to the pinned revision
and corresponding source archive. Production verification rejects any other `.rom` path and
independently checks those exact approval fields plus every manifest-addressed file's bytes
and digest before admitting the upstream image to `dist/`.

c64 applies the auditable `kernal-c64-compat.patch` and an equivalent deterministic byte patch
to that exact binary. Standard secondary-address loads retain their embedded address. When that
embedded address equals BASIC `TXTTAB`, the BASIC `LOAD` command also updates `VARTAB` from the
returned end address and relinks the program, matching the existing secondary-address-zero BASIC
path. Secondary-address machine-code loads at any other address leave BASIC boundaries unchanged.

The same compatibility patch preserves the 6510 processor-port contract during `RAMTAS` by
clearing only zero-page `$02-$FF`, provides the stock-compatible `$EA31` custom-IRQ continuation,
transmits the required `$3F` byte after the `UNLSN` turnaround delay, and leaves CIA1 port A at
`$7F` after keyboard/STOP scans so idle joystick-2 fire remains released. The displaced internal
cursor routine is relocated within reviewed zero-filled ROM space. The runtime `kernal.rom`
remains 8192 bytes with the runtime digest above. The build verifies the upstream digest, every
replaced instruction range, copied routine, and zero-filled compatibility region.

Upstream describes this revision as a full Microsoft 6502 BASIC-derived interpreter with a
screen editor and IEC `LOAD`/`SAVE`/`VERIFY`. c64 treats those as upstream claims and asserts
only the supported paths it tests locally: reset-vector startup reaches the Pascual banner
and `READY.`, direct-entry assembly execution remains deterministic, standard drive-8 BASIC
loads work with secondary addresses zero and one, and machine-code loads preserve BASIC
boundaries.

The bundled 1541 firmware is
[`Pascual-Candel-Palazon/Pascual_DOS-1541`](https://github.com/Pascual-Candel-Palazon/Pascual_DOS-1541),
pinned to revision `72c2648494c71126cf5338f0c3c09b9e815a8b50` under MIT. It is a clean-room
implementation from public 1541 hardware and IEC documentation, not a derivative or disassembly of
Commodore DOS. The published `dos.bin` is preserved as `dos1541-upstream.rom` (16384 bytes, SHA-256
`c63f4933689e7582e6fa857564eb03df3466bd56ca1f9ab78e6b9f798ddeee39`).
c64 applies the auditable `dos1541-c64-compat.patch` to the corresponding pinned source and an
equivalent deterministic byte patch to that exact published binary. Both express the same
compatibility behavior: standard CBM `*` and `?` filename patterns match, channel 15 returns DOS
status, direct-access channels opened with `#` expose a sector buffer, and the public `U1`
block-read command validates drive/track/sector fields and fills that buffer. A direct channel
sends a leading buffer byte followed by exactly 256 sector bytes; the final sector byte carries
EOI. The byte patch additionally restores one pinned-source behavior the published `dos.bin`
omits: channel-0 OPEN resets the received filename before every LOAD request. This keeps
sequential and repeated loads independent and supports documented sector access without host-side
KERNAL traps or title-specific logic.
The runtime `dos1541.rom` is 16384 bytes with SHA-256
`725047c3310d843b99c02dbd35699b2d6ccfe07f16adef28025cb5519d89dd39`. The compatibility
changes use erased space in the clean-room ROM and do not add game-specific filenames,
addresses, or proprietary code.

The exact source archive is 82984 bytes with SHA-256
`ade11365bd3ae671e681306d536d4942942be2a3fcb10ef0f54b2ffdff2fff9c`; its MIT license,
`PROCEDENCIA.md`, source, hardware notes, tests, upstream base binary, and c64 patch ship beside
the runtime binary and are covered by the production allowlist/integrity gate. The build script
verifies the base bytes and replaced instruction ranges before producing the patched identity,
so assembler-version layout differences cannot silently alter the deployed firmware.

## Behaviour / Rules

- No Commodore-owned BASIC, KERNAL, character, or drive ROM dump may be committed, bundled in
  generated assets, embedded in tests, copied into issues/PRs, or fetched by the app.
- User-supplied ROMs enter through local file selection or drag/drop, are size checked,
  hashed locally, and remain in browser memory for the session.
- The client loads the bundled manifest, all three C64 role files, the drive ROM, corresponding source archives, and
  every redistribution file from the same static app origin at startup. It validates manifest
  shape plus every byte count and exact SHA-256 before replacing the active set. The production
  allowlist additionally treats the manifest-addressed upstream KERNAL as a reproduction input
  only when its pinned path, hash, license, provenance, revision, and corresponding-source
  identity all match the reviewed approval. A partial or mismatched package is rejected atomically.
- The ROM-source control defaults to **Bundled Pascual's BASIC/KERNAL and DOS-1541**. Choosing **Custom local
  ROM files** clears the bundled set and requires a complete BASIC/KERNAL/CHARGEN trio; it
  never silently mixes a custom C64 role with roles from the bundled C64 set. The independently
  licensed bundled drive ROM remains selected; a custom drive-ROM picker is deferred. Switching
  back reloads and revalidates the bundled set.
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

`same-origin bundled manifest + C64 role files + drive ROM OR user C64 file picker ->
byte/size/digest validation -> atomic active RomSet + DriveRom in memory -> MachineConfig ->
emulator`; metadata may flow to
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
| Redistributable default set | Implemented | Pinned Pascual's BASIC/KERNAL + MEGA65 PXL chargen; deterministic KERNAL LOAD/processor-port/IRQ/IEC/input compatibility patch; exact role/archive integrity gate; complete per-component licenses, notices, provenance, and corresponding source |
| Redistributable drive ROM | Implemented | Pinned clean-room MIT Pascual DOS-1541 base plus exact source archive, c64 filename/status/direct-channel/U1 compatibility patch, provenance, hardware notes, tests, and integrity gate |
| User file picker | Implemented | Explicit custom source mode requires all three roles; size/digest validation, unknown-digest confirmation, memory-only |
| Custom drive-ROM picker | Deferred | Bundled clean-room drive ROM remains active with custom C64 ROM sets; a local original-ROM override needs its own compatibility UI/tests |
| Persistent user-ROM cache | Deferred | Requires explicit privacy/storage design |
