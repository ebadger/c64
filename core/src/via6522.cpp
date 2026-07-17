#include "c64/via6522.hpp"

namespace c64 {

void Via6522::reset() {
  ora_ = orb_ = ddra_ = ddrb_ = pcr_ = 0;
  portAInputs_ = portBInputs_ = 0xFF;
}

u8 Via6522::portAPins() const {
  return static_cast<u8>((ora_ & ddra_) | (portAInputs_ & ~ddra_));
}

u8 Via6522::portBPins() const {
  return static_cast<u8>((orb_ & ddrb_) | (portBInputs_ & ~ddrb_));
}

u8 Via6522::read(u8 reg) const {
  switch (reg & 0x0F) {
    case 0x0:
      return portBPins();
    case 0x1:
    case 0xF:
      return portAPins();
    case 0x2:
      return ddrb_;
    case 0x3:
      return ddra_;
    case 0xC:
      return pcr_;
    default:
      return 0;
  }
}

void Via6522::write(u8 reg, u8 value) {
  switch (reg & 0x0F) {
    case 0x0:
      orb_ = value;
      break;
    case 0x1:
    case 0xF:
      ora_ = value;
      break;
    case 0x2:
      ddrb_ = value;
      break;
    case 0x3:
      ddra_ = value;
      break;
    case 0xC:
      pcr_ = value;
      break;
    default:
      break;
  }
}

}  // namespace c64
