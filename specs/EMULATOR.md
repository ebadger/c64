# c64 — Emulator Core Spec

> Deterministic C++17 machine core and the shared native/WebAssembly execution contract.

---

## Purpose

The emulator core models the NMOS 6510 CPU, C64 memory map and banking, clocked devices, and
machine lifecycle without owning browser timing, DOM rendering, file pickers, or audio
playback. The same C++ sources and WebAssembly artifact drive the browser and headless WASM
tests; native tests compile the same core for faster diagnostics.

## Contracts / Interfaces

The public C++ API and its embind projection expose value types rather than raw pointers:

```text
MachineConfig {
  timingProfile: "pal-6569" | "ntsc-6567r8"
  sidModel: "6581" | "8580"
  romSet: RomSet
}

LoadResult {
  ok: boolean
  loadAddress: uint16
  endAddressExclusive: uint32
  error: EmulatorError | null
}

RunResult {
  cyclesExecuted: uint64
  frameSequence: uint64
  audioFramesAvailable: uint32
  stopped: boolean
  stopReason: "budget" | "breakpoint" | "brk" | "fault"
}
```

Required operations:

- `create(config) -> Machine`
- `reset(kind)` where `kind` is `power-on` or `warm`
- `loadPrg(bytes) -> LoadResult`
- `mountD64(bytes, driveNumber = 8) -> MediaResult`
- `runCycles(maxCycles) -> RunResult`
- `setInput(snapshot)` for keyboard, joystick, and restore state
- `copyFramebuffer(target) -> FrameInfo`
- `drainAudio(targetFrames) -> AudioInfo`
- `saveState() -> byte[]` and `loadState(bytes)` only after a versioned format is specified
- debug reads/writes that are explicitly marked as side-effecting or side-effect-free

The JavaScript bridge owns typed-array allocation/copy policy and translates structured
errors. It must not expose writable views whose lifetime can outlive a WebAssembly memory
growth.

## CPU and bus rules

- Implement NMOS 6510 behavior, including decimal mode, interrupt sequencing, page-crossing
  timing, read-modify-write bus cycles, the 6510 data-direction register at `$0000`, and
  processor port at `$0001`.
- Implement documented NMOS 6502/6510 opcodes first. Any supported undocumented opcode must
  be named, tested against a declared reference, and enabled consistently in native and
  WASM builds. 65C02-only instructions are invalid.
- The 16-bit address bus resolves RAM, BASIC ROM, KERNAL ROM, character ROM, color RAM, and
  I/O according to `$0000/$0001` banking and cartridge lines. Cartridge emulation is outside
  the initial scope, but unused lines must have deterministic defaults.
- Device clocks advance from consumed CPU/bus cycles. No device may read wall-clock time.
- Reads with hardware side effects and debugger peeks are separate operations.
- A reset initializes every byte and latch to specified values. Unspecified power-on RAM is
  filled by a deterministic pattern selected by the test fixture, never host randomness.

## Timing profiles

`pal-6569` and `ntsc-6567r8` are immutable profile IDs shared with VIC-II, CIA, and SID:

| Profile | CPU clock | Cycles/line | Raster lines | Cycles/frame |
|---------|-----------|-------------|--------------|--------------|
| `pal-6569` | 985248 Hz nominal | 63 | 312 | 19656 |
| `ntsc-6567r8` | 1022727 Hz nominal | 65 | 263 | 17095 |

Exact rational clock constants, not rounded display values, are the implementation source of
truth. Supporting another VIC revision requires another profile ID and golden vectors.

## Behaviour / Rules

- `runCycles(n)` executes no more than `n` CPU cycles and reports the exact amount consumed.
  It may stop early only for a declared stop reason.
- PRG loading validates the two-byte little-endian load address and rejects images that
  would exceed `$FFFF`; it does not infer a run address from file content.
- Browser Run uses the entry contract from `CODEGEN.md`: direct mode sets the CPU program
  counter after loading; BASIC SYS mode starts through a reset BASIC environment and its
  generated stub.
- Machine faults are stable error codes with context, not C++ exceptions crossing embind.
- Audio and video buffer exhaustion may drop presentation data only at the bridge boundary;
  it must not alter emulated device state.
- Save states are not part of the initial release. No unversioned serialization may ship.

## Data flow

`PRG/D64 + ROM set + timing profile + input snapshots -> machine bus -> CPU and clocked
devices -> deterministic state -> framebuffer/audio/trace buffers -> web client or tests`.

## Error handling

| Code | Condition |
|------|-----------|
| `invalid-config` | Unknown timing/SID profile or incomplete ROM set |
| `invalid-prg` | Missing load address, overflow, or malformed byte source |
| `invalid-d64` | Media layer rejected the disk |
| `rom-mismatch` | ROM size/identity is inconsistent with the selected set |
| `invalid-state` | Operation is not valid for the current machine lifecycle |
| `internal-fault` | Checked invariant failed; execution stops with diagnostic context |

The bridge surfaces failures to the UI and tests. It must not silently reset, substitute
ROMs, or report success-shaped defaults.

## Dependencies

- Upstream: [`CODEGEN.md`](./CODEGEN.md), [`MEDIA.md`](./MEDIA.md),
  [`ROM-ASSETS.md`](./ROM-ASSETS.md), machine profile selection.
- Downstream: [`VIC-II.md`](./VIC-II.md), [`IO.md`](./IO.md),
  [`WEB-CLIENT.md`](./WEB-CLIENT.md), native and WASM test harnesses.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| C++17 machine shell and bus | Not started | Architecture only |
| NMOS 6510 core | Not started | Requires opcode and cycle golden vectors |
| Native and embind APIs | Not started | Must remain behaviorally identical |
| Headless deterministic runner | Not started | Must load the production WASM artifact |
| Save-state format | Deferred | Requires a separate versioned contract |
