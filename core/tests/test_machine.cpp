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

TEST(machine_unavailable_devices) {
  Machine m;
  boot(m);
  CHECK_EQ(static_cast<int>(m.mountD64({}, 8).code), static_cast<int>(ErrorCode::Unavailable));
  CHECK_EQ(static_cast<int>(m.copyFramebuffer().code), static_cast<int>(ErrorCode::Unavailable));
  CHECK_EQ(static_cast<int>(m.drainAudio().code), static_cast<int>(ErrorCode::Unavailable));
  CHECK_EQ(static_cast<int>(m.setInput().code), static_cast<int>(ErrorCode::Unavailable));
  CHECK(!m.vicStatus().implemented);
  CHECK(!m.sidStatus().implemented);
  CHECK(!m.cia1Status().implemented);
  CHECK(!m.cia2Status().implemented);
}

TEST(machine_frame_sequence) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xEA, 0x4C, 0x00, 0xC0});  // NOP; JMP $C000 (tight loop)
  m.runCycles(20000);                                // > one PAL frame (19656 cycles)
  CHECK(m.totalCycles() >= 19656u);
  CHECK(m.frameSequence() >= 1u);
}
