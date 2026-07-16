// Dependency-free SHA-256 used for ROM identity/digests.
//
// A single deterministic implementation so native and WebAssembly builds produce identical
// digests. Digests are lowercase hex. No system crypto library is used, keeping the core
// self-contained and byte-identical across toolchains.
#ifndef C64_SHA256_HPP
#define C64_SHA256_HPP

#include <string>
#include <vector>

#include "c64/types.hpp"

namespace c64 {

// Streaming SHA-256. Construct, update() zero or more times, then hexDigest() once.
class Sha256 {
 public:
  Sha256();
  void update(const u8* data, std::size_t len);
  // Returns the 64-character lowercase hex digest and finalizes the state.
  std::string hexDigest();

 private:
  void processBlock(const u8* block);

  u32 state_[8];
  u64 bitLength_;
  u8 buffer_[64];
  std::size_t bufferLen_;
};

// Convenience: lowercase hex SHA-256 of a byte span.
std::string sha256Hex(const u8* data, std::size_t len);
std::string sha256Hex(const std::vector<u8>& data);

}  // namespace c64

#endif  // C64_SHA256_HPP
