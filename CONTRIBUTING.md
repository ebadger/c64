# Contributing to c64

## Start with product truth

Read, in order:

1. [`docs/LEARNINGS.md`](./docs/LEARNINGS.md)
2. [`docs/MISSION.md`](./docs/MISSION.md)
3. [`specs/SYSTEM.md`](./specs/SYSTEM.md)
4. Only the sub-specs for the layers being changed

Read [`status/SYSTEM-STATUS.md`](./status/SYSTEM-STATUS.md) for build, deployment, runtime,
or verification work. A spec marked "Not started" is a contract, not a shipped feature.

## Non-negotiable product rules

- Keep browser pacing, DOM, audio playback, and file pickers outside the deterministic core.
- Use the same C++ sources and production WebAssembly artifact for browser and headless WASM
  verification.
- Target NMOS 6510/6502 semantics; do not silently accept 65C02-only instructions.
- Preserve byte-deterministic rebuilds from shared source to PRG and D64.
- Do not commit or redistribute copyrighted Commodore ROMs.
- Keep the running application static and serverless. Accounts, databases, private shares,
  and runtime write APIs require an explicit architecture change.
- Physical-hardware work is out of scope; interoperability ends at standard PRG/D64 files.

## Change workflow

1. Update every affected spec before implementation and trace the complete data flow.
2. Add or update deterministic tests for the changed contract.
3. Keep implementation status and `status/SYSTEM-STATUS.md` honest.
4. Run the validations in [`SETUP.md`](./SETUP.md) plus all application tests that exist for
   the changed layer.
5. Follow [`docs/CODE-REVIEW-PANEL.md`](./docs/CODE-REVIEW-PANEL.md) for behavior changes.
6. Open a pull request against `main`; never self-merge.

Changes to inherited operating files also require the read-only template check and explicit
reconciliation in [`specs/TEMPLATE-INHERITANCE.md`](./specs/TEMPLATE-INHERITANCE.md).

## Artifact and ROM contributions

Examples must include source and deterministically rebuild their expected PRG/D64 artifacts.
Do not contribute ROM dumps, copied proprietary source, or binary fixtures without clear
redistribution rights and provenance. PR descriptions should identify any new third-party
asset, its license, and how its digest is verified.
