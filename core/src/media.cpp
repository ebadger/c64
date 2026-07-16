#include "c64/media.hpp"

#include <set>

namespace c64 {

namespace {
constexpr u32 kBytesPerSector = 256;
constexpr u32 kBamTrack = 18;
constexpr u32 kBamSector = 0;
constexpr u32 kDirTrack = 18;
constexpr u8 kShiftSpace = 0xA0;

MediaResult mediaError(ErrorCode code, std::string message) {
  MediaResult r;
  r.ok = false;
  r.error = Error::make(code, std::move(message));
  return r;
}

// Trim trailing $A0 padding from a 16-byte PETSCII name; returns the significant length.
u8 trimName(const u8* bytes, std::array<u8, 16>& out) {
  int end = 16;
  while (end > 0 && bytes[end - 1] == kShiftSpace) --end;
  out.fill(0);
  for (int i = 0; i < end; ++i) out[i] = bytes[i];
  return static_cast<u8>(end);
}

// Rough PETSCII -> ASCII for display metadata only (uppercase letters/digits/space).
std::string petsciiToAscii(const std::array<u8, 16>& name, u8 len) {
  std::string s;
  for (u8 i = 0; i < len; ++i) {
    const u8 c = name[i];
    if (c >= 0x41 && c <= 0x5A) {
      s.push_back(static_cast<char>(c));  // A-Z
    } else if (c >= 0x30 && c <= 0x39) {
      s.push_back(static_cast<char>(c));  // 0-9
    } else if (c == 0x20) {
      s.push_back(' ');
    } else {
      s.push_back('?');
    }
  }
  return s;
}

// Walk a file sector chain, collecting payload bytes. Validates bounds and cycles.
bool walkFileChain(const std::vector<u8>& bytes, u8 startTrack, u8 startSector,
                   std::vector<u8>& payload, Error& err) {
  payload.clear();
  std::set<u32> visited;
  u32 t = startTrack;
  u32 s = startSector;
  for (;;) {
    const i32 off = sectorOffset(t, s);
    if (off < 0) {
      err = Error::make(ErrorCode::InvalidTrackSector, "File link references an invalid sector.");
      return false;
    }
    const u32 key = t * 256 + s;
    if (visited.count(key) != 0) {
      err = Error::make(ErrorCode::ChainCycle, "File chain cycles.");
      return false;
    }
    visited.insert(key);
    const u8 nextT = bytes[off];
    const u8 nextS = bytes[off + 1];
    if (nextT == 0) {
      const u32 lastOffset = nextS;
      if (lastOffset < 1) {
        err = Error::make(ErrorCode::InvalidTrackSector, "Invalid final-sector byte count.");
        return false;
      }
      for (u32 i = 2; i <= lastOffset && i < kBytesPerSector; ++i) payload.push_back(bytes[off + i]);
      return true;
    }
    for (u32 i = 2; i < kBytesPerSector; ++i) payload.push_back(bytes[off + i]);
    t = nextT;
    s = nextS;
  }
}
}  // namespace

u32 sectorsInTrack(u32 track) {
  if (track >= 1 && track <= 17) return 21;
  if (track >= 18 && track <= 24) return 19;
  if (track >= 25 && track <= 30) return 18;
  if (track >= 31 && track <= 35) return 17;
  return 0;
}

i32 sectorOffset(u32 track, u32 sector) {
  if (track < 1 || track > 35) return -1;
  if (sector >= sectorsInTrack(track)) return -1;
  u32 sectorCount = 0;
  for (u32 t = 1; t < track; ++t) sectorCount += sectorsInTrack(t);
  return static_cast<i32>((sectorCount + sector) * kBytesPerSector);
}

MediaResult parseD64(const std::vector<u8>& bytes, Disk& out) {
  out = Disk{};
  MediaResult result;

  std::vector<std::string> warnings;
  if (bytes.size() == kD64SizeWithErrors) {
    warnings.emplace_back("error-table-ignored");
  } else if (bytes.size() != kD64Size) {
    return mediaError(ErrorCode::UnsupportedGeometry, "Unsupported D64 image size.");
  }

  const i32 bamOff = sectorOffset(kBamTrack, kBamSector);
  const u8 dirTrack = bytes[bamOff];
  const u8 dirSector = bytes[bamOff + 1];
  if (dirTrack != kDirTrack) {
    return mediaError(ErrorCode::InvalidBam, "BAM directory link points to the wrong track.");
  }

  std::vector<DiskFile> files;
  std::set<u32> visitedDir;
  u32 t = dirTrack;
  u32 s = dirSector;
  while (t != 0) {
    const i32 off = sectorOffset(t, s);
    if (off < 0) {
      return mediaError(ErrorCode::InvalidTrackSector, "Directory link references an invalid sector.");
    }
    const u32 key = t * 256 + s;
    if (visitedDir.count(key) != 0) {
      return mediaError(ErrorCode::ChainCycle, "Directory chain cycles.");
    }
    visitedDir.insert(key);
    for (int e = 0; e < 8; ++e) {
      const i32 eo = off + e * 32;
      const u8 fileType = bytes[eo + 2];
      if (fileType == 0) continue;
      DiskFile file;
      file.fileType = fileType;
      file.startTrack = bytes[eo + 3];
      file.startSector = bytes[eo + 4];
      file.nameLen = trimName(&bytes[eo + 5], file.name);
      file.blocks = static_cast<u16>(bytes[eo + 30] | (bytes[eo + 31] << 8));
      files.push_back(file);
    }
    const u8 nextT = bytes[off];
    const u8 nextS = bytes[off + 1];
    t = nextT;
    s = nextS;
  }

  // Validate every file chain (bounds + cycle) before accepting the disk.
  for (const DiskFile& file : files) {
    std::vector<u8> payload;
    Error err = Error::none();
    if (!walkFileChain(bytes, file.startTrack, file.startSector, payload, err)) {
      return mediaError(err.code, err.message);
    }
  }

  DiskMetadata meta;
  meta.diskNameLen = trimName(&bytes[bamOff + 0x90], meta.petsciiName);
  meta.diskName = petsciiToAscii(meta.petsciiName, meta.diskNameLen);
  meta.diskId0 = bytes[bamOff + 0xA2];
  meta.diskId1 = bytes[bamOff + 0xA3];
  meta.fileCount = static_cast<u32>(files.size());

  out.loaded = true;
  out.image.assign(bytes.begin(), bytes.begin() + kD64Size);  // exact image, error table dropped
  out.metadata = meta;
  out.files = files;

  result.ok = true;
  result.metadata = meta;
  result.warnings = warnings;
  return result;
}

bool extractFile(const Disk& disk, size_t fileIndex, std::vector<u8>& outPrg, Error& err) {
  if (!disk.loaded || fileIndex >= disk.files.size()) {
    err = Error::make(ErrorCode::InvalidTrackSector, "No such directory entry.");
    return false;
  }
  const DiskFile& file = disk.files[fileIndex];
  if ((file.fileType & 0x0F) != 0x02) {
    err = Error::make(ErrorCode::InvalidPrg, "Directory entry is not a PRG file.");
    return false;
  }
  if (!walkFileChain(disk.image, file.startTrack, file.startSector, outPrg, err)) return false;
  if (outPrg.size() < 3) {
    err = Error::make(ErrorCode::InvalidPrg, "Extracted PRG is too short.");
    return false;
  }
  // A PRG's load address plus its data length must not wrap past $FFFF (matches specs/MEDIA.md
  // and the JS extractPrg/parsePrg). This keeps the C++ drive path consistent with the pipeline.
  const u16 loadAddr = static_cast<u16>(outPrg[0] | (outPrg[1] << 8));
  const u32 endExclusive = static_cast<u32>(loadAddr) + static_cast<u32>(outPrg.size() - 2);
  if (endExclusive > 0x10000u) {
    err = Error::make(ErrorCode::InvalidPrg, "Extracted PRG data wraps past $FFFF.");
    return false;
  }
  return true;
}

}  // namespace c64
