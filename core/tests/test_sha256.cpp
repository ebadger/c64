#include "c64/sha256.hpp"

#include <vector>

#include "test_framework.hpp"

using namespace c64;

TEST(sha256_empty) {
  // SHA-256("") known vector.
  CHECK_STR_EQ(sha256Hex(std::vector<u8>{}),
               "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
}

TEST(sha256_abc) {
  const std::vector<u8> abc = {'a', 'b', 'c'};
  CHECK_STR_EQ(sha256Hex(abc),
               "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
}

TEST(sha256_long) {
  // 1,000,000 'a' -> known vector, exercises multi-block streaming.
  Sha256 h;
  const std::vector<u8> block(1000, 'a');
  for (int i = 0; i < 1000; ++i) h.update(block.data(), block.size());
  CHECK_STR_EQ(h.hexDigest(),
               "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}
