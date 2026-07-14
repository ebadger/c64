# c64 specifications

**Specs are the source of truth. Code follows specs, not the other way around.**

Start with [`SYSTEM.md`](./SYSTEM.md), then read only the layer being changed:

| Spec | Layer |
|------|-------|
| [`EMULATOR.md`](./EMULATOR.md) | NMOS 6510, memory bus, deterministic core, native/WASM boundary |
| [`VIC-II.md`](./VIC-II.md) | PAL/NTSC raster timing and video |
| [`IO.md`](./IO.md) | SID, CIA, keyboard, joystick, and IEC-facing signals |
| [`CODEGEN.md`](./CODEGEN.md) | Dual-use assembler, source project, PRG output and run entry |
| [`MEDIA.md`](./MEDIA.md) | PRG/D64 generation, validation, import, and downloads |
| [`ROM-ASSETS.md`](./ROM-ASSETS.md) | Redistributable and user-supplied ROM policy |
| [`WEB-CLIENT.md`](./WEB-CLIENT.md) | Static IDE, sharing, autosave, emulator presentation |
| [`TEMPLATE-INHERITANCE.md`](./TEMPLATE-INHERITANCE.md) | Shared operating-system lineage |

Use [`_TEMPLATE.md`](./_TEMPLATE.md) when a genuinely new layer is needed. A behavior change
must update every affected spec and trace the full path from user action through build or
machine state to presentation/download. Keep implementation status honest: a specified
feature is not shipped until its code and required verification exist.
