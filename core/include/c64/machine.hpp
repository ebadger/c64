// Machine lifecycle: configuration, deterministic reset, PRG loading, bounded execution, and
// explicit debug/inspection APIs.
//
// The Machine owns the ROM set, bus, and CPU. Operations that belong to devices not yet
// implemented (mounting a D64, framebuffer, audio, input) return a stable Unavailable error
// rather than pretending to succeed. All fallible operations return values carrying an Error;
// no exception crosses this API or the embind projection. See specs/EMULATOR.md.
#ifndef C64_MACHINE_HPP
#define C64_MACHINE_HPP

#include <set>
#include <string>
#include <vector>

#include "c64/bus.hpp"
#include "c64/cpu.hpp"
#include "c64/result.hpp"
#include "c64/rom.hpp"
#include "c64/timing.hpp"
#include "c64/types.hpp"

namespace c64 {

struct MachineConfig {
  std::string timingProfile = "pal-6569";  // "pal-6569" | "ntsc-6567r8"
  std::string sidModel = "6581";           // "6581" | "8580" (validated; unused until IO.md)
  RomSet roms;
  u8 powerOnSeed = 0;  // deterministic power-on RAM pattern selector (never host randomness)
};

enum class ResetKind : u8 { PowerOn, Warm };

struct LoadResult {
  bool ok = false;
  u16 loadAddress = 0;
  u32 endAddressExclusive = 0;
  Error error = Error::none();
};

struct RunResult {
  u64 cyclesExecuted = 0;
  u64 frameSequence = 0;
  u32 audioFramesAvailable = 0;
  bool stopped = false;
  std::string stopReason;  // "budget" | "breakpoint" | "brk" | "fault"
  Error error = Error::none();
};

class Machine {
 public:
  Machine();

  // Cpu holds a reference to Bus, so Machine must not be copied or moved.
  Machine(const Machine&) = delete;
  Machine& operator=(const Machine&) = delete;
  Machine(Machine&&) = delete;
  Machine& operator=(Machine&&) = delete;

  // Validate the configuration, install the ROM set, and power on. Errors: invalid-config
  // (unknown timing/SID id), rom-set-incomplete (ROM set is not complete).
  Error configure(const MachineConfig& config);

  bool ready() const { return ready_; }
  const TimingProfile& timing() const { return *profile_; }
  const RomSet& roms() const { return roms_; }

  // Deterministic reset. power-on rebuilds RAM from the configured seed and zeroes registers;
  // warm preserves RAM. Both restore the processor port and jump through the reset vector, and
  // reset the execution counters. Invalid before configure() (invalid-state).
  Error reset(ResetKind kind);

  // Validate and load a PRG image (2-byte little-endian load address + contiguous data) into
  // RAM. Does not infer or set a run address. Errors: invalid-prg, invalid-state.
  LoadResult loadPrg(const std::vector<u8>& bytes);

  // direct-mode entry: set the CPU program counter. Invalid before configure().
  Error setProgramCounter(u16 pc);

  // Execute whole instructions until at least maxCycles CPU cycles have elapsed, reporting the
  // exact number consumed. Because instructions are not interruptible, the reported total may
  // overshoot maxCycles by up to the final instruction's cycle count. Stops early on BRK
  // ("brk"), an undocumented opcode ("fault"), or a breakpoint. See specs/EMULATOR.md.
  RunResult runCycles(u64 maxCycles);

  // Interrupt lines (exposed for tests and future device wiring).
  void setIrqLine(bool asserted);
  void triggerNmi();

  // Breakpoints (address-based). Checked before each instruction fetch.
  void addBreakpoint(u16 addr) { breakpoints_.insert(addr); }
  void clearBreakpoints() { breakpoints_.clear(); }

  // Debug inspection/mutation.
  CpuState cpuState() const { return cpu_.state(); }
  void setCpuState(const CpuState& s) { cpu_.setState(s); }
  u8 debugPeek(u16 addr) const { return bus_.peek(addr); }             // mapped, no side effects
  u8 debugReadRam(u16 addr) const { return bus_.rawRamRead(addr); }    // raw RAM, bypass banking
  void debugWriteRam(u16 addr, u8 value) { bus_.rawRamWrite(addr, value); }
  MappedRegion regionOf(u16 addr) const { return bus_.regionOf(addr); }
  u8 processorPort() const { return bus_.processorPort(); }
  u8 dataDirection() const { return bus_.dataDirection(); }

  u64 totalCycles() const { return totalCycles_; }
  u64 frameSequence() const;

  // Device availability. Milestone 2 reports these as unavailable honestly.
  DeviceStatus vicStatus() const { return bus_.vicStatus(); }
  DeviceStatus sidStatus() const { return bus_.sidStatus(); }
  DeviceStatus cia1Status() const { return bus_.cia1Status(); }
  DeviceStatus cia2Status() const { return bus_.cia2Status(); }

  // Operations belonging to unimplemented devices — always return Unavailable in milestone 2.
  Error mountD64(const std::vector<u8>& bytes, u8 driveNumber = 8);
  Error copyFramebuffer();
  Error drainAudio();
  Error setInput();

 private:
  Error requireReady() const;

  bool ready_ = false;
  const TimingProfile* profile_ = nullptr;
  MachineConfig config_;
  RomSet roms_;
  Bus bus_;
  Cpu cpu_;
  u64 totalCycles_ = 0;
  std::set<u16> breakpoints_;
};

}  // namespace c64

#endif  // C64_MACHINE_HPP
