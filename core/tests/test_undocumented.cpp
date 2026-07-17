#include "c64/cpu.hpp"

#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

namespace {
bool flag(Machine& m, u8 mask) { return (m.cpuState().p & mask) != 0; }

void setRegisters(Machine& m, u8 a, u8 x, u8 y, u8 status) {
  CpuState state = m.cpuState();
  state.a = a;
  state.x = x;
  state.y = y;
  state.p = static_cast<u8>(status | FlagU);
  m.setCpuState(state);
}
}  // namespace

TEST(undocumented_pacmania_nop_zpx_54) {
  Machine m;
  boot(m);
  setRegisters(m, 0, 1, 0, 0);
  m.debugWriteRam(0x11, 0xA5);
  loadCodeAt(m, 0xC000, {0x54, 0x10});
  CHECK_EQ(stepOne(m), 4u);
  CHECK_EQ(m.cpuState().pc, 0xC002u);
  CHECK_EQ(m.debugReadRam(0x11), 0xA5u);
}

TEST(undocumented_pacmania_slo_zpx_17) {
  Machine m;
  boot(m);
  setRegisters(m, 0x10, 1, 0, 0);
  m.debugWriteRam(0x11, 0x81);
  loadCodeAt(m, 0xC000, {0x17, 0x10});
  CHECK_EQ(stepOne(m), 6u);
  CHECK_EQ(m.debugReadRam(0x11), 0x02u);
  CHECK_EQ(m.cpuState().a, 0x12u);
  CHECK(flag(m, FlagC));
}

TEST(undocumented_lax_and_sax) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x20, 0x80);
  loadCodeAt(m, 0xC000, {0xA7, 0x20, 0x87, 0x21});
  CHECK_EQ(stepOne(m), 3u);
  CHECK_EQ(m.cpuState().a, 0x80u);
  CHECK_EQ(m.cpuState().x, 0x80u);
  CHECK(flag(m, FlagN));
  CHECK_EQ(stepOne(m), 3u);
  CHECK_EQ(m.debugReadRam(0x21), 0x80u);
}

TEST(undocumented_dcp_and_isc) {
  Machine m;
  boot(m);
  setRegisters(m, 0x40, 0, 0, FlagC);
  m.debugWriteRam(0x20, 0x41);
  m.debugWriteRam(0x21, 0x0F);
  loadCodeAt(m, 0xC000, {0xC7, 0x20, 0xE7, 0x21});
  CHECK_EQ(stepOne(m), 5u);
  CHECK_EQ(m.debugReadRam(0x20), 0x40u);
  CHECK(flag(m, FlagC) && flag(m, FlagZ));
  CHECK_EQ(stepOne(m), 5u);
  CHECK_EQ(m.debugReadRam(0x21), 0x10u);
  CHECK_EQ(m.cpuState().a, 0x30u);
}

TEST(undocumented_rla_sre_and_rra) {
  Machine m;
  boot(m);
  setRegisters(m, 0x03, 0, 0, FlagC);
  m.debugWriteRam(0x20, 0x80);
  m.debugWriteRam(0x21, 0x03);
  m.debugWriteRam(0x22, 0x01);
  loadCodeAt(m, 0xC000, {0x27, 0x20, 0x47, 0x21, 0x67, 0x22});

  CHECK_EQ(stepOne(m), 5u);
  CHECK_EQ(m.debugReadRam(0x20), 0x01u);
  CHECK_EQ(m.cpuState().a, 0x01u);
  CHECK(flag(m, FlagC));

  CHECK_EQ(stepOne(m), 5u);
  CHECK_EQ(m.debugReadRam(0x21), 0x01u);
  CHECK_EQ(m.cpuState().a, 0x00u);
  CHECK(flag(m, FlagC) && flag(m, FlagZ));

  CHECK_EQ(stepOne(m), 5u);
  CHECK_EQ(m.debugReadRam(0x22), 0x80u);
  CHECK_EQ(m.cpuState().a, 0x81u);
  CHECK(!flag(m, FlagC));
  CHECK(flag(m, FlagN));
}

TEST(undocumented_sbc_immediate_alias_eb) {
  Machine m;
  boot(m);
  setRegisters(m, 0x50, 0, 0, FlagC);
  loadCodeAt(m, 0xC000, {0xEB, 0x10});
  CHECK_EQ(stepOne(m), 2u);
  CHECK_EQ(m.cpuState().a, 0x40u);
  CHECK(flag(m, FlagC));
}

TEST(undocumented_unstable_and_jam_encodings_fault) {
  for (u8 opcode : {static_cast<u8>(0x02), static_cast<u8>(0x0B),
                    static_cast<u8>(0x8B), static_cast<u8>(0x9F)}) {
    Machine m;
    boot(m);
    loadCodeAt(m, 0xC000, {opcode});
    RunResult result = m.runCycles(10);
    CHECK_STR_EQ(result.stopReason.c_str(), "fault");
    CHECK_EQ(m.cpuState().pc, 0xC000u);
  }
}
