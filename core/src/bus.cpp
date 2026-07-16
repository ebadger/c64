#include "c64/bus.hpp"

#include "c64/vicii.hpp"

namespace c64 {

Bus::Bus() { reset(ResetKind::PowerOn, RamPattern::Zero); }

void Bus::reset(ResetKind kind, RamPattern pattern) {
  if (kind == ResetKind::PowerOn) {
    switch (pattern) {
      case RamPattern::Zero:
        ram_.fill(0x00);
        break;
      case RamPattern::C64Classic:
        // Alternating 64-byte runs of $00 and $FF: a common, deterministic power-on
        // approximation. Never sourced from host randomness.
        for (std::size_t i = 0; i < ram_.size(); ++i) {
          ram_[i] = ((i >> 6) & 1) ? 0xFF : 0x00;
        }
        break;
    }
    // Colour RAM is static RAM; a reset does not clear it, so only the power-on fill does.
    colorRam_.fill(0x00);
  }
  // The SID and both CIAs have reset inputs, so their register latches clear on every reset
  // (power-on and warm) while RAM is preserved on a warm reset.
  sid_.fill(0x00);
  cia1_.fill(0x00);
  cia2_.fill(0x00);
  // Undriven keyboard/joystick data ports read as all-high (no key/direction asserted).
  cia1_[0x00] = 0xFF;
  cia1_[0x01] = 0xFF;
  cia2_[0x00] = 0xFF;
  cia2_[0x01] = 0xFF;
  // Processor port power-on/reset values: I/O, BASIC, and KERNAL banked in.
  ddr_ = 0x2F;
  port_ = 0x37;
}

bool Bus::ioVisible() const {
  const u8 pins = effectivePort();
  const bool loram = (pins & 0x01) != 0;
  const bool hiram = (pins & 0x02) != 0;
  const bool charen = (pins & 0x04) != 0;
  return charen && (loram || hiram);
}

u8 Bus::read8(u16 addr) { return peek8(addr); }

u8 Bus::peek8(u16 addr) const {
  if (addr == 0x0000) {
    return ddr_;
  }
  if (addr == 0x0001) {
    // Output bits reflect the latch; input bits read high through their pull-ups.
    return effectivePort();
  }
  if (addr >= 0xD000 && addr <= 0xDFFF && ioVisible()) {
    return readIo(addr);
  }
  return ram_[addr];
}

void Bus::write8(u16 addr, u8 value) { poke8(addr, value); }

void Bus::poke8(u16 addr, u8 value) {
  if (addr == 0x0000) {
    ddr_ = value;
    return;
  }
  if (addr == 0x0001) {
    port_ = value;
    return;
  }
  if (addr >= 0xD000 && addr <= 0xDFFF && ioVisible()) {
    writeIo(addr, value);
    return;
  }
  ram_[addr] = value;
}

u8 Bus::readIo(u16 addr) const {
  if (addr <= 0xD3FF) { // VIC-II, mirrored every $40
    if (vic_ == nullptr) {
      return 0x00;
    }
    return vic_->readRegister(static_cast<u8>(addr & 0x3F));
  }
  if (addr <= 0xD7FF) { // SID, mirrored every $20 (register shadow stub)
    return sid_[static_cast<std::size_t>(addr & 0x1F)];
  }
  if (addr <= 0xDBFF) { // colour RAM: low nibble significant, high nibble reads as 0 here
    return static_cast<u8>(colorRam_[static_cast<std::size_t>((addr - 0xD800) & 0x3FF)] & 0x0F);
  }
  if (addr <= 0xDCFF) { // CIA 1 (stub)
    return cia1_[static_cast<std::size_t>(addr & 0x0F)];
  }
  if (addr <= 0xDDFF) { // CIA 2 (stub)
    return cia2_[static_cast<std::size_t>(addr & 0x0F)];
  }
  // $DE00-$DFFF I/O expansion with nothing connected: deterministic open-bus 0.
  return 0x00;
}

void Bus::writeIo(u16 addr, u8 value) {
  if (addr <= 0xD3FF) {
    if (vic_ != nullptr) {
      vic_->writeRegister(static_cast<u8>(addr & 0x3F), value);
    }
    return;
  }
  if (addr <= 0xD7FF) {
    sid_[static_cast<std::size_t>(addr & 0x1F)] = value;
    return;
  }
  if (addr <= 0xDBFF) {
    colorRam_[static_cast<std::size_t>((addr - 0xD800) & 0x3FF)] = static_cast<u8>(value & 0x0F);
    return;
  }
  if (addr <= 0xDCFF) {
    cia1_[static_cast<std::size_t>(addr & 0x0F)] = value;
    return;
  }
  if (addr <= 0xDDFF) {
    cia2_[static_cast<std::size_t>(addr & 0x0F)] = value;
    return;
  }
  // $DE00-$DFFF expansion: no target connected; write is discarded deterministically.
}

} // namespace c64
#include "c64/cpu.hpp"

namespace c64 {

namespace {
const char* const kRegionIds[] = {"ram",     "basic-rom", "kernal-rom",   "char-rom",
                                  "color-ram", "io-vic",   "io-sid",       "io-cia1",
                                  "io-cia2",   "io-expansion", "cpu-port"};
}  // namespace

const char* mappedRegionId(MappedRegion region) { return kRegionIds[static_cast<u8>(region)]; }

Bus::Bus() {
  ram_.fill(0);
  colorRam_.fill(0);
  recomputeBanking();
}

void Bus::setRoms(const RomSet& roms) { roms_ = &roms; }

void Bus::configureDevices(const TimingProfile& profile, Sid::Model sidModel, u32 sampleRate) {
  const u64 phi2Hz = profile.clockDenominator
                         ? (profile.clockNumerator + profile.clockDenominator / 2) /
                               profile.clockDenominator
                         : 985248;
  vic_.configure(profile, ram_.data(), colorRam_.data(),
                 roms_ ? roms_->chargen.data() : nullptr);
  sid_.configure(sidModel, phi2Hz, sampleRate);
  cia1_.configure(profile.cyclesPerFrame);
  cia2_.configure(profile.cyclesPerFrame);
}

u8 Bus::readPort() const {
  return static_cast<u8>((portLatch_ & ddr_) | (inputPins_ & static_cast<u8>(~ddr_)));
}

void Bus::recomputeBanking() {
  const u8 p = readPort();
  loram_ = (p & 0x01) != 0;
  hiram_ = (p & 0x02) != 0;
  charen_ = (p & 0x04) != 0;
}

void Bus::powerOnReset(u8 fillSeed) {
  // Deterministic power-on RAM pattern: classic 64-byte $00/$FF banding, XORed with the
  // fixture-selected seed. Host randomness is never used.
  for (u32 i = 0; i < ram_.size(); ++i) {
    const u8 base = (i & 0x40) ? 0xFF : 0x00;
    ram_[i] = static_cast<u8>(base ^ fillSeed);
  }
  colorRam_.fill(0);
  ddr_ = 0x2F;
  portLatch_ = 0x37;
  lastBusValue_ = 0;
  cycleCounter_ = 0;
  prevNmiLine_ = false;
  recomputeBanking();
  vic_.reset();
  sid_.reset();
  cia1_.reset();
  cia2_.reset();
}

void Bus::warmReset() {
  ddr_ = 0x2F;
  portLatch_ = 0x37;
  lastBusValue_ = 0;
  cycleCounter_ = 0;
  prevNmiLine_ = false;
  recomputeBanking();
  vic_.reset();
  sid_.reset();
  cia1_.reset();
  cia2_.reset();
}

MappedRegion Bus::regionOf(u16 addr) const {
  if (addr <= 0x0001) {
    return MappedRegion::CpuPort;
  }
  if (addr >= 0xA000 && addr <= 0xBFFF) {
    return (loram_ && hiram_) ? MappedRegion::BasicRom : MappedRegion::Ram;
  }
  if (addr >= 0xD000 && addr <= 0xDFFF) {
    if (!hiram_ && !loram_) {
      return MappedRegion::Ram;
    }
    if (!charen_) {
      return MappedRegion::CharRom;
    }
    if (addr <= 0xD3FF) return MappedRegion::IoVic;
    if (addr <= 0xD7FF) return MappedRegion::IoSid;
    if (addr <= 0xDBFF) return MappedRegion::ColorRam;
    if (addr <= 0xDCFF) return MappedRegion::IoCia1;
    if (addr <= 0xDDFF) return MappedRegion::IoCia2;
    return MappedRegion::IoExpansion;
  }
  if (addr >= 0xE000) {
    return hiram_ ? MappedRegion::KernalRom : MappedRegion::Ram;
  }
  return MappedRegion::Ram;
}

u8 Bus::read(u16 addr) {
  u8 value;
  switch (regionOf(addr)) {
    case MappedRegion::CpuPort:
      value = (addr == 0x0000) ? ddr_ : readPort();
      break;
    case MappedRegion::BasicRom:
      value = roms_ ? roms_->basic[addr - 0xA000] : lastBusValue_;
      break;
    case MappedRegion::KernalRom:
      value = roms_ ? roms_->kernal[addr - 0xE000] : lastBusValue_;
      break;
    case MappedRegion::CharRom:
      value = roms_ ? roms_->chargen[addr - 0xD000] : lastBusValue_;
      break;
    case MappedRegion::ColorRam:
      value = static_cast<u8>((colorRam_[addr - 0xD800] & 0x0F) | (lastBusValue_ & 0xF0));
      break;
    case MappedRegion::IoVic:
      value = vic_.read(static_cast<u8>(addr & 0x3F), true);
      break;
    case MappedRegion::IoSid:
      value = sid_.read(static_cast<u8>(addr & 0x1F), true);
      break;
    case MappedRegion::IoCia1:
      value = cia1_.read(static_cast<u8>(addr & 0x0F), true);
      break;
    case MappedRegion::IoCia2:
      value = cia2_.read(static_cast<u8>(addr & 0x0F), true);
      break;
    case MappedRegion::IoExpansion:
      value = lastBusValue_;  // open bus
      break;
    case MappedRegion::Ram:
    default:
      value = ram_[addr];
      break;
  }
  lastBusValue_ = value;
  return value;
}

u8 Bus::peek(u16 addr) const {
  switch (regionOf(addr)) {
    case MappedRegion::CpuPort:
      return (addr == 0x0000) ? ddr_ : readPort();
    case MappedRegion::BasicRom:
      return roms_ ? roms_->basic[addr - 0xA000] : lastBusValue_;
    case MappedRegion::KernalRom:
      return roms_ ? roms_->kernal[addr - 0xE000] : lastBusValue_;
    case MappedRegion::CharRom:
      return roms_ ? roms_->chargen[addr - 0xD000] : lastBusValue_;
    case MappedRegion::ColorRam:
      return static_cast<u8>((colorRam_[addr - 0xD800] & 0x0F) | (lastBusValue_ & 0xF0));
    case MappedRegion::IoVic:
    case MappedRegion::IoSid:
    case MappedRegion::IoCia1:
    case MappedRegion::IoCia2:
    case MappedRegion::IoExpansion:
      // Milestone-2 devices are open-bus placeholders; peek does not invoke device state.
      return lastBusValue_;
    case MappedRegion::Ram:
    default:
      return ram_[addr];
  }
}

void Bus::write(u16 addr, u8 value) {
  lastBusValue_ = value;
  switch (regionOf(addr)) {
    case MappedRegion::CpuPort:
      if (addr == 0x0000) {
        ddr_ = value;
      } else {
        portLatch_ = value;
      }
      recomputeBanking();
      return;
    case MappedRegion::ColorRam:
      colorRam_[addr - 0xD800] = static_cast<u8>(value & 0x0F);
      return;
    case MappedRegion::IoVic:
      vic_.write(static_cast<u8>(addr & 0x3F), value);
      return;
    case MappedRegion::IoSid:
      sid_.write(static_cast<u8>(addr & 0x1F), value);
      return;
    case MappedRegion::IoCia1:
      cia1_.write(static_cast<u8>(addr & 0x0F), value);
      return;
    case MappedRegion::IoCia2:
      cia2_.write(static_cast<u8>(addr & 0x0F), value);
      return;
    case MappedRegion::IoExpansion:
      return;  // open bus, ignored
    case MappedRegion::BasicRom:
    case MappedRegion::KernalRom:
    case MappedRegion::CharRom:
    case MappedRegion::Ram:
    default:
      // Writes to ROM windows fall through to the RAM beneath them.
      ram_[addr] = value;
      return;
  }
}

void Bus::cycle() {
  // Tick every clocked device by exactly one CPU cycle, then aggregate their interrupt outputs
  // onto the CPU. C64 wiring: VIC-II and CIA1 drive IRQ; CIA2 (and RESTORE, handled by the
  // machine via triggerNmi) drives NMI. The VIC bank comes from CIA2 port A.
  ++cycleCounter_;
  vic_.setBank(cia2_.vicBank());
  vic_.tickCycle();
  cia1_.tickCycle();
  cia2_.tickCycle();
  sid_.tickCycle();
  if (cpu_ != nullptr) {
    cpu_->setDeviceIrq(vic_.irqAsserted() || cia1_.irqAsserted());
    const bool nmiLine = cia2_.irqAsserted();
    if (nmiLine && !prevNmiLine_) cpu_->triggerNmi();
    prevNmiLine_ = nmiLine;
  }
}

u8 Bus::readCycle(u16 addr) {
  // BA/AEC: a bad line (or sprite DMA) steals bus cycles; the CPU is halted on its next read
  // until the VIC releases the bus. Apply any pending steal before completing this read.
  const u32 steal = vic_.takeBaSteal();
  if (steal != 0) idleCycles(steal);
  cycle();
  return read(addr);
}

void Bus::writeCycle(u16 addr, u8 value) {
  cycle();
  write(addr, value);
}

void Bus::idleCycles(u32 count) {
  for (u32 i = 0; i < count; ++i) cycle();
}

}  // namespace c64
