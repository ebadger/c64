# c64 — Media and Artifact Spec

> Standard PRG/D64 validation, deterministic disk construction, import, and download.

---

## Purpose

The media layer validates standard PRG and D64 bytes, builds a standards-compatible 1541
35-track D64 containing assembled PRG files, and mounts imported disks for emulation. It is
client-side and does not upload or persist binary media.

## Contracts / Interfaces

```text
ArtifactBundle {
  schema: 1
  buildId: string
  prgName: string
  prg: Uint8Array
  d64Name: string
  d64: Uint8Array
  loadAddress: uint16
  runAddress: uint16
}

MediaResult {
  ok: boolean
  metadata: DiskMetadata | null
  warnings: readonly MediaWarning[]
  error: MediaError | null
}
```

- `parsePrg(bytes)` validates and returns load/end metadata without executing it.
- `buildD64(project, prg)` returns a new deterministic 174848-byte image.
- `parseD64(bytes)` validates geometry, the directory chain, and every file chain (bounds and
  cycle checks) plus the BAM directory-link track. Full BAM-consistency validation (DOS
  version, per-track free-count/bitmap agreement, and allocation conflicts) is a tracked
  follow-up (ebadger/c64#2) and is **not** performed in this milestone: a structurally valid
  image whose BAM free map is internally inconsistent is currently accepted.
- `extractPrg(disk, directoryIndex)` returns the exact file byte stream, including its
  two-byte PRG load address. It requires the directory entry to be a PRG file (CBM DOS file
  type low nibble 2) and validates the reconstructed stream with `parsePrg`, returning
  `invalid-prg` for a non-PRG entry or a stream that is too short/overflows.
- `mountD64` passes an immutable validated byte image to the emulator/drive model. It rejects
  media that fails the geometry/directory/file-chain checks above, but not (yet) media whose
  only defect is an inconsistent BAM free map (see ebadger/c64#2).
- Download filenames are sanitized ASCII/PETSCII-derived names with `.prg` or `.d64`.

## PRG rules

- A PRG is at least three bytes: two-byte little-endian load address plus at least one data
  byte.
- `loadAddress + dataLength` must be at most `$10000`; wraparound is invalid.
- The media layer does not infer a run address. Run metadata comes from `SourceProject`.
- Downloaded bytes are exactly the assembler bytes; no browser metadata is prepended.

## D64 geometry and filesystem rules

Initial generation targets a standard 35-track 1541 image with 683 sectors and no appended
error-byte table:

| Tracks | Sectors/track |
|--------|---------------|
| 1-17 | 21 |
| 18-24 | 19 |
| 25-30 | 18 |
| 31-35 | 17 |

- Image size is exactly 174848 bytes. Import may recognize a 175531-byte image with a
  683-byte error table, but the drive model must either consume that table explicitly or
  report that it is ignored; generated images never include it.
- Track/sector references are one-based track and zero-based sector. Every chain is bounds
  checked and cycle checked.
- BAM is at track 18 sector 0. It links to directory sector 18/1, declares DOS version
  `$41`, records a free-sector count and three-byte bitmap for every track, and reserves BAM
  and directory sectors.
- Directory sectors begin at 18/1. Each 32-byte entry uses file type `$82` for a closed PRG,
  start track/sector, a 16-byte PETSCII filename padded with `$A0`, and little-endian block
  count. Unused entry bytes are deterministically zeroed.
- File sectors use bytes 0-1 as the next track/sector link and bytes 2-255 as up to 254
  payload bytes. In the final sector, byte 0 is `$00`; byte 1 is one greater than the
  payload length, so valid payload occupies offsets `$02` through the byte-1 value
  inclusive (for example `$00/$34` means payload offsets `$02-$34`, or 51 bytes).
- Generated disk label, two-character ID, DOS type, filename mapping, allocation order, and
  padding are deterministic. Allocation proceeds by a documented fixed track/sector order
  that avoids track 18 until directory growth requires it.
- The implemented file-data allocation walk visits tracks in ascending order
  `1,2,…,17,19,…,35` (track 18 is reserved for the BAM and directory) and, within each track,
  sectors `0…max` with no interleave. Interleave is a drive-performance optimization that does
  not affect byte-exactness, so it is intentionally omitted for determinism.
- The generated D64 contains the exact PRG byte stream produced by `CODEGEN.md`; rebuilding
  the same project produces identical D64 bytes.

## Import and emulated-drive boundary

- File selection and curated `?d64` fetches provide bytes to `parseD64`; malformed media is
  never mounted.
- Emulation is **read-only** in this milestone. Writable disk support requires copy-on-write
  state and a separate persistence/export contract before it can ship.
- Imported bytes remain in memory. They are not placed in source share URLs, localStorage,
  analytics, logs, or network requests.
- Optional curated `?d64=<id>` values resolve only through committed gallery metadata and
  same-origin static assets; arbitrary remote URLs are not fetched.

### Emulated-drive fidelity: high-level KERNAL LOAD / IEC trap (READ THIS)

**The mounted disk is served by a deterministic high-level file-service trap, NOT a cycle-level
1541 CPU/VIA/GCR emulation.** This is a deliberate, prominently-labelled compatibility boundary:

- The core intercepts a call to the KERNAL LOAD vector (`$FFD5`) when media is mounted. It reads
  the standard KERNAL zero-page LOAD parameters (device `$BA`, secondary address `$B9`, filename
  pointer `$BB/$BC` and length `$B7`), locates the file on the immutable D64 (CBM name matching
  with `*`/`?` wildcards; `$` loads a generated directory listing), copies the file into RAM at
  the load address (the PRG header when SA≠0, else the X/Y address), sets the KERNAL return
  registers (carry clear, `X/Y` = end address; carry set with `A=4`/`A=5` on error), and returns.
- **Supported:** standard `LOAD"NAME",8` / `LOAD"NAME",8,1` and `LOAD"$",8` directory loads
  through drive 8, the common path for the broad-compatibility MVP. Only **drive 8** is supported
  (`unsupported-media` otherwise).
- **NOT supported (returns explicit errors or is simply not intercepted):** custom drive code
  (`M-E`/`M-W`/`M-R`), fastloaders, bit-level GCR access, non-standard serial protocols, and
  anything that bypasses the KERNAL LOAD vector. Programs that hand-roll the serial routine or
  upload drive code are outside this boundary and are not emulated.
- No 1541 drive ROM is required, fetched, or bundled by this path; there is therefore no
  copyrighted 1541 ROM in the repository, tests, or artifacts. A future real GCR drive model (if
  it is ever added) would need a redistributable drive ROM under `ROM-ASSETS.md` and is out of
  scope here.
- Byte identity is preserved: `extractFile` returns the exact PRG byte stream (2-byte load
  address + data) from the sector chain. Issue #2's deferred full BAM-consistency scope is
  unchanged.

## Data flow

`AssemblyResult PRG -> deterministic D64 builder -> ArtifactBundle -> Blob downloads and
emulated media`; or `local/curated D64 bytes -> validator -> immutable drive media ->
emulator`.

## Error handling

| Code | Condition |
|------|-----------|
| `invalid-prg` | Too short, overflow, or empty data |
| `unsupported-geometry` | Image size/track layout is not supported |
| `invalid-track-sector` | A link references outside the image |
| `chain-cycle` | Directory or file chain loops |
| `invalid-bam` | BAM directory-link track is wrong. Full free-count/bitmap conflict detection is tracked in ebadger/c64#2 |
| `disk-full` | PRG and directory cannot fit (defensive; unreachable for a single valid PRG on a 35-track disk, whose maximum size needs far fewer than 683 sectors) |
| `invalid-name` | Name cannot be represented under the declared PETSCII policy |

Partial downloads are never offered. A failure leaves the source and prior valid artifacts
visible but marks them stale.

## Dependencies

- Upstream: [`CODEGEN.md`](./CODEGEN.md), project metadata, curated static assets.
- Downstream: [`EMULATOR.md`](./EMULATOR.md), [`WEB-CLIENT.md`](./WEB-CLIENT.md), golden
  image tests, external C64 interoperability checks.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| PRG parser/validator | Implemented | `parsePrg` shares serializer golden vectors with codegen |
| Deterministic 35-track D64 builder | Implemented | Byte-exact BAM/directory/chain construction under tests |
| D64 parser/import | Implemented (limited) | `parseD64`/`extractPrg` (JS) and the C++ core `parseD64`/`extractFile` validate geometry, directory chain, and file chains; full BAM-consistency validation is deferred to ebadger/c64#2 |
| 1541 drive behavior | Implemented (high-level trap) | Read-only KERNAL LOAD/IEC file-service trap for drive 8 (see the fidelity section above); no cycle-level GCR drive |
| Curated D64 routes | Implemented | Same-origin gallery IDs only (`?d64` resolves through a valid gallery entry); owned by `WEB-CLIENT.md` |

External-tool D64 interoperability (loading generated images in real 1541 tooling or hardware)
is not yet independently verified and is tracked as an open gap in `status/SYSTEM-STATUS.md`.
