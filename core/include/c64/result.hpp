// Explicit result and error types crossing every layer boundary.
//
// Errors are stable enumerated codes with human-readable context, never C++ exceptions. No
// exception is allowed to cross the public API or the embind boundary, so all fallible
// operations return a value carrying an ErrorCode (see specs/EMULATOR.md error table).
#ifndef C64_RESULT_HPP
#define C64_RESULT_HPP

#include <string>

#include "c64/types.hpp"

namespace c64 {

// Stable public error codes. The string form (errorCodeId) is the contract shared with the
// JavaScript bridge and tests; the enum ordering is an implementation detail.
enum class ErrorCode : u8 {
  None = 0,
  InvalidConfig,       // "invalid-config": unknown timing/SID profile or incomplete ROM set
  InvalidPrg,          // "invalid-prg": missing load address, overflow, or malformed bytes
  InvalidD64,          // "invalid-d64": media layer rejected the disk
  RomMismatch,         // "rom-mismatch": ROM size/identity inconsistent with the set
  RomSetIncomplete,    // "rom-set-incomplete": a required ROM role is missing
  RomSize,             // "rom-size": a ROM role has the wrong byte length
  InvalidState,        // "invalid-state": operation invalid for the current lifecycle
  Unavailable,         // "unavailable": device/feature not implemented in this milestone
  InternalFault,       // "internal-fault": a checked invariant failed
  // Media-layer codes (see specs/MEDIA.md).
  UnsupportedGeometry, // "unsupported-geometry": D64 size/track layout is not supported
  InvalidTrackSector,  // "invalid-track-sector": a chain link references outside the image
  ChainCycle,          // "chain-cycle": a directory or file chain loops
  InvalidBam,          // "invalid-bam": the BAM directory-link track is wrong
  InvalidInput,        // "invalid-input": host input snapshot is malformed
  UnsupportedMedia,    // "unsupported-media": operation requires unsupported drive fidelity
};

// Returns the stable lowercase string identifier for a code (the cross-layer contract).
const char* errorCodeId(ErrorCode code);

// A structured error. When code == None the error is absent and message is empty.
struct Error {
  ErrorCode code = ErrorCode::None;
  std::string message;

  bool ok() const { return code == ErrorCode::None; }

  static Error none() { return Error{ErrorCode::None, {}}; }
  static Error make(ErrorCode code, std::string message) {
    return Error{code, std::move(message)};
  }
};

}  // namespace c64

#endif  // C64_RESULT_HPP
