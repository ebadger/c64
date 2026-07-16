#include "c64/rom.hpp"

#include "c64/sha256.hpp"
#include "test_framework.hpp"

using namespace c64;

static RomImage image(u32 size, u8 fill) {
  RomImage img;
  img.bytes.assign(size, fill);
  img.source = "synthetic-test";
  return img;
}

TEST(rom_valid_set) {
  RomSetResult r = validateRomSet(image(kBasicRomSize, 0x11), image(kKernalRomSize, 0x22),
                                  image(kChargenRomSize, 0x33));
  CHECK(r.ok);
  CHECK(r.error.ok());
  CHECK(r.set.complete());
  CHECK_EQ(r.set.id.size(), 64u);
  // Per-role digest matches an independent hash of the same bytes.
  CHECK_STR_EQ(r.set.descriptors[0].sha256, sha256Hex(r.set.basic));
  CHECK_STR_EQ(r.set.descriptors[1].sha256, sha256Hex(r.set.kernal));
  CHECK_STR_EQ(r.set.descriptors[2].sha256, sha256Hex(r.set.chargen));
  CHECK_STR_EQ(romRoleId(RomRole::Basic), "basic");
  CHECK_STR_EQ(romRoleId(RomRole::Kernal), "kernal");
  CHECK_STR_EQ(romRoleId(RomRole::Chargen), "chargen");
}

TEST(rom_missing_role) {
  RomImage empty;  // no bytes
  RomSetResult r = validateRomSet(image(kBasicRomSize, 0x11), empty, image(kChargenRomSize, 0x33));
  CHECK(!r.ok);
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::RomSetIncomplete));
}

TEST(rom_wrong_size) {
  RomSetResult r = validateRomSet(image(kBasicRomSize - 1, 0x11), image(kKernalRomSize, 0x22),
                                  image(kChargenRomSize, 0x33));
  CHECK(!r.ok);
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::RomSize));
}

TEST(rom_id_deterministic_and_sensitive) {
  RomSetResult a = validateRomSet(image(kBasicRomSize, 0x11), image(kKernalRomSize, 0x22),
                                  image(kChargenRomSize, 0x33));
  RomSetResult b = validateRomSet(image(kBasicRomSize, 0x11), image(kKernalRomSize, 0x22),
                                  image(kChargenRomSize, 0x33));
  CHECK_STR_EQ(a.set.id, b.set.id);  // deterministic
  RomImage tweaked = image(kBasicRomSize, 0x11);
  tweaked.bytes[0] = 0x99;
  RomSetResult c = validateRomSet(tweaked, image(kKernalRomSize, 0x22), image(kChargenRomSize, 0x33));
  CHECK(a.set.id != c.set.id);  // sensitive to bytes
}

TEST(rom_identity_verifier) {
  RomSet set = syntheticRomSet(0xC000, 0xC100, 0xC200);
  CHECK(romSetIdentityMatches(set));

  RomSet tamperedBytes = set;
  tamperedBytes.kernal[10] ^= 0xFF;  // bytes changed but id/descriptors stale
  CHECK(!romSetIdentityMatches(tamperedBytes));

  RomSet forgedId = set;
  forgedId.id = "0000000000000000000000000000000000000000000000000000000000000000";
  CHECK(!romSetIdentityMatches(forgedId));

  RomSet forgedDigest = set;
  forgedDigest.descriptors[0].sha256 = "deadbeef";
  CHECK(!romSetIdentityMatches(forgedDigest));
}

TEST(rom_synthetic_vectors) {
  RomSet set = syntheticRomSet(0xFCE2, 0xFF48, 0xFE43);
  CHECK(set.complete());
  // RESET vector at $FFFC/$FFFD in the KERNAL image.
  CHECK_EQ(set.kernal[0xFFFC - 0xE000], 0xE2u);
  CHECK_EQ(set.kernal[0xFFFD - 0xE000], 0xFCu);
  CHECK_EQ(set.kernal[0xFFFE - 0xE000], 0x48u);
  CHECK_EQ(set.kernal[0xFFFF - 0xE000], 0xFFu);
  CHECK_EQ(set.kernal[0xFFFA - 0xE000], 0x43u);
  CHECK_EQ(set.kernal[0xFFFB - 0xE000], 0xFEu);
}
