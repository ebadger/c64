// Shared device-status value type.
//
// Extracted into its own header so the Bus can own concrete device instances (which in turn need
// this type) without a circular include. Each clocked device reports an honest implementation
// status through this struct.
#ifndef C64_DEVICE_HPP
#define C64_DEVICE_HPP

namespace c64 {

struct DeviceStatus {
  const char* id;      // "vic-ii" | "sid" | "cia1" | "cia2"
  bool implemented;    // true once the device is modelled
  const char* detail;  // honest human-readable status
};

}  // namespace c64

#endif  // C64_DEVICE_HPP
