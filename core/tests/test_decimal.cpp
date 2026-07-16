#include <utility>
#include <vector>

#include "c64/cpu.hpp"
#include "c64/machine.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

namespace {

// Run one decimal ADC: SED; (SEC|CLC); LDA #a; ADC #b; store result and status.
std::pair<int, int> decAdc(u8 a, u8 b, bool carryIn) {
  Machine m;
  boot(m);
  std::vector<u8> prg = {
      0x00, 0xC0,
      0xF8,                                   // SED
      static_cast<u8>(carryIn ? 0x38 : 0x18), // SEC/CLC
      0xA9, a,                                // LDA #a
      0x69, b,                                // ADC #b
      0x85, 0x20,                             // STA $20
      0x08, 0x68, 0x85, 0x21,                 // PHP; PLA; STA $21
      0x00,                                   // BRK
  };
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(200);
  return {m.debugReadRam(0x20), (m.debugReadRam(0x21) & FlagC) ? 1 : 0};
}

std::pair<int, int> decSbc(u8 a, u8 b, bool carryIn) {
  Machine m;
  boot(m);
  std::vector<u8> prg = {
      0x00, 0xC0,
      0xF8,
      static_cast<u8>(carryIn ? 0x38 : 0x18),
      0xA9, a,
      0xE9, b,                                // SBC #b
      0x85, 0x20,
      0x08, 0x68, 0x85, 0x21,
      0x00,
  };
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(200);
  return {m.debugReadRam(0x20), (m.debugReadRam(0x21) & FlagC) ? 1 : 0};
}

}  // namespace

TEST(decimal_adc_golden) {
  struct Case {
    u8 a, b;
    bool cin;
    int result, carry;
  };
  const Case cases[] = {
      {0x05, 0x05, false, 0x10, 0}, {0x09, 0x09, false, 0x18, 0},
      {0x09, 0x09, true, 0x19, 0},  {0x50, 0x50, false, 0x00, 1},
      {0x99, 0x01, false, 0x00, 1}, {0x99, 0x99, false, 0x98, 1},
      {0x12, 0x34, false, 0x46, 0}, {0x58, 0x46, false, 0x04, 1},
  };
  for (const Case& c : cases) {
    std::pair<int, int> got = decAdc(c.a, c.b, c.cin);
    CHECK_EQ(got.first, c.result);
    CHECK_EQ(got.second, c.carry);
  }
}

TEST(decimal_sbc_golden) {
  struct Case {
    u8 a, b;
    bool cin;
    int result, carry;
  };
  const Case cases[] = {
      {0x00, 0x01, true, 0x99, 0},  {0x50, 0x25, true, 0x25, 1},
      {0x00, 0x00, true, 0x00, 1},  {0x05, 0x03, false, 0x01, 1},
      {0x46, 0x12, true, 0x34, 1},  {0x12, 0x21, true, 0x91, 0},
  };
  for (const Case& c : cases) {
    std::pair<int, int> got = decSbc(c.a, c.b, c.cin);
    CHECK_EQ(got.first, c.result);
    CHECK_EQ(got.second, c.carry);
  }
}

TEST(decimal_zero_flag_binary_semantics) {
  // NMOS: in decimal mode the Z flag reflects the *binary* sum. 0x99 + 0x01 = 0x9A binary
  // (non-zero) even though the BCD result is 0x00, so Z must be clear.
  Machine m;
  boot(m);
  std::vector<u8> prg = {0x00, 0xC0, 0xF8, 0x18, 0xA9, 0x99, 0x69, 0x01, 0x08, 0x68, 0x85,
                         0x21, 0x00};
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(200);
  CHECK(!(m.debugReadRam(0x21) & FlagZ));
}
