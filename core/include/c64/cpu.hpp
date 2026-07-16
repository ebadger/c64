// Deterministic NMOS 6510/6502 CPU core. Implements the documented opcode set only (no 65C02
// instructions, no undocumented opcodes), with cycle counts, page-crossing and branch timing,
// read-modify-write bus cycles, NMOS decimal-mode ADC/SBC, and BRK/IRQ/NMI/RESET sequencing.
// The 6510 on-chip port lives on the Bus at $0000/$0001. See specs/EMULATOR.md "CPU and bus
// rules". No wall-clock time is read here.
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

  // Power-on/warm reset sequence: I set, S decremented to $FD, PC loaded from the $FFFC vector.
  void reset();

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
