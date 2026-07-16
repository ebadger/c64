// Standard 1541 35-track D64 validation and file extraction for the emulated drive.
//
// This mirrors the deterministic byte layout of the JavaScript media pipeline (src/d64.js): a
// 174848-byte image, BAM at 18/0, directory chain from 18/1, and file sector chains with a
// final-sector length byte. It validates geometry, the BAM directory link, the directory chain,
// and every file chain (bounds + cycle), then hands the drive an immutable copy. Full
// BAM-consistency validation (free-count/bitmap agreement) is a tracked follow-up (ebadger/c64#2)
// and is not performed here. See specs/MEDIA.md.
#ifndef C64_MEDIA_HPP
#define C64_MEDIA_HPP

#include <array>
#include <string>
#include <vector>

#include "c64/result.hpp"
#include "c64/types.hpp"

namespace c64 {

constexpr u32 kD64Size = 174848;
constexpr u32 kD64SizeWithErrors = 175531;

// Sectors on a one-based track (0 if out of range).
u32 sectorsInTrack(u32 track);
// Byte offset of a track/sector, or -1 (as i32) if out of range.
i32 sectorOffset(u32 track, u32 sector);

struct DiskFile {
  u8 fileType = 0;
  u8 startTrack = 0;
  u8 startSector = 0;
  u8 nameLen = 0;
  std::array<u8, 16> name{};  // raw PETSCII, trailing $A0 padding stripped (nameLen bytes valid)
  u16 blocks = 0;
};

struct DiskMetadata {
  std::string diskName;             // ASCII approximation of the PETSCII disk label
  std::array<u8, 16> petsciiName{};
  u8 diskNameLen = 0;
  u8 diskId0 = 0, diskId1 = 0;
  u32 fileCount = 0;
};

// A validated, immutable mounted disk.
struct Disk {
  bool loaded = false;
  std::vector<u8> image;  // exact 174848 bytes (error table, if present, is not copied)
  DiskMetadata metadata;
  std::vector<DiskFile> files;
};

struct MediaResult {
  bool ok = false;
  DiskMetadata metadata;
  std::vector<std::string> warnings;
  Error error = Error::none();
};

// Validate a D64 image and, on success, fill `out` with an immutable mounted disk.
MediaResult parseD64(const std::vector<u8>& bytes, Disk& out);

// Reconstruct a file's raw PRG byte stream (2-byte load address + data) by walking its chain.
bool extractFile(const Disk& disk, size_t fileIndex, std::vector<u8>& outPrg, Error& err);

}  // namespace c64

#endif  // C64_MEDIA_HPP
