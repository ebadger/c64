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
    colorRam_.fill(0x00);
    sid_.fill(0x00);
    cia1_.fill(0x00);
    cia2_.fill(0x00);
    // Undriven keyboard/joystick data ports read as all-high (no key/direction asserted).
    cia1_[0x00] = 0xFF;
    cia1_[0x01] = 0xFF;
    cia2_[0x00] = 0xFF;
    cia2_[0x01] = 0xFF;
  }
  // Processor port power-on/reset values: I/O, BASIC, and KERNAL banked in.
  ddr_ = 0x2F;
  port_ = 0x37;
}

bool Bus::ioVisible() const {
  const bool loram = (port_ & 0x01) != 0;
  const bool hiram = (port_ & 0x02) != 0;
  const bool charen = (port_ & 0x04) != 0;
  return charen && (loram || hiram);
}

u8 Bus::read8(u16 addr) { return peek8(addr); }

u8 Bus::peek8(u16 addr) const {
  if (addr == 0x0000) {
    return ddr_;
  }
  if (addr == 0x0001) {
    // Output bits reflect the latch; input bits read high through their pull-ups.
    return static_cast<u8>((port_ & ddr_) | (~ddr_ & 0xFF & 0x17) | 0x00);
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
