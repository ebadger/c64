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
- `setInput(snapshot)` for keyboard, joystick, and restore state (owned copy; not retained)
- `copyFramebuffer(target) -> FrameInfo` (copies the indexed framebuffer; clears the dirty flag)
- `drainAudio(target, maxFrames) -> AudioInfo` (drains mono float samples)
- `saveState() -> byte[]` and `loadState(bytes)` only after a versioned format is specified
- debug reads/writes that are explicitly marked as side-effecting or side-effect-free

The JavaScript bridge owns typed-array allocation/copy policy and translates structured
errors. It must not expose writable views whose lifetime can outlive a WebAssembly memory
growth.

The embind projection (`core/wasm/embind.cpp`) and the committed ES-module wrapper
(`web/emulator/c64.mjs`) implement this: byte inputs are copied into the module
(`convertJSArrayToNumberVector`) and every result is a plain JS value, string error code, or
object copy — no writable WebAssembly memory view is ever handed to JavaScript, so a memory
growth cannot invalidate a JS-held handle. Native and WebAssembly builds compile the identical
C++ sources; a shared deterministic scenario suite (`core/src/scenarios.cpp`) is run by both the
native `scenario_dump` tool and the WASM build, and headless parity tests assert their canonical
JSON is byte-identical. The WASM artifact is linked with `-sDYNAMIC_EXECUTION=0` so embind builds
its invokers without runtime `new Function`/`eval`; the loader then needs only `wasm-unsafe-eval`
and runs under the web client's restrictive CSP with no `unsafe-eval` (see `specs/WEB-CLIENT.md`).

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

The core stores each profile's phi2 clock as a reduced rational (hertz):

| Profile | phi2 clock (exact) | Nominal | Derivation |
|---------|--------------------|---------|------------|
| `pal-6569` | `8867236 / 9` Hz | 985248 Hz | PAL crystal 17734472 Hz ÷ 18 |
| `ntsc-6567r8` | `11250000 / 11` Hz | 1022727 Hz | 4×NTSC subcarrier (157500000/11 Hz) ÷ 14 |

Both fractions are reduced (gcd = 1) and `cyclesPerFrame == cyclesPerLine × rasterLines`.

## Memory map and banking (implemented)

The bus resolves each address from the processor-port bits (LORAM, HIRAM, CHAREN) with the
cartridge GAME/EXROM lines held high (no cartridge in scope). The reset processor-port state is
`$00 = $2F` (DDR) and `$01 = $37`. The port read value is `(latch & ddr) | (inputPins & ~ddr)`;
banking derives from that read value so an input-configured bit reads its pull-up.

| Window | Rule |
|--------|------|
| `$A000-$BFFF` | BASIC ROM when `LORAM & HIRAM`, else RAM |
| `$E000-$FFFF` | KERNAL ROM when `HIRAM`, else RAM |
| `$D000-$DFFF` | RAM when `!HIRAM & !LORAM`; else character ROM when `!CHAREN`; else the I/O page |
| I/O `$D000-$D3FF` / `$D400-$D7FF` | VIC-II / SID device windows (clocked-device boundary) |
| I/O `$D800-$DBFF` | Colour RAM (low nibble stored; high nibble reads open bus) |
| I/O `$DC00-$DCFF` / `$DD00-$DDFF` | CIA1 / CIA2 device windows |
| I/O `$DE00-$DFFF` | Expansion I/O (open bus) |

Writes to ROM windows fall through to the RAM beneath them. VIC-II, SID, and the two CIAs are
concrete cycle-clocked devices owned by the bus. Every consumed CPU cycle advances the devices
exactly once, in-line at bus-access granularity, so the device clock never runs ahead of the CPU
(`runCycles` never advances devices past the cycles it reports). The VIC-II can steal bus cycles
(BA/AEC) on a bad line or for sprite DMA: the CPU is stalled on its next read until the VIC
releases the bus, and those stall cycles are counted. The bus aggregates the device interrupt
outputs onto the CPU each cycle — VIC-II and CIA1 drive IRQ, CIA2 (and the RESTORE key) drive
NMI — alongside the external test IRQ/NMI hooks.

## CPU accuracy (implemented)

The complete documented NMOS 6502/6510 instruction set (151 opcodes) and all addressing modes
are implemented. 65C02-only instructions and undocumented opcodes are not implemented; executing
one stops the run with a `fault`. Cycle accounting is exact at instruction granularity — the
documented per-opcode cycle counts plus dynamic page-cross (indexed reads) and branch
(taken / page-cross) penalties. Read-modify-write instructions perform the hardware
read + dummy-write + write sequence, the JMP `(ind)` page-boundary bug is modelled, decimal
ADC/SBC follow documented NMOS flag behaviour, and BRK/IRQ/NMI/reset sequencing and stack order
match hardware. Instructions execute atomically (as hardware instructions are), and their bus
cycles tick the devices in order; internal (non-bus) cycles are ticked at the instruction
boundary. Interrupts are sampled at instruction boundaries.

The **NMOS one-instruction interrupt-enable delay** after `CLI`/`SEI`/`PLP` is implemented: the
interrupt poll for the single instruction following one of these uses the pre-change I flag, so a
pending IRQ enabled by `CLI` is only taken after the next instruction executes.

Reset restores registers to deterministic specified values as required above: warm reset sets
`SP = $FD` and `P = I|U` and jumps through the reset vector while preserving RAM and the A/X/Y
registers; power-on additionally zeroes A/X/Y and rebuilds RAM from the fixture seed. This
deterministic initialization is intentional and is not the hardware `SP -= 3` decrement.

**`runCycles(n)` reporting:** instructions are atomic and are run until at least `n` cycles have
elapsed, so the reported `cyclesExecuted` may exceed `n` by up to the final instruction's length
(including any BA stall cycles it incurred). This is unchanged from milestone 2 and is the only
sense in which the reported total can exceed the request; device advancement itself is always
exactly one tick per consumed cycle.

## Behaviour / Rules

- `runCycles(n)` executes whole instructions until at least `n` CPU cycles have elapsed and
  reports the exact amount consumed. Instructions are not interruptible, so the reported total
  may overshoot `n` by up to the final instruction's cycle count; it never reports more or fewer
  cycles than were actually executed. It may stop early only for a declared stop reason
  (`brk`, `fault`, `breakpoint`).
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
| `invalid-d64` | Media layer rejected the disk (see MEDIA.md for the specific sub-codes) |
| `rom-mismatch` | ROM size/identity is inconsistent with the selected set |
| `invalid-state` | Operation is not valid for the current machine lifecycle |
| `invalid-input` | A host input snapshot field is malformed |
| `unsupported-media` | Operation requires drive fidelity the high-level IEC model does not provide |
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
| Timing profiles (PAL 6569, NTSC 6567R8) | Implemented | Exact reduced-rational phi2 clocks and cycle/line/frame counts |
| C++17 machine shell and bus | Implemented | RAM, ROM windows, colour RAM, processor port/DDR banking, concrete clocked devices |
| Cycle-integrated execution | Implemented | Per-cycle device advancement, BA/AEC read stalls, aggregated device IRQ/NMI, NMOS CLI/SEI/PLP interrupt-enable delay |
| NMOS 6510 core | Implemented | Complete 151-opcode documented set; cycle-exact; decimal, interrupts, RMW, JMP-indirect bug; native + WASM golden/parity tests |
| ROM set validation | Implemented | Sizes, per-role SHA-256, deterministic set id; memory-only; synthetic test fixtures |
| Machine lifecycle | Implemented | Configure/validate, power-on/warm reset, PRG load (no run-address inference), direct-mode PC, bounded `runCycles`, breakpoints, debug inspect/write |
| Native and embind APIs | Implemented | `setInput`/`copyFramebuffer`/`drainAudio`/`mountD64` with owned-copy semantics; value types only; no exceptions cross embind |
| Headless deterministic runner | Implemented | Node loads the production WASM artifact; native/WASM scenario parity is byte-identical (integer device state); SID float audio validated separately |
| VIC-II / SID / CIA devices | Implemented | See VIC-II.md and IO.md for the exact modelled behaviour and honestly-labelled unsupported fidelity |
| Mounted D64 / framebuffer / audio / input | Implemented | Read-only D64 via a high-level KERNAL LOAD/IEC trap (see MEDIA.md); indexed framebuffer; mono float audio; keyboard/joystick/RESTORE input |
| Save-state format | Deferred | Requires a separate versioned contract |

