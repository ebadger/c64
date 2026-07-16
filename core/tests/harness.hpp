// Shared helpers for the native CPU/machine tests.
#ifndef C64_TEST_HARNESS_HPP
#define C64_TEST_HARNESS_HPP

#include <initializer_list>
#include <string>
#include <vector>

#include "c64/machine.hpp"
#include "c64/media.hpp"
#include "c64/rom.hpp"

namespace c64test {

// Boot a machine with a synthetic (legally-clean) ROM set whose reset vector is $C000.
inline void boot(c64::Machine& m, c64::u8 seed = 0) {
  c64::MachineConfig cfg;
  cfg.timingProfile = "pal-6569";
  cfg.sidModel = "6581";
  cfg.powerOnSeed = seed;
  cfg.roms = c64::syntheticRomSet(0xC000, 0xC100, 0xC200);
  m.configure(cfg);
}

// Load code at `addr` and set the program counter there (direct-mode entry).
inline void loadCodeAt(c64::Machine& m, c64::u16 addr, std::initializer_list<c64::u8> code) {
  std::vector<c64::u8> prg;
  prg.push_back(static_cast<c64::u8>(addr & 0xFF));
  prg.push_back(static_cast<c64::u8>((addr >> 8) & 0xFF));
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(addr);
}

// Execute exactly one instruction; returns cycles consumed.
inline c64::u64 stepOne(c64::Machine& m) { return m.runCycles(1).cyclesExecuted; }

// Build a valid 174848-byte D64 containing a single PRG file, mirroring src/d64.js layout.
inline std::vector<c64::u8> makeD64(const std::string& name, const std::vector<c64::u8>& prg) {
  auto sectorsIn = [](int t) {
    if (t >= 1 && t <= 17) return 21;
    if (t >= 18 && t <= 24) return 19;
    if (t >= 25 && t <= 30) return 18;
    if (t >= 31 && t <= 35) return 17;
    return 0;
  };
  auto off = [&](int t, int s) {
    int cnt = 0;
    for (int i = 1; i < t; ++i) cnt += sectorsIn(i);
    return (cnt + s) * 256;
  };
  std::vector<c64::u8> img(174848, 0);
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
      img[o] = static_cast<c64::u8>(secs[i + 1].first);
      img[o + 1] = static_cast<c64::u8>(secs[i + 1].second);
    } else {
      img[o] = 0;
      img[o + 1] = static_cast<c64::u8>(len + 1);
    }
    for (int k = 0; k < len; ++k) img[o + 2 + k] = prg[start + k];
  }
  const int dir = off(18, 1);
  img[dir] = 0;
  img[dir + 1] = 0xFF;
  img[dir + 2] = 0x82;
  img[dir + 3] = static_cast<c64::u8>(secs[0].first);
  img[dir + 4] = static_cast<c64::u8>(secs[0].second);
  for (int i = 0; i < 16; ++i) img[dir + 5 + i] = 0xA0;
  for (size_t i = 0; i < name.size() && i < 16; ++i)
    img[dir + 5 + i] = static_cast<c64::u8>(name[i]);
  img[dir + 30] = static_cast<c64::u8>(numSectors & 0xFF);
  img[dir + 31] = static_cast<c64::u8>((numSectors >> 8) & 0xFF);
  const int bam = off(18, 0);
  img[bam] = 18;
  img[bam + 1] = 1;
  img[bam + 2] = 0x41;
  for (int i = 0; i < 16; ++i) img[bam + 0x90 + i] = 0xA0;
  const char* dn = "TESTDISK";
  for (int i = 0; dn[i]; ++i) img[bam + 0x90 + i] = static_cast<c64::u8>(dn[i]);
  img[bam + 0xA2] = 'I';
  img[bam + 0xA3] = 'D';
  return img;
}

}  // namespace c64test

#endif  // C64_TEST_HARNESS_HPP
