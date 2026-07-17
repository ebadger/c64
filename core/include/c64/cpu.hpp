// NMOS 6510/6502 CPU core.
//
// Implements the documented NMOS instruction set plus the declared stable undocumented families.
// Unstable, JAM, and 65C02-only encodings stop with an IllegalOpcode result rather than guessing.
// See specs/EMULATOR.md.
#ifndef C64_CPU_HPP
#define C64_CPU_HPP

#include "c64/cpu_bus.hpp"
#include "c64/types.hpp"

namespace c64 {

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
  explicit Cpu(CpuBus& bus);

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
  void triggerSo() { soPending_ = true; }                       // falling SO edge (1541 byte ready)

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

  CpuBus& bus_;
  u16 pc_ = 0;
  u8 a_ = 0;
  u8 x_ = 0;
  u8 y_ = 0;
  u8 sp_ = 0xFD;
  u8 p_ = FlagI | FlagU;

  bool extIrq_ = false;    // external/host IRQ input
  bool devIrq_ = false;    // aggregated device IRQ input (VIC-II | CIA1), driven by the Bus
  bool nmiPending_ = false;
  bool soPending_ = false;

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
  bool documented;        // true only for the official NMOS opcode set
  bool implemented;       // documented or explicitly supported stable undocumented encoding
  u8 baseCycles;          // cycle count before page-cross/branch penalties
  bool pageCrossPenalty;  // true when an indexed read adds +1 on a page cross
};
CpuOpcodeInfo cpuOpcodeInfo(u8 opcode);

}  // namespace c64

#endif  // C64_CPU_HPP
