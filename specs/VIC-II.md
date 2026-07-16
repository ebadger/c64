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

## Implementation status

Fidelity note: the renderer is **line-based** — each raster line is produced from the register
state at the line boundary. This reproduces per-line raster effects (colour bars, split screens,
smooth scroll, mode changes between lines) but is **not pixel-cycle-exact within a line**;
mid-line register changes take effect at the next line. BA/AEC bus stalls are represented at
**bad-line + sprite-DMA granularity** (a bad line steals ~40 cycles; each active sprite ~2),
not at exact per-cycle BA edge timing. These approximations are deliberate for the
broad-compatibility MVP and are the honestly-labelled unsupported fidelity.

| Item | Status | Notes |
|------|--------|-------|
| Register file and mirrors | Implemented | `$D000-$D03F` with correct readable bits/latches; colour regs read top nibble 1; unused read `$FF` |
| Raster counters and interrupts | Implemented | 9-bit raster (`$D012` + `$D011` bit7), compare IRQ, `$D019` ack, `$D01A` mask; golden PAL/NTSC vectors |
| Bad lines and bus arbitration | Implemented | DEN-qualified bad-line detection; BA steal on read (line granularity) |
| Borders | Implemented | RSEL/CSEL top/bottom/left/right; DEN-off blanking |
| Text/bitmap modes | Implemented | Standard + multicolor text, standard + multicolor bitmap, ECM; invalid combos render deterministic black |
| Colour RAM | Implemented | Low nibble from colour RAM through the bus |
| Sprites | Implemented | 8 sprites: enable, X (incl. MSB), Y, X/Y expansion, multicolor, priority, pointer/DMA fetch, sprite-sprite and sprite-background collision latches + IRQ |
| CIA2 VIC bank | Implemented | 16 KB bank from CIA2 port A; char-ROM overlay in banks 0/2 |
| Indexed framebuffer + FrameInfo | Implemented | One 4-bit colour index per byte; stable per-profile dimensions (PAL 384x284, NTSC 384x235) |
| Pixel-cycle-exact rendering | Not implemented | Line-based renderer; documented above |
| Browser renderer | Implemented | Lives in the web client (`web/client/lib/video.js` + palette), not this module |

