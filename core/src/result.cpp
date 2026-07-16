#include "c64/result.hpp"

namespace c64 {

const char* errorCodeId(ErrorCode code) {
  switch (code) {
    case ErrorCode::None:
      return "none";
    case ErrorCode::InvalidConfig:
      return "invalid-config";
    case ErrorCode::InvalidPrg:
      return "invalid-prg";
    case ErrorCode::InvalidD64:
      return "invalid-d64";
    case ErrorCode::RomMismatch:
      return "rom-mismatch";
    case ErrorCode::RomSetIncomplete:
      return "rom-set-incomplete";
    case ErrorCode::RomSize:
      return "rom-size";
    case ErrorCode::InvalidState:
      return "invalid-state";
    case ErrorCode::Unavailable:
      return "unavailable";
    case ErrorCode::InternalFault:
      return "internal-fault";
    case ErrorCode::UnsupportedGeometry:
      return "unsupported-geometry";
    case ErrorCode::InvalidTrackSector:
      return "invalid-track-sector";
    case ErrorCode::ChainCycle:
      return "chain-cycle";
    case ErrorCode::InvalidBam:
      return "invalid-bam";
    case ErrorCode::InvalidInput:
      return "invalid-input";
    case ErrorCode::UnsupportedMedia:
      return "unsupported-media";
  }
  return "internal-fault";
}

}  // namespace c64
