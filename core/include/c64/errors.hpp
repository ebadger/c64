// Stable machine error codes. These cross the embind boundary as integers with a matching
// string projection; the core never throws C++ exceptions across the WASM API (see
// specs/EMULATOR.md "Error handling"). The bridge must not substitute success-shaped defaults
// for any of these.
#ifndef C64_ERRORS_HPP
#define C64_ERRORS_HPP

namespace c64 {

enum class ErrorCode : int {
  None = 0,
  InvalidConfig = 1, // unknown timing/SID profile or incomplete ROM set
  InvalidPrg = 2,    // missing load address, overflow, or malformed byte source
  InvalidD64 = 3,    // media layer rejected the disk (not implemented in this subset)
  RomMismatch = 4,   // ROM size/identity inconsistent with the selected set
  InvalidState = 5,  // operation not valid for the current machine lifecycle
  InternalFault = 6, // checked invariant failed; execution stops with diagnostic context
};

// Stable kebab-case identifier for an error code, matching the codes documented in
// specs/EMULATOR.md so tests and the bridge agree on wording.
const char* errorCodeName(ErrorCode code);

} // namespace c64

#endif // C64_ERRORS_HPP
