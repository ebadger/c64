# c64 — SID, CIA, and Input Spec

> Clocked sound, timers, ports, keyboard/joystick input, and software-visible I/O.

---

## Purpose

This layer models the SID and two CIA chips and translates host input snapshots into C64
electrical/logical state. It never reads browser events or plays audio directly; the web
client samples input and consumes deterministic audio buffers.

## Contracts / Interfaces

```text
InputSnapshot {
  keyboardRows: uint8[8]
  joystick1: uint8
  joystick2: uint8
  restorePressed: boolean
}

AudioInfo {
  sampleRate: uint32
  channels: 1
  framesWritten: uint32
  sequence: uint64
}
```

- Keyboard row bits and joystick bits are active-low and normalized before entering the
  core. The bridge maps physical key codes separately from text input.
- SID register traffic covers `$D400-$D41F`; CIA 1 covers `$DC00-$DC0F`; CIA 2 covers
  `$DD00-$DD0F`, including address mirrors.
- The core emits mono floating-point samples in `[-1, 1]` at a configured output sample
  rate derived by deterministic resampling from the machine clock.
- CIA outputs expose interrupt lines, VIC bank bits, keyboard matrix scanning, joystick
  lines, and serial/IEC-facing signals required by media emulation.

## SID behaviour

- Support named `6581` and `8580` models. The selected model is machine configuration and is
  included in reproducibility metadata.
- Implement three voices, frequency and pulse-width registers, triangle/saw/pulse/noise
  waveforms, ADSR envelopes, ring modulation, sync, gate/test behavior, mixer routing,
  volume, and filter registers.
- Model differences must be explicit and tested. An initial approximation may ship only
  when labeled in status and tests; it may not claim analog-perfect reproduction.
- SID reads with undefined/open-bus characteristics return deterministic modelled values.
- Audio generation is deterministic for a fixed sample rate and input trace. Browser audio
  buffer scheduling and underrun recovery do not feed back into machine state.

## CIA and input behaviour

- Implement 16-bit timers A/B, one-shot/continuous modes, timer chaining, interrupt control
  masks/latches, data direction, ports, serial shift behavior needed by supported software,
  and TOD/alarm registers.
- TOD advances from the selected machine profile's 50/60 Hz source, not host wall-clock.
- CIA 1 resolves keyboard matrix and joystick ports with active-low line interactions. Key
  ghosting behavior is deterministic and documented by matrix tests.
- CIA 2 drives VIC bank selection and the IEC-facing lines needed by the selected disk-drive
  model. Unsupported user-port peripherals remain disconnected with deterministic pull-up
  values.
- RESTORE is represented as its machine interrupt input, not a printable key.
- Browser key repeat is ignored by the core; only current input state matters.

## Data flow

`DOM/gamepad events -> normalized InputSnapshot -> CIA port matrix -> CPU-visible registers`
and `machine cycles -> SID/CIA state -> audio samples, interrupts, VIC bank, IEC lines ->
emulator/web presentation`.

## Error handling

- Unknown SID models or unsupported sample rates reject machine creation.
- Invalid host input data is rejected by the bridge; values are not truncated silently.
- Audio buffer overflow increments a presentation diagnostic and drops only already-emitted
  samples. It never rewinds or stalls emulation.
- Unsupported peripherals are reported as unavailable; the UI must not present them as
  working.

## Dependencies

- Upstream: [`EMULATOR.md`](./EMULATOR.md) clock/bus/profile,
  [`WEB-CLIENT.md`](./WEB-CLIENT.md) normalized input.
- Downstream: VIC bank selection, media/IEC behavior, browser audio, deterministic I/O tests.

## Implementation Status

> v0 subset: the bus maps SID (`$D400-$D41F`), CIA 1 (`$DC00-$DC0F`), and CIA 2 (`$DD00-$DD0F`)
> as deterministic register shadows so executing code can read and write them without faulting,
> and undriven keyboard/joystick data ports read as all-high. No timers, TOD, interrupt logic,
> audio synthesis, keyboard-matrix scanning, or IEC signalling is implemented yet; none of this
> feeds machine state. This is enough to run code that touches these registers while the VIC-II
> border/background path is exercised, and honestly nothing more.

| Item | Status | Notes |
|------|--------|-------|
| CIA 1/2 register shadows | Implemented (stub) | Read/write shadows only; no timers/TOD/IRQ in `core/src/bus.cpp` |
| CIA 1/2 timers, TOD, interrupts | Not started | Requires interrupt/timer vectors wired to the CPU |
| Keyboard and joystick matrix | Not started | Data ports read all-high; browser mapping remains separate |
| SID register shadow | Implemented (stub) | Deterministic read/write; no synthesis |
| SID voices, envelopes, filters, resampling | Not started | Model fidelity must be labelled honestly; no analog-perfect claim |
| IEC-facing signal contract | Not started | Drive model selected in media implementation |
