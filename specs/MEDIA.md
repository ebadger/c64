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
- `parseD64(bytes)` validates geometry, BAM, directory chains, and file chains.
- `extractPrg(disk, directoryIndex)` returns the exact file byte stream, including its
  two-byte PRG load address.
- `mountD64` passes an immutable validated byte image to the emulator/drive model.
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
- The generated D64 contains the exact PRG byte stream produced by `CODEGEN.md`; rebuilding
  the same project produces identical D64 bytes.

## Import and emulated-drive boundary

- File selection and curated `?d64` fetches provide bytes to `parseD64`; malformed media is
  never mounted.
- Initial emulation may begin with a read-only 1541-compatible drive/media contract.
  Writable disk support requires copy-on-write state and a separate persistence/export
  contract before it can ship.
- Imported bytes remain in memory. They are not placed in source share URLs, localStorage,
  analytics, logs, or network requests.
- Optional curated `?d64=<id>` values resolve only through committed gallery metadata and
  same-origin static assets; arbitrary remote URLs are not fetched.

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
| `invalid-bam` | Free counts/bitmaps conflict with required allocation |
| `disk-full` | PRG and directory cannot fit |
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
| PRG parser/validator | Not started | Shares serializer vectors with codegen |
| Deterministic 35-track D64 builder | Not started | Byte and external-tool validation required |
| D64 parser/import | Not started | Read-only initial media |
| 1541 drive behavior | Not started | Emulator design must select fidelity level |
| Curated D64 routes | Optional / not started | Same-origin IDs only |
