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
#include <memory>

#include "c64/rom.hpp"
#include "c64/types.hpp"

namespace c64 {

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

struct DeviceStatus {
  const char* id;      // "vic-ii" | "sid" | "cia1" | "cia2"
  bool implemented;    // false in milestone 2
  const char* detail;  // honest human-readable status
};

// Boundary for a clocked I/O device. Device clocks advance from consumed CPU cycles only; no
// device reads wall-clock time. `openBus` carries the last value driven on the data bus so an
// unimplemented device can model open-bus reads deterministically.
class ClockedDevice {
 public:
  virtual ~ClockedDevice() = default;
  virtual void reset() = 0;
  virtual void tick(u32 cpuCycles) = 0;
  virtual u8 read(u16 addr, bool sideEffects, u8 openBus) = 0;
  virtual void write(u16 addr, u8 value) = 0;
  virtual DeviceStatus status() const = 0;
};

// Milestone-2 placeholder: reads return open bus, writes are ignored, and status() reports the
// device as unavailable. This provides the interface milestone 3 will replace without ever
// claiming the device is modelled.
class UnimplementedDevice : public ClockedDevice {
 public:
  explicit UnimplementedDevice(const char* id) : id_(id) {}
  void reset() override {}
  void tick(u32) override {}
  u8 read(u16, bool, u8 openBus) override { return openBus; }
  void write(u16, u8) override {}
  DeviceStatus status() const override {
    return DeviceStatus{id_, false, "not implemented until milestone 3"};
  }

 private:
  const char* id_;
};

class Bus {
 public:
  Bus();

  // Point the ROM windows at a validated set. The set must outlive the bus.
  void setRoms(const RomSet& roms);

  // Reset all RAM to a deterministic pattern (power-on) and set the processor port to its
  // documented reset state ($00 = $2F, $01 = $37). `fillSeed` selects the power-on RAM
  // pattern deterministically; host randomness is never used.
  void powerOnReset(u8 fillSeed);
  // Warm reset: preserve RAM contents but restore the processor port reset state.
  void warmReset();

  // CPU-visible access following the current banking. read()/write() may have device side
  // effects; peek() follows banking without side effects for debug inspection.
  u8 read(u16 addr);
  void write(u16 addr, u8 value);
  u8 peek(u16 addr) const;

  // Raw underlying RAM access, bypassing banking and the processor port shadow. Used by debug
  // write APIs and PRG loading.
  u8 rawRamRead(u16 addr) const { return ram_[addr]; }
  void rawRamWrite(u16 addr, u8 value) { ram_[addr] = value; }

  // Advance device clocks by the given number of consumed CPU cycles.
  void tickDevices(u32 cpuCycles);

  // Current banking state (derived from the processor port).
  bool loram() const { return loram_; }
  bool hiram() const { return hiram_; }
  bool charen() const { return charen_; }
  u8 processorPort() const { return readPort(); }
  u8 dataDirection() const { return ddr_; }

  MappedRegion regionOf(u16 addr) const;

  DeviceStatus vicStatus() const { return vic_->status(); }
  DeviceStatus sidStatus() const { return sid_->status(); }
  DeviceStatus cia1Status() const { return cia1_->status(); }
  DeviceStatus cia2Status() const { return cia2_->status(); }

 private:
  u8 readPort() const;
  void recomputeBanking();

  std::array<u8, 0x10000> ram_;
  std::array<u8, 0x0400> colorRam_;  // low nibble significant

  const RomSet* roms_ = nullptr;

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

  std::unique_ptr<UnimplementedDevice> vic_;
  std::unique_ptr<UnimplementedDevice> sid_;
  std::unique_ptr<UnimplementedDevice> cia1_;
  std::unique_ptr<UnimplementedDevice> cia2_;
};

}  // namespace c64

#endif  // C64_BUS_HPP
