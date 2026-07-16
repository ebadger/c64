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
#include "c64/cpu.hpp"

#include "c64/machine.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

namespace {
bool flag(Machine& m, u8 mask) { return (m.cpuState().p & mask) != 0; }
}  // namespace

TEST(cpu_reset_vector) {
  Machine m;
  boot(m);
  CHECK_EQ(m.cpuState().pc, 0xC000u);
  CHECK_EQ(m.cpuState().sp, 0xFDu);
  CHECK(flag(m, FlagI));
  CHECK(flag(m, FlagU));
}

TEST(cpu_lda_flags) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0x00, 0xA9, 0x80, 0xA9, 0x42});
  stepOne(m);
  CHECK(flag(m, FlagZ));
  CHECK(!flag(m, FlagN));
  stepOne(m);
  CHECK(flag(m, FlagN));
  CHECK(!flag(m, FlagZ));
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x42u);
  CHECK(!flag(m, FlagN) && !flag(m, FlagZ));
}

TEST(cpu_store_absolute) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0x42, 0x8D, 0x00, 0x04});  // LDA #$42; STA $0400
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.debugReadRam(0x0400), 0x42u);
}

TEST(cpu_adc_overflow_and_carry) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x18, 0xA9, 0x50, 0x69, 0x50});  // CLC; LDA #$50; ADC #$50
  stepOne(m);
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0xA0u);
  CHECK(flag(m, FlagV));
  CHECK(flag(m, FlagN));
  CHECK(!flag(m, FlagC));

  boot(m);
  loadCodeAt(m, 0xC000, {0x18, 0xA9, 0xFF, 0x69, 0x01});  // CLC; LDA #$FF; ADC #$01
  stepOne(m);
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x00u);
  CHECK(flag(m, FlagC));
  CHECK(flag(m, FlagZ));
}

TEST(cpu_sbc_binary) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x38, 0xA9, 0x50, 0xE9, 0x10});  // SEC; LDA #$50; SBC #$10
  stepOne(m);
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x40u);
  CHECK(flag(m, FlagC));

  boot(m);
  loadCodeAt(m, 0xC000, {0x38, 0xA9, 0x00, 0xE9, 0x01});  // SEC; LDA #$00; SBC #$01
  stepOne(m);
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0xFFu);
  CHECK(!flag(m, FlagC));  // borrow
  CHECK(flag(m, FlagN));
}

TEST(cpu_compare) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0x40, 0xC9, 0x40, 0xC9, 0x50, 0xC9, 0x30});
  stepOne(m);
  stepOne(m);  // CMP #$40
  CHECK(flag(m, FlagZ) && flag(m, FlagC));
  stepOne(m);  // CMP #$50
  CHECK(!flag(m, FlagC) && flag(m, FlagN));
  stepOne(m);  // CMP #$30
  CHECK(flag(m, FlagC) && !flag(m, FlagZ));
}

TEST(cpu_logic) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0xF0, 0x29, 0x0F, 0x09, 0x30, 0x49, 0xFF});
  stepOne(m);  // LDA #$F0
  stepOne(m);  // AND #$0F -> 0
  CHECK_EQ(m.cpuState().a, 0x00u);
  CHECK(flag(m, FlagZ));
  stepOne(m);  // ORA #$30 -> 0x30
  CHECK_EQ(m.cpuState().a, 0x30u);
  stepOne(m);  // EOR #$FF -> 0xCF
  CHECK_EQ(m.cpuState().a, 0xCFu);
}

TEST(cpu_bit) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x10, 0xC0);  // bits 7,6 set
  loadCodeAt(m, 0xC000, {0xA9, 0x01, 0x24, 0x10});  // LDA #$01; BIT $10
  stepOne(m);
  stepOne(m);
  CHECK(flag(m, FlagN));
  CHECK(flag(m, FlagV));
  CHECK(flag(m, FlagZ));  // A & M == 0
}

TEST(cpu_inc_dec_wrap) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x10, 0xFF);
  m.debugWriteRam(0x11, 0x00);
  loadCodeAt(m, 0xC000, {0xE6, 0x10, 0xC6, 0x11});  // INC $10; DEC $11
  stepOne(m);
  CHECK_EQ(m.debugReadRam(0x10), 0x00u);
  CHECK(flag(m, FlagZ));
  stepOne(m);
  CHECK_EQ(m.debugReadRam(0x11), 0xFFu);
  CHECK(flag(m, FlagN));
}

TEST(cpu_shifts) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0x81, 0x0A, 0xA9, 0x01, 0x4A});
  stepOne(m);  // LDA #$81
  stepOne(m);  // ASL A -> 0x02, C=1
  CHECK_EQ(m.cpuState().a, 0x02u);
  CHECK(flag(m, FlagC));
  stepOne(m);  // LDA #$01
  stepOne(m);  // LSR A -> 0x00, C=1, Z=1
  CHECK_EQ(m.cpuState().a, 0x00u);
  CHECK(flag(m, FlagC));
  CHECK(flag(m, FlagZ));
}

TEST(cpu_rol_ror_through_carry) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x38, 0xA9, 0x80, 0x2A});  // SEC; LDA #$80; ROL A
  stepOne(m);
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x01u);  // (0x80<<1)|carry
  CHECK(flag(m, FlagC));
}

TEST(cpu_branch_cycles) {
  Machine m;
  boot(m);
  // BEQ not taken (Z=0): 2 cycles.
  loadCodeAt(m, 0xC000, {0xA9, 0x01, 0xF0, 0x10});  // LDA #$01; BEQ +16
  stepOne(m);
  CHECK_EQ(stepOne(m), 2u);

  // BEQ taken, same page: 3 cycles.
  boot(m);
  loadCodeAt(m, 0xC000, {0xA9, 0x00, 0xF0, 0x10});  // LDA #$00; BEQ +16
  stepOne(m);
  CHECK_EQ(stepOne(m), 3u);

  // BEQ taken, page cross: 4 cycles. Place branch at $C0F0 so target crosses page.
  boot(m);
  m.debugWriteRam(0xC0F0, 0xF0);  // BEQ
  m.debugWriteRam(0xC0F1, 0x30);  // +48 -> crosses into $C1xx
  CpuState s = m.cpuState();
  s.pc = 0xC0F0;
  s.p |= FlagZ;  // ensure Z set so branch is taken
  m.setCpuState(s);
  CHECK_EQ(stepOne(m), 4u);
}

TEST(cpu_jmp_indirect_page_bug) {
  Machine m;
  boot(m);
  // Pointer at $30FF/$3000 (bug: high byte read from $3000, not $3100).
  m.debugWriteRam(0x30FF, 0x34);
  m.debugWriteRam(0x3000, 0x12);
  m.debugWriteRam(0x3100, 0xFF);  // would be used if not buggy
  loadCodeAt(m, 0xC000, {0x6C, 0xFF, 0x30});  // JMP ($30FF)
  stepOne(m);
  CHECK_EQ(m.cpuState().pc, 0x1234u);
}

TEST(cpu_jsr_rts) {
  Machine m;
  boot(m);
  // JSR $C010; at $C010 place RTS.
  loadCodeAt(m, 0xC000, {0x20, 0x10, 0xC0});
  m.debugWriteRam(0xC010, 0x60);  // RTS
  stepOne(m);                     // JSR
  CHECK_EQ(m.cpuState().pc, 0xC010u);
  stepOne(m);                     // RTS
  CHECK_EQ(m.cpuState().pc, 0xC003u);  // returns after the JSR operand
}

TEST(cpu_stack_php_plp) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x38, 0x08, 0x18, 0x28});  // SEC; PHP; CLC; PLP
  stepOne(m);  // SEC
  stepOne(m);  // PHP
  stepOne(m);  // CLC (carry now 0)
  CHECK(!flag(m, FlagC));
  stepOne(m);  // PLP restores carry
  CHECK(flag(m, FlagC));
}

TEST(cpu_zeropage_x_wraps) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x02, 0x5A);  // $02 (avoid the $00/$01 processor-port shadow)
  loadCodeAt(m, 0xC000, {0xA2, 0x03, 0xB5, 0xFF});  // LDX #$03; LDA $FF,X -> $02
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x5Au);
}

TEST(cpu_indexed_indirect_izx) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x24, 0x00);
  m.debugWriteRam(0x25, 0x40);  // pointer -> $4000
  m.debugWriteRam(0x4000, 0x7E);
  loadCodeAt(m, 0xC000, {0xA2, 0x04, 0xA1, 0x20});  // LDX #$04; LDA ($20,X) -> ($24) -> $4000
  stepOne(m);
  stepOne(m);
  CHECK_EQ(m.cpuState().a, 0x7Eu);
}

TEST(cpu_indirect_indexed_izy_page_cross) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x20, 0xFF);
  m.debugWriteRam(0x21, 0x40);  // base $40FF
  m.debugWriteRam(0x4100, 0x99);
  loadCodeAt(m, 0xC000, {0xA0, 0x01, 0xB1, 0x20});  // LDY #$01; LDA ($20),Y -> $4100
  stepOne(m);
  CHECK_EQ(stepOne(m), 6u);  // 5 base + 1 page cross
  CHECK_EQ(m.cpuState().a, 0x99u);
}

TEST(cpu_abs_x_page_cross_cycles) {
  Machine m;
  boot(m);
  m.debugWriteRam(0x2010, 0x11);
  m.debugWriteRam(0x2100, 0x22);
  loadCodeAt(m, 0xC000, {0xA2, 0x10, 0xBD, 0x00, 0x20, 0xA2, 0x10, 0xBD, 0xF0, 0x20});
  stepOne(m);              // LDX #$10
  CHECK_EQ(stepOne(m), 4u);  // LDA $2000,X -> $2010 (no cross)
  stepOne(m);              // LDX #$10
  CHECK_EQ(stepOne(m), 5u);  // LDA $20F0,X -> $2100 (cross)
}

TEST(cpu_rmw_cycles) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0xEE, 0x00, 0x20, 0xA2, 0x01, 0xFE, 0x00, 0x20});
  CHECK_EQ(stepOne(m), 6u);  // INC $2000 (abs) = 6
  stepOne(m);                // LDX #$01
  CHECK_EQ(stepOne(m), 7u);  // INC $2000,X (abs,X) = 7
}

TEST(cpu_brk_and_rti) {
  Machine m;
  boot(m);
  // IRQ/BRK vector is $C100 (from boot). Handler: RTI.
  m.debugWriteRam(0xC100, 0x40);  // RTI
  loadCodeAt(m, 0xC000, {0x00, 0xEA, 0xEA});  // BRK; NOP; NOP
  RunResult brk = m.runCycles(1);
  CHECK_STR_EQ(brk.stopReason.c_str(), "brk");
  CHECK_EQ(m.cpuState().pc, 0xC100u);  // jumped to handler
  CHECK(flag(m, FlagI));
  // Pushed status on stack has B set.
  stepOne(m);  // RTI
  CHECK_EQ(m.cpuState().pc, 0xC002u);  // BRK pushes PC+2
}

TEST(cpu_irq_line) {
  Machine m;
  boot(m);
  m.debugWriteRam(0xC100, 0x40);              // IRQ handler: RTI
  loadCodeAt(m, 0xC000, {0x58, 0xEA, 0xEA});  // CLI; NOP; NOP
  stepOne(m);                                 // CLI clears I
  CHECK(!flag(m, FlagI));
  m.setIrqLine(true);
  // NMOS CLI delay: the instruction immediately following CLI still runs before a pending IRQ
  // is taken. So the first step executes the NOP, and only the next step services the IRQ.
  CHECK_EQ(stepOne(m), 2u);                   // the delayed NOP runs first
  CHECK_EQ(m.cpuState().pc, 0xC002u);
  RunResult r = m.runCycles(1);
  CHECK_EQ(r.cyclesExecuted, 7u);
  CHECK_EQ(m.cpuState().pc, 0xC100u);
  CHECK(flag(m, FlagI));  // I set on entry
}

TEST(cpu_cli_sei_interrupt_delay) {
  // NMOS one-instruction interrupt-enable delay for CLI (and symmetrically SEI/PLP): a pending
  // IRQ raised while I is set is not serviced until AFTER the instruction that follows CLI.
  Machine m;
  boot(m);
  m.debugWriteRam(0xC100, 0x40);  // IRQ handler: RTI
  // SEI; CLI; NOP; NOP  — IRQ is asserted before CLI executes.
  loadCodeAt(m, 0xC000, {0x78, 0x58, 0xEA, 0xEA});
  stepOne(m);            // SEI (I=1)
  m.setIrqLine(true);    // IRQ pending while masked
  stepOne(m);            // CLI (clears I, but effect delayed one instruction)
  CHECK(!flag(m, FlagI));
  CHECK_EQ(m.cpuState().pc, 0xC002u);  // no IRQ yet: PC advanced past CLI
  stepOne(m);                          // the delayed instruction (first NOP) runs
  CHECK_EQ(m.cpuState().pc, 0xC003u);
  RunResult r = m.runCycles(1);        // now the IRQ is serviced
  CHECK_EQ(r.cyclesExecuted, 7u);
  CHECK_EQ(m.cpuState().pc, 0xC100u);
}

TEST(cpu_irq_masked_when_i_set) {
  Machine m;
  boot(m);
  m.debugWriteRam(0xC100, 0x40);
  loadCodeAt(m, 0xC000, {0x78, 0xEA});  // SEI; NOP
  stepOne(m);                           // SEI
  m.setIrqLine(true);
  stepOne(m);                           // should execute NOP, not the IRQ
  CHECK_EQ(m.cpuState().pc, 0xC002u);
}

TEST(cpu_nmi_edge) {
  Machine m;
  boot(m);
  m.debugWriteRam(0xC200, 0x40);        // NMI handler: RTI
  loadCodeAt(m, 0xC000, {0x78, 0xEA});  // SEI; NOP (NMI ignores I)
  stepOne(m);                           // SEI
  m.triggerNmi();
  RunResult r = m.runCycles(1);
  CHECK_EQ(r.cyclesExecuted, 7u);
  CHECK_EQ(m.cpuState().pc, 0xC200u);  // NMI serviced despite I set
}

TEST(cpu_illegal_opcode_faults) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x02});  // undocumented opcode
  RunResult r = m.runCycles(10);
  CHECK_STR_EQ(r.stopReason.c_str(), "fault");
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::InternalFault));
  CHECK_EQ(m.cpuState().pc, 0xC000u);  // pc not advanced past the bad opcode
}

TEST(cpu_flag_ops) {
  Machine m;
  boot(m);
  loadCodeAt(m, 0xC000, {0x38, 0xF8, 0x78, 0x18, 0xD8, 0x58, 0xB8});
  stepOne(m);
  CHECK(flag(m, FlagC));
  stepOne(m);
  CHECK(flag(m, FlagD));
  stepOne(m);
  CHECK(flag(m, FlagI));
  stepOne(m);
  CHECK(!flag(m, FlagC));
  stepOne(m);
  CHECK(!flag(m, FlagD));
  stepOne(m);
  CHECK(!flag(m, FlagI));
}
