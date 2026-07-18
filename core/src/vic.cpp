#include "c64/vic.hpp"

namespace c64 {
namespace {

constexpr u32 kFramebufferWidth = 384;
constexpr u32 kVerticalBlankingLines = 28;
constexpr u16 kPalFirstVisibleLine = 16;
constexpr u16 kNtscFirstVisibleLine = 28;

}  // namespace

Vic::Vic() { fb_.assign(static_cast<size_t>(width_) * height_, 0); }

void Vic::configure(const TimingProfile& profile, const u8* ram, const u8* colorRam,
                    const u8* chargen) {
  profile_ = &profile;
  cyclesPerLine_ = profile.cyclesPerLine;
  rasterLines_ = profile.rasterLines;
  ram_ = ram;
  colorRam_ = colorRam;
  chargen_ = chargen;
  // Keep the complete 200-line display between visible top and bottom borders. NTSC has only
  // twelve post-display raster lines, so its window trims vertical blanking from the top.
  width_ = kFramebufferWidth;
  firstVisibleLine_ = profile.id == TimingProfileId::Ntsc6567R8
                          ? kNtscFirstVisibleLine
                          : kPalFirstVisibleLine;
  height_ = rasterLines_ - kVerticalBlankingLines;
  fb_.assign(static_cast<size_t>(width_) * height_, 0);
}

void Vic::reset() {
  reg_.fill(0);
  // Documented reset-ish defaults: DEN on, RSEL/CSEL on (25x40 display), yscroll 3, border/bg.
  reg_[0x11] = 0x1B;  // DEN=1, RSEL=1, yscroll=3
  reg_[0x16] = 0xC8;  // CSEL=1, xscroll default (upper bits read 1)
  reg_[0x18] = 0x15;  // screen $0400, char $1000
  reg_[0x20] = 0x0E;  // light blue border
  reg_[0x21] = 0x06;  // blue background
  irqLatch_ = 0;
  irqMask_ = 0;
  cycleInLine_ = 0;
  rasterY_ = 0;
  badLine_ = false;
  denSeenThisFrame_ = false;
  baSteal_ = 0;
  frameSequence_ = 0;
  dirty_ = false;
  spriteSpriteColl_ = 0;
  spriteBgColl_ = 0;
  std::fill(fb_.begin(), fb_.end(), static_cast<u8>(0));
}

u32 Vic::takeBaSteal() {
  const u32 s = baSteal_;
  baSteal_ = 0;
  return s;
}

u8 Vic::vicFetch(u16 addr14) const {
  addr14 = static_cast<u16>(addr14 & 0x3FFF);
  const bool charRomVisible = (bank_ == 0 || bank_ == 2) && addr14 >= 0x1000 && addr14 < 0x2000;
  if (charRomVisible && chargen_ != nullptr) return chargen_[addr14 - 0x1000];
  if (ram_ == nullptr) return 0;
  const u32 abs = static_cast<u32>(bank_) * 0x4000u + addr14;
  return ram_[abs & 0xFFFF];
}

void Vic::onLineStart() {
  // Capture DEN at raster line $30; it qualifies bad lines for the frame.
  if (rasterY_ == 0x30) denSeenThisFrame_ = (reg_[0x11] & 0x10) != 0;

  badLine_ = rasterY_ >= 0x30 && rasterY_ <= 0xF7 &&
             (rasterY_ & 0x07) == (reg_[0x11] & 0x07) && denSeenThisFrame_;

  // Raster interrupt compare (9-bit compare value from $D012 + $D011 bit7).
  const u16 compare = static_cast<u16>(reg_[0x12] | ((reg_[0x11] & 0x80) << 1));
  if (rasterY_ == compare) irqLatch_ = static_cast<u8>(irqLatch_ | 0x01);

  // BA/AEC steal: a bad line steals ~40 cycles for character DMA; each active sprite steals ~2
  // cycles for its DMA. Represented at line granularity (see the fidelity note in the header).
  baSteal_ = 0;
  if (badLine_) baSteal_ += 40;
  if (reg_[0x15] != 0) {
    for (u8 n = 0; n < 8; ++n) {
      if ((reg_[0x15] & (1u << n)) == 0) continue;
      const int yTop = reg_[1 + 2 * n];
      const int height = (reg_[0x17] & (1u << n)) ? 42 : 21;
      if (static_cast<int>(rasterY_) >= yTop && static_cast<int>(rasterY_) < yTop + height) {
        baSteal_ += 2;
      }
    }
  }
}

void Vic::tickCycle() {
  if (cycleInLine_ == 0) onLineStart();
  ++cycleInLine_;
  if (cycleInLine_ >= cyclesPerLine_) {
    renderLine(rasterY_);
    cycleInLine_ = 0;
    ++rasterY_;
    if (rasterY_ >= rasterLines_) {
      rasterY_ = 0;
      ++frameSequence_;
      dirty_ = true;
    }
  }
}

u8 Vic::renderTextBitmapPixel(u16 line, int dpx, bool& foreground) const {
  foreground = false;
  const u8 bg0 = static_cast<u8>(reg_[0x21] & 0x0F);
  const bool ecm = (reg_[0x11] & 0x40) != 0;
  const bool bmm = (reg_[0x11] & 0x20) != 0;
  const bool mcm = (reg_[0x16] & 0x10) != 0;
  const int xscroll = reg_[0x16] & 0x07;
  const int yscroll = reg_[0x11] & 0x07;

  const int sx = dpx - xscroll;
  if (sx < 0) return bg0;  // scrolled-in region shows the background colour
  const int col = sx / 8;
  if (col >= 40) return bg0;
  const int y = static_cast<int>(line) - 48 - yscroll;
  if (y < 0 || y >= 200) return bg0;
  const int charRow = y / 8;
  const int lineInChar = y % 8;
  const int pixInByte = sx & 7;

  const u16 vmBase = static_cast<u16>(((reg_[0x18] >> 4) & 0x0F) * 0x0400);
  const int vmIndex = charRow * 40 + col;
  const u8 code = vicFetch(static_cast<u16>(vmBase + vmIndex));
  const u8 colorNib = static_cast<u8>(colorRam_ ? (colorRam_[vmIndex & 0x03FF] & 0x0F) : 0);

  // Invalid mode combinations (ECM with BMM or MCM) render black deterministically.
  if (ecm && (bmm || mcm)) {
    foreground = false;
    return 0;
  }

  if (bmm) {
    const u16 bmBase = static_cast<u16>(((reg_[0x18] >> 3) & 0x01) * 0x2000);
    const u16 addr = static_cast<u16>(bmBase + charRow * 320 + col * 8 + lineInChar);
    const u8 bits = vicFetch(addr);
    if (!mcm) {  // standard bitmap: fg = VM high nibble, bg = VM low nibble
      const bool on = (bits >> (7 - pixInByte)) & 1;
      foreground = on;
      return on ? static_cast<u8>((code >> 4) & 0x0F) : static_cast<u8>(code & 0x0F);
    }
    // multicolor bitmap: 2 bits select bg0 / VM-hi / VM-lo / colour RAM
    const u8 two = static_cast<u8>((bits >> (6 - (pixInByte & 6))) & 0x03);
    switch (two) {
      case 0: return bg0;
      case 1: return static_cast<u8>((code >> 4) & 0x0F);  // background layer
      case 2: foreground = true; return static_cast<u8>(code & 0x0F);
      default: foreground = true; return colorNib;
    }
  }

  // Text modes.
  const u16 chBase = static_cast<u16>(((reg_[0x18] >> 1) & 0x07) * 0x0800);
  const u8 chCode = ecm ? static_cast<u8>(code & 0x3F) : code;
  const u8 bits = vicFetch(static_cast<u16>(chBase + chCode * 8 + lineInChar));

  if (!mcm) {  // standard text (or ECM)
    const bool on = (bits >> (7 - pixInByte)) & 1;
    foreground = on;
    u8 bg = bg0;
    if (ecm) bg = static_cast<u8>(reg_[0x21 + ((code >> 6) & 0x03)] & 0x0F);
    return on ? colorNib : bg;
  }
  // multicolor text
  if (colorNib & 0x08) {
    const u8 two = static_cast<u8>((bits >> (6 - (pixInByte & 6))) & 0x03);
    switch (two) {
      case 0: return bg0;
      case 1: return static_cast<u8>(reg_[0x22] & 0x0F);  // bg1 (background)
      case 2: foreground = true; return static_cast<u8>(reg_[0x23] & 0x0F);  // bg2 (foreground)
      default: foreground = true; return static_cast<u8>(colorNib & 0x07);
    }
  }
  const bool on = (bits >> (7 - pixInByte)) & 1;
  foreground = on;
  return on ? static_cast<u8>(colorNib & 0x07) : bg0;
}

void Vic::renderLine(u16 line) {
  const int r = static_cast<int>(line) - firstVisibleLine_;
  if (r < 0 || r >= static_cast<int>(height_)) return;
  u8* row = &fb_[static_cast<size_t>(r) * width_];

  const u8 border = static_cast<u8>(reg_[0x20] & 0x0F);
  const bool den = (reg_[0x11] & 0x10) != 0;
  const bool rsel = (reg_[0x11] & 0x08) != 0;
  const int dispTop = rsel ? 51 : 55;
  const int dispBot = rsel ? 250 : 246;
  const bool vBorder = !(den && static_cast<int>(line) >= dispTop && static_cast<int>(line) <= dispBot);
  const bool csel = (reg_[0x16] & 0x08) != 0;
  const int hLeft = csel ? 0 : 7;
  const int hRight = csel ? 320 : 313;

  // Foreground mask (for sprite priority + sprite/background collision) and sprite ownership.
  std::array<u8, 384> fg{};
  for (int c = 0; c < static_cast<int>(width_); ++c) {
    const int dpx = c - 32;
    if (vBorder || dpx < hLeft || dpx >= hRight) {
      row[c] = border;
      fg[c] = 0;
    } else {
      bool isFg = false;
      row[c] = renderTextBitmapPixel(line, dpx, isFg);
      fg[c] = isFg ? 1 : 0;
    }
  }

  // Sprites: draw 7..0 so sprite 0 (highest priority) wins overlapping pixels.
  const u16 vmBase = static_cast<u16>(((reg_[0x18] >> 4) & 0x0F) * 0x0400);
  std::array<u8, 384> owner{};  // sprite-index+1 that painted each column (0 = none)
  owner.fill(0);
  for (int s = 7; s >= 0; --s) {
    const u8 n = static_cast<u8>(s);
    if ((reg_[0x15] & (1u << n)) == 0) continue;
    const int yTop = reg_[1 + 2 * n];
    const bool yExp = (reg_[0x17] & (1u << n)) != 0;
    const int height = yExp ? 42 : 21;
    if (static_cast<int>(line) < yTop || static_cast<int>(line) >= yTop + height) continue;
    int spriteRow = static_cast<int>(line) - yTop;
    if (yExp) spriteRow /= 2;

    const int spriteX = reg_[2 * n] | (((reg_[0x10] >> n) & 1) << 8);
    const bool xExp = (reg_[0x1D] & (1u << n)) != 0;
    const bool mc = (reg_[0x1C] & (1u << n)) != 0;
    const bool behind = (reg_[0x1B] & (1u << n)) != 0;
    const u8 spColor = static_cast<u8>(reg_[0x27 + n] & 0x0F);
    const u8 mc0 = static_cast<u8>(reg_[0x25] & 0x0F);
    const u8 mc1 = static_cast<u8>(reg_[0x26] & 0x0F);
    const u8 ptr = vicFetch(static_cast<u16>(vmBase + 0x3F8 + n));
    const u16 dataBase = static_cast<u16>(ptr * 64 + spriteRow * 3);

    for (int px = 0; px < 24; ++px) {
      u8 colorIdx = 0;
      bool on = false;
      if (mc) {
        const int byteIdx = (px & ~1) / 8;
        const u8 sbyte = vicFetch(static_cast<u16>(dataBase + byteIdx));
        const int shift = 6 - ((px & ~1) & 6);
        const u8 two = static_cast<u8>((sbyte >> shift) & 0x03);
        switch (two) {
          case 0: on = false; break;
          case 1: on = true; colorIdx = mc0; break;
          case 2: on = true; colorIdx = spColor; break;
          default: on = true; colorIdx = mc1; break;
        }
      } else {
        const int byteIdx = px / 8;
        const u8 sbyte = vicFetch(static_cast<u16>(dataBase + byteIdx));
        on = ((sbyte >> (7 - (px & 7))) & 1) != 0;
        colorIdx = spColor;
      }
      if (!on) continue;

      const int widthPx = xExp ? 2 : 1;
      for (int sub = 0; sub < widthPx; ++sub) {
        const int screenX = spriteX + (xExp ? px * 2 + sub : px);
        const int dpx = screenX - 24;   // sprite X=24 aligns with display pixel 0
        const int c = dpx + 32;
        if (c < 0 || c >= static_cast<int>(width_)) continue;

        // Collisions are detected regardless of priority/visibility.
        if (owner[c] != 0) {
          const u8 prevMask = static_cast<u8>(owner[c] - 1);
          const bool wasZero = spriteSpriteColl_ == 0;
          spriteSpriteColl_ = static_cast<u8>(spriteSpriteColl_ | (1u << n) | (1u << prevMask));
          if (wasZero) irqLatch_ = static_cast<u8>(irqLatch_ | 0x04);
        }
        if (fg[c]) {
          const bool wasZero = spriteBgColl_ == 0;
          spriteBgColl_ = static_cast<u8>(spriteBgColl_ | (1u << n));
          if (wasZero) irqLatch_ = static_cast<u8>(irqLatch_ | 0x02);
        }
        owner[c] = static_cast<u8>(n + 1);

        // Priority: a background-priority sprite is hidden behind foreground graphics.
        if (!(behind && fg[c])) row[c] = colorIdx;
      }
    }
  }
}

FrameInfo Vic::frameInfo() const {
  FrameInfo info;
  info.sequence = frameSequence_;
  info.width = static_cast<u16>(width_);
  info.height = static_cast<u16>(height_);
  info.pixelFormat = "c64-indexed-8";
  info.dirty = dirty_;
  return info;
}

u8 Vic::read(u8 reg, bool sideEffects) {
  reg = static_cast<u8>(reg & 0x3F);
  switch (reg) {
    case 0x11:
      return static_cast<u8>((reg_[0x11] & 0x7F) | ((rasterY_ >> 8) & 0x01 ? 0x80 : 0x00));
    case 0x12:
      return static_cast<u8>(rasterY_ & 0xFF);
    case 0x16:
      return static_cast<u8>(reg_[0x16] | 0xC0);  // upper two bits read 1
    case 0x18:
      return static_cast<u8>(reg_[0x18] | 0x01);  // bit0 reads 1
    case 0x19:
      return static_cast<u8>(irqLatch_ | 0x70 | (irqAsserted() ? 0x80 : 0x00));
    case 0x1A:
      return static_cast<u8>(irqMask_ | 0xF0);
    case 0x1E: {
      const u8 v = spriteSpriteColl_;
      if (sideEffects) spriteSpriteColl_ = 0;
      return v;
    }
    case 0x1F: {
      const u8 v = spriteBgColl_;
      if (sideEffects) spriteBgColl_ = 0;
      return v;
    }
    default:
      if (reg >= 0x20 && reg <= 0x2E) return static_cast<u8>(reg_[reg] | 0xF0);  // colour regs
      if (reg >= 0x2F) return 0xFF;  // unused registers read all ones
      return reg_[reg];
  }
}

void Vic::write(u8 reg, u8 value) {
  reg = static_cast<u8>(reg & 0x3F);
  switch (reg) {
    case 0x19:
      // Acknowledge: writing a 1 clears the corresponding latch bit.
      irqLatch_ = static_cast<u8>(irqLatch_ & ~(value & 0x0F));
      return;
    case 0x1A:
      irqMask_ = static_cast<u8>(value & 0x0F);
      return;
    case 0x1E:
    case 0x1F:
      return;  // collision registers are read-only
    default:
      if (reg <= 0x2E) reg_[reg] = value;
      return;
  }
}

DeviceStatus Vic::status() const {
  return DeviceStatus{"vic-ii", true,
                      "6567/6569 registers, raster IRQ, bad-line BA steal, text/bitmap/ECM modes, "
                      "8 sprites, collisions; line-based renderer (not pixel-cycle-exact)"};
}

}  // namespace c64
