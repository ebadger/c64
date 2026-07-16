# MEGA65 OpenROMs provenance

The files in this directory are an unmodified generic C64 ROM set from
[`MEGA65/open-roms`](https://github.com/MEGA65/open-roms).

- Upstream revision: `ad178dbe4d48cd6a317737a8e0e7e662f7e33d32`
- Pinned source:
  <https://github.com/MEGA65/open-roms/tree/ad178dbe4d48cd6a317737a8e0e7e662f7e33d32>
- Corresponding source archive:
  <https://github.com/MEGA65/open-roms/archive/ad178dbe4d48cd6a317737a8e0e7e662f7e33d32.tar.gz>
- Vendored corresponding source:
  `open-roms-ad178dbe4d48cd6a317737a8e0e7e662f7e33d32.tar.gz`
  (756837 bytes, SHA-256
  `7e7fb6e775a0d820e8605107fec168e17ab232ad1172bc788bbc492996fcf229`)
- License: `LGPL-3.0-or-later`; some identified BASIC source files are MIT-licensed.
  See `LICENSE.txt`, `COPYING`, and `COPYING.LESSER`.

## Included files

| Local file | Upstream path | Bytes | SHA-256 |
|------------|---------------|------:|---------|
| `basic_generic.rom` | `bin/basic_generic.rom` | 8192 | `54a1464b4b27c9dc61bbd62a818fdd12ec99af9089111005a5add0ad0e6bd5ec` |
| `kernal_generic.rom` | `bin/kernal_generic.rom` | 8192 | `88e86ed3d0c710edab8f90ad146faa8de1ead11f43494b176c7b54724ca721c6` |
| `chargen_openroms.rom` | `bin/chargen_openroms.rom` | 4096 | `5e3451466841b93df7e01e4b635b07b8d8633351bae483b1961d96b3131186e7` |

The generic BASIC and KERNAL files are used together as upstream requires; the CHARGEN file
is the matching OpenROMs character set. No original Commodore ROM dump is included.
The deployed bundle includes the pinned source archive and complete license texts beside these
images so recipients do not depend on a mutable external URL for corresponding source.

## Compatibility boundary

OpenROMs provides an open, redistributable startup environment and KERNAL interfaces, but
its upstream status still lists most BASIC commands and some system functions as incomplete.
The c64 browser IDE therefore uses its existing assembly-first Run contract: it loads the
assembled PRG and enters its machine-code `runAddress` instead of claiming complete BASIC
compatibility.
