#include "c64/drive.hpp"

#include <array>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "c64/iec.hpp"
#include "c64/media.hpp"
#include "c64/via6522.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;

namespace {

std::array<u8, 4> decodeGcr(const u8* encoded) {
  constexpr std::array<i8, 32> decode = {
      -1, -1, -1, -1, -1, -1, -1, -1, -1, 8,  0,  1,  -1, 12, 4,  5,
      -1, -1, 2,  3,  -1, 15, 6,  7,  -1, 9,  10, 11, -1, 13, 14, -1,
  };
  u64 packed = 0;
  for (u8 i = 0; i < 5; ++i) packed = (packed << 8) | encoded[i];
  std::array<u8, 4> result{};
  for (u8 i = 0; i < 4; ++i) {
    const u8 hiCode = static_cast<u8>((packed >> (35 - i * 10)) & 0x1F);
    const u8 loCode = static_cast<u8>((packed >> (30 - i * 10)) & 0x1F);
    result[i] = static_cast<u8>((decode[hiCode] << 4) | decode[loCode]);
  }
  return result;
}

std::vector<u8> syntheticDriveRom() {
  std::vector<u8> rom(16384, 0xEA);
  const u8 code[] = {
      0xA9, 0x1A,        // LDA #DATA_OUT|CLK_OUT|ATNA
      0x8D, 0x02, 0x18,  // STA $1802
      0xA9, 0x08,        // LDA #CLK_OUT
      0x8D, 0x00, 0x18,  // STA $1800
      0x4C, 0x0A, 0xC0,  // JMP $C00A
  };
  for (u32 i = 0; i < sizeof(code); ++i) rom[i] = code[i];
  rom[0x3FFC] = 0x00;
  rom[0x3FFD] = 0xC0;
  return rom;
}

std::vector<u8> readBinary(const char* path) {
  std::ifstream stream(path, std::ios::binary);
  return std::vector<u8>(std::istreambuf_iterator<char>(stream),
                         std::istreambuf_iterator<char>());
}

RomSet bundledC64Roms() {
  RomImage basic;
  basic.bytes = readBinary(C64_TEST_BASIC_ROM_PATH);
  basic.licenseId = "MIT";
  basic.source = "bundled-replacement";
  RomImage kernal = basic;
  kernal.bytes = readBinary(C64_TEST_KERNAL_ROM_PATH);
  RomImage chargen = basic;
  chargen.bytes = readBinary(C64_TEST_CHARGEN_ROM_PATH);
  chargen.licenseId = "LGPL-3.0-or-later";
  return validateRomSet(basic, kernal, chargen).set;
}

DriveRom bundledDriveRom() {
  RomImage image;
  image.bytes = readBinary(C64_TEST_DRIVE_ROM_PATH);
  image.licenseId = "MIT";
  image.source = "bundled-replacement";
  return validateDriveRom(image).rom;
}

bool screenContains(const Machine& machine, const std::string& needle) {
  std::string screen;
  for (u16 offset = 0; offset < 1000; ++offset) {
    const u8 code = static_cast<u8>(machine.debugReadRam(0x0400 + offset) & 0x7F);
    if (code >= 1 && code <= 26) {
      screen.push_back(static_cast<char>('A' + code - 1));
    } else if (code >= 32 && code <= 63) {
      screen.push_back(static_cast<char>(code));
    } else {
      screen.push_back(' ');
    }
  }
  return screen.find(needle) != std::string::npos;
}

}  // namespace

TEST(drive_iec_open_collector_lines) {
  IecBus bus;
  bus.reset();
  CHECK_EQ(bus.c64PortAInputs(), 0xFFu);
  CHECK_EQ(bus.driveVia1PortBInputs(), 0u);

  bus.setC64PortA(0x08, 0x38);
  CHECK(bus.atnAsserted());
  CHECK(bus.dataAsserted());  // drive ATNA defaults released, so the acknowledge gate responds
  CHECK_EQ(bus.c64PortAInputs() & 0x80, 0u);
  CHECK_EQ(bus.driveVia1PortBInputs() & 0x81, 0x81u);

  bus.setDriveVia1PortB(0x10, 0x1A);
  CHECK(!bus.dataAsserted());
  bus.setDriveVia1PortB(0x08, 0x1A);
  CHECK(bus.clockAsserted());
  CHECK_EQ(bus.c64PortAInputs() & 0x40, 0u);
}

TEST(drive_via_ports_and_pcr) {
  Via6522 via;
  via.reset();
  via.setPortBInputs(0xA5);
  CHECK_EQ(via.read(0), 0xA5u);
  via.write(2, 0x0F);
  via.write(0, 0x06);
  CHECK_EQ(via.read(0), 0xA6u);
  via.write(12, 0xEE);
  CHECK_EQ(via.read(12), 0xEEu);
}

TEST(drive_gcr_tracks_have_standard_header_and_density_lengths) {
  const std::vector<u8> image = c64test::makeD64("PROG", {0x01, 0x08, 0x60});
  Disk disk;
  CHECK(parseD64(image, disk).ok);
  const GcrDisk gcr = encodeGcrDisk(disk);
  CHECK_EQ(gcr.tracks[0].bytes.size(), 7692u);
  CHECK_EQ(gcr.tracks[17].bytes.size(), 7142u);
  CHECK_EQ(gcr.tracks[24].bytes.size(), 6666u);
  CHECK_EQ(gcr.tracks[30].bytes.size(), 6250u);
  for (u8 i = 0; i < 5; ++i) CHECK(gcr.tracks[0].sync[i] != 0);

  const std::array<u8, 4> first = decodeGcr(&gcr.tracks[0].bytes[5]);
  const std::array<u8, 4> second = decodeGcr(&gcr.tracks[0].bytes[10]);
  CHECK_EQ(first[0], 0x08u);
  CHECK_EQ(first[2], 0u);
  CHECK_EQ(first[3], 1u);
  CHECK_EQ(second[2], 0x0Fu);
  CHECK_EQ(second[3], 0x0Fu);
}

TEST(drive_cpu_runs_at_rational_clock_and_controls_iec) {
  IecBus iec;
  Drive1541 drive(iec);
  drive.configure(syntheticDriveRom(), palProfile());
  for (u32 i = 0; i < 100; ++i) drive.tickC64Cycle();
  CHECK(!drive.faulted());
  CHECK(drive.cycleCount() >= 90);
  CHECK(iec.clockAsserted());
  CHECK(drive.cpuState().pc >= 0xC00A);
}

TEST(drive_clean_room_firmware_reaches_iec_main_loop) {
  const std::vector<u8> rom = readBinary(C64_TEST_DRIVE_ROM_PATH);
  CHECK_EQ(rom.size(), kDriveRomSize);
  IecBus iec;
  Drive1541 drive(iec);
  drive.configure(rom, palProfile());
  for (u32 i = 0; i < 200000; ++i) drive.tickC64Cycle();
  CHECK(!drive.faulted());
  CHECK_EQ(drive.ram(0), 8u);  // firmware initialized its hard-coded IEC device number
  CHECK(drive.cpuState().pc >= 0xC000);
}

TEST(drive_real_kernal_loads_prg_over_iec) {
  Machine machine;
  MachineConfig config;
  config.roms = bundledC64Roms();
  config.driveRom = bundledDriveRom();
  CHECK(machine.configure(config).ok());
  CHECK(machine.mountD64(c64test::makeD64("PROG", {0x01, 0x08, 0x11, 0x22, 0x33}), 8).ok);

  for (u8 batch = 0; batch < 100 && !screenContains(machine, "READY."); ++batch) {
    const RunResult run = machine.runCycles(200000);
    CHECK(run.stopReason != "fault");
  }
  CHECK(screenContains(machine, "READY."));

  machine.debugWriteRam(0x0500, '*');
  c64test::loadCodeAt(machine, 0xC000,
                      {
                          0xA9, 0x01,        // LDA #1 (filename length)
                          0xA2, 0x00,        // LDX #<$0500
                          0xA0, 0x05,        // LDY #>$0500
                          0x20, 0xBD, 0xFF,  // JSR SETNAM
                          0xA9, 0x01,        // LDA #1 (logical file)
                          0xA2, 0x08,        // LDX #8 (device)
                          0xA0, 0x01,        // LDY #1 (secondary address)
                          0x20, 0xBA, 0xFF,  // JSR SETLFS
                          0xA9, 0x00,        // LDA #0 (load)
                          0x20, 0xD5, 0xFF,  // JSR LOAD
                          0x00,              // BRK
                      });

  RunResult run;
  for (u8 batch = 0; batch < 20; ++batch) {
    run = machine.runCycles(500000);
    if (run.stopReason != "budget") break;
  }
  CHECK(run.stopReason != "fault");
  CHECK_STR_EQ(run.stopReason, "brk");
  CHECK_EQ(machine.debugReadRam(0x0801), 0x11u);
  CHECK_EQ(machine.debugReadRam(0x0803), 0x33u);
  CHECK(!(machine.cpuState().p & FlagC));
}
