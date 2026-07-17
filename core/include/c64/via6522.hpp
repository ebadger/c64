// Selected MOS 6522 VIA surface used by the bundled clean-room 1541 firmware.
#ifndef C64_VIA6522_HPP
#define C64_VIA6522_HPP

#include "c64/types.hpp"

namespace c64 {

class Via6522 {
 public:
  void reset();
  u8 read(u8 reg) const;
  void write(u8 reg, u8 value);

  void setPortAInputs(u8 pins) { portAInputs_ = pins; }
  void setPortBInputs(u8 pins) { portBInputs_ = pins; }

  u8 portAOutputLatch() const { return ora_; }
  u8 portBOutputLatch() const { return orb_; }
  u8 portADirection() const { return ddra_; }
  u8 portBDirection() const { return ddrb_; }
  u8 peripheralControl() const { return pcr_; }

 private:
  u8 portAPins() const;
  u8 portBPins() const;

  u8 ora_ = 0;
  u8 orb_ = 0;
  u8 ddra_ = 0;
  u8 ddrb_ = 0;
  u8 pcr_ = 0;
  u8 portAInputs_ = 0xFF;
  u8 portBInputs_ = 0xFF;
};

}  // namespace c64

#endif  // C64_VIA6522_HPP
