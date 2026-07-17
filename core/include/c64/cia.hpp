// MOS 6526 CIA (Complex Interface Adapter).
//
// Two instances exist in a C64: CIA1 ($DC00) whose IRQ output drives the CPU IRQ line, and CIA2
// ($DD00) whose IRQ output drives the CPU NMI line. CIA1 resolves the keyboard matrix and both
// joysticks; CIA2 selects the VIC-II 16 KB bank and exposes the IEC-facing port lines. Both model
// 16-bit timers A/B (one-shot/continuous, chaining, PB6/PB7 output), the interrupt control
// register (mask/latch/read-to-clear), and a BCD time-of-day clock with alarm driven by the
// machine's 50/60 Hz frame source (never host wall-clock). See specs/IO.md.
#ifndef C64_CIA_HPP
#define C64_CIA_HPP

#include <array>

#include "c64/device.hpp"  // DeviceStatus
#include "c64/io_types.hpp"
#include "c64/types.hpp"

namespace c64 {

class Cia {
 public:
  enum class Variant : u8 { Cia1, Cia2 };

  explicit Cia(Variant variant);

  // Provide the timing profile's cycles-per-frame so the TOD clock advances from the 50/60 Hz
  // frame source deterministically. Called by the machine on configure.
  void configure(u32 cyclesPerFrame);

  void reset();

  // Advance the CIA by exactly one CPU cycle: timers, PB outputs, TOD, and the IRQ output.
  void tickCycle();

  // Register access. reg is the low 4 bits of the address (registers mirror every 16 bytes).
  // read() with sideEffects=true performs read side effects (ICR clear, TOD latch); false is a
  // debugger peek.
  u8 read(u8 reg, bool sideEffects);
  void write(u8 reg, u8 value);

  // Aggregated interrupt output (ICR bit7 latched). CIA1 -> IRQ, CIA2 -> NMI.
  bool irqAsserted() const { return (intData_ & mask_ & 0x1F) != 0; }

  // CIA1 host input.
  void setKeyboard(const std::array<u8, 8>& columns) { keyboard_ = columns; }
  void setJoysticks(u8 joy1, u8 joy2) { joy1_ = joy1; joy2_ = joy2; }

  // External active-low port-A pins. CIA2 uses bits 6/7 for IEC CLOCK/DATA input; all other
  // callers leave the default pull-up mask ($FF).
  void setPortAInputs(u8 pins) { portAInputs_ = pins; }
  u8 portAOutputLatch() const { return pra_; }
  u8 portADirection() const { return ddra_; }

  // CIA2: selected VIC-II 16 KB bank (0..3) derived from port A bits 0..1.
  u8 vicBank() const;

  DeviceStatus status() const;

 private:
  u8 portAPins() const;  // effective port A pin state (outputs + pull-ups + external inputs)
  u8 portBPins() const;  // effective port B pin state
  void tickTimers();
  void tickTod();
  void reloadTimerA() { counterA_ = latchA_; }
  void reloadTimerB() { counterB_ = latchB_; }
  void setInterrupt(u8 bit);  // set an ICR data bit
  static u8 bcdInc(u8 value, u8 max);

  Variant variant_;
  u32 cyclesPerFrame_ = 19656;

  // Ports.
  u8 pra_ = 0, prb_ = 0, ddra_ = 0, ddrb_ = 0;
  u8 pb6Out_ = 0, pb7Out_ = 0;      // latched timer output levels (toggle mode)
  bool pb6Pulse_ = false, pb7Pulse_ = false;  // one-cycle high pulse (pulse mode)

  // Timers.
  u16 counterA_ = 0, latchA_ = 0xFFFF;
  u16 counterB_ = 0, latchB_ = 0xFFFF;
  u8 cra_ = 0, crb_ = 0;

  // Interrupt control register.
  u8 intData_ = 0;  // pending sources (bit0 TA, bit1 TB, bit2 alarm, bit3 SDR, bit4 FLAG)
  u8 mask_ = 0;

  // Serial data register (limited support; see status).
  u8 sdr_ = 0;

  // Time of day (BCD). Latched snapshot returned while reading between hr and 10ths.
  u8 todTenth_ = 0, todSec_ = 0, todMin_ = 0, todHr_ = 1;
  u8 almTenth_ = 0, almSec_ = 0, almMin_ = 0, almHr_ = 0;
  u8 latchTenth_ = 0, latchSec_ = 0, latchMin_ = 0, latchHr_ = 1;
  bool todLatched_ = false;
  bool todHalted_ = true;  // TOD stopped after a write to the hours register until 10ths written
  u64 todCycleAccum_ = 0;

  // CIA1 host input state (active-low).
  std::array<u8, 8> keyboard_{{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}};
  u8 joy1_ = 0xFF;
  u8 joy2_ = 0xFF;
  u8 portAInputs_ = 0xFF;
};

}  // namespace c64

#endif  // C64_CIA_HPP
