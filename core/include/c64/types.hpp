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
using i16 = std::int16_t;
using i32 = std::int32_t;
using i64 = std::int64_t;

}  // namespace c64

#endif  // C64_TYPES_HPP
