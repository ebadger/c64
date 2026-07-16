// Deterministic NMOS 6510/6502 CPU core. Implements the documented opcode set only (no 65C02
// instructions, no undocumented opcodes), with cycle counts, page-crossing and branch timing,
// read-modify-write bus cycles, NMOS decimal-mode ADC/SBC, and BRK/IRQ/NMI/RESET sequencing.
// The 6510 on-chip port lives on the Bus at $0000/$0001. See specs/EMULATOR.md "CPU and bus
// rules". No wall-clock time is read here.
// NMOS 6510/6502 CPU core.
//
// Implements the complete documented NMOS instruction set and addressing modes. 65C02-only
// instructions and undocumented ("illegal") opcodes are not implemented: executing one stops
// with an IllegalOpcode result rather than guessing. Cycle accounting is exact at instruction
// granularity — the documented per-opcode cycle counts plus dynamic page-cross and branch
// penalties — and read-modify-write instructions perform the hardware double write. Decimal
// ADC/SBC follow documented NMOS flag behaviour. See specs/EMULATOR.md.
#ifndef C64_CPU_HPP
#define C64_CPU_HPP

#include "c64/bus.hpp"
#include "c64/types.hpp"

namespace c64 {

// Processor status flag bit masks.
namespace flag {
constexpr u8 C = 0x01; // carry
constexpr u8 Z = 0x02; // zero
constexpr u8 I = 0x04; // interrupt disable
constexpr u8 D = 0x08; // decimal
constexpr u8 B = 0x10; // break (only meaningful in pushed copies)
constexpr u8 U = 0x20; // unused, always reads as 1
constexpr u8 V = 0x40; // overflow
constexpr u8 N = 0x80; // negative
} // namespace flag

class Cpu {
public:
  explicit Cpu(Bus& bus) : bus_(bus) {}

  // Power-on/warm reset sequence. Power-on installs a clean known state (A/X/Y=0, S=$FD).
  // A warm reset preserves A/X/Y and, like the real reset micro-sequence, decrements the stack
  // pointer by three; both set the interrupt-disable flag and load PC from the $FFFC vector.
  void reset(ResetKind kind = ResetKind::PowerOn);

  // Execute exactly one instruction. Returns the number of CPU cycles it consumed. On an
  // unsupported (undocumented) opcode the CPU sets the fault flag and consumes the fetch cycle
  // so the caller can stop; it never throws.
  u8 step();

  // Deliver a maskable IRQ. Honoured only when the I flag is clear; consumes 7 cycles when
  // taken and returns the cycles consumed (0 when masked).
  u8 irq();

  // Deliver a non-maskable interrupt (edge semantics are the caller's responsibility). Always
  // taken; returns cycles consumed.
  u8 nmi();

  bool faulted() const { return faulted_; }
  void clearFault() { faulted_ = false; }

  // Registers are public so golden-vector tests can assert exact post-conditions.
  u8 a = 0;
  u8 x = 0;
  u8 y = 0;
  u8 s = 0xFD;
  u8 p = flag::U | flag::I;
  u16 pc = 0;

  void setPc(u16 value) { pc = value; }

private:
  // Fetch helpers advance PC.
  u8 fetch8() { return bus_.read8(pc++); }
  u16 fetch16() {
    const u16 lo = fetch8();
    const u16 hi = fetch8();
    return static_cast<u16>(lo | (hi << 8));
  }

  // Stack operations live in page 1.
  void push8(u8 v) { bus_.write8(static_cast<u16>(0x0100 | s--), v); }
  u8 pull8() { return bus_.read8(static_cast<u16>(0x0100 | ++s)); }
  void push16(u16 v) {
    push8(static_cast<u8>(v >> 8));
    push8(static_cast<u8>(v & 0xFF));
  }
  u16 pull16() {
    const u16 lo = pull8();
    const u16 hi = pull8();
    return static_cast<u16>(lo | (hi << 8));
  }

  void setZN(u8 value) {
    p = static_cast<u8>((p & ~(flag::Z | flag::N)) | (value == 0 ? flag::Z : 0) | (value & flag::N));
  }
  void setFlag(u8 mask, bool on) { p = static_cast<u8>(on ? (p | mask) : (p & ~mask)); }
  bool getFlag(u8 mask) const { return (p & mask) != 0; }

  // Core ALU operations shared across addressing modes.
  void doADC(u8 value);
  void doSBC(u8 value);
  void doCompare(u8 reg, u8 value);
  u8 doASL(u8 value);
  u8 doLSR(u8 value);
  u8 doROL(u8 value);
  u8 doROR(u8 value);
  void doBranch(bool take, u8& cycles);
  void serviceInterrupt(u16 vector, bool fromBrk);

  Bus& bus_;
  bool faulted_ = false;
};

} // namespace c64

#endif // C64_CPU_HPP
// Status register bit masks.
enum StatusFlag : u8 {
  FlagC = 0x01,
  FlagZ = 0x02,
  FlagI = 0x04,
  FlagD = 0x08,
  FlagB = 0x10,
  FlagU = 0x20,  // unused, always reads 1
  FlagV = 0x40,
  FlagN = 0x80,
};

struct CpuState {
  u16 pc = 0;
  u8 a = 0;
  u8 x = 0;
  u8 y = 0;
  u8 sp = 0xFD;
  u8 p = FlagI | FlagU;
};

enum class StepStop : u8 { None, Brk, IllegalOpcode };

struct StepResult {
  u32 cycles = 0;
  StepStop stop = StepStop::None;
  u8 opcode = 0;
  u16 pc = 0;  // address of the instruction associated with a stop
};

class Cpu {
 public:
  explicit Cpu(Bus& bus);

  // Power-on: clear registers, then perform the reset sequence. Used for a cold machine.
  void powerOn();
  // Warm reset: restore SP/status and jump through the reset vector ($FFFC), preserving the
  // A/X/Y registers as hardware does. Does not consume runCycles budget.
  void reset();

  // Execute exactly one instruction (servicing a pending NMI/IRQ first when due). Returns the
  // cycles consumed and any stop condition (BRK or illegal opcode). Each bus access ticks the
  // clocked devices by one cycle through the Bus, so devices advance in lock-step with the CPU.
  StepResult step();

  // Interrupt lines. The IRQ line is level-sensitive; NMI is edge-triggered.
  //
  // There are two independent IRQ inputs OR-ed together: an external line (test/host hook) and a
  // device line driven by the Bus each cycle from the VIC-II and CIA1 outputs. Keeping them
  // separate lets host-driven and device-driven interrupts coexist without clobbering each other.
  void setIrqLine(bool asserted) { extIrq_ = asserted; }        // external/host IRQ input
  void setDeviceIrq(bool asserted) { devIrq_ = asserted; }      // aggregated device IRQ (Bus)
  void triggerNmi() { nmiPending_ = true; }                     // edge input (CIA2/RESTORE/host)

  // Number of bus (read/write) cycles the most recent step() performed. The enclosing machine
  // uses this to tick the remaining internal (non-bus) cycles of the instruction so the device
  // clock advances exactly once per consumed CPU cycle.
  u32 busCycles() const { return busCycles_; }

  CpuState state() const;
  void setState(const CpuState& s);

  u16 pc() const { return pc_; }
  u8 a() const { return a_; }
  u8 x() const { return x_; }
  u8 y() const { return y_; }
  u8 sp() const { return sp_; }
  u8 status() const { return static_cast<u8>(p_ | FlagU); }

 private:
  // Bus helpers. Each read/write is one CPU cycle: it ticks the clocked devices through the Bus
  // and counts toward busCycles_. readCycle() may stall (BA/AEC) when the VIC steals the bus.
  u8 read(u16 addr) { ++busCycles_; return bus_.readCycle(addr); }
  void write(u16 addr, u8 value) { ++busCycles_; bus_.writeCycle(addr, value); }
  u8 fetch() { return read(pc_++); }
  u16 read16(u16 addr);
  // Read a vector without ticking devices (used only by reset, which resets device clocks).
  u16 peekVector(u16 addr);

  void push(u8 v);
  u8 pull();

  void setFlag(u8 mask, bool on) {
    if (on) {
      p_ = static_cast<u8>(p_ | mask);
    } else {
      p_ = static_cast<u8>(p_ & ~mask);
    }
  }
  void setZN(u8 v);
  void branch(bool take, i8 offset, u32& cycles);
  void serviceInterrupt(u16 vectorAddress, bool fromBrk);

  // ALU
  void adc(u8 value);
  void sbc(u8 value);
  void compare(u8 reg, u8 value);

  Bus& bus_;
  u16 pc_ = 0;
  u8 a_ = 0;
  u8 x_ = 0;
  u8 y_ = 0;
  u8 sp_ = 0xFD;
  u8 p_ = FlagI | FlagU;

  bool extIrq_ = false;    // external/host IRQ input
  bool devIrq_ = false;    // aggregated device IRQ input (VIC-II | CIA1), driven by the Bus
  bool nmiPending_ = false;

  // NMOS interrupt-enable delay: CLI/SEI/PLP update the I flag, but the interrupt poll for the
  // single following instruction still uses the pre-update value. This defers the effect of
  // enabling/disabling IRQs by one instruction, matching NMOS 6502/6510 hardware.
  bool iPollDelay_ = false;
  bool iPollValue_ = false;

  u32 busCycles_ = 0;  // read/write cycles performed by the most recent step()

  bool irqAsserted() const { return extIrq_ || devIrq_; }
};

// Decode metadata for one opcode byte, for exhaustive table tests.
struct CpuOpcodeInfo {
  bool documented;      // false for undocumented/65C02 opcodes (not implemented)
  u8 baseCycles;        // documented cycle count before page-cross/branch penalties
  bool pageCrossPenalty;  // true when an indexed read adds +1 on a page cross
};
CpuOpcodeInfo cpuOpcodeInfo(u8 opcode);

}  // namespace c64

#endif  // C64_CPU_HPP
