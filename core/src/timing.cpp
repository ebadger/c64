#include "c64/timing.hpp"

#include <cstring>

namespace c64 {

// PAL 6569 (PAL-B): 63 cycles/line * 312 lines = 19656 cycles/frame.
// The PAL C64 crystal is 17'734'472 Hz; phi2 = crystal / 18 = 985248.444... Hz.
// Reduced rational: 17734472 / 18  ->  8867236 / 9.
static const TimingProfile kPal = {
    TimingProfileId::Pal6569,
    "pal-6569",
    63,
    312,
    19656,
    8867236,
    9,
};

// NTSC 6567R8: 65 cycles/line * 263 lines = 17095 cycles/frame.
// The NTSC C64 phi2 clock derives from 4x the NTSC colour subcarrier divided by 14:
// fsc = 39375000 / 11 Hz; dot clock = 4*fsc = 157500000 / 11 Hz; phi2 = dot / 14 =
// 157500000 / 154 = 1022727.27... Hz. Reduced rational: 11250000 / 11.
static const TimingProfile kNtsc = {
    TimingProfileId::Ntsc6567R8,
    "ntsc-6567r8",
    65,
    263,
    17095,
    11250000,
    11,
};

const TimingProfile& palProfile() { return kPal; }
const TimingProfile& ntscProfile() { return kNtsc; }

bool timingProfileById(const char* id, const TimingProfile** out) {
  if (id == nullptr) {
    return false;
  }
  if (std::strcmp(id, kPal.name) == 0) {
    *out = &kPal;
    return true;
  }
  if (std::strcmp(id, kNtsc.name) == 0) {
    *out = &kNtsc;
    return true;
  }
  return false;
}

}  // namespace c64
