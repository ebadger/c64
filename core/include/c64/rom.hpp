// ROM set descriptors and validation.
//
// The core never contains copyrighted Commodore ROM bytes. Callers supply BASIC (8192),
// KERNAL (8192), and character (4096) ROM images from a reviewed redistributable set, a
// user-selected local file, or a synthetic test fixture. This layer validates sizes, computes
// deterministic per-role digests and a set identity, and owns the bytes in memory only
// (see specs/ROM-ASSETS.md).
#ifndef C64_ROM_HPP
#define C64_ROM_HPP

#include <string>
#include <vector>

#include "c64/result.hpp"
#include "c64/types.hpp"

namespace c64 {

enum class RomRole : u8 { Basic = 0, Kernal = 1, Chargen = 2 };

// Expected role sizes in bytes.
constexpr u32 kBasicRomSize = 8192;
constexpr u32 kKernalRomSize = 8192;
constexpr u32 kChargenRomSize = 4096;

// Stable lowercase role id: "basic" | "kernal" | "chargen".
const char* romRoleId(RomRole role);

// Provenance for one role. sha256 is filled in by validation. licenseId/source are opaque
// metadata carried for reproducibility diagnostics; the core never inspects the bytes' origin.
struct RomImage {
  std::vector<u8> bytes;
  std::string licenseId;                 // e.g. license SPDX id, or empty
  std::string source = "user-supplied";  // "bundled-replacement" | "user-supplied"
};

struct RomDescriptor {
  RomRole role;
  u32 size;
  std::string sha256;
  std::string licenseId;
  std::string source;
};

// A validated, complete ROM set with an in-memory-only identity.
struct RomSet {
  u32 schema = 1;
  std::string id;  // SHA-256 over ordered role ids, sizes, and bytes.
  std::vector<u8> basic;
  std::vector<u8> kernal;
  std::vector<u8> chargen;
  RomDescriptor descriptors[3];

  bool complete() const {
    return basic.size() == kBasicRomSize && kernal.size() == kKernalRomSize &&
           chargen.size() == kChargenRomSize;
  }
};

struct RomSetResult {
  bool ok = false;
  RomSet set;
  Error error = Error::none();
};

// Validate three role images into a RomSet.
//
// Errors (never exceptions):
//   rom-set-incomplete  a role image is empty (missing)
//   rom-size            a role image has the wrong byte length
//
// On success the RomSet carries per-role SHA-256 digests and a deterministic set id computed
// over the canonical preimage documented in specs/ROM-ASSETS.md.
RomSetResult validateRomSet(const RomImage& basic, const RomImage& kernal,
                            const RomImage& chargen);

// Verify that a RomSet's stored id and per-role descriptor digests actually match its bytes.
// Guards the machine against a hand-constructed set with a forged identity (the normal path
// through validateRomSet always produces a consistent set). Returns false on any mismatch or
// if the set is incomplete.
bool romSetIdentityMatches(const RomSet& set);

// Build a fully synthetic, legally-clean ROM set for tests and headless bring-up. The bytes
// are generated from a seed (never copyrighted dumps): each role is filled with a
// role-specific deterministic pattern, and the KERNAL image carries valid NMI/RESET/IRQ
// vectors at $FFFA/$FFFC/$FFFE pointing at the provided addresses. This lets reset and
// interrupt sequencing be exercised without any Commodore ROM.
RomSet syntheticRomSet(u16 resetVector, u16 irqVector, u16 nmiVector);

}  // namespace c64

#endif  // C64_ROM_HPP
