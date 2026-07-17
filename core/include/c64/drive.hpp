// Deterministic digital Commodore 1541 model for immutable D64 media.
#ifndef C64_DRIVE_HPP
#define C64_DRIVE_HPP

#include <array>
#include <vector>

#include "c64/cpu.hpp"
#include "c64/cpu_bus.hpp"
#include "c64/iec.hpp"
#include "c64/media.hpp"
#include "c64/timing.hpp"
#include "c64/types.hpp"
#include "c64/via6522.hpp"

namespace c64 {

class DriveBus final : public CpuBus {
 public:
  explicit DriveBus(IecBus& iec);

  void attachCpu(Cpu* cpu) { cpu_ = cpu; }
  void setRom(const std::vector<u8>& rom) { rom_ = rom; }
  void mount(const Disk& disk);
  void unmount();
  void reset();

  u8 readCycle(u16 addr) override;
  void writeCycle(u16 addr, u8 value) override;
  u8 peek(u16 addr) const override;
  void idleCycles(u32 count);

  u64 cycleCount() const { return cycles_; }
  u8 headTrack() const;
  bool motorOn() const { return (via2_.portBOutputLatch() & 0x04) != 0; }
  u8 ram(u16 addr) const { return ram_[addr & 0x07FF]; }
  u8 via1PortB() const { return via1_.read(0); }
  u8 via1PortBOutput() const { return via1_.portBOutputLatch(); }
  u8 via1PortBDirection() const { return via1_.portBDirection(); }
  u8 via2PortB() const { return via2_.read(0); }

 private:
  void tickCycle();
  u8 read(u16 addr, bool sideEffects) const;
  void write(u16 addr, u8 value);
  void updateViaInputs();
  void updateStepper(u8 oldPortB, u8 newPortB);
  u32 bytePeriod() const;

  IecBus& iec_;
  Cpu* cpu_ = nullptr;
  std::array<u8, 2048> ram_{};
  std::vector<u8> rom_;
  Via6522 via1_;
  Via6522 via2_;
  GcrDisk disk_;
  bool mounted_ = false;
  i32 headHalfTrack_ = 34;  // track 18
  u8 stepPhase_ = 0;
  u32 rotationCycle_ = 0;
  u32 byteIndex_ = 0;
  bool byteReady_ = false;
  u64 cycles_ = 0;
};

class Drive1541 {
 public:
  explicit Drive1541(IecBus& iec);

  void configure(const std::vector<u8>& rom, const TimingProfile& c64Timing);
  void mount(const Disk& disk) { bus_.mount(disk); }
  void unmount() { bus_.unmount(); }
  void reset();
  void tickC64Cycle();

  bool configured() const { return configured_; }
  bool faulted() const { return faulted_; }
  CpuState cpuState() const { return cpu_.state(); }
  u64 cycleCount() const { return bus_.cycleCount(); }
  u8 headTrack() const { return bus_.headTrack(); }
  u8 ram(u16 addr) const { return bus_.ram(addr); }
  u8 via1PortB() const { return bus_.via1PortB(); }
  u8 via1PortBOutput() const { return bus_.via1PortBOutput(); }
  u8 via1PortBDirection() const { return bus_.via1PortBDirection(); }
  u8 via2PortB() const { return bus_.via2PortB(); }

 private:
  static constexpr u64 kDriveClockHz = 1000000;

  DriveBus bus_;
  Cpu cpu_;
  bool configured_ = false;
  bool faulted_ = false;
  u64 c64ClockNumerator_ = 1;
  u64 c64ClockDenominator_ = 1;
  u64 phase_ = 0;
  i64 cycleBudget_ = 0;
};

}  // namespace c64

#endif  // C64_DRIVE_HPP
