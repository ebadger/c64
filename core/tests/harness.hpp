// Shared helpers for the native CPU/machine tests.
#ifndef C64_TEST_HARNESS_HPP
#define C64_TEST_HARNESS_HPP

#include <initializer_list>
#include <vector>

#include "c64/machine.hpp"
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

}  // namespace c64test

#endif  // C64_TEST_HARNESS_HPP
