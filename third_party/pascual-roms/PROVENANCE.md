# Pascual's BASIC ROM-set provenance

The ROM images in this directory are unmodified published binaries from
[`Pascual-Candel-Palazon/Pascuals-BASIC`](https://github.com/Pascual-Candel-Palazon/Pascuals-BASIC).

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
| `kernal.rom` | `bin/kernal_c64.bin` | 8192 | `5423d7dbbf678a17640f08465705aaab5bf04975281c48b3d343e7cb64a3c414` | Pascual project MIT (`LICENSE.txt`) |
| `chargen.rom` | `bin/chargen.bin` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` | LGPL-3.0-or-later (`COPYING.LESSER`, `COPYING`, `LICENSE-megabase-notice.txt`, `NOTICE.md`) |

The BASIC is mechanically derived from Microsoft's published `BASIC-M6502` source. The
KERNAL and project tooling are project-owned MIT-licensed work. The character generator is
the MEGA65 OpenROMs PXL font by Retrofan, redistributed under LGPL-3.0-or-later. The deployed
bundle includes the exact pinned source archive and every applicable license/notice listed
above, so recipients do not depend on mutable external URLs for corresponding source.

No original Commodore ROM dump is included.

## Supported compatibility boundary

Upstream describes this revision as providing a full Microsoft 6502 BASIC-derived interpreter,
screen editor, and IEC `LOAD`/`SAVE`/`VERIFY`. c64 records those as upstream claims. Its local
release gate verifies reset-vector startup through the production WASM artifact to the Pascual
banner and `READY.`, deterministic direct-entry assembly execution, and drive-8 access through
c64's documented high-level KERNAL LOAD trap.
