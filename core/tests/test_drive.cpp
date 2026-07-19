#include "c64/drive.hpp"

#include <algorithm>
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

template <typename Predicate>
bool runUntil(Machine& machine, u64 maxCycles, Predicate predicate) {
  constexpr u64 kBatchCycles = 200000;
  for (u64 elapsed = 0; elapsed < maxCycles; elapsed += kBatchCycles) {
    if (predicate()) return true;
    const RunResult run = machine.runCycles(kBatchCycles);
    if (run.stopReason == "fault" || run.stopReason == "brk") return false;
  }
  return predicate();
}

bool bootBundledMachine(Machine& machine, const std::vector<u8>& d64) {
  MachineConfig config;
  config.roms = bundledC64Roms();
  config.driveRom = bundledDriveRom();
  if (!machine.configure(config).ok() || !machine.mountD64(d64, 8).ok) return false;
  return runUntil(machine, 20000000, [&] { return screenContains(machine, "READY."); });
}

bool queueKeyboard(Machine& machine, const std::string& text) {
  if (text.empty() || text.size() > 10 || machine.debugReadRam(0x00C6) != 0) return false;
  for (size_t index = 0; index < text.size(); ++index) {
    machine.debugWriteRam(static_cast<u16>(0x0277 + index), static_cast<u8>(text[index]));
  }
  machine.debugWriteRam(0x00C6, static_cast<u8>(text.size()));
  return true;
}

bool typeBasicCommand(Machine& machine, const std::string& text) {
  for (size_t offset = 0; offset < text.size();) {
    const size_t count = std::min<size_t>(10, text.size() - offset);
    if (!queueKeyboard(machine, text.substr(offset, count))) return false;
    if (!runUntil(machine, 2000000, [&] { return machine.debugReadRam(0x00C6) == 0; })) {
      return false;
    }
    offset += count;
  }
  return true;
}

u16 basicProgramEnd(const Machine& machine) {
  return static_cast<u16>(machine.debugReadRam(0x002A) |
                          (static_cast<u16>(machine.debugReadRam(0x002B)) << 8));
}

std::vector<u8> basicBoundaryProgram() {
  return {
      0x01, 0x08,              // load address $0801
      0x10, 0x08, 0x0A, 0x00,  // line link and line number 10
      0x97, 0x20,              // POKE
      '4',  '9',  '1',  '5', '2', ',', '6', '6', 0x00,
      0x00, 0x00,
  };
}

void emit(std::vector<u8>& code, std::initializer_list<u8> bytes) {
  code.insert(code.end(), bytes.begin(), bytes.end());
}

void emitBranchBack(std::vector<u8>& code, u8 opcode, size_t target) {
  emit(code, {opcode, static_cast<u8>(static_cast<int>(target) -
                                     static_cast<int>(code.size() + 2))});
}

void emitU1Read(std::vector<u8>& code, u16 command, u16 status, u16 destination,
                u16 bufferNumber) {
  emit(code, {0xA2, 0x0F, 0x20, 0xC9, 0xFF,  // LDX #15; JSR CHKOUT
              0xA0, 0x00});                   // LDY #0
  const size_t commandLoop = code.size();
  emit(code, {0xB9, static_cast<u8>(command & 0xFF), static_cast<u8>(command >> 8),
              0x20, 0xD2, 0xFF,  // LDA command,Y; JSR CHROUT
              0xC8, 0xC0, 0x0D}); // INY; CPY #13
  emitBranchBack(code, 0xD0, commandLoop);
  emit(code, {0x20, 0xCC, 0xFF,              // JSR CLRCHN
              0xA2, 0x0F, 0x20, 0xC6, 0xFF, // LDX #15; JSR CHKIN
              0xA0, 0x00});                   // LDY #0
  const size_t statusLoop = code.size();
  emit(code, {0x20, 0xCF, 0xFF,  // JSR CHRIN
              0x99, static_cast<u8>(status & 0xFF), static_cast<u8>(status >> 8),
              0xC8, 0xC9, 0x0D}); // STA status,Y; INY; CMP #RETURN
  emitBranchBack(code, 0xD0, statusLoop);
  emit(code, {0x20, 0xCC, 0xFF,              // JSR CLRCHN
              0xA2, 0x02, 0x20, 0xC6, 0xFF, // LDX #2; JSR CHKIN
              0x20, 0xCF, 0xFF,              // JSR CHRIN (buffer number)
              0x8D, static_cast<u8>(bufferNumber & 0xFF),
              static_cast<u8>(bufferNumber >> 8),
              0xA0, 0x00}); // STA bufferNumber; LDY #0
  const size_t sectorLoop = code.size();
  emit(code, {0x20, 0xCF, 0xFF,  // JSR CHRIN
              0x99, static_cast<u8>(destination & 0xFF),
              static_cast<u8>(destination >> 8),
              0xC8}); // STA destination,Y; INY
  emitBranchBack(code, 0xD0, sectorLoop);
  emit(code, {0x20, 0xCC, 0xFF}); // JSR CLRCHN
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

TEST(drive_bundled_kernal_preserves_processor_port_for_banked_ram) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("PROG", {0x01, 0x08, 0x11})));
  CHECK_EQ(machine.dataDirection(), 0x2Fu);
  CHECK_EQ(machine.processorPort(), 0x37u);

  machine.debugWriteRam(0xB500, 0x42);
  c64test::loadCodeAt(machine, 0xC000,
                      {
                          0xA5, 0x01,        // LDA $01
                          0x29, 0xFE,        // AND #$FE
                          0x85, 0x01,        // STA $01 (bank out BASIC)
                          0xAD, 0x00, 0xB5,  // LDA $B500
                          0x8D, 0x02, 0xC2,  // STA $C202
                          0x00,              // BRK
                      });
  const RunResult run = machine.runCycles(1000);
  CHECK_STR_EQ(run.stopReason, "brk");
  CHECK_EQ(machine.dataDirection(), 0x2Fu);
  CHECK_EQ(machine.processorPort(), 0x36u);
  CHECK_EQ(static_cast<int>(machine.regionOf(0xB500)),
           static_cast<int>(MappedRegion::Ram));
  CHECK_EQ(machine.debugReadRam(0xC202), 0x42u);
}

TEST(drive_bundled_kernal_custom_irq_continues_and_releases_joystick) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("PROG", {0x01, 0x08, 0x11})));

  machine.debugWriteRam(0xC100, 0xEE); // INC $C200
  machine.debugWriteRam(0xC101, 0x00);
  machine.debugWriteRam(0xC102, 0xC2);
  machine.debugWriteRam(0xC103, 0x4C); // JMP $EA31
  machine.debugWriteRam(0xC104, 0x31);
  machine.debugWriteRam(0xC105, 0xEA);
  c64test::loadCodeAt(machine, 0xC000,
                      {
                          0x78,                    // SEI
                          0xA9, 0x00, 0x8D, 0x00, 0xC2, // marker = 0
                          0x8D, 0x01, 0xC2,        // idle port capture = 0
                          0xA9, 0x00, 0x8D, 0x14, 0x03, // IRQ vector low
                          0xA9, 0xC1, 0x8D, 0x15, 0x03, // IRQ vector high
                          0xA9, 0xD0, 0x8D, 0x04, 0xDC, // timer A low
                          0xA9, 0x07, 0x8D, 0x05, 0xDC, // timer A high
                          0xA9, 0x81, 0x8D, 0x0D, 0xDC, // enable timer A IRQ
                          0xA9, 0x11, 0x8D, 0x0E, 0xDC, // start continuous timer
                          0x58,                          // CLI
                          0xAD, 0x00, 0xC2,              // wait for three IRQs
                          0xC9, 0x03,
                          0x90, 0xF9,
                          0x78,                    // SEI
                          0xAD, 0x00, 0xDC,        // LDA CIA1 PRA
                          0x8D, 0x01, 0xC2,        // STA idle port capture
                          0x00,                    // BRK
                      });

  RunResult run;
  for (u8 batch = 0; batch < 10; ++batch) {
    run = machine.runCycles(50000);
    if (run.stopReason != "budget") break;
  }
  CHECK(run.stopReason != "fault");
  CHECK_STR_EQ(run.stopReason, "brk");
  CHECK(machine.debugReadRam(0xC200) >= 3u);
  CHECK_EQ(machine.debugReadRam(0xC201), 0x7Fu);
}

TEST(drive_real_kernal_loads_prg_over_iec) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("PROG", {0x01, 0x08, 0x11, 0x22, 0x33})));

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

TEST(drive_command_channel_repeats_u1_direct_sector_reads) {
  std::vector<u8> prg(400);
  prg[0] = 0x01;
  prg[1] = 0x08;
  for (size_t index = 2; index < prg.size(); ++index) {
    prg[index] = static_cast<u8>((index * 37 + 11) & 0xFF);
  }
  const std::vector<u8> d64 = c64test::makeD64("BLOCKS", prg);
  Machine machine;
  CHECK(bootBundledMachine(machine, d64));

  machine.debugWriteRam(0x0500, '#');
  const std::string firstCommand = "U1:02 0 1 00\r";
  const std::string secondCommand = "U1:02 0 1 01\r";
  for (size_t index = 0; index < firstCommand.size(); ++index) {
    machine.debugWriteRam(static_cast<u16>(0x0510 + index),
                          static_cast<u8>(firstCommand[index]));
    machine.debugWriteRam(static_cast<u16>(0x0520 + index),
                          static_cast<u8>(secondCommand[index]));
  }

  std::vector<u8> code;
  emit(code, {
                 0xA9, 0x00, 0xA2, 0x00, 0xA0, 0x00, 0x20, 0xBD, 0xFF, // SETNAM ""
                 0xA9, 0x0F, 0xA2, 0x08, 0xA0, 0x0F, 0x20, 0xBA, 0xFF, // SETLFS 15,8,15
                 0x20, 0xC0, 0xFF,                                     // OPEN
                 0xA9, 0x01, 0xA2, 0x00, 0xA0, 0x05, 0x20, 0xBD, 0xFF, // SETNAM "#"
                 0xA9, 0x02, 0xA2, 0x08, 0xA0, 0x02, 0x20, 0xBA, 0xFF, // SETLFS 2,8,2
                 0x20, 0xC0, 0xFF,                                     // OPEN
             });
  emitU1Read(code, 0x0510, 0xC300, 0x2000, 0xC2F0);
  emitU1Read(code, 0x0520, 0xC320, 0x2100, 0xC2F1);
  emit(code, {0x00}); // BRK

  std::vector<u8> program = {0x00, 0xC0};
  program.insert(program.end(), code.begin(), code.end());
  CHECK(machine.loadPrg(program).ok);
  machine.setProgramCounter(0xC000);

  RunResult run;
  for (u8 batch = 0; batch < 80; ++batch) {
    run = machine.runCycles(500000);
    if (run.stopReason != "budget") break;
  }
  CHECK(run.stopReason != "fault");
  CHECK_STR_EQ(run.stopReason, "brk");
  CHECK_EQ(machine.debugReadRam(0xC2F0), 0u);
  CHECK_EQ(machine.debugReadRam(0xC2F1), 0u);
  CHECK_EQ(machine.debugReadRam(0xC300), static_cast<u8>('0'));
  CHECK_EQ(machine.debugReadRam(0xC301), static_cast<u8>('0'));
  CHECK_EQ(machine.debugReadRam(0xC320), static_cast<u8>('0'));
  CHECK_EQ(machine.debugReadRam(0xC321), static_cast<u8>('0'));
  for (u16 offset = 0; offset < 256; ++offset) {
    CHECK_EQ(machine.debugReadRam(static_cast<u16>(0x2000 + offset)), d64[offset]);
    CHECK_EQ(machine.debugReadRam(static_cast<u16>(0x2100 + offset)), d64[256 + offset]);
  }
}

TEST(drive_basic_load_secondary_one_updates_program_boundaries_and_runs) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("BASIC", basicBoundaryProgram())));
  CHECK_EQ(basicProgramEnd(machine), 0x0803u);

  CHECK(typeBasicCommand(machine, "LOAD\"*\",8,1\r"));
  CHECK(runUntil(machine, 12000000, [&] { return basicProgramEnd(machine) == 0x0812; }));
  CHECK_EQ(basicProgramEnd(machine), 0x0812u);

  machine.debugWriteRam(0xC000, 0);
  CHECK(typeBasicCommand(machine, "RUN\r"));
  CHECK(runUntil(machine, 4000000, [&] { return machine.debugReadRam(0xC000) == 66; }));
  CHECK_EQ(machine.debugReadRam(0xC000), 66u);
  CHECK(!screenContains(machine, "OUT OF DATA"));
}

TEST(drive_basic_load_secondary_zero_updates_program_boundaries_and_runs) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("BASIC", basicBoundaryProgram())));
  CHECK_EQ(basicProgramEnd(machine), 0x0803u);

  CHECK(typeBasicCommand(machine, "LOAD\"*\",8\r"));
  CHECK(runUntil(machine, 12000000, [&] { return basicProgramEnd(machine) == 0x0812; }));
  CHECK_EQ(basicProgramEnd(machine), 0x0812u);

  machine.debugWriteRam(0xC000, 0);
  CHECK(typeBasicCommand(machine, "RUN\r"));
  CHECK(runUntil(machine, 4000000, [&] { return machine.debugReadRam(0xC000) == 66; }));
  CHECK_EQ(machine.debugReadRam(0xC000), 66u);
  CHECK(!screenContains(machine, "OUT OF DATA"));
}

TEST(drive_basic_load_secondary_one_preserves_boundaries_for_machine_code) {
  Machine machine;
  CHECK(bootBundledMachine(machine, c64test::makeD64("CODE", {0x00, 0xC0, 0x42})));
  const u16 initialProgramEnd = basicProgramEnd(machine);
  machine.debugWriteRam(0xC000, 0);

  CHECK(typeBasicCommand(machine, "LOAD\"*\",8,1\r"));
  CHECK(runUntil(machine, 12000000, [&] { return machine.debugReadRam(0xC000) == 0x42; }));
  CHECK_EQ(machine.debugReadRam(0xC000), 0x42u);
  CHECK_EQ(basicProgramEnd(machine), initialProgramEnd);
}

TEST(drive_sequential_exact_name_loads_start_with_fresh_filenames) {
  Machine machine;
  CHECK(bootBundledMachine(
      machine, c64test::makeD64("PROG", {0x01, 0x08, 0x11, 0x22, 0x33})));

  machine.debugWriteRam(0x0500, 'P');
  machine.debugWriteRam(0x0501, 'R');
  machine.debugWriteRam(0x0502, 'O');
  machine.debugWriteRam(0x0503, 'G');
  c64test::loadCodeAt(machine, 0xC000,
                      {
                          0xA9, 0x04,        // LDA #4 (filename length)
                          0xA2, 0x00,        // LDX #<$0500
                          0xA0, 0x05,        // LDY #>$0500
                          0x20, 0xBD, 0xFF,  // JSR SETNAM
                          0xA9, 0x01,        // LDA #1 (logical file)
                          0xA2, 0x08,        // LDX #8 (device)
                          0xA0, 0x01,        // LDY #1 (secondary address)
                          0x20, 0xBA, 0xFF,  // JSR SETLFS
                          0xA9, 0x00,        // LDA #0 (load)
                          0x20, 0xD5, 0xFF,  // JSR LOAD
                          0xA9, 0x00,
                          0x8D, 0x01, 0x08,  // clear the first loaded byte
                          0xA9, 0x00,        // LDA #0 (load again)
                          0x20, 0xD5, 0xFF,  // JSR LOAD
                          0x00,              // BRK
                      });

  RunResult run;
  for (u8 batch = 0; batch < 40; ++batch) {
    run = machine.runCycles(500000);
    if (run.stopReason != "budget") break;
  }
  CHECK(run.stopReason != "fault");
  CHECK_STR_EQ(run.stopReason, "brk");
  CHECK_EQ(machine.debugReadRam(0x0801), 0x11u);
  CHECK(!(machine.cpuState().p & FlagC));
}
