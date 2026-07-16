// C64 memory bus: 64 KiB RAM, the 6510 processor port ($0000/$0001) banking bits, colour RAM,
// and the I/O region routing that lets executing code observe VIC-II register writes. This is
// the milestone-2a subset: no BASIC/KERNAL/CHARGEN ROM is present, so ROM/character regions read
// RAM. SID and the two CIAs are deterministic register shadows only (no timers/IRQ yet); see
// specs/IO.md for the honest status. Reads with hardware side effects and side-effect-free
// debugger peeks are separate operations, per specs/EMULATOR.md.
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
