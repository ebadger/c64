# Bundled Pascual ROM provenance

The C64 ROM base images in this directory are published binaries from
[`Pascual-Candel-Palazon/Pascuals-BASIC`](https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC).
The runtime KERNAL carries the small c64 compatibility patch described below.

- Upstream revision: `45da60da4d39f9f3950cdf957996c1743c53bb6e`
- Pinned source:
  <https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC/tree/45da60da4d39f9f3950cdf957996c1743c53bb6e>
- Corresponding source archive:
  <https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC/archive/45da60da4d39f9f3950cdf957996c1743c53bb6e.tar.gz>
- Vendored corresponding source:
  `pascuals-basic-45da60da4d39f9f3950cdf957996c1743c53bb6e.tar.gz`
  (165027 bytes, SHA-256
  `8cab283a172f3eb1473320e4be65894ec43d68ef0ff29c68c486f2d98ad665b2`)

## Included ROM images

| Local file | Upstream path | Bytes | SHA-256 | License |
|------------|---------------|------:|---------|---------|
| `basic.rom` | `bin/basic_c64.bin` | 8192 | `06480f4be4b62b545bbc4185c22befa8cc3b958fa15db31d74f82ffc03fec2e5` | Microsoft MIT (`LICENSE-microsoft.txt`) |
| `kernal-upstream.rom` | `bin/kernal_c64.bin` | 8192 | `5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414` | Pascual project MIT (`LICENSE.txt`) |
| `kernal.rom` | c64-patched `bin/kernal_c64.bin` | 8192 | `dbf227205959580b188d5e93c9f1cffb6e19897957af6d2525c88e5e72ab6f06` | Pascual project MIT (`LICENSE.txt`) |
| `chargen.rom` | `bin/chargen.bin` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` | LGPL-3.0-or-later (`COPYING.LESSER`, `COPYING`, `LICENSE-megabase-notice.txt`, `NOTICE.md`) |

The BASIC is mechanically derived from Microsoft's published `BASIC-M6502` source. The
KERNAL and project tooling are project-owned MIT-licensed work. The character generator is
the MEGA65 OpenROMs PXL font by Retrofan, redistributed under LGPL-3.0-or-later. The deployed
bundle includes the exact pinned source archive and every applicable license/notice listed
above, so recipients do not depend on mutable external URLs for corresponding source.

The source-level change is `kernal-c64-compat.patch`.
`scripts/build/build-kernal-rom.mjs` applies the equivalent reviewed byte replacements to the
exact upstream KERNAL after validating its digest, every replaced instruction range, the copied
cursor routine, and a zero-filled compatibility area. It preserves nonzero-secondary-address
machine-code loads while repairing BASIC boundaries when a file's embedded address is the BASIC
text start. It also keeps the 6510 processor port intact during `RAMTAS`, exposes the standard
`$EA31` custom-IRQ continuation, transmits `$3F` from `UNLSN`, and restores CIA1 port A to `$7F`
after keyboard and STOP scans.

No original Commodore ROM dump is included.

## Supported compatibility boundary

Upstream describes this revision as providing a full Microsoft 6502 BASIC-derived interpreter,
screen editor, and IEC `LOAD`/`SAVE`/`VERIFY`. c64 records those as upstream claims. Its local
release gate verifies reset-vector startup through the production WASM artifact to the Pascual
banner and `READY.`, deterministic direct-entry assembly execution, and drive-8 access through
c64's documented 1541 CPU/VIA/IEC/GCR boundary. Synthetic media also verifies standard
`LOAD "*",8,1` BASIC boundary handling, processor-port banking, custom IRQ continuation,
independent sequential LOAD requests, and repeated byte-exact direct-channel sector reads.

## Clean-room DOS-1541 firmware

The drive firmware comes from
[`Pascual-Candel-Palazon/Pascual_DOS-1541`](https://github.com/Pascual-Candel-Palazon/Pascual_DOS-1541):

- Upstream revision: `72c2648494c71126cf5338f0c3c09b9e815a8b50`
- Pinned source:
  <https://github.com/Pascual-Candel-Palazon/Pascual_DOS-1541/tree/72c2648494c71126cf5338f0c3c09b9e815a8b50>
- Vendored corresponding source:
  `pascual-dos-1541-72c2648494c71126cf5338f0c3c09b9e815a8b50.tar.gz`
  (82984 bytes, SHA-256
  `ade11365bd3ae671e681306d536d4942942be2a3fcb10ef0f54b2ffdff2fff9c`)
- Published upstream binary:
  `dos1541-upstream.rom` (16384 bytes, SHA-256
  `c63f4933689e7582e6fa857564eb03df3466bd56ca1f9ab78e6b9f798ddeee39`)

The upstream package is a clean-room MIT implementation whose development rules prohibit
consulting or disassembling Commodore's proprietary drive ROM. Its archived `LICENSE`,
`README.md`, `PROCEDENCIA.md`, and hardware notes ship under drive-specific filenames beside
the source archive.

c64 adds standard CBM `*` and `?` directory-name matching, channel-15 DOS status, direct-access
`#` channels, and the validated public `U1` block-read command, and a direct channel sends a
leading buffer byte followed by all 256 sector bytes. The source change is
`dos1541-c64-compat.patch`, which applies cleanly to the pinned `src/dos.s`;
`scripts/build/build-drive-rom.mjs` applies equivalent reviewed byte replacements to the exact
published binary after checking its digest, every hook, and the erased compatibility area. The
byte replacements additionally restore one pinned-source behavior the published `dos.bin` omits:
channel-0 OPEN resets the received filename before every LOAD. The resulting deployed
`dos1541.rom` is 16384 bytes with SHA-256
`725047c3310d843b99c02dbd35699b2d6ccfe07f16adef28025cb5519d89dd39`.
No proprietary bytes, game-specific names, or private Commodore entry points are added.
