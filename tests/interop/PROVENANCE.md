# External D64 interoperability — tool provenance

The external interoperability gate (`tests/interop/d64.interop.test.mjs`) verifies that a D64 image
produced by this project's deterministic media pipeline is a valid, standard 1541 image by
round-tripping it through an independent third-party tool, rather than trusting only our own reader
(`src/d64.js`).

## Tool

| Field | Value |
|-------|-------|
| Tool | `c1541` |
| Project | VICE (the Versatile Commodore Emulator) |
| Home | https://vice-emu.sourceforge.io/ |
| License | GPL-2.0-or-later |
| Role | Independent D64 directory listing (`-dir`) and file extraction (`-read`) |

`c1541` is a standalone, well-established command-line tool for reading and writing CBM disk images.
It is used here read-only for verification.

## Provisioning (no binary committed)

No third-party binary is committed to this repository. The tool is provisioned reproducibly at CI
time from the distribution package:

```sh
sudo apt-get update && sudo apt-get install -y vice   # provides /usr/bin/c1541
```

The exact installed version is recorded in the CI run log (the release workflow prints
`c1541`'s banner and the resolved package version). To run the gate against a specific local build,
set `C64_C1541=/path/to/c1541`.

## What is verified

1. **35-track geometry / directory metadata** — the external `-dir` listing shows the disk name and
   id, the file entry, its `PRG` type and block size, and the blocks-free count; the test asserts
   `blocksFree + fileBlocks == 664`, the standard empty-1541 figure, confirming 35-track geometry.
2. **Exact extracted PRG bytes** — the file extracted by `c1541 -read` is compared byte-for-byte
   (including the two-byte load address) against the PRG the pipeline generated.

## Scope and honesty

This gate exercises **software tooling only**. Passing it demonstrates interoperability with
established C64 software tools; it makes **no claim** about physical 1541 hardware, real GCR
flux/timing, custom drive code, or fastloaders (see `specs/MEDIA.md` for the honest fidelity
boundary). The gate is required on the release path (`C64_INTEROP_REQUIRE=1`) and skips locally when
the tool is absent.
