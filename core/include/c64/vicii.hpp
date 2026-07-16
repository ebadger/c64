// Minimal VIC-II model (milestone-2a subset). It is a cycle-clocked device that tracks the
// raster position deterministically and exposes the video registers so executing code can set
// the border ($D020) and background ($D021) colours and read the raster counter ($D011 bit 7 /
// $D012). It renders an indexed framebuffer of the border frame plus a 320x200 display window
// filled with background colour 0. Text, bitmap, sprites, bad-line fetches, per-raster splits,
// and video interrupts are NOT implemented yet and are tracked as gaps in specs/VIC-II.md.
#ifndef C64_VICII_HPP
#define C64_VICII_HPP

#include <array>
#include <vector>

#include "c64/timing.hpp"
#include "c64/types.hpp"

namespace c64 {

class Vic {
public:
  // Framebuffer geometry shared with the bridge. One byte per pixel holding a 4-bit colour
  // index (0..15). 320x200 display centred in a fixed border frame.
  static constexpr u16 kDisplayWidth = 320;
  static constexpr u16 kDisplayHeight = 200;
  static constexpr u16 kBorderX = 32;
  static constexpr u16 kBorderY = 36;
  static constexpr u16 kWidth = kDisplayWidth + 2 * kBorderX;  // 384
  static constexpr u16 kHeight = kDisplayHeight + 2 * kBorderY; // 272

  explicit Vic(TimingProfile profile) : timing_(profileTiming(profile)) {}

  void reset();

  // Advance the raster position by the given number of consumed bus cycles. Frame completion is
  // a machine event; the counter continues deterministically regardless of the host.
  void tick(u32 cycles);

  // Register access. The bus masks the address into the $00..$3F register space before calling.
  u8 readRegister(u8 reg) const;
  void writeRegister(u8 reg, u8 value);

  // Render one indexed frame into the target (resized to kWidth*kHeight). Uses the current
  // border/background registers; in this subset colours are sampled at render time.
  void renderInto(std::vector<u8>& target) const;

  u16 rasterLine() const { return rasterLine_; }
  u16 cyclesPerFrame() const { return static_cast<u16>(timing_.cyclesPerFrame); }
  u64 frameSequence() const { return frameSequence_; }

  u8 borderColor() const { return static_cast<u8>(registers_[0x20] & 0x0F); }
  u8 backgroundColor0() const { return static_cast<u8>(registers_[0x21] & 0x0F); }

private:
  ProfileTiming timing_;
  std::array<u8, 0x40> registers_{};
  u16 rasterLine_ = 0;
  u16 cycleInLine_ = 0;
  u64 frameSequence_ = 0;
};

} // namespace c64

#endif // C64_VICII_HPP
