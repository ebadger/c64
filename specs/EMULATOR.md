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

### v0 WebAssembly boundary (shipped subset)

The first implemented embind surface (`core/wasm/embind.cpp`) is a deliberately small subset of
the full contract above, coordinated with the web client so integration can begin. It is
projected 1:1 from the native `c64::Machine`; native and WASM builds share the same sources.

```text
class Machine {
  constructor(timingProfile: "pal-6569" | "ntsc-6567r8")
  ok() -> boolean                          // false when the timing profile was invalid
  configError() -> string                   // "" or "invalid-config"
  reset()                                  // power-on reset
  setPC(address: uint16)                   // direct-mode entry
  loadPrg(bytes: Uint8Array) -> { ok, loadAddress, endAddress, error }
  runCycles(maxCycles: uint32) -> cyclesRun: number
  runFrame() -> { cyclesRun, frameSequence, stopped }
  framebuffer() -> Uint8Array              // fresh copy; c64-indexed-8, frameWidth*frameHeight
  frameWidth() -> uint16                    // 384
  frameHeight() -> uint16                   // 272
  readMem(address: uint16) -> uint8         // side-effect-free
  writeMem(address: uint16, value: uint8)
  delete()                                  // release the C++ instance
}
```

An unsupported timing profile is not silently accepted: `ok()` returns `false`, `configError()`
returns `"invalid-config"`, and `loadPrg`/`runCycles`/`runFrame` become inert rather than
returning success-shaped defaults. The bridge never throws a C++ exception across embind.
`framebuffer()` returns a newly allocated `Uint8Array` copied out of WASM memory, so no writable
view outlives a memory growth. `create/mountD64/setInput/copyFramebuffer/drainAudio/saveState`
from the full contract are not part of v0 and are tracked below. This boundary is expected to
grow toward the full contract; changes are coordinated with the web client before landing.

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

- `runCycles(n)` runs whole instructions until at least `n` CPU cycles have executed and
  reports the exact amount consumed; the final instruction may carry execution a few cycles
  past `n` at its boundary. It may stop early only for a declared stop reason (`fault` in the
  v0 core; `budget` otherwise). Sub-instruction cycle budgeting is a later refinement.
- PRG loading validates the two-byte little-endian load address and rejects images that
  would exceed `$FFFF`; it does not infer a run address from file content. Bytes are written to
  the underlying RAM regardless of the current bank configuration.
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
| C++17 machine shell and bus | Implemented (subset) | 64 KiB RAM, 6510 `$00/$01` port banking, I/O routing to VIC/colour-RAM/SID/CIA in `core/` |
| NMOS 6510 core | Implemented | All documented opcodes with cycle counts, page-cross/branch penalties, RMW timing, NMOS decimal ADC/SBC, BRK/IRQ/NMI/RESET; illegal opcodes fault. No undocumented opcodes |
| Native and embind APIs | Implemented (v0 subset) | Shared native `Machine`; embind v0 boundary above. `mountD64/setInput/drainAudio/copyFramebuffer/saveState` not yet exposed |
| Headless deterministic runner | Implemented | `tests/wasm-smoke.test.mjs` runs the production `c64core.wasm`; native golden vectors via CTest (`core/tests`) |
| SID / CIA devices | Not started | Register shadows only (deterministic); no timers, IRQ, audio, or keyboard scan yet — see `IO.md` |
| Save-state format | Deferred | Requires a separate versioned contract |
| Sub-instruction cycle budgeting, breakpoints | Not started | `runCycles` budgets whole instructions in v0 |
