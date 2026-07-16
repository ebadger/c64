// Immutable timing-profile constants. The rational CPU-clock numerator/denominator are the
// source of truth for audio resampling and TOD in later layers; VIC-II and the machine loop use
// the integer cycles-per-line and lines-per-frame. Values match the table in specs/EMULATOR.md.
#ifndef C64_TIMING_HPP
#define C64_TIMING_HPP

#include "c64/types.hpp"

namespace c64 {

struct ProfileTiming {
  u16 cyclesPerLine;
  u16 rasterLines;
  u32 cyclesPerFrame; // cyclesPerLine * rasterLines
  u32 clockHzNumerator;
  u32 clockHzDenominator;
};

// pal-6569:  63 cycles/line * 312 lines = 19656 cycles/frame, ~985248.444 Hz.
// ntsc-6567r8: 65 cycles/line * 263 lines = 17095 cycles/frame, ~1022727.14 Hz.
constexpr ProfileTiming profileTiming(TimingProfile profile) {
  return profile == TimingProfile::Pal6569
             ? ProfileTiming{63, 312, 63u * 312u, 17734472u, 18u}
             : ProfileTiming{65, 263, 65u * 263u, 14318181u, 14u};
}

} // namespace c64

#endif // C64_TIMING_HPP
