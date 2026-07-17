#include "c64/iec.hpp"

namespace c64 {

namespace {
constexpr u8 kC64AtnOut = 0x08;
constexpr u8 kC64ClockOut = 0x10;
constexpr u8 kC64DataOut = 0x20;
constexpr u8 kC64ClockIn = 0x40;
constexpr u8 kC64DataIn = 0x80;

constexpr u8 kDriveDataIn = 0x01;
constexpr u8 kDriveDataOut = 0x02;
constexpr u8 kDriveClockIn = 0x04;
constexpr u8 kDriveClockOut = 0x08;
constexpr u8 kDriveAtna = 0x10;
constexpr u8 kDriveAtnIn = 0x80;

bool assertedOutput(u8 latch, u8 direction, u8 bit) {
  return (direction & bit) != 0 && (latch & bit) != 0;
}
}  // namespace

void IecBus::reset() {
  c64Atn_ = c64Clock_ = c64Data_ = false;
  driveClock_ = driveData_ = driveAtna_ = false;
}

void IecBus::setC64PortA(u8 latch, u8 direction) {
  c64Atn_ = assertedOutput(latch, direction, kC64AtnOut);
  c64Clock_ = assertedOutput(latch, direction, kC64ClockOut);
  c64Data_ = assertedOutput(latch, direction, kC64DataOut);
}

void IecBus::setDriveVia1PortB(u8 latch, u8 direction) {
  driveData_ = assertedOutput(latch, direction, kDriveDataOut);
  driveClock_ = assertedOutput(latch, direction, kDriveClockOut);
  driveAtna_ = assertedOutput(latch, direction, kDriveAtna);
}

bool IecBus::dataAsserted() const {
  // The 1541's ATN acknowledge gate grounds DATA while ATN and ATNA disagree.
  return c64Data_ || driveData_ || (c64Atn_ && !driveAtna_);
}

u8 IecBus::c64PortAInputs() const {
  u8 pins = 0xFF;
  if (clockAsserted()) pins = static_cast<u8>(pins & ~kC64ClockIn);
  if (dataAsserted()) pins = static_cast<u8>(pins & ~kC64DataIn);
  return pins;
}

u8 IecBus::driveVia1PortBInputs() const {
  u8 pins = 0;
  if (dataAsserted()) pins = static_cast<u8>(pins | kDriveDataIn);
  if (clockAsserted()) pins = static_cast<u8>(pins | kDriveClockIn);
  if (atnAsserted()) pins = static_cast<u8>(pins | kDriveAtnIn);
  return pins;
}

}  // namespace c64
