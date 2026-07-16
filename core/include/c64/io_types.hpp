// Value types crossing the machine <-> host boundary for input, video, and audio.
//
// These are plain copyable structs. The host (browser bridge or tests) fills an InputSnapshot
// and reads FrameInfo/AudioInfo; no writable view into the core is ever exposed. Keyboard and
// joystick bits are active-low (a clear bit means engaged/pressed), matching the C64 electrical
// convention, and are normalized by the bridge before entering the core (see specs/IO.md).
#ifndef C64_IO_TYPES_HPP
#define C64_IO_TYPES_HPP

#include <array>

#include "c64/types.hpp"

namespace c64 {

// Host input for one machine sampling point. The core consumes current state only; browser key
// repeat and event history stay in the bridge.
struct InputSnapshot {
  // One byte per keyboard matrix column (CIA1 PRA line 0..7). Bit r (0..7) is the row line
  // (CIA1 PRB). Active-low: a 0 bit means the key at (column, row) is pressed. 0xFF = no key in
  // that column. Default (all 0xFF) = nothing pressed.
  std::array<u8, 8> keyboardColumns{{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}};
  // Joystick lines, active-low: bit0 up, bit1 down, bit2 left, bit3 right, bit4 fire. Bits 5..7
  // read as 1. 0xFF = centred, no fire. Joystick 1 shares CIA1 PRB, joystick 2 shares CIA1 PRA.
  u8 joystick1 = 0xFF;
  u8 joystick2 = 0xFF;
  // RESTORE is a machine NMI input (not a printable key). True = pressed this snapshot.
  bool restorePressed = false;
};

// Metadata describing the framebuffer copied out by copyFramebuffer(). The pixel buffer holds one
// 4-bit C64 colour index per byte; the bridge maps indices through a declared 16-colour palette.
struct FrameInfo {
  u64 sequence = 0;            // completed-frame counter (monotonic)
  u16 width = 0;               // full frame width incl. borders (pixels)
  u16 height = 0;              // full frame height incl. borders (raster lines)
  const char* pixelFormat = "c64-indexed-8";
  bool dirty = false;          // true when a new frame completed since the previous copy
};

// Metadata describing the audio drained by drainAudio(). Samples are mono float in [-1, 1] at
// the configured output sample rate, produced by deterministic resampling from the machine clock.
struct AudioInfo {
  u32 sampleRate = 0;
  u32 channels = 1;
  u32 framesWritten = 0;       // mono sample frames written to the caller's buffer this call
  u64 sequence = 0;            // total sample frames produced since reset
  u32 dropped = 0;             // already-emitted frames dropped due to buffer overflow (presentation only)
};

}  // namespace c64

#endif  // C64_IO_TYPES_HPP
