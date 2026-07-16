// Machine-level and critical-path tests. The border/background test protects the product
// critical path: a direct-mode PRG assembled by the merged src/ pipeline is loaded into the
// core, run for a frame, and the resulting indexed framebuffer plus VIC registers are observed.
// The PRG bytes and expectations come from the committed, assembler-generated fixture header.
#include "c64/errors.hpp"
#include "c64/machine.hpp"
#include "fixtures/border_bg_fixture.hpp"
#include "test_framework.hpp"

using namespace c64;

TEST(border_bg_fixture_renders_framebuffer) {
  Machine m;
  const LoadResult lr = m.loadPrg(c64_fixture::kBorderBgPrg, sizeof(c64_fixture::kBorderBgPrg));
  REQUIRE(lr.ok);
  REQUIRE_EQ(lr.loadAddress, c64_fixture::kBorderBgLoadAddress);

  m.setPc(c64_fixture::kBorderBgRunAddress);
  m.runFrame();

  // VIC register state set by the program.
  REQUIRE_EQ(m.vic().borderColor(), c64_fixture::kExpectedBorder);
  REQUIRE_EQ(m.vic().backgroundColor0(), c64_fixture::kExpectedBackground);

  // CPU-visible register read (I/O banked in): colour registers read back with high nibble set.
  REQUIRE_EQ(m.readMem(0xD020) & 0x0F, c64_fixture::kExpectedBorder);
  REQUIRE_EQ(m.readMem(0xD021) & 0x0F, c64_fixture::kExpectedBackground);

  // Rendered indexed framebuffer.
  const std::vector<u8>& fb = m.framebuffer();
  REQUIRE_EQ(static_cast<long>(fb.size()),
             static_cast<long>(c64_fixture::kFrameWidth) * c64_fixture::kFrameHeight);
  REQUIRE_EQ(fb[c64_fixture::kBorderSampleIndex], c64_fixture::kExpectedBorder);
  REQUIRE_EQ(fb[c64_fixture::kCentreSampleIndex], c64_fixture::kExpectedBackground);

  // A full frame completed deterministically.
  REQUIRE(m.frameInfo().sequence >= 1);
}

TEST(loadprg_validates_header) {
  Machine m;
  const u8 tooShort[] = {0x00, 0x08};
  REQUIRE(!m.loadPrg(tooShort, sizeof(tooShort)).ok);

  // Load address $FFFF with two data bytes wraps past $FFFF.
  const u8 overflow[] = {0xFF, 0xFF, 0x01, 0x02};
  const LoadResult r = m.loadPrg(overflow, sizeof(overflow));
  REQUIRE(!r.ok);
  REQUIRE_EQ(r.errorCode, static_cast<int>(ErrorCode::InvalidPrg));

  // A valid minimal image.
  const u8 ok[] = {0x00, 0xC0, 0xEA};
  const LoadResult good = m.loadPrg(ok, sizeof(ok));
  REQUIRE(good.ok);
  REQUIRE_EQ(good.loadAddress, 0xC000);
  REQUIRE_EQ(static_cast<long>(good.endAddressExclusive), 0xC001);
  REQUIRE_EQ(m.readMem(0xC000), 0xEA);
}

TEST(processor_port_banks_io_in_and_out) {
  Machine m;
  // Default port ($37) banks I/O in: a $D020 write reaches the VIC register.
  m.writeMem(0xD020, 0x05);
  REQUIRE_EQ(m.readMem(0xD020) & 0x0F, 0x05);
  REQUIRE_EQ(m.vic().borderColor(), 0x05);

  // Bank I/O out (CHAREN set but LORAM/HIRAM clear): $D020 becomes plain RAM.
  m.writeMem(0x0001, 0x34);
  m.writeMem(0xD020, 0xAB);
  REQUIRE_EQ(m.readMem(0xD020), 0xAB);   // reads underlying RAM now
  REQUIRE_EQ(m.vic().borderColor(), 0x05); // VIC register untouched by the RAM write
}

TEST(runframe_advances_frame_sequence) {
  Machine m;
  m.bus().loadRam(0xC000, 0x4C); // JMP $C000 (spin)
  m.bus().loadRam(0xC001, 0x00);
  m.bus().loadRam(0xC002, 0xC0);
  m.setPc(0xC000);
  REQUIRE_EQ(static_cast<long>(m.frameInfo().sequence), 0);
  m.runFrame();
  REQUIRE(m.frameInfo().sequence >= 1);
}

TEST(warm_reset_preserves_registers_and_resets_devices) {
  Machine m;
  m.cpu().a = 0x12;
  m.cpu().x = 0x34;
  m.cpu().y = 0x56;
  m.cpu().s = 0x80;
  m.writeMem(0xD400, 0xAA);       // SID register shadow (I/O banked in by default)
  m.bus().loadRam(0xFFFC, 0x00);  // reset vector -> $C000
  m.bus().loadRam(0xFFFD, 0xC0);
  m.reset(ResetKind::Warm);
  REQUIRE_EQ(m.cpu().a, 0x12);    // register file preserved
  REQUIRE_EQ(m.cpu().x, 0x34);
  REQUIRE_EQ(m.cpu().y, 0x56);
  REQUIRE_EQ(m.cpu().s, 0x7D);    // stack pointer decremented by three
  REQUIRE(m.cpu().p & flag::I);
  REQUIRE_EQ(m.readMem(0xD400), 0x00); // device latch reset
  REQUIRE_EQ(m.cpu().pc, 0xC000);
}

TEST(ddr_input_lines_bank_io_via_pullups) {
  Machine m;
  // Make the banking lines inputs (DDR bits 0-2 = 0); their pull-ups drive them high, so I/O is
  // banked in even though the port latch is all-low. Banking must use effective pins, not latch.
  m.writeMem(0x0000, 0x00); // DDR: all inputs
  m.writeMem(0x0001, 0x00); // latch low
  REQUIRE_EQ(m.readMem(0x0001) & 0x07, 0x07); // pull-ups read high
  m.writeMem(0xD020, 0x07);
  REQUIRE_EQ(m.vic().borderColor(), 0x07); // routed to the VIC because I/O is banked in
#include "c64/machine.hpp"

#include <vector>

#include "c64/rom.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

TEST(machine_configure_invalid_timing) {
  Machine m;
  MachineConfig cfg;
  cfg.timingProfile = "pal-6572";
  cfg.roms = syntheticRomSet(0xC000, 0xC100, 0xC200);
  Error e = m.configure(cfg);
  CHECK_EQ(static_cast<int>(e.code), static_cast<int>(ErrorCode::InvalidConfig));
  CHECK(!m.ready());
}

TEST(machine_configure_invalid_sid) {
  Machine m;
  MachineConfig cfg;
  cfg.sidModel = "6591";
  cfg.roms = syntheticRomSet(0xC000, 0xC100, 0xC200);
  Error e = m.configure(cfg);
  CHECK_EQ(static_cast<int>(e.code), static_cast<int>(ErrorCode::InvalidConfig));
}

TEST(machine_configure_incomplete_roms) {
  Machine m;
  MachineConfig cfg;  // default RomSet is empty
  Error e = m.configure(cfg);
  CHECK_EQ(static_cast<int>(e.code), static_cast<int>(ErrorCode::RomSetIncomplete));
}

TEST(machine_configure_rom_identity_mismatch) {
  Machine m;
  MachineConfig cfg;
  cfg.roms = syntheticRomSet(0xC000, 0xC100, 0xC200);
  cfg.roms.basic[0] ^= 0xFF;  // tamper bytes without recomputing the stored id/digests
  Error e = m.configure(cfg);
  CHECK_EQ(static_cast<int>(e.code), static_cast<int>(ErrorCode::RomMismatch));
  CHECK(!m.ready());
}

TEST(machine_configure_ok) {
  Machine m;
  boot(m);
  CHECK(m.ready());
  CHECK_EQ(m.cpuState().pc, 0xC000u);
  CHECK_STR_EQ(m.timing().name, "pal-6569");
}

TEST(machine_operations_require_ready) {
  Machine m;
  LoadResult lr = m.loadPrg({0x00, 0xC0, 0xEA});
  CHECK_EQ(static_cast<int>(lr.error.code), static_cast<int>(ErrorCode::InvalidState));
  CHECK_EQ(static_cast<int>(m.reset(ResetKind::Warm).code), static_cast<int>(ErrorCode::InvalidState));
  CHECK_EQ(static_cast<int>(m.setProgramCounter(0x1000).code),
           static_cast<int>(ErrorCode::InvalidState));
}

TEST(machine_load_prg_valid) {
  Machine m;
  boot(m);
  LoadResult lr = m.loadPrg({0x00, 0x10, 0xDE, 0xAD});
  CHECK(lr.ok);
  CHECK_EQ(lr.loadAddress, 0x1000u);
  CHECK_EQ(lr.endAddressExclusive, 0x1002u);
  CHECK_EQ(m.debugReadRam(0x1000), 0xDEu);
  CHECK_EQ(m.debugReadRam(0x1001), 0xADu);
}

TEST(machine_load_prg_errors) {
  Machine m;
  boot(m);
  CHECK_EQ(static_cast<int>(m.loadPrg({0x00, 0x10}).error.code),
           static_cast<int>(ErrorCode::InvalidPrg));  // too short
  CHECK_EQ(static_cast<int>(m.loadPrg({0xFF, 0xFF, 0x01, 0x02, 0x03}).error.code),
           static_cast<int>(ErrorCode::InvalidPrg));  // overflow past $FFFF
}

TEST(machine_run_budget) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA});  // NOP sled (2 cycles each)
  RunResult r = m.runCycles(10);
  CHECK_STR_EQ(r.stopReason.c_str(), "budget");
  CHECK_EQ(r.cyclesExecuted, 10u);
  CHECK(!r.stopped);
}

TEST(machine_breakpoint) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xEA, 0xEA, 0xEA, 0xEA});
  m.addBreakpoint(0xC002);
  RunResult r = m.runCycles(100);
  CHECK_STR_EQ(r.stopReason.c_str(), "breakpoint");
  CHECK_EQ(m.cpuState().pc, 0xC002u);
}

TEST(machine_reset_kinds) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x2000, 0x55);
  m.reset(ResetKind::Warm);
  CHECK_EQ(m.debugReadRam(0x2000), 0x55u);  // warm preserves RAM
  m.reset(ResetKind::PowerOn);
  CHECK_EQ(m.debugReadRam(0x2000), 0x00u);  // power-on pattern at $2000 is $00
}

TEST(machine_devices_implemented) {
  Machine m;
  boot(m);
  // All four devices are modelled in milestone 3.
  CHECK(m.vicStatus().implemented);
  CHECK(m.sidStatus().implemented);
  CHECK(m.cia1Status().implemented);
  CHECK(m.cia2Status().implemented);
  // Input is accepted (not "unavailable").
  InputSnapshot input;
  CHECK_EQ(static_cast<int>(m.setInput(input).code), static_cast<int>(ErrorCode::None));
  // Framebuffer and audio drain succeed and report sane metadata.
  CHECK(m.framebufferSize() > 0u);
  FrameInfo fi = m.frameInfo();
  CHECK(fi.width > 0u && fi.height > 0u);
  AudioInfo ai = m.drainAudio(nullptr, 0);
  CHECK(ai.sampleRate > 0u);
  // A malformed D64 is rejected (never mounted); mounting on a non-8 drive is unsupported.
  MediaResult bad = m.mountD64(std::vector<u8>(10, 0), 8);
  CHECK(!bad.ok);
  CHECK_EQ(static_cast<int>(bad.error.code), static_cast<int>(ErrorCode::UnsupportedGeometry));
  CHECK(!m.diskMounted());
  MediaResult wrongDrive = m.mountD64(std::vector<u8>(174848, 0), 9);
  CHECK_EQ(static_cast<int>(wrongDrive.error.code), static_cast<int>(ErrorCode::UnsupportedMedia));
}

TEST(machine_frame_sequence) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xEA, 0x4C, 0x00, 0xC0});  // NOP; JMP $C000 (tight loop)
  m.runCycles(20000);                                // > one PAL frame (19656 cycles)
  CHECK(m.totalCycles() >= 19656u);
  CHECK(m.frameSequence() >= 1u);
}
