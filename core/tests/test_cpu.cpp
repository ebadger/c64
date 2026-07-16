// Golden-vector unit tests for the NMOS 6510 CPU: representative opcodes across every addressing
// mode, cycle counts (including page-cross and branch penalties), flag behaviour, NMOS decimal
// ADC/SBC, stack/subroutine flow, RMW wrap-around, BRK interrupt sequencing, and the illegal-
// opcode fault. Programs are hand-assembled bytes so the expected results are computed
// independently of the src/ assembler.
#include "c64/cpu.hpp"
#include "c64/machine.hpp"
#include "test_framework.hpp"

#include <initializer_list>

using namespace c64;

namespace {

void load(Machine& m, u16 addr, std::initializer_list<u8> bytes) {
  u16 a = addr;
  for (u8 b : bytes) {
    m.bus().loadRam(a, b);
    a = static_cast<u16>(a + 1);
  }
}

} // namespace

TEST(lda_immediate_flags) {
  Machine m;
  load(m, 0xC000, {0xA9, 0x00, 0xA9, 0x80});
  m.setPc(0xC000);
  u8 cycles = m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0x00);
  REQUIRE(m.cpu().p & flag::Z);
  REQUIRE(!(m.cpu().p & flag::N));
  REQUIRE_EQ(cycles, 2);
  cycles = m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0x80);
  REQUIRE(m.cpu().p & flag::N);
  REQUIRE(!(m.cpu().p & flag::Z));
}

TEST(adc_binary_overflow_and_carry) {
  Machine m;
  load(m, 0xC000, {0x69, 0x50}); // ADC #$50
  m.cpu().a = 0x50;
  m.cpu().p = flag::U; // C clear, D clear
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0xA0);
  REQUIRE(m.cpu().p & flag::V);
  REQUIRE(m.cpu().p & flag::N);
  REQUIRE(!(m.cpu().p & flag::C));

  Machine m2;
  load(m2, 0xC000, {0x69, 0x01}); // ADC #$01
  m2.cpu().a = 0xFF;
  m2.cpu().p = flag::U;
  m2.setPc(0xC000);
  m2.cpu().step();
  REQUIRE_EQ(m2.cpu().a, 0x00);
  REQUIRE(m2.cpu().p & flag::C);
  REQUIRE(m2.cpu().p & flag::Z);
}

TEST(adc_decimal_vectors) {
  Machine m;
  load(m, 0xC000, {0x69, 0x05}); // ADC #$05
  m.cpu().a = 0x05;
  m.cpu().p = flag::U | flag::D; // decimal, C clear
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0x10); // 05 + 05 = 10 (BCD)

  Machine m2;
  load(m2, 0xC000, {0x69, 0x50}); // ADC #$50
  m2.cpu().a = 0x50;
  m2.cpu().p = flag::U | flag::D;
  m2.setPc(0xC000);
  m2.cpu().step();
  REQUIRE_EQ(m2.cpu().a, 0x00); // 50 + 50 = 100 -> 00 with carry
  REQUIRE(m2.cpu().p & flag::C);
}

TEST(sbc_binary_and_decimal) {
  Machine m; // binary with borrow-in clear (SEC)
  load(m, 0xC000, {0xE9, 0x03}); // SBC #$03
  m.cpu().a = 0x05;
  m.cpu().p = flag::U | flag::C;
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0x02);
  REQUIRE(m.cpu().p & flag::C); // no borrow

  Machine m2; // decimal 10 - 01 = 09
  load(m2, 0xC000, {0xE9, 0x01});
  m2.cpu().a = 0x10;
  m2.cpu().p = flag::U | flag::C | flag::D;
  m2.setPc(0xC000);
  m2.cpu().step();
  REQUIRE_EQ(m2.cpu().a, 0x09);
}

TEST(branch_cycles_and_pagecross) {
  Machine m; // not taken: 2 cycles
  load(m, 0xC000, {0xF0, 0x02}); // BEQ +2
  m.cpu().p = flag::U; // Z clear
  m.setPc(0xC000);
  REQUIRE_EQ(m.cpu().step(), 2);
  REQUIRE_EQ(m.cpu().pc, 0xC002);

  Machine m2; // taken, no page cross: 3 cycles
  load(m2, 0xC000, {0xF0, 0x02});
  m2.cpu().p = flag::U | flag::Z;
  m2.setPc(0xC000);
  REQUIRE_EQ(m2.cpu().step(), 3);
  REQUIRE_EQ(m2.cpu().pc, 0xC004);

  Machine m3; // taken with page cross: 4 cycles
  load(m3, 0xC0FE, {0xF0, 0x80}); // BEQ -128 from pc-after=$C100 -> $C080
  m3.cpu().p = flag::U | flag::Z;
  m3.setPc(0xC0FE);
  REQUIRE_EQ(m3.cpu().step(), 4);
  REQUIRE_EQ(m3.cpu().pc, 0xC080);
}

TEST(lda_absx_pagecross_cycle) {
  Machine m; // no cross
  load(m, 0xC000, {0xBD, 0xFF, 0x20}); // LDA $20FF,X
  m.bus().loadRam(0x20FF, 0x99);
  m.cpu().x = 0x00;
  m.setPc(0xC000);
  REQUIRE_EQ(m.cpu().step(), 4);
  REQUIRE_EQ(m.cpu().a, 0x99);

  Machine m2; // cross into $2100
  load(m2, 0xC000, {0xBD, 0xFF, 0x20});
  m2.bus().loadRam(0x2100, 0x42);
  m2.cpu().x = 0x01;
  m2.setPc(0xC000);
  REQUIRE_EQ(m2.cpu().step(), 5);
  REQUIRE_EQ(m2.cpu().a, 0x42);
}

TEST(jsr_rts_roundtrip) {
  Machine m;
  load(m, 0xC000, {0x20, 0x34, 0x12}); // JSR $1234
  load(m, 0x1234, {0x60});             // RTS
  m.cpu().s = 0xFD;
  m.setPc(0xC000);
  REQUIRE_EQ(m.cpu().step(), 6);
  REQUIRE_EQ(m.cpu().pc, 0x1234);
  REQUIRE_EQ(m.cpu().s, 0xFB);
  REQUIRE_EQ(m.cpu().step(), 6);
  REQUIRE_EQ(m.cpu().pc, 0xC003);
  REQUIRE_EQ(m.cpu().s, 0xFD);
}

TEST(stack_push_pull) {
  Machine m;
  load(m, 0xC000, {0x48, 0xA9, 0x00, 0x68}); // PHA; LDA #$00; PLA
  m.cpu().a = 0xC3;
  m.cpu().s = 0xFD;
  m.setPc(0xC000);
  m.cpu().step(); // PHA
  REQUIRE_EQ(m.cpu().s, 0xFC);
  REQUIRE_EQ(m.readMem(0x01FD), 0xC3);
  m.cpu().step(); // LDA #$00
  REQUIRE_EQ(m.cpu().a, 0x00);
  m.cpu().step(); // PLA
  REQUIRE_EQ(m.cpu().a, 0xC3);
  REQUIRE_EQ(m.cpu().s, 0xFD);
}

TEST(inc_dec_wraparound) {
  Machine m;
  load(m, 0xC000, {0xE6, 0x10, 0xC6, 0x10}); // INC $10; DEC $10
  m.bus().loadRam(0x10, 0xFF);
  m.setPc(0xC000);
  REQUIRE_EQ(m.cpu().step(), 5); // INC zp
  REQUIRE_EQ(m.readMem(0x10), 0x00);
  REQUIRE(m.cpu().p & flag::Z);
  m.cpu().step(); // DEC back to 0xFF
  REQUIRE_EQ(m.readMem(0x10), 0xFF);
  REQUIRE(m.cpu().p & flag::N);
}

TEST(shifts_and_rotates) {
  Machine m;
  load(m, 0xC000, {0x0A}); // ASL A
  m.cpu().a = 0x81;
  m.cpu().p = flag::U;
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE_EQ(m.cpu().a, 0x02);
  REQUIRE(m.cpu().p & flag::C);

  Machine m2;
  load(m2, 0xC000, {0x6A}); // ROR A with carry in
  m2.cpu().a = 0x00;
  m2.cpu().p = flag::U | flag::C;
  m2.setPc(0xC000);
  m2.cpu().step();
  REQUIRE_EQ(m2.cpu().a, 0x80);
  REQUIRE(!(m2.cpu().p & flag::C));
  REQUIRE(m2.cpu().p & flag::N);
}

TEST(cmp_and_bit) {
  Machine m;
  load(m, 0xC000, {0xC9, 0x50, 0xC9, 0x60}); // CMP #$50; CMP #$60
  m.cpu().a = 0x50;
  m.cpu().p = flag::U;
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE(m.cpu().p & flag::Z);
  REQUIRE(m.cpu().p & flag::C);
  m.cpu().step();
  REQUIRE(!(m.cpu().p & flag::C)); // 0x50 < 0x60
  REQUIRE(m.cpu().p & flag::N);

  Machine m2;
  load(m2, 0xC000, {0x24, 0x10}); // BIT $10
  m2.bus().loadRam(0x10, 0xC0);
  m2.cpu().a = 0x00;
  m2.cpu().p = flag::U;
  m2.setPc(0xC000);
  m2.cpu().step();
  REQUIRE(m2.cpu().p & flag::Z); // A & M == 0
  REQUIRE(m2.cpu().p & flag::N); // bit 7 of M
  REQUIRE(m2.cpu().p & flag::V); // bit 6 of M
}

TEST(brk_sequences_interrupt) {
  Machine m;
  load(m, 0xC000, {0x00});     // BRK
  m.bus().loadRam(0xFFFE, 0x00);
  m.bus().loadRam(0xFFFF, 0xC1); // IRQ/BRK vector -> $C100
  m.cpu().s = 0xFD;
  m.cpu().p = flag::U; // I clear
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE_EQ(m.cpu().pc, 0xC100);
  REQUIRE(m.cpu().p & flag::I);
  REQUIRE_EQ(m.cpu().s, 0xFA);
  REQUIRE_EQ(m.readMem(0x01FD), 0xC0);       // return hi (pc+2)
  REQUIRE_EQ(m.readMem(0x01FC), 0x02);       // return lo
  REQUIRE_EQ(m.readMem(0x01FB), flag::U | flag::B); // pushed status has B set
}

TEST(illegal_opcode_faults) {
  Machine m;
  load(m, 0xC000, {0x02}); // undocumented opcode
  m.setPc(0xC000);
  m.cpu().step();
  REQUIRE(m.cpu().faulted());
}

TEST(run_cycles_budget_is_exact_on_boundary) {
  Machine m;
  load(m, 0xC000, {0xEA, 0xEA, 0xEA, 0xEA, 0xEA, 0xEA}); // NOPs (2 cycles each)
  m.setPc(0xC000);
  const RunResult r = m.runCycles(10);
  REQUIRE_EQ(static_cast<long>(r.cyclesExecuted), 10);
  REQUIRE(!r.stopped);
}
