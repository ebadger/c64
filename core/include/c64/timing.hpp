// Immutable machine timing profiles.
//
// Two profiles are supported: PAL 6569 and late NTSC 6567R8. Each is defined by exact rational
// CPU-clock constants (numerator/denominator, in hertz) plus the integer cycle/line/frame
// counts that clocked devices derive their timing from. The rational constants — not rounded
// display values — are the implementation source of truth (see specs/EMULATOR.md).
#ifndef C64_TIMING_HPP
#define C64_TIMING_HPP

#include "c64/result.hpp"
#include "c64/types.hpp"

namespace c64 {

enum class TimingProfileId : u8 {
  Pal6569 = 0,
  Ntsc6567R8 = 1,
};

struct TimingProfile {
  TimingProfileId id;
  const char* name;      // stable id: "pal-6569" | "ntsc-6567r8"
  u32 cyclesPerLine;     // CPU (phi2) cycles per raster line
  u32 rasterLines;       // raster lines per frame
  u32 cyclesPerFrame;    // == cyclesPerLine * rasterLines
  // Exact CPU (phi2) clock as a reduced rational, in hertz: clockNumerator / clockDenominator.
  u64 clockNumerator;
  u64 clockDenominator;
};

// The two immutable profiles. References are stable for the program lifetime.
const TimingProfile& palProfile();
const TimingProfile& ntscProfile();

// Resolve a profile by its stable string id ("pal-6569" | "ntsc-6567r8").
// Returns false and leaves *out untouched when the id is unknown.
bool timingProfileById(const char* id, const TimingProfile** out);

}  // namespace c64

#endif  // C64_TIMING_HPP
