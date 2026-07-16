// C64 memory bus: 64 KiB RAM, the 6510 processor port ($0000/$0001) banking bits, colour RAM,
// and the I/O region routing that lets executing code observe VIC-II register writes. This is
// the milestone-2a subset: no BASIC/KERNAL/CHARGEN ROM is present, so ROM/character regions read
// RAM. SID and the two CIAs are deterministic register shadows only (no timers/IRQ yet); see
// specs/IO.md for the honest status. Reads with hardware side effects and side-effect-free
// debugger peeks are separate operations, per specs/EMULATOR.md.
// C64 memory bus: RAM, ROM windows, colour RAM, the 6510 processor port, and the clocked
// device boundary.
//
// The 16-bit address space resolves to RAM, BASIC/KERNAL/character ROM, colour RAM, or the I/O
// page according to the 6510 data-direction register ($0000), processor port ($0001), and the
// cartridge GAME/EXROM lines. VIC-II, SID, and the two CIAs are reached through an explicit
// ClockedDevice interface; milestone 2 wires deterministic Unimplemented placeholders so CPU
// execution stays deterministic while the machine honestly reports those devices as
// unavailable (see specs/EMULATOR.md).
#ifndef C64_BUS_HPP
#define C64_BUS_HPP

#include <array>

#include "c64/types.hpp"

namespace c64 {

class Vic; // register routing for $D000-$D3FF; owned by the Machine

// Deterministic power-on RAM fill. Host randomness is never used; the fixture selects a pattern.
enum class RamPattern : u8 {
  Zero = 0,      // all $00 (default, simplest deterministic state)
  C64Classic = 1 // alternating $00/$FF every 64 bytes, a common power-on approximation
};

class Bus {
public:
  Bus();

  // Attach the VIC-II whose registers are mapped into the I/O region. Must be set before any
  // access that can reach $D000-$D3FF.
  void attachVic(Vic* vic) { vic_ = vic; }

  // Power-on clears colour RAM and applies the RAM fill pattern; warm reset preserves RAM.
  void reset(ResetKind kind, RamPattern pattern);

  // CPU-visible access (may have hardware side effects on real I/O; none in this subset).
  u8 read8(u16 addr);
  void write8(u16 addr, u8 value);

  // Side-effect-free debugger peek/poke. Poke writes directly to the decoded target without
  // triggering device side effects.
  u8 peek8(u16 addr) const;
  void poke8(u16 addr, u8 value);

  // Write a byte straight into the underlying RAM array, bypassing the processor port and I/O
  // banking. Used by the PRG loader so an image always lands in RAM regardless of the current
  // bank configuration.
  void loadRam(u16 addr, u8 value) { ram_[addr] = value; }

  u16 read16(u16 addr) { return static_cast<u16>(read8(addr) | (read8(static_cast<u16>(addr + 1)) << 8)); }

  // 6502 indirect-vector read with the NMOS page-wrap bug at a page boundary (used by JMP ind).
  u16 read16Bug(u16 addr) {
    const u16 lo = read8(addr);
    const u16 hi = read8(static_cast<u16>((addr & 0xFF00) | ((addr + 1) & 0x00FF)));
    return static_cast<u16>(lo | (hi << 8));
  }

  // True when the I/O region ($D000-$DFFF) is banked in given the current processor port bits.
  bool ioVisible() const;

  u8 processorPortDir() const { return ddr_; }
  u8 processorPort() const { return port_; }

private:
  // Effective processor-port pin levels: output bits reflect the latch, input bits read their
  // pull-ups (banking lines and cassette sense pull high). Both the `$01` readback and the I/O
  // banking decision derive from this same value so they can never disagree.
  u8 effectivePort() const { return static_cast<u8>((port_ & ddr_) | (~ddr_ & 0x17)); }

  u8 readIo(u16 addr) const;
  void writeIo(u16 addr, u8 value);

  std::array<u8, 0x10000> ram_{};
  std::array<u8, 0x0400> colorRam_{}; // $D800-$DBFF, low nibble significant
  std::array<u8, 0x20> sid_{};        // $D400-$D41F register shadow (stub)
  std::array<u8, 0x10> cia1_{};       // $DC00-$DC0F register shadow (stub)
  std::array<u8, 0x10> cia2_{};       // $DD00-$DD0F register shadow (stub)
  u8 ddr_ = 0x2F;  // $0000 data-direction register (power-on value)
  u8 port_ = 0x37; // $0001 processor port: LORAM|HIRAM|CHAREN in, cassette bits out
  Vic* vic_ = nullptr;
};

} // namespace c64

#endif // C64_BUS_HPP
#include "c64/cia.hpp"
#include "c64/device.hpp"
#include "c64/rom.hpp"
#include "c64/sid.hpp"
#include "c64/timing.hpp"
#include "c64/types.hpp"
#include "c64/vic.hpp"

namespace c64 {

class Cpu;  // forward declaration; the Bus drives the CPU's device IRQ/NMI inputs each cycle

// Region a physical address currently resolves to. Used by debug inspection and banking tests.
enum class MappedRegion : u8 {
  Ram,
  BasicRom,
  KernalRom,
  CharRom,
  ColorRam,
  IoVic,
  IoSid,
  IoCia1,
  IoCia2,
  IoExpansion,
  CpuPort,  // $0000/$0001
};

const char* mappedRegionId(MappedRegion region);

class Bus {
 public:
  Bus();

  // Point the ROM windows at a validated set. The set must outlive the bus.
  void setRoms(const RomSet& roms);

  // Configure the clocked devices for the machine's timing profile and SID model, wiring the VIC
  // to the memory it fetches from. Call after setRoms(), before the first reset.
  void configureDevices(const TimingProfile& profile, Sid::Model sidModel, u32 sampleRate);

  // Wire the CPU so the Bus can drive its aggregated device IRQ line and NMI edges each cycle.
  void attachCpu(Cpu* cpu) { cpu_ = cpu; }

  // Reset all RAM to a deterministic pattern (power-on) and set the processor port to its
  // documented reset state ($00 = $2F, $01 = $37). `fillSeed` selects the power-on RAM
  // pattern deterministically; host randomness is never used.
  void powerOnReset(u8 fillSeed);
  // Warm reset: preserve RAM contents but restore the processor port reset state.
  void warmReset();

  // CPU-visible access following the current banking. read()/write() may have device side
  // effects; peek() follows banking without side effects for debug inspection. These do NOT tick
  // the clocked devices; the CPU uses the *Cycle variants below so that every consumed CPU cycle
  // advances the devices exactly once.
  u8 read(u16 addr);
  void write(u16 addr, u8 value);
  u8 peek(u16 addr) const;

  // One CPU cycle that performs a read/write/idle. readCycle() first resolves any VIC bus steal
  // (BA/AEC): while the VIC is holding the bus the CPU is stalled on a read, so extra stall
  // cycles are consumed (ticking the devices) before the read completes. Writes are not stalled.
  u8 readCycle(u16 addr);
  void writeCycle(u16 addr, u8 value);
  void idleCycles(u32 count);

  // Total device cycles ticked since the last reset (free-running accounting clock).
  u64 cycleCount() const { return cycleCounter_; }

  // Raw underlying RAM access, bypassing banking and the processor port shadow. Used by debug
  // write APIs and PRG loading.
  u8 rawRamRead(u16 addr) const { return ram_[addr]; }
  void rawRamWrite(u16 addr, u8 value) { ram_[addr] = value; }

  // Current banking state (derived from the processor port).
  bool loram() const { return loram_; }
  bool hiram() const { return hiram_; }
  bool charen() const { return charen_; }
  u8 processorPort() const { return readPort(); }
  u8 dataDirection() const { return ddr_; }

  MappedRegion regionOf(u16 addr) const;

  DeviceStatus vicStatus() const { return vic_.status(); }
  DeviceStatus sidStatus() const { return sid_.status(); }
  DeviceStatus cia1Status() const { return cia1_.status(); }
  DeviceStatus cia2Status() const { return cia2_.status(); }

  // Direct device access for the machine's input/framebuffer/audio APIs and the drive/IEC path.
  Vic& vic() { return vic_; }
  Sid& sid() { return sid_; }
  Cia& cia1() { return cia1_; }
  Cia& cia2() { return cia2_; }
  const Vic& vic() const { return vic_; }
  const Sid& sid() const { return sid_; }

 private:
  u8 readPort() const;
  void recomputeBanking();
  // Tick all clocked devices by one cycle and update the CPU's aggregated IRQ/NMI inputs.
  void cycle();

  std::array<u8, 0x10000> ram_;
  std::array<u8, 0x0400> colorRam_;  // low nibble significant

  const RomSet* roms_ = nullptr;
  Cpu* cpu_ = nullptr;

  u64 cycleCounter_ = 0;    // free-running device-cycle accounting clock
  bool prevNmiLine_ = false;  // for edge detection on the aggregated device NMI line

  u8 ddr_ = 0x2F;         // $0000 data-direction register
  u8 portLatch_ = 0x37;   // $0001 output latch
  u8 inputPins_ = 0x17;   // deterministic input-pin state (bit4 cassette sense high)
  bool loram_ = true;
  bool hiram_ = true;
  bool charen_ = true;

  // Cartridge lines: no cartridge in scope, deterministic defaults (both high / inactive).
  static constexpr bool kGame = true;
  static constexpr bool kExrom = true;

  u8 lastBusValue_ = 0;  // open-bus source

  Vic vic_;
  Sid sid_;
  Cia cia1_{Cia::Variant::Cia1};
  Cia cia2_{Cia::Variant::Cia2};
};

}  // namespace c64

#endif  // C64_BUS_HPP
