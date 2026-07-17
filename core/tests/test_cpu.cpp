#include "c64/cpu.hpp"

#include <array>

#include "c64/cpu_bus.hpp"
#include "c64/machine.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

namespace {
bool flag(Machine& m, u8 mask) { return (m.cpuState().p & mask) != 0; }

class SoTestBus final : public CpuBus {
 public:
  u8 readCycle(u16 addr) override {
    if (triggerOnRead) {
      triggerOnRead = false;
      cpu->triggerSo();
      cpu->triggerSo();
    }
    return bytes[addr];
  }
  void writeCycle(u16 addr, u8 value) override { bytes[addr] = value; }
  u8 peek(u16 addr) const override { return bytes[addr]; }

  std::array<u8, 65536> bytes{};
  Cpu* cpu = nullptr;
  bool triggerOnRead = false;
};
}  // namespace

TEST(cpu_reset_vector) {
  Machine m;
  boot(m);
  CHECK_EQ(m.cpuState().pc, 0xC000u);
  CHECK_EQ(m.cpuState().sp, 0xFDu);
  CHECK(flag(m, FlagI));
  CHECK(flag(m, FlagU));
}

TEST(cpu_so_edge_latches_until_next_instruction_boundary) {
  SoTestBus bus;
  Cpu cpu(bus);
  bus.cpu = &cpu;
  bus.bytes[0x1000] = 0xEA;
  bus.bytes[0x1001] = 0xEA;
  CpuState state;
  state.pc = 0x1000;
  state.p = FlagU;
  cpu.setState(state);

  bus.triggerOnRead = true;
  cpu.step();
  CHECK(!(cpu.state().p & FlagV));
  cpu.step();
  CHECK(cpu.state().p & FlagV);
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
