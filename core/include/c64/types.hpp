// Shared value types for the deterministic C64 core. Fixed-width integers are used at every
// hardware boundary so native and WebAssembly builds observe identical wrap-around and
// truncation behaviour. No type here owns browser timing, DOM state, or host randomness.
// Fixed-width hardware value types shared across the deterministic C64 core.
//
// Every hardware boundary uses explicit fixed-width integers so native and WebAssembly builds
// agree bit-for-bit. Nothing in the core reads wall-clock time, host randomness, or locale.
#ifndef C64_TYPES_HPP
#define C64_TYPES_HPP

#include <cstdint>

namespace c64 {

using u8 = std::uint8_t;
using u16 = std::uint16_t;
using u32 = std::uint32_t;
using u64 = std::uint64_t;
using i8 = std::int8_t;

// Timing profile identifiers shared with VIC-II, CIA, and SID. These are immutable IDs, not
// display strings; adding a VIC revision requires a new profile and its own golden vectors.
enum class TimingProfile : u8 {
  Pal6569 = 0,   // "pal-6569"
  Ntsc6567R8 = 1 // "ntsc-6567r8"
};

// Reset kind. A power-on reset applies the deterministic RAM fill pattern; a warm reset
// preserves RAM and only re-initialises CPU/device latches.
enum class ResetKind : u8 { PowerOn = 0, Warm = 1 };

// Why a run stopped. "Budget" means the requested cycle budget was reached at an instruction
// boundary; the other reasons are machine events. Fault is a checked-invariant stop, never a
// C++ exception crossing the embind boundary.
enum class StopReason : u8 { Budget = 0, Brk = 1, Fault = 2 };

// Result of loading a PRG image. Mirrors specs/EMULATOR.md LoadResult; a failure never yields
// a partially written machine state beyond the documented behaviour.
struct LoadResult {
  bool ok = false;
  u16 loadAddress = 0;
  u32 endAddressExclusive = 0;
  int errorCode = 0; // 0 == none; see c64::ErrorCode
};

// Result of running the CPU for a cycle budget or a full frame.
struct RunResult {
  u64 cyclesExecuted = 0;
  u64 frameSequence = 0;
  bool stopped = false;
  StopReason stopReason = StopReason::Budget;
};

// Describes the indexed framebuffer produced by the VIC-II subset. Pixels are one byte each
// holding a 4-bit C64 colour index (0..15); the browser bridge maps indices through a declared
// palette. "c64-indexed-8" is the pixel format name shared with specs/VIC-II.md.
struct FrameInfo {
  u64 sequence = 0;
  u16 width = 0;
  u16 height = 0;
};

} // namespace c64

#endif // C64_TYPES_HPP
using i16 = std::int16_t;
using i32 = std::int32_t;
using i64 = std::int64_t;

}  // namespace c64

#endif  // C64_TYPES_HPP
