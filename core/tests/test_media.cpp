#include "c64/media.hpp"

#include <string>
#include <vector>

#include "test_framework.hpp"

using namespace c64;

namespace {

int sectorsIn(int t) {
  if (t >= 1 && t <= 17) return 21;
  if (t >= 18 && t <= 24) return 19;
  if (t >= 25 && t <= 30) return 18;
  if (t >= 31 && t <= 35) return 17;
  return 0;
}
int off(int t, int s) {
  int cnt = 0;
  for (int i = 1; i < t; ++i) cnt += sectorsIn(i);
  return (cnt + s) * 256;
}

// Build a valid 174848-byte D64 containing one PRG file, mirroring src/d64.js layout.
std::vector<u8> makeD64(const std::string& name, const std::vector<u8>& prg) {
  std::vector<u8> img(174848, 0);
  const int payloadPer = 254;
  const int numSectors = (static_cast<int>(prg.size()) + payloadPer - 1) / payloadPer;
  std::vector<std::pair<int, int>> secs;
  for (int t = 1; t <= 35 && static_cast<int>(secs.size()) < numSectors; ++t) {
    if (t == 18) continue;
    for (int s = 0; s < sectorsIn(t) && static_cast<int>(secs.size()) < numSectors; ++s) {
      secs.emplace_back(t, s);
    }
  }
  for (int i = 0; i < numSectors; ++i) {
    const int o = off(secs[i].first, secs[i].second);
    const int start = i * payloadPer;
    const int len = std::min(payloadPer, static_cast<int>(prg.size()) - start);
    if (i < numSectors - 1) {
      img[o] = static_cast<u8>(secs[i + 1].first);
      img[o + 1] = static_cast<u8>(secs[i + 1].second);
    } else {
      img[o] = 0;
      img[o + 1] = static_cast<u8>(len + 1);
    }
    for (int k = 0; k < len; ++k) img[o + 2 + k] = prg[start + k];
  }
  const int dir = off(18, 1);
  img[dir] = 0;
  img[dir + 1] = 0xFF;
  img[dir + 2] = 0x82;  // closed PRG
  img[dir + 3] = static_cast<u8>(secs[0].first);
  img[dir + 4] = static_cast<u8>(secs[0].second);
  for (int i = 0; i < 16; ++i) img[dir + 5 + i] = 0xA0;
  for (size_t i = 0; i < name.size() && i < 16; ++i) img[dir + 5 + i] = static_cast<u8>(name[i]);
  img[dir + 30] = static_cast<u8>(numSectors & 0xFF);
  img[dir + 31] = static_cast<u8>((numSectors >> 8) & 0xFF);
  const int bam = off(18, 0);
  img[bam] = 18;
  img[bam + 1] = 1;
  img[bam + 2] = 0x41;
  for (int i = 0; i < 16; ++i) img[bam + 0x90 + i] = 0xA0;
  const char* dn = "TESTDISK";
  for (int i = 0; dn[i]; ++i) img[bam + 0x90 + i] = static_cast<u8>(dn[i]);
  img[bam + 0xA2] = 'I';
  img[bam + 0xA3] = 'D';
  return img;
}

}  // namespace

TEST(media_parse_valid_disk) {
  const std::vector<u8> prg = {0x01, 0x08, 0xAA, 0xBB, 0xCC};
  const std::vector<u8> img = makeD64("PROG", prg);
  Disk disk;
  MediaResult r = parseD64(img, disk);
  CHECK(r.ok);
  CHECK(disk.loaded);
  CHECK_EQ(disk.files.size(), 1u);
  CHECK_EQ(disk.metadata.fileCount, 1u);
  CHECK_EQ(disk.files[0].nameLen, 4u);
  CHECK_EQ(disk.files[0].name[0], static_cast<u8>('P'));
}

TEST(media_extract_file_roundtrip) {
  const std::vector<u8> prg = {0x01, 0x08, 0xDE, 0xAD, 0xBE, 0xEF};
  const std::vector<u8> img = makeD64("PROG", prg);
  Disk disk;
  parseD64(img, disk);
  std::vector<u8> out;
  Error err = Error::none();
  CHECK(extractFile(disk, 0, out, err));
  CHECK_EQ(out.size(), prg.size());
  for (size_t i = 0; i < prg.size(); ++i) CHECK_EQ(out[i], prg[i]);
}

TEST(media_multi_sector_file) {
  // A file larger than one sector (>254 bytes) exercises the sector chain.
  std::vector<u8> prg = {0x00, 0x10};
  for (int i = 0; i < 600; ++i) prg.push_back(static_cast<u8>(i & 0xFF));
  const std::vector<u8> img = makeD64("BIG", prg);
  Disk disk;
  CHECK(parseD64(img, disk).ok);
  std::vector<u8> out;
  Error err = Error::none();
  CHECK(extractFile(disk, 0, out, err));
  CHECK_EQ(out.size(), prg.size());
  for (size_t i = 0; i < prg.size(); ++i) CHECK_EQ(out[i], prg[i]);
}

TEST(media_reject_wrong_size) {
  Disk disk;
  MediaResult r = parseD64(std::vector<u8>(1000, 0), disk);
  CHECK(!r.ok);
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::UnsupportedGeometry));
  CHECK(!disk.loaded);
}

TEST(media_reject_bad_bam_link) {
  std::vector<u8> img = makeD64("PROG", {0x01, 0x08, 0x11});
  img[off(18, 0)] = 17;  // BAM directory link points to the wrong track
  Disk disk;
  MediaResult r = parseD64(img, disk);
  CHECK(!r.ok);
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::InvalidBam));
}

TEST(media_reject_file_chain_out_of_bounds) {
  std::vector<u8> img = makeD64("PROG", {0x01, 0x08, 0x11});
  // Corrupt the file's start sector so the chain references an invalid sector.
  img[off(18, 1) + 4] = 99;  // start sector out of range for track 1
  Disk disk;
  MediaResult r = parseD64(img, disk);
  CHECK(!r.ok);
  CHECK_EQ(static_cast<int>(r.error.code), static_cast<int>(ErrorCode::InvalidTrackSector));
}

TEST(media_error_table_image_warns) {
  std::vector<u8> img = makeD64("PROG", {0x01, 0x08, 0x11});
  img.resize(175531, 0);  // append a 683-byte error table
  Disk disk;
  MediaResult r = parseD64(img, disk);
  CHECK(r.ok);
  CHECK_EQ(r.warnings.size(), 1u);
  CHECK_EQ(disk.image.size(), 174848u);  // error table dropped from the mounted image
}
