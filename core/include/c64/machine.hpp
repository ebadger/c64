// Machine shell: owns the bus, VIC-II, and CPU and drives deterministic execution. This is the
// native/WASM-shared surface. The v0 boundary exposed to the web client (loadPrg, reset, setPc,
// runCycles, runFrame, framebuffer, readMem, writeMem) is projected 1:1 by core/wasm/embind.cpp.
// Browser pacing, audio, DOM, and file pickers stay outside this class.
#ifndef C64_MACHINE_HPP
#define C64_MACHINE_HPP

#include <cstddef>
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
#include "c64/errors.hpp"
#include "c64/types.hpp"
#include "c64/vicii.hpp"
#include "c64/io_types.hpp"
#include "c64/media.hpp"
#include "c64/result.hpp"
#include "c64/rom.hpp"
#include "c64/timing.hpp"
#include "c64/types.hpp"

namespace c64 {

struct MachineConfig {
  TimingProfile profile = TimingProfile::Pal6569;
  RamPattern ramPattern = RamPattern::Zero;
};

class Machine {
public:
  explicit Machine(const MachineConfig& config = {});

  // Re-initialise CPU/device latches. Power-on additionally applies the RAM fill pattern.
  void reset(ResetKind kind = ResetKind::PowerOn);

  // Load a PRG image: a 2-byte little-endian load address followed by data bytes. Validates the
  // header and rejects images that would wrap past $FFFF. The run address is not inferred here;
  // callers set the program counter with setPc (direct mode) per specs/CODEGEN.md.
  LoadResult loadPrg(const u8* data, std::size_t length);

  void setPc(u16 address) { cpu_.setPc(address); }

  // Execute whole instructions until at least `maxCycles` CPU cycles have run, or execution
  // faults. Reports the exact number of cycles executed (which may reach the end of the
  // instruction that crosses the budget). Ticks the VIC-II from consumed cycles.
  RunResult runCycles(u32 maxCycles);

  // Run one full frame worth of cycles for the active timing profile.
  RunResult runFrame();

  // Render the current indexed framebuffer and return a reference to the internal buffer. The
  // WASM bridge copies this into a fresh Uint8Array so no writable view outlives memory growth.
  const std::vector<u8>& framebuffer();
  FrameInfo frameInfo() const;

  // Side-effect-free debug memory access.
  u8 readMem(u16 address) const { return bus_.peek8(address); }
  void writeMem(u16 address, u8 value) { bus_.poke8(address, value); }

  // Accessors used by native tests.
  Cpu& cpu() { return cpu_; }
  Vic& vic() { return vic_; }
  Bus& bus() { return bus_; }

private:
  MachineConfig config_;
  Bus bus_;
  Vic vic_;
  Cpu cpu_;
  std::vector<u8> framebuffer_;
  u64 frameSequence_ = 0;
};

} // namespace c64

#endif // C64_MACHINE_HPP
  std::string timingProfile = "pal-6569";  // "pal-6569" | "ntsc-6567r8"
  std::string sidModel = "6581";           // "6581" | "8580"
  RomSet roms;
  u8 powerOnSeed = 0;      // deterministic power-on RAM pattern selector (never host randomness)
  u32 sampleRate = 44100;  // SID audio output sample rate
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

  // Device availability. All four devices are modelled in milestone 3.
  DeviceStatus vicStatus() const { return bus_.vicStatus(); }
  DeviceStatus sidStatus() const { return bus_.sidStatus(); }
  DeviceStatus cia1Status() const { return bus_.cia1Status(); }
  DeviceStatus cia2Status() const { return bus_.cia2Status(); }

  // --- Device I/O APIs (implemented in milestone 3) ---

  // Feed the CIA1 keyboard/joystick matrix and drive the RESTORE NMI edge. Owned copy semantics:
  // the snapshot is consumed, not retained. Returns invalid-input if a snapshot field is invalid.
  Error setInput(const InputSnapshot& snapshot);
  // Release all keys/joysticks (host focus loss). Explicitly driven, never inferred.
  void releaseAllInput();

  // Copy the current VIC-II framebuffer (one 4-bit colour index per byte) into the caller's
  // buffer and return frame metadata. Copies min(framebufferSize(), destLen) bytes and clears the
  // dirty flag. Dropping an already-completed frame never changes machine state.
  FrameInfo copyFramebuffer(u8* dest, u32 destLen);
  u32 framebufferSize() const;
  FrameInfo frameInfo() const;

  // Drain up to maxFrames mono float samples ([-1,1]) into the caller's buffer and return audio
  // metadata. Only already-emitted samples are dropped on overflow; state is never altered.
  AudioInfo drainAudio(float* dest, u32 maxFrames);

  // Mount an immutable, validated D64 as read-only media on the given drive (only drive 8 is
  // supported). Malformed media is never mounted. The mounted disk is served through a
  // deterministic high-level KERNAL LOAD/IEC trap (see specs/MEDIA.md for the compatibility
  // boundary); custom drive code is not emulated.
  MediaResult mountD64(const std::vector<u8>& bytes, u8 driveNumber = 8);
  bool diskMounted() const { return disk_.loaded; }

 private:
  Error requireReady() const;
  // High-level LOAD trap: services a JSR to the KERNAL LOAD vector ($FFD5) from mounted media.
  // Returns the deterministic cycle cost charged for the operation (always >= 1).
  u32 serviceLoadTrap();
  void rtsFromTrap(CpuState& st);
  bool findFile(const std::vector<u8>& petsciiName, size_t& outIndex) const;
  std::vector<u8> buildDirectoryListing() const;

  bool ready_ = false;
  const TimingProfile* profile_ = nullptr;
  MachineConfig config_;
  RomSet roms_;
  Bus bus_;
  Cpu cpu_;
  u64 totalCycles_ = 0;
  std::set<u16> breakpoints_;

  Disk disk_;                  // mounted read-only media (empty until mountD64)
  bool restorePrev_ = false;   // RESTORE edge detection for the NMI
};

}  // namespace c64

#endif  // C64_MACHINE_HPP
