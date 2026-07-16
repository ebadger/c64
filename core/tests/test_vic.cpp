#include "c64/vic.hpp"

#include <array>
#include <vector>

#include "c64/timing.hpp"
#include "test_framework.hpp"

using namespace c64;

namespace {

// A VIC wired to standalone memory buffers, mimicking the bus wiring for unit tests.
struct VicFixture {
  std::vector<u8> ram = std::vector<u8>(0x10000, 0);
  std::vector<u8> colorRam = std::vector<u8>(0x0400, 0);
  std::vector<u8> chargen = std::vector<u8>(0x1000, 0);
  Vic vic;

  explicit VicFixture(const TimingProfile& p = palProfile()) {
    vic.configure(p, ram.data(), colorRam.data(), chargen.data());
    vic.reset();
    vic.setBank(0);
  }
  void tickCycles(u32 n) {
    for (u32 i = 0; i < n; ++i) vic.tickCycle();
  }
  void tickLines(u32 lines) { tickCycles(lines * palProfile().cyclesPerLine); }
  // Tick so that onLineStart() for the given raster line has executed (it runs on the line's
  // first cycle): raster compare, bad-line qualification, and BA steal are evaluated there.
  void tickToLineStart(u32 line) { tickCycles(line * palProfile().cyclesPerLine + 1); }
  void tickFrame() { tickCycles(palProfile().cyclesPerFrame); }
};

}  // namespace

TEST(vic_register_readback) {
  VicFixture f;
  // Colour registers read back with the top nibble set (only 4 bits are real).
  f.vic.write(0x20, 0x03);
  CHECK_EQ(f.vic.read(0x20, true), 0xF3u);
  // Unused registers read all ones.
  CHECK_EQ(f.vic.read(0x2F, true), 0xFFu);
  CHECK_EQ(f.vic.read(0x3F, true), 0xFFu);
  // $D016 upper two bits read 1.
  f.vic.write(0x16, 0x08);
  CHECK_EQ(f.vic.read(0x16, true) & 0xC0, 0xC0u);
}

TEST(vic_raster_counter_and_frame) {
  VicFixture f;
  const u64 seq0 = f.vic.frameSequence();
  f.tickFrame();
  CHECK_EQ(f.vic.frameSequence(), seq0 + 1);
  CHECK(f.vic.frameDirty());
  f.vic.clearDirty();
  CHECK(!f.vic.frameDirty());
  CHECK_EQ(f.vic.rasterY(), 0u);
}

TEST(vic_raster_bit8_readback) {
  VicFixture f;
  // Advance beyond raster 255 so $D011 bit7 reflects the high raster bit.
  f.tickLines(260);
  const u8 d011 = f.vic.read(0x11, true);
  const u8 d012 = f.vic.read(0x12, true);
  const u16 raster = static_cast<u16>(d012 | ((d011 & 0x80) << 1));
  CHECK_EQ(raster, f.vic.rasterY());
  CHECK(raster > 255u);
}

TEST(vic_raster_interrupt) {
  VicFixture f;
  f.vic.write(0x12, 100);  // compare raster = 100
  f.vic.write(0x11, 0x1B); // bit7 (raster msb) = 0
  f.vic.write(0x1A, 0x01); // enable raster interrupt
  f.tickToLineStart(100);  // reach the start of raster line 100
  CHECK(f.vic.irqAsserted());
  CHECK_EQ(f.vic.read(0x19, true) & 0x01, 0x01u);  // latch bit0 set
  CHECK_EQ(f.vic.read(0x19, true) & 0x80, 0x80u);  // IRQ flag
  f.vic.write(0x19, 0x01);  // acknowledge
  CHECK(!f.vic.irqAsserted());
}

TEST(vic_bad_line_steals_bus) {
  VicFixture f;
  // DEN is on by default ($D011=0x1B). Advance to a bad line (raster>=0x30, raster&7==yscroll).
  f.tickToLineStart(0x33);  // raster line 0x33 = 51, (51 & 7) == 3 == yscroll
  const u32 steal = f.vic.takeBaSteal();
  CHECK(steal >= 40u);      // ~40 character-DMA cycles stolen
  // A non-bad line steals nothing (no sprites). Advance one full line to line 0x34's start.
  f.tickCycles(palProfile().cyclesPerLine);  // raster 0x34, (0x34 & 7) == 4 != 3
  CHECK_EQ(f.vic.takeBaSteal(), 0u);
}

TEST(vic_den_off_no_bad_lines) {
  VicFixture f;
  f.vic.write(0x11, 0x0B);  // DEN=0
  f.tickToLineStart(0x33);
  CHECK_EQ(f.vic.takeBaSteal(), 0u);
}

TEST(vic_text_mode_render) {
  VicFixture f;
  // Screen at $0400, char base at $2000 (RAM, away from char ROM overlay).
  f.vic.write(0x18, 0x18);
  f.vic.write(0x11, 0x1B);  // DEN, RSEL, yscroll=3
  f.vic.write(0x16, 0x08);  // CSEL=1, xscroll=0
  f.vic.write(0x21, 0x06);  // background 0 = blue
  f.ram[0x0400] = 0x01;     // char code 1 at screen position 0
  f.colorRam[0] = 0x0A;     // foreground = light red
  f.ram[0x2000 + 1 * 8 + 0] = 0x80;  // char 1, row 0: only leftmost pixel on
  f.tickFrame();            // render the whole frame
  const u32 w = f.vic.fbWidth();
  const u8* fb = f.vic.framebuffer();
  const int r = 51 - 16;    // raster line 51 -> framebuffer row
  CHECK_EQ(fb[r * w + 32], 0x0Au);  // display pixel 0: foreground
  CHECK_EQ(fb[r * w + 33], 0x06u);  // display pixel 1: background
}

TEST(vic_border_color) {
  VicFixture f;
  f.vic.write(0x20, 0x02);  // red border
  f.tickFrame();
  const u32 w = f.vic.fbWidth();
  const u8* fb = f.vic.framebuffer();
  // Top-left corner is border.
  CHECK_EQ(fb[0], 0x02u);
}

TEST(vic_sprite_render_and_priority) {
  VicFixture f;
  f.vic.write(0x18, 0x18);   // screen $0400, char $2000
  f.vic.write(0x15, 0x01);   // enable sprite 0
  f.vic.write(0x00, 100);    // sprite 0 X low = 100
  f.vic.write(0x10, 0x00);   // X msb = 0
  f.vic.write(0x01, 60);     // sprite 0 Y = 60
  f.vic.write(0x27, 0x07);   // sprite 0 colour = yellow
  f.ram[0x0400 + 0x3F8] = 0x80;      // sprite 0 data pointer -> $2000
  f.ram[0x2000] = 0x80;              // sprite row 0: leftmost pixel on
  f.tickFrame();
  const u32 w = f.vic.fbWidth();
  const u8* fb = f.vic.framebuffer();
  const int r = 60 - 16;             // sprite Y=60 -> framebuffer row
  const int c = (100 - 24) + 32;     // sprite X=100 -> display pixel 76 -> fb col
  CHECK_EQ(fb[r * w + c], 0x07u);    // sprite pixel painted
}

TEST(vic_sprite_sprite_collision) {
  VicFixture f;
  f.vic.write(0x18, 0x18);
  f.vic.write(0x15, 0x03);   // enable sprites 0 and 1
  // Both sprites at the same position with the same data -> overlapping pixel.
  f.vic.write(0x00, 100);
  f.vic.write(0x01, 60);
  f.vic.write(0x02, 100);
  f.vic.write(0x03, 60);
  f.vic.write(0x1A, 0x04);   // enable sprite-sprite collision interrupt
  f.ram[0x0400 + 0x3F8] = 0x80;
  f.ram[0x0400 + 0x3F9] = 0x80;
  f.ram[0x2000] = 0x80;
  f.tickFrame();
  CHECK_EQ(f.vic.read(0x1E, true) & 0x03, 0x03u);  // both sprites flagged
  CHECK(f.vic.irqAsserted());                      // collision raised IRQ
  CHECK_EQ(f.vic.read(0x1E, true), 0x00u);         // cleared on read
}

TEST(vic_ntsc_dimensions_differ) {
  VicFixture pal(palProfile());
  VicFixture ntsc(ntscProfile());
  CHECK(pal.vic.fbHeight() != ntsc.vic.fbHeight());  // different raster line counts
  CHECK_EQ(pal.vic.fbWidth(), ntsc.vic.fbWidth());   // same width
}
