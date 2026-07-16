#include "c64/rom.hpp"

#include "c64/sha256.hpp"

namespace c64 {
namespace {

const char* const kRoleIds[3] = {"basic", "kernal", "chargen"};

u32 expectedSize(RomRole role) {
  switch (role) {
    case RomRole::Basic:
      return kBasicRomSize;
    case RomRole::Kernal:
      return kKernalRomSize;
    case RomRole::Chargen:
      return kChargenRomSize;
  }
  return 0;
}

// Feed one role's canonical contribution into the set-id hash: role id, a NUL separator, the
// little-endian 32-bit size, another NUL, then the raw bytes. The separators keep field
// boundaries unambiguous (see specs/ROM-ASSETS.md).
void hashRole(Sha256& h, RomRole role, const std::vector<u8>& bytes) {
  const char* id = kRoleIds[static_cast<u8>(role)];
  h.update(reinterpret_cast<const u8*>(id), std::char_traits<char>::length(id));
  const u8 nul = 0;
  h.update(&nul, 1);
  const u32 size = static_cast<u32>(bytes.size());
  const u8 sizeLe[4] = {static_cast<u8>(size & 0xffu), static_cast<u8>((size >> 8) & 0xffu),
                        static_cast<u8>((size >> 16) & 0xffu), static_cast<u8>((size >> 24) & 0xffu)};
  h.update(sizeLe, 4);
  h.update(&nul, 1);
  if (!bytes.empty()) {
    h.update(bytes.data(), bytes.size());
  }
}

Error validateRole(RomRole role, const std::vector<u8>& bytes) {
  if (bytes.empty()) {
    return Error::make(ErrorCode::RomSetIncomplete,
                       std::string("ROM role '") + romRoleId(role) + "' is missing.");
  }
  const u32 expected = expectedSize(role);
  if (bytes.size() != expected) {
    return Error::make(ErrorCode::RomSize, std::string("ROM role '") + romRoleId(role) +
                                               "' must be " + std::to_string(expected) +
                                               " bytes but was " + std::to_string(bytes.size()) +
                                               ".");
  }
  return Error::none();
}

}  // namespace

const char* romRoleId(RomRole role) { return kRoleIds[static_cast<u8>(role)]; }

RomSetResult validateRomSet(const RomImage& basic, const RomImage& kernal,
                            const RomImage& chargen) {
  RomSetResult result;

  // Report incompleteness before size mismatches so the caller learns of a missing role first.
  const RomImage* images[3] = {&basic, &kernal, &chargen};
  const RomRole roles[3] = {RomRole::Basic, RomRole::Kernal, RomRole::Chargen};
  for (int i = 0; i < 3; ++i) {
    if (images[i]->bytes.empty()) {
      result.error = validateRole(roles[i], images[i]->bytes);
      return result;
    }
  }
  for (int i = 0; i < 3; ++i) {
    Error e = validateRole(roles[i], images[i]->bytes);
    if (!e.ok()) {
      result.error = std::move(e);
      return result;
    }
  }

  RomSet set;
  set.schema = 1;
  set.basic = basic.bytes;
  set.kernal = kernal.bytes;
  set.chargen = chargen.bytes;

  // Canonical set-id preimage: the header tag "c64-romset\0" followed by each role's
  // contribution in fixed order (basic, kernal, chargen). See specs/ROM-ASSETS.md.
  Sha256 idHash;
  idHash.update(reinterpret_cast<const u8*>("c64-romset"), 10);
  const u8 nul = 0;
  idHash.update(&nul, 1);
  hashRole(idHash, RomRole::Basic, set.basic);
  hashRole(idHash, RomRole::Kernal, set.kernal);
  hashRole(idHash, RomRole::Chargen, set.chargen);
  set.id = idHash.hexDigest();

  for (int i = 0; i < 3; ++i) {
    RomDescriptor& d = set.descriptors[i];
    d.role = roles[i];
    d.size = static_cast<u32>(images[i]->bytes.size());
    d.sha256 = sha256Hex(images[i]->bytes);
    d.licenseId = images[i]->licenseId;
    d.source = images[i]->source;
  }

  result.ok = true;
  result.set = std::move(set);
  return result;
}

RomSet syntheticRomSet(u16 resetVector, u16 irqVector, u16 nmiVector) {
  RomImage basic;
  basic.bytes.resize(kBasicRomSize);
  basic.source = "synthetic-test";
  basic.licenseId = "CC0-1.0";
  for (u32 i = 0; i < kBasicRomSize; ++i) {
    basic.bytes[i] = static_cast<u8>((i * 3u + 0x11u) & 0xffu);
  }

  RomImage kernal;
  kernal.bytes.resize(kKernalRomSize);
  kernal.source = "synthetic-test";
  kernal.licenseId = "CC0-1.0";
  for (u32 i = 0; i < kKernalRomSize; ++i) {
    kernal.bytes[i] = static_cast<u8>((i * 7u + 0x22u) & 0xffu);
  }
  // KERNAL ROM occupies $E000-$FFFF; vector table lives at $FFFA/$FFFC/$FFFE.
  auto putVector = [&](u16 addr, u16 value) {
    const u32 off = static_cast<u32>(addr) - 0xE000u;
    kernal.bytes[off] = static_cast<u8>(value & 0xffu);
    kernal.bytes[off + 1] = static_cast<u8>((value >> 8) & 0xffu);
  };
  putVector(0xFFFA, nmiVector);
  putVector(0xFFFC, resetVector);
  putVector(0xFFFE, irqVector);

  RomImage chargen;
  chargen.bytes.resize(kChargenRomSize);
  chargen.source = "synthetic-test";
  chargen.licenseId = "CC0-1.0";
  for (u32 i = 0; i < kChargenRomSize; ++i) {
    chargen.bytes[i] = static_cast<u8>((i * 5u + 0x33u) & 0xffu);
  }

  RomSetResult validated = validateRomSet(basic, kernal, chargen);
  return validated.set;
}

}  // namespace c64
