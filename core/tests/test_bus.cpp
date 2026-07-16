#include "c64/bus.hpp"

#include "c64/rom.hpp"
#include "test_framework.hpp"

using namespace c64;

namespace {
struct Fixture {
  RomSet roms = syntheticRomSet(0xC000, 0xC100, 0xC200);
  Bus bus;
  Fixture() {
    bus.setRoms(roms);
    bus.powerOnReset(0);
  }
  void setPort(u8 value) { bus.write(0x0001, value); }
};
}  // namespace

TEST(bus_reset_processor_port) {
  Fixture f;
  CHECK_EQ(f.bus.read(0x0000), 0x2Fu);  // DDR reset value
  CHECK_EQ(f.bus.read(0x0001), 0x37u);  // port reset value
  CHECK(f.bus.loram());
  CHECK(f.bus.hiram());
  CHECK(f.bus.charen());
}

TEST(bus_banking_standard_37) {
  Fixture f;
  f.setPort(0x37);
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xA000)), "basic-rom");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xE000)), "kernal-rom");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD000)), "io-vic");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD400)), "io-sid");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD800)), "color-ram");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xDC00)), "io-cia1");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xDD00)), "io-cia2");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xDE00)), "io-expansion");
}

TEST(bus_banking_charen_off) {
  Fixture f;
  f.setPort(0x33);  // loram=1, hiram=1, charen=0
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD000)), "char-rom");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xA000)), "basic-rom");
}

TEST(bus_banking_ram_under_roms) {
  Fixture f;
  f.setPort(0x35);  // loram=1, hiram=0 -> BASIC/KERNAL are RAM, IO still visible
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xA000)), "ram");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xE000)), "ram");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD000)), "io-vic");

  f.setPort(0x34);  // loram=0, hiram=0 -> D000 region is RAM
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xD000)), "ram");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xA000)), "ram");
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0xE000)), "ram");
}

TEST(bus_rom_reads) {
  Fixture f;
  f.setPort(0x37);
  // syntheticRomSet fills basic[i] = i*3 + 0x11 -> basic[0] = 0x11.
  CHECK_EQ(f.bus.read(0xA000), 0x11u);
  // kernal[i] = i*7 + 0x22 -> kernal[0] = 0x22.
  CHECK_EQ(f.bus.read(0xE000), 0x22u);
}

TEST(bus_writes_fall_through_rom) {
  Fixture f;
  f.setPort(0x37);
  f.bus.write(0xA000, 0x99);          // BASIC visible: write goes to RAM beneath
  CHECK_EQ(f.bus.read(0xA000), 0x11u); // still reads ROM
  f.setPort(0x35);                     // A000 now RAM
  CHECK_EQ(f.bus.read(0xA000), 0x99u); // the shadowed RAM byte
}

TEST(bus_color_ram_nibble) {
  Fixture f;
  f.setPort(0x37);
  f.bus.write(0xD800, 0xAB);
  CHECK_EQ(f.bus.read(0xD800) & 0x0F, 0x0Bu);  // only low nibble stored
}

TEST(bus_peek_no_side_effects) {
  Fixture f;
  f.setPort(0x37);
  f.bus.rawRamWrite(0x2000, 0x77);
  CHECK_EQ(f.bus.peek(0x2000), 0x77u);
  CHECK_STR_EQ(mappedRegionId(f.bus.regionOf(0x2000)), "ram");
}
