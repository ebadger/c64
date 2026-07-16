#include "c64/vicii.hpp"

namespace c64 {

void Vic::reset() {
  registers_.fill(0x00);
  rasterLine_ = 0;
  cycleInLine_ = 0;
  frameSequence_ = 0;
}

void Vic::tick(u32 cycles) {
  cycleInLine_ = static_cast<u16>(cycleInLine_ + cycles);
  while (cycleInLine_ >= timing_.cyclesPerLine) {
    cycleInLine_ = static_cast<u16>(cycleInLine_ - timing_.cyclesPerLine);
    ++rasterLine_;
    if (rasterLine_ >= timing_.rasterLines) {
      rasterLine_ = 0;
      ++frameSequence_;
    }
  }
}

u8 Vic::readRegister(u8 reg) const {
  reg &= 0x3F;
  switch (reg) {
    case 0x11: // control 1: bit 7 is the current raster line bit 8
      return static_cast<u8>((registers_[0x11] & 0x7F) | ((rasterLine_ & 0x100) ? 0x80 : 0x00));
    case 0x12: // current raster line, low 8 bits
      return static_cast<u8>(rasterLine_ & 0xFF);
    case 0x16: // control 2: bits 6-7 unused, read as 1
      return static_cast<u8>(registers_[0x16] | 0xC0);
    case 0x18: // memory pointers: bit 0 unused, reads as 1
      return static_cast<u8>(registers_[0x18] | 0x01);
    case 0x19: // interrupt latch: unused bits 4-6 read as 1 (no IRQ source yet)
      return static_cast<u8>(registers_[0x19] | 0x70);
    case 0x1A: // interrupt enable: bits 4-7 unused, read as 1
      return static_cast<u8>(registers_[0x1A] | 0xF0);
    case 0x1E: // sprite-sprite collision latch (read-to-clear; no sprites in this subset)
    case 0x1F: // sprite-background collision latch
      return 0x00;
    default:
      if (reg >= 0x20 && reg <= 0x2E) {
        return static_cast<u8>(registers_[reg] | 0xF0); // colour registers: high nibble reads 1
      }
      if (reg >= 0x2F) {
        return 0xFF; // $D02F-$D03F are unused and read as $FF
      }
      return registers_[reg];
  }
}

void Vic::writeRegister(u8 reg, u8 value) {
  reg &= 0x3F;
  if (reg >= 0x2F) {
    return; // unused registers ignore writes
  }
  registers_[reg] = value;
}

void Vic::renderInto(std::vector<u8>& target) const {
  const u8 border = borderColor();
  const u8 background = backgroundColor0();
  target.assign(static_cast<std::size_t>(kWidth) * kHeight, border);
  for (u16 y = 0; y < kDisplayHeight; ++y) {
    const std::size_t rowStart = static_cast<std::size_t>(kBorderY + y) * kWidth + kBorderX;
    for (u16 x = 0; x < kDisplayWidth; ++x) {
      target[rowStart + x] = background;
    }
  }
}

} // namespace c64
