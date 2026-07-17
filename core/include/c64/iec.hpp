// Open-collector Commodore IEC serial bus shared by the C64 and emulated drive.
#ifndef C64_IEC_HPP
#define C64_IEC_HPP

#include "c64/types.hpp"

namespace c64 {

class IecBus {
 public:
  void reset();

  // CIA2 port A uses inverted output drivers: PA3/4/5 high assert ATN/CLOCK/DATA.
  void setC64PortA(u8 latch, u8 direction);
  // The clean-room drive ROM uses VIA1 PB bits 1/3/4 as asserted-high DATA/CLOCK/ATNA outputs.
  void setDriveVia1PortB(u8 latch, u8 direction);

  bool atnAsserted() const { return c64Atn_; }
  bool clockAsserted() const { return c64Clock_ || driveClock_; }
  bool dataAsserted() const;

  // Electrical pin representations expected by each endpoint.
  u8 c64PortAInputs() const;
  u8 driveVia1PortBInputs() const;

 private:
  bool c64Atn_ = false;
  bool c64Clock_ = false;
  bool c64Data_ = false;
  bool driveClock_ = false;
  bool driveData_ = false;
  bool driveAtna_ = false;
};

}  // namespace c64

#endif  // C64_IEC_HPP
