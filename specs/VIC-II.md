# c64 — VIC-II Spec

> Raster timing, memory fetches, display output, sprites, and video interrupts.

---

## Purpose

The VIC-II module models the video chip as a cycle-clocked device on the C64 bus. It
produces deterministic raster state and indexed pixels while leaving canvas scaling,
frame pacing, shaders, and browser presentation to the web client.

## Contracts / Interfaces

The emulator core clocks the device once per machine cycle and supplies bus arbitration:

```text
VicProfile {
  id: "pal-6569" | "ntsc-6567r8"
  cyclesPerLine: uint16
  rasterLines: uint16
  visibleRect: { x, y, width, height }
  paletteId: string
}

FrameInfo {
  sequence: uint64
  width: uint16
  height: uint16
  pixelFormat: "c64-indexed-8"
  dirty: boolean
}
```

- Register reads/writes cover `$D000-$D03F` mirrors with correct readable bits and latches.
- `clock()` returns bus-steal and interrupt-line changes for the enclosing machine cycle.
- `framebuffer()` exposes one complete frame of 4-bit C64 color indices stored in bytes.
- The browser bridge maps color indices through a declared 16-color palette into RGBA.
- Trace hooks may emit raster line, cycle, bad-line, sprite DMA, and IRQ transitions in
  debug builds without changing emulated state.

## Behaviour / Rules

- Profiles use the exact cycle/line and line/frame constants in `EMULATOR.md`. Initial
  support targets PAL 6569 and late NTSC 6567R8; earlier NTSC revisions require new IDs.
- Raster counters, `$D011` high raster bit, `$D012` compare, IRQ latch/mask behavior, and
  acknowledgement semantics are cycle-consistent and golden-tested.
- Bad-line qualification, character/bitmap fetches, border opening/closing, display modes,
  color RAM nibble reads, and BA/AEC bus arbitration are explicit state-machine behavior.
- Implement standard text, multicolor text, standard bitmap, and multicolor bitmap modes.
  Invalid mode combinations render deterministic output documented by tests rather than
  falling back to a valid mode.
- Eight sprites support X/Y expansion, multicolor, priority, enable, pointer fetch, DMA,
  sprite/sprite collision, and sprite/background collision registers.
- VIC bank selection comes from CIA 2; screen, character, bitmap, and sprite pointers are
  interpreted through the selected bank and current banking rules.
- Frame completion is a machine event, not permission to vary emulated cycle counts to
  match browser refresh.
- Palette selection affects presentation only and never machine state or collision logic.

## Data flow

`machine profile + CPU register traffic + CIA 2 bank lines + RAM/color RAM -> VIC-II cycle
state -> bus arbitration/IRQ + indexed framebuffer -> emulator bridge -> canvas renderer`.

## Error handling

The VIC-II has no recoverable runtime fallback. An unknown profile or impossible internal
state produces the emulator's `invalid-config` or `internal-fault` result. Rendering may
skip an already completed frame when the UI is behind, but the raster state continues
deterministically.

## Dependencies

- Upstream: [`EMULATOR.md`](./EMULATOR.md) bus and timing, [`IO.md`](./IO.md) CIA 2 bank
  lines, ROM/RAM mapping.
- Downstream: [`WEB-CLIENT.md`](./WEB-CLIENT.md) canvas presentation and diagnostics,
  deterministic video tests.

## Implementation Status

> v0 subset: the model tracks the raster position deterministically and renders an indexed
> framebuffer of `384x272` (a fixed border frame around the `320x200` display) using the border
> (`$D020`) and background-0 (`$D021`) registers. Colours are sampled when `framebuffer()` is
> called; because this subset has no mid-frame raster effects, calling it after `runFrame()`
> reflects the completed frame, so a direct-mode PRG that writes those registers yields visible,
> deterministic output. `$D011` bit 7 / `$D012` expose the live raster line and the colour
> registers read back with the hardware's high-nibble-set behaviour. Character/bitmap fetches,
> per-raster mid-frame splits, sprites, bad lines, and video interrupts are not implemented and
> are tracked below.

| Item | Status | Notes |
|------|--------|-------|
| Raster counter and register file | Implemented (subset) | Deterministic raster/line/frame advance; `$D011`/`$D012` readback and register read-mask behaviour in `core/src/vicii.cpp` |
| Framebuffer output | Implemented (subset) | Indexed `c64-indexed-8`, border + background-0 only; sampled at frame end |
| Display modes and borders | Not started | No text/bitmap character fetches yet |
| Sprites, collisions, and DMA | Not started | Cycle-level arbitration required |
| Raster interrupts and bad lines | Not started | No VIC IRQ source wired to the CPU yet |
| Browser renderer | Not started | Lives in web client, not this module |
