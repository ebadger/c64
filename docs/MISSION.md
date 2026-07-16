# c64 — Mission Statement

> This document defines the product purpose and direction of the repository.

## Mission

Make Commodore 64 software development available from a browser with no local install:
people can write NMOS 6510 assembly, assemble it deterministically, run it in a software
emulator, share or remix the source, and download standard PRG and D64 artifacts that also
work with established C64 tools and physical machines.

## Product boundary

This project is a software-emulation and artifact-interoperability product. It includes the
browser IDE, assembler, C64 emulation, examples, serverless sharing, and standards-compliant
PRG/D64 import and export.

Physical-hardware support ends at downloadable PRG and D64 files that users transfer with
their own tools. Custom transfer devices, firmware, PCBs, HDL, KiCad, GAL or address-decode
logic, cartridges, cables, and all other physical 3RIC hardware work are explicitly out of
scope.

## Organization model

- **`ebadger`** owns direction, priorities, review-scope decisions, and merge decisions.
- **AI agents** propose, implement, review, and advise; they validate reviewer findings and
  surface every independently validated release blocker, material scope change, or review
  finding above the 30-minute effort threshold with a recommendation rather than disposing
  of it unilaterally.
- **Sessions** are workers, not permanent departments or biographies.

## Operating principles

1. The mission drives all work. Question work that does not serve it.
2. Prefer open, standard C64 artifacts over project-specific formats or hardware.
3. Keep the deterministic machine and build logic independent from browser pacing and UI.
4. Treat ROM licensing as a product constraint: ship only redistributable replacements and
   keep user-supplied ROM bytes local.
5. Preserve serverless public access; GitHub pull requests are the only canonical publishing
   path in the initial architecture.
6. Cooperation over autonomy; surface uncertainty and trade-offs early.
7. Quality over speed.
8. Learn continuously, but codify only durable threshold-meeting rules.
9. Prefer product progress and deletion over new organizational machinery.
10. Improve reusable governance once in `ebadger/AIProjectTemplate`, then reconcile it
    deliberately without overriding c64 product truth.
