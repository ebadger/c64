#include "c64/bus.hpp"

namespace c64 {

namespace {
const char* const kRegionIds[] = {"ram",     "basic-rom", "kernal-rom",   "char-rom",
                                  "color-ram", "io-vic",   "io-sid",       "io-cia1",
                                  "io-cia2",   "io-expansion", "cpu-port"};
}  // namespace

const char* mappedRegionId(MappedRegion region) { return kRegionIds[static_cast<u8>(region)]; }

Bus::Bus()
    : vic_(std::make_unique<UnimplementedDevice>("vic-ii")),
      sid_(std::make_unique<UnimplementedDevice>("sid")),
      cia1_(std::make_unique<UnimplementedDevice>("cia1")),
      cia2_(std::make_unique<UnimplementedDevice>("cia2")) {
  ram_.fill(0);
  colorRam_.fill(0);
  recomputeBanking();
}

void Bus::setRoms(const RomSet& roms) { roms_ = &roms; }

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
  recomputeBanking();
  vic_->reset();
  sid_->reset();
  cia1_->reset();
  cia2_->reset();
}

void Bus::warmReset() {
  ddr_ = 0x2F;
  portLatch_ = 0x37;
  lastBusValue_ = 0;
  recomputeBanking();
  vic_->reset();
  sid_->reset();
  cia1_->reset();
  cia2_->reset();
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
      value = vic_->read(addr, true, lastBusValue_);
      break;
    case MappedRegion::IoSid:
      value = sid_->read(addr, true, lastBusValue_);
      break;
    case MappedRegion::IoCia1:
      value = cia1_->read(addr, true, lastBusValue_);
      break;
    case MappedRegion::IoCia2:
      value = cia2_->read(addr, true, lastBusValue_);
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
      vic_->write(addr, value);
      return;
    case MappedRegion::IoSid:
      sid_->write(addr, value);
      return;
    case MappedRegion::IoCia1:
      cia1_->write(addr, value);
      return;
    case MappedRegion::IoCia2:
      cia2_->write(addr, value);
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

void Bus::tickDevices(u32 cpuCycles) {
  vic_->tick(cpuCycles);
  sid_->tick(cpuCycles);
  cia1_->tick(cpuCycles);
  cia2_->tick(cpuCycles);
}

}  // namespace c64
