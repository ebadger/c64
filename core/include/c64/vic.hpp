// MOS 6567/6569 VIC-II video interface chip.
//
// The VIC-II is a cycle-clocked device on the C64 bus. It maintains raster counters, raster
// interrupts, bad-line/bus-arbitration (BA/AEC) behaviour, display modes, and eight sprites, and
// produces a deterministic indexed framebuffer (one 4-bit C64 colour index per byte). Browser
// palette mapping, scaling, and frame pacing live in the web client, not here.
//
// Fidelity note: rendering is line-based (each raster line is generated from the register state
// at the line boundary). This reproduces per-line raster effects (colour bars, split screens,
// smooth scroll) but is not pixel-cycle-exact within a line; BA/AEC stalls are represented at
// bad-line granularity. See specs/VIC-II.md for the exact contract and unsupported fidelity.
#ifndef C64_VIC_HPP
#define C64_VIC_HPP

#include <array>
#include <vector>

#include "c64/device.hpp"  // DeviceStatus
#include "c64/io_types.hpp"
#include "c64/timing.hpp"
#include "c64/types.hpp"

namespace c64 {

class Vic {
 public:
  Vic();

  // Provide the timing profile and read-only pointers to the memory the VIC fetches from: system
  // RAM (64 KB), colour RAM (1 KB, low nibble), and character ROM (4 KB). The pointers must
  // outlive the VIC. Also sizes the framebuffer for the profile.
  void configure(const TimingProfile& profile, const u8* ram, const u8* colorRam,
                 const u8* chargen);

  void reset();

  // Advance exactly one CPU cycle: raster position, raster IRQ, bad-line evaluation, and (at line
  // end) rendering.
  void tickCycle();

  // The current VIC 16 KB bank (0..3) from CIA2; the enclosing machine updates this each cycle.
  void setBank(u8 bank) { bank_ = static_cast<u8>(bank & 0x03); }

  // Pending BA/AEC steal cycles the CPU must lose before its next read (bad-line + sprite DMA).
  // Returns the count once and clears it.
  u32 takeBaSteal();

  // Register access. reg is the low 6 bits of the address ($D000-$D03F, mirrored).
  u8 read(u8 reg, bool sideEffects);
  void write(u8 reg, u8 value);

  bool irqAsserted() const { return (irqLatch_ & irqMask_ & 0x0F) != 0; }

  // Framebuffer: one byte per pixel holding a 4-bit colour index. Stable for the profile.
  const u8* framebuffer() const { return fb_.data(); }
  u32 fbWidth() const { return width_; }
  u32 fbHeight() const { return height_; }
  u64 frameSequence() const { return frameSequence_; }
  bool frameDirty() const { return dirty_; }
  void clearDirty() { dirty_ = false; }
  FrameInfo frameInfo() const;

  u16 rasterY() const { return rasterY_; }
  DeviceStatus status() const;

 private:
  void onLineStart();
  void renderLine(u16 line);
  u8 vicFetch(u16 addr14) const;         // 14-bit VIC address within the selected bank
  u8 renderTextBitmapPixel(u16 line, int dpx, bool& foreground) const;

  // Register file (48 registers; unused ones read back with set high bits).
  std::array<u8, 0x40> reg_{};

  // Derived interrupt state.
  u8 irqLatch_ = 0;  // $D019 latched sources (bit0 raster, bit1 sprite-bg, bit2 sprite-sprite)
  u8 irqMask_ = 0;   // $D01A enable mask

  // Raster/timing.
  const TimingProfile* profile_ = nullptr;
  u32 cyclesPerLine_ = 63;
  u32 rasterLines_ = 312;
  u32 cycleInLine_ = 0;
  u16 rasterY_ = 0;
  bool badLine_ = false;
  bool denSeenThisFrame_ = false;  // DEN set during raster line $30 enables bad lines
  u32 baSteal_ = 0;

  u64 frameSequence_ = 0;
  bool dirty_ = false;

  // Collision latches accumulate within a frame.
  u8 spriteSpriteColl_ = 0;
  u8 spriteBgColl_ = 0;

  // Memory the VIC fetches from (owned by the Bus).
  const u8* ram_ = nullptr;
  const u8* colorRam_ = nullptr;
  const u8* chargen_ = nullptr;
  u8 bank_ = 0;

  // Framebuffer.
  u32 width_ = 384;
  u32 height_ = 284;
  u16 firstVisibleLine_ = 16;
  std::vector<u8> fb_;
};

}  // namespace c64

#endif  // C64_VIC_HPP
