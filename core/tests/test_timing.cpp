#include "c64/timing.hpp"

#include <numeric>

#include "test_framework.hpp"

using namespace c64;

TEST(timing_pal_constants) {
  const TimingProfile& p = palProfile();
  CHECK_STR_EQ(p.name, "pal-6569");
  CHECK_EQ(p.cyclesPerLine, 63u);
  CHECK_EQ(p.rasterLines, 312u);
  CHECK_EQ(p.cyclesPerFrame, 19656u);
  CHECK_EQ(p.cyclesPerLine * p.rasterLines, p.cyclesPerFrame);
  // Exact reduced rational 8867236 / 9 (== 17734472 / 18).
  CHECK_EQ(p.clockNumerator, 8867236ull);
  CHECK_EQ(p.clockDenominator, 9ull);
  CHECK_EQ(std::gcd(p.clockNumerator, p.clockDenominator), 1ull);
  // Nominal phi2 ~= 985248 Hz.
  CHECK_EQ(p.clockNumerator / p.clockDenominator, 985248ull);
}

TEST(timing_ntsc_constants) {
  const TimingProfile& p = ntscProfile();
  CHECK_STR_EQ(p.name, "ntsc-6567r8");
  CHECK_EQ(p.cyclesPerLine, 65u);
  CHECK_EQ(p.rasterLines, 263u);
  CHECK_EQ(p.cyclesPerFrame, 17095u);
  CHECK_EQ(p.cyclesPerLine * p.rasterLines, p.cyclesPerFrame);
  // Exact reduced rational 11250000 / 11 (== 157500000 / 154).
  CHECK_EQ(p.clockNumerator, 11250000ull);
  CHECK_EQ(p.clockDenominator, 11ull);
  CHECK_EQ(std::gcd(p.clockNumerator, p.clockDenominator), 1ull);
  // Nominal phi2 ~= 1022727 Hz.
  CHECK_EQ(p.clockNumerator / p.clockDenominator, 1022727ull);
}

TEST(timing_lookup) {
  const TimingProfile* p = nullptr;
  CHECK(timingProfileById("pal-6569", &p));
  CHECK(p != nullptr && p->id == TimingProfileId::Pal6569);
  CHECK(timingProfileById("ntsc-6567r8", &p));
  CHECK(p != nullptr && p->id == TimingProfileId::Ntsc6567R8);
  CHECK(!timingProfileById("pal-6572", &p));
  CHECK(!timingProfileById(nullptr, &p));
}
