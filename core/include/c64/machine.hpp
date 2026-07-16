// Machine shell: owns the bus, VIC-II, and CPU and drives deterministic execution. This is the
// native/WASM-shared surface. The v0 boundary exposed to the web client (loadPrg, reset, setPc,
// runCycles, runFrame, framebuffer, readMem, writeMem) is projected 1:1 by core/wasm/embind.cpp.
// Browser pacing, audio, DOM, and file pickers stay outside this class.
#ifndef C64_MACHINE_HPP
#define C64_MACHINE_HPP

#include <cstddef>
#include <vector>

#include "c64/bus.hpp"
#include "c64/cpu.hpp"
#include "c64/errors.hpp"
#include "c64/types.hpp"
#include "c64/vicii.hpp"

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
