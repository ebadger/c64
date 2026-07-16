#include "c64/cpu.hpp"

namespace c64 {
namespace {

// Base cycle counts for every documented NMOS opcode; undocumented opcodes are 0 and are
// treated as a fault at runtime. Page-crossing and branch-taken penalties are added by the
// addressing helpers and doBranch, so this table holds the no-penalty base only. Store and
// read-modify-write opcodes already include their fixed extra cycle here and never take the
// page-cross discount.
constexpr u8 kBaseCycles[256] = {
    /* 0x00 */ 7, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 0, 4, 6, 0,
    /* 0x10 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
    /* 0x20 */ 6, 6, 0, 0, 3, 3, 5, 0, 4, 2, 2, 0, 4, 4, 6, 0,
    /* 0x30 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
    /* 0x40 */ 6, 6, 0, 0, 0, 3, 5, 0, 3, 2, 2, 0, 3, 4, 6, 0,
    /* 0x50 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
    /* 0x60 */ 6, 6, 0, 0, 0, 3, 5, 0, 4, 2, 2, 0, 5, 4, 6, 0,
    /* 0x70 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
    /* 0x80 */ 0, 6, 0, 0, 3, 3, 3, 0, 2, 0, 2, 0, 4, 4, 4, 0,
    /* 0x90 */ 2, 6, 0, 0, 4, 4, 4, 0, 2, 5, 2, 0, 0, 5, 0, 0,
    /* 0xA0 */ 2, 6, 2, 0, 3, 3, 3, 0, 2, 2, 2, 0, 4, 4, 4, 0,
    /* 0xB0 */ 2, 5, 0, 0, 4, 4, 4, 0, 2, 4, 2, 0, 4, 4, 4, 0,
    /* 0xC0 */ 2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
    /* 0xD0 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
    /* 0xE0 */ 2, 6, 0, 0, 3, 3, 5, 0, 2, 2, 2, 0, 4, 4, 6, 0,
    /* 0xF0 */ 2, 5, 0, 0, 0, 4, 6, 0, 2, 4, 0, 0, 0, 4, 7, 0,
};

} // namespace

void Cpu::reset() {
  a = 0;
  x = 0;
  y = 0;
  s = 0xFD;
  p = flag::U | flag::I;
  pc = bus_.read16(0xFFFC);
  faulted_ = false;
}

void Cpu::serviceInterrupt(u16 vector, bool fromBrk) {
  push16(pc);
  u8 pushed = static_cast<u8>(p | flag::U);
  pushed = static_cast<u8>(fromBrk ? (pushed | flag::B) : (pushed & ~flag::B));
  push8(pushed);
  setFlag(flag::I, true);
  pc = bus_.read16(vector);
}

u8 Cpu::irq() {
  if (getFlag(flag::I)) {
    return 0;
  }
  serviceInterrupt(0xFFFE, false);
  return 7;
}

u8 Cpu::nmi() {
  serviceInterrupt(0xFFFA, false);
  return 7;
}

void Cpu::doADC(u8 value) {
  const int corg = getFlag(flag::C) ? 1 : 0;
  const int a0 = a;
  if (p & flag::D) {
    setFlag(flag::Z, ((a0 + value + corg) & 0xFF) == 0); // Z from binary sum (NMOS quirk)
    int al = (a0 & 0x0F) + (value & 0x0F) + corg;
    if (al >= 0x0A) {
      al = ((al + 0x06) & 0x0F) + 0x10;
    }
    int sum = (a0 & 0xF0) + (value & 0xF0) + al;
    setFlag(flag::N, (sum & 0x80) != 0);
    setFlag(flag::V, ((~(a0 ^ value) & (a0 ^ sum)) & 0x80) != 0);
    if (sum >= 0xA0) {
      sum += 0x60;
    }
    setFlag(flag::C, sum >= 0x100);
    a = static_cast<u8>(sum & 0xFF);
  } else {
    const int sum = a0 + value + corg;
    setFlag(flag::C, sum > 0xFF);
    setFlag(flag::V, ((~(a0 ^ value) & (a0 ^ sum)) & 0x80) != 0);
    a = static_cast<u8>(sum & 0xFF);
    setZN(a);
  }
}

void Cpu::doSBC(u8 value) {
  const int corg = getFlag(flag::C) ? 1 : 0;
  const int a0 = a;
  const int bin = a0 - value - (1 - corg); // flags come from the binary result in both modes
  setFlag(flag::C, bin >= 0);
  setFlag(flag::V, (((a0 ^ value) & (a0 ^ bin)) & 0x80) != 0);
  setFlag(flag::Z, (bin & 0xFF) == 0);
  setFlag(flag::N, (bin & 0x80) != 0);
  if (p & flag::D) {
    int al = (a0 & 0x0F) - (value & 0x0F) - (1 - corg);
    if (al < 0) {
      al = ((al - 0x06) & 0x0F) - 0x10;
    }
    int sum = (a0 & 0xF0) - (value & 0xF0) + al;
    if (sum < 0) {
      sum -= 0x60;
    }
    a = static_cast<u8>(sum & 0xFF);
  } else {
    a = static_cast<u8>(bin & 0xFF);
  }
}

void Cpu::doCompare(u8 reg, u8 value) {
  const int t = reg - value;
  setFlag(flag::C, reg >= value);
  setFlag(flag::Z, (t & 0xFF) == 0);
  setFlag(flag::N, (t & 0x80) != 0);
}

u8 Cpu::doASL(u8 value) {
  setFlag(flag::C, (value & 0x80) != 0);
  const u8 r = static_cast<u8>(value << 1);
  setZN(r);
  return r;
}

u8 Cpu::doLSR(u8 value) {
  setFlag(flag::C, (value & 0x01) != 0);
  const u8 r = static_cast<u8>(value >> 1);
  setZN(r);
  return r;
}

u8 Cpu::doROL(u8 value) {
  const bool carryIn = getFlag(flag::C);
  setFlag(flag::C, (value & 0x80) != 0);
  const u8 r = static_cast<u8>((value << 1) | (carryIn ? 0x01 : 0x00));
  setZN(r);
  return r;
}

u8 Cpu::doROR(u8 value) {
  const bool carryIn = getFlag(flag::C);
  setFlag(flag::C, (value & 0x01) != 0);
  const u8 r = static_cast<u8>((value >> 1) | (carryIn ? 0x80 : 0x00));
  setZN(r);
  return r;
}

void Cpu::doBranch(bool take, u8& cycles) {
  const i8 offset = static_cast<i8>(fetch8());
  if (take) {
    const u16 target = static_cast<u16>(pc + offset);
    cycles = static_cast<u8>(cycles + 1);
    if ((pc & 0xFF00) != (target & 0xFF00)) {
      cycles = static_cast<u8>(cycles + 1); // extra cycle when the branch crosses a page
    }
    pc = target;
  }
}

u8 Cpu::step() {
  if (faulted_) {
    return 1;
  }

  const u8 opcode = fetch8();
  u8 cycles = kBaseCycles[opcode];

  // Addressing-mode effective-address helpers. The abs,X / abs,Y / (ind),Y helpers add a
  // page-cross cycle only for read instructions (penalty == true).
  auto amZp = [&]() -> u16 { return fetch8(); };
  auto amZpX = [&]() -> u16 { return static_cast<u16>((fetch8() + x) & 0xFF); };
  auto amZpY = [&]() -> u16 { return static_cast<u16>((fetch8() + y) & 0xFF); };
  auto amAbs = [&]() -> u16 { return fetch16(); };
  auto amAbsX = [&](bool penalty) -> u16 {
    const u16 base = fetch16();
    const u16 addr = static_cast<u16>(base + x);
    if (penalty && ((base ^ addr) & 0xFF00)) {
      cycles = static_cast<u8>(cycles + 1);
    }
    return addr;
  };
  auto amAbsY = [&](bool penalty) -> u16 {
    const u16 base = fetch16();
    const u16 addr = static_cast<u16>(base + y);
    if (penalty && ((base ^ addr) & 0xFF00)) {
      cycles = static_cast<u8>(cycles + 1);
    }
    return addr;
  };
  auto amIzx = [&]() -> u16 {
    const u8 zp = static_cast<u8>((fetch8() + x) & 0xFF);
    const u16 lo = bus_.read8(zp);
    const u16 hi = bus_.read8(static_cast<u8>((zp + 1) & 0xFF));
    return static_cast<u16>(lo | (hi << 8));
  };
  auto amIzy = [&](bool penalty) -> u16 {
    const u8 zp = fetch8();
    const u16 lo = bus_.read8(zp);
    const u16 hi = bus_.read8(static_cast<u8>((zp + 1) & 0xFF));
    const u16 base = static_cast<u16>(lo | (hi << 8));
    const u16 addr = static_cast<u16>(base + y);
    if (penalty && ((base ^ addr) & 0xFF00)) {
      cycles = static_cast<u8>(cycles + 1);
    }
    return addr;
  };

  auto rd = [&](u16 addr) -> u8 { return bus_.read8(addr); };
  auto wr = [&](u16 addr, u8 value) { bus_.write8(addr, value); };

  switch (opcode) {
    // ---- LDA ----
    case 0xA9: a = fetch8(); setZN(a); break;               // imm
    case 0xA5: a = rd(amZp()); setZN(a); break;             // zp
    case 0xB5: a = rd(amZpX()); setZN(a); break;            // zp,X
    case 0xAD: a = rd(amAbs()); setZN(a); break;            // abs
    case 0xBD: a = rd(amAbsX(true)); setZN(a); break;       // abs,X
    case 0xB9: a = rd(amAbsY(true)); setZN(a); break;       // abs,Y
    case 0xA1: a = rd(amIzx()); setZN(a); break;            // (ind,X)
    case 0xB1: a = rd(amIzy(true)); setZN(a); break;        // (ind),Y

    // ---- LDX ----
    case 0xA2: x = fetch8(); setZN(x); break;               // imm
    case 0xA6: x = rd(amZp()); setZN(x); break;             // zp
    case 0xB6: x = rd(amZpY()); setZN(x); break;            // zp,Y
    case 0xAE: x = rd(amAbs()); setZN(x); break;            // abs
    case 0xBE: x = rd(amAbsY(true)); setZN(x); break;       // abs,Y

    // ---- LDY ----
    case 0xA0: y = fetch8(); setZN(y); break;               // imm
    case 0xA4: y = rd(amZp()); setZN(y); break;             // zp
    case 0xB4: y = rd(amZpX()); setZN(y); break;            // zp,X
    case 0xAC: y = rd(amAbs()); setZN(y); break;            // abs
    case 0xBC: y = rd(amAbsX(true)); setZN(y); break;       // abs,X

    // ---- STA ----
    case 0x85: wr(amZp(), a); break;                        // zp
    case 0x95: wr(amZpX(), a); break;                       // zp,X
    case 0x8D: wr(amAbs(), a); break;                       // abs
    case 0x9D: wr(amAbsX(false), a); break;                 // abs,X
    case 0x99: wr(amAbsY(false), a); break;                 // abs,Y
    case 0x81: wr(amIzx(), a); break;                       // (ind,X)
    case 0x91: wr(amIzy(false), a); break;                  // (ind),Y

    // ---- STX / STY ----
    case 0x86: wr(amZp(), x); break;                        // STX zp
    case 0x96: wr(amZpY(), x); break;                       // STX zp,Y
    case 0x8E: wr(amAbs(), x); break;                       // STX abs
    case 0x84: wr(amZp(), y); break;                        // STY zp
    case 0x94: wr(amZpX(), y); break;                       // STY zp,X
    case 0x8C: wr(amAbs(), y); break;                       // STY abs

    // ---- register transfers ----
    case 0xAA: x = a; setZN(x); break;                      // TAX
    case 0xA8: y = a; setZN(y); break;                      // TAY
    case 0x8A: a = x; setZN(a); break;                      // TXA
    case 0x98: a = y; setZN(a); break;                      // TYA
    case 0xBA: x = s; setZN(x); break;                      // TSX
    case 0x9A: s = x; break;                                // TXS (no flags)

    // ---- stack ----
    case 0x48: push8(a); break;                             // PHA
    case 0x68: a = pull8(); setZN(a); break;                // PLA
    case 0x08: push8(static_cast<u8>(p | flag::B | flag::U)); break; // PHP
    case 0x28: p = static_cast<u8>((pull8() & ~flag::B) | flag::U); break; // PLP

    // ---- logic ----
    case 0x29: a &= fetch8(); setZN(a); break;              // AND imm
    case 0x25: a &= rd(amZp()); setZN(a); break;
    case 0x35: a &= rd(amZpX()); setZN(a); break;
    case 0x2D: a &= rd(amAbs()); setZN(a); break;
    case 0x3D: a &= rd(amAbsX(true)); setZN(a); break;
    case 0x39: a &= rd(amAbsY(true)); setZN(a); break;
    case 0x21: a &= rd(amIzx()); setZN(a); break;
    case 0x31: a &= rd(amIzy(true)); setZN(a); break;

    case 0x09: a |= fetch8(); setZN(a); break;              // ORA imm
    case 0x05: a |= rd(amZp()); setZN(a); break;
    case 0x15: a |= rd(amZpX()); setZN(a); break;
    case 0x0D: a |= rd(amAbs()); setZN(a); break;
    case 0x1D: a |= rd(amAbsX(true)); setZN(a); break;
    case 0x19: a |= rd(amAbsY(true)); setZN(a); break;
    case 0x01: a |= rd(amIzx()); setZN(a); break;
    case 0x11: a |= rd(amIzy(true)); setZN(a); break;

    case 0x49: a ^= fetch8(); setZN(a); break;              // EOR imm
    case 0x45: a ^= rd(amZp()); setZN(a); break;
    case 0x55: a ^= rd(amZpX()); setZN(a); break;
    case 0x4D: a ^= rd(amAbs()); setZN(a); break;
    case 0x5D: a ^= rd(amAbsX(true)); setZN(a); break;
    case 0x59: a ^= rd(amAbsY(true)); setZN(a); break;
    case 0x41: a ^= rd(amIzx()); setZN(a); break;
    case 0x51: a ^= rd(amIzy(true)); setZN(a); break;

    case 0x24: { const u8 v = rd(amZp()); setFlag(flag::Z, (a & v) == 0); setFlag(flag::N, (v & 0x80) != 0); setFlag(flag::V, (v & 0x40) != 0); break; } // BIT zp
    case 0x2C: { const u8 v = rd(amAbs()); setFlag(flag::Z, (a & v) == 0); setFlag(flag::N, (v & 0x80) != 0); setFlag(flag::V, (v & 0x40) != 0); break; } // BIT abs

    // ---- arithmetic ----
    case 0x69: doADC(fetch8()); break;                      // ADC imm
    case 0x65: doADC(rd(amZp())); break;
    case 0x75: doADC(rd(amZpX())); break;
    case 0x6D: doADC(rd(amAbs())); break;
    case 0x7D: doADC(rd(amAbsX(true))); break;
    case 0x79: doADC(rd(amAbsY(true))); break;
    case 0x61: doADC(rd(amIzx())); break;
    case 0x71: doADC(rd(amIzy(true))); break;

    case 0xE9: doSBC(fetch8()); break;                      // SBC imm
    case 0xE5: doSBC(rd(amZp())); break;
    case 0xF5: doSBC(rd(amZpX())); break;
    case 0xED: doSBC(rd(amAbs())); break;
    case 0xFD: doSBC(rd(amAbsX(true))); break;
    case 0xF9: doSBC(rd(amAbsY(true))); break;
    case 0xE1: doSBC(rd(amIzx())); break;
    case 0xF1: doSBC(rd(amIzy(true))); break;

    case 0xC9: doCompare(a, fetch8()); break;               // CMP imm
    case 0xC5: doCompare(a, rd(amZp())); break;
    case 0xD5: doCompare(a, rd(amZpX())); break;
    case 0xCD: doCompare(a, rd(amAbs())); break;
    case 0xDD: doCompare(a, rd(amAbsX(true))); break;
    case 0xD9: doCompare(a, rd(amAbsY(true))); break;
    case 0xC1: doCompare(a, rd(amIzx())); break;
    case 0xD1: doCompare(a, rd(amIzy(true))); break;

    case 0xE0: doCompare(x, fetch8()); break;               // CPX
    case 0xE4: doCompare(x, rd(amZp())); break;
    case 0xEC: doCompare(x, rd(amAbs())); break;
    case 0xC0: doCompare(y, fetch8()); break;               // CPY
    case 0xC4: doCompare(y, rd(amZp())); break;
    case 0xCC: doCompare(y, rd(amAbs())); break;

    // ---- increment / decrement ----
    case 0xE6: { const u16 ad = amZp(); u8 v = static_cast<u8>(rd(ad) + 1); wr(ad, v); setZN(v); break; }  // INC zp
    case 0xF6: { const u16 ad = amZpX(); u8 v = static_cast<u8>(rd(ad) + 1); wr(ad, v); setZN(v); break; }
    case 0xEE: { const u16 ad = amAbs(); u8 v = static_cast<u8>(rd(ad) + 1); wr(ad, v); setZN(v); break; }
    case 0xFE: { const u16 ad = amAbsX(false); u8 v = static_cast<u8>(rd(ad) + 1); wr(ad, v); setZN(v); break; }
    case 0xC6: { const u16 ad = amZp(); u8 v = static_cast<u8>(rd(ad) - 1); wr(ad, v); setZN(v); break; }  // DEC zp
    case 0xD6: { const u16 ad = amZpX(); u8 v = static_cast<u8>(rd(ad) - 1); wr(ad, v); setZN(v); break; }
    case 0xCE: { const u16 ad = amAbs(); u8 v = static_cast<u8>(rd(ad) - 1); wr(ad, v); setZN(v); break; }
    case 0xDE: { const u16 ad = amAbsX(false); u8 v = static_cast<u8>(rd(ad) - 1); wr(ad, v); setZN(v); break; }
    case 0xE8: ++x; setZN(x); break;                        // INX
    case 0xC8: ++y; setZN(y); break;                        // INY
    case 0xCA: --x; setZN(x); break;                        // DEX
    case 0x88: --y; setZN(y); break;                        // DEY

    // ---- shifts / rotates ----
    case 0x0A: a = doASL(a); break;                         // ASL A
    case 0x06: { const u16 ad = amZp(); wr(ad, doASL(rd(ad))); break; }
    case 0x16: { const u16 ad = amZpX(); wr(ad, doASL(rd(ad))); break; }
    case 0x0E: { const u16 ad = amAbs(); wr(ad, doASL(rd(ad))); break; }
    case 0x1E: { const u16 ad = amAbsX(false); wr(ad, doASL(rd(ad))); break; }
    case 0x4A: a = doLSR(a); break;                         // LSR A
    case 0x46: { const u16 ad = amZp(); wr(ad, doLSR(rd(ad))); break; }
    case 0x56: { const u16 ad = amZpX(); wr(ad, doLSR(rd(ad))); break; }
    case 0x4E: { const u16 ad = amAbs(); wr(ad, doLSR(rd(ad))); break; }
    case 0x5E: { const u16 ad = amAbsX(false); wr(ad, doLSR(rd(ad))); break; }
    case 0x2A: a = doROL(a); break;                         // ROL A
    case 0x26: { const u16 ad = amZp(); wr(ad, doROL(rd(ad))); break; }
    case 0x36: { const u16 ad = amZpX(); wr(ad, doROL(rd(ad))); break; }
    case 0x2E: { const u16 ad = amAbs(); wr(ad, doROL(rd(ad))); break; }
    case 0x3E: { const u16 ad = amAbsX(false); wr(ad, doROL(rd(ad))); break; }
    case 0x6A: a = doROR(a); break;                         // ROR A
    case 0x66: { const u16 ad = amZp(); wr(ad, doROR(rd(ad))); break; }
    case 0x76: { const u16 ad = amZpX(); wr(ad, doROR(rd(ad))); break; }
    case 0x6E: { const u16 ad = amAbs(); wr(ad, doROR(rd(ad))); break; }
    case 0x7E: { const u16 ad = amAbsX(false); wr(ad, doROR(rd(ad))); break; }

    // ---- jumps / subroutines ----
    case 0x4C: pc = fetch16(); break;                       // JMP abs
    case 0x6C: { const u16 ptr = fetch16(); pc = bus_.read16Bug(ptr); break; } // JMP (ind) with NMOS bug
    case 0x20: { const u16 target = fetch16(); push16(static_cast<u16>(pc - 1)); pc = target; break; } // JSR
    case 0x60: pc = static_cast<u16>(pull16() + 1); break;  // RTS
    case 0x40: { p = static_cast<u8>((pull8() & ~flag::B) | flag::U); pc = pull16(); break; } // RTI

    // ---- branches ----
    case 0x10: doBranch(!getFlag(flag::N), cycles); break;  // BPL
    case 0x30: doBranch(getFlag(flag::N), cycles); break;   // BMI
    case 0x50: doBranch(!getFlag(flag::V), cycles); break;  // BVC
    case 0x70: doBranch(getFlag(flag::V), cycles); break;   // BVS
    case 0x90: doBranch(!getFlag(flag::C), cycles); break;  // BCC
    case 0xB0: doBranch(getFlag(flag::C), cycles); break;   // BCS
    case 0xD0: doBranch(!getFlag(flag::Z), cycles); break;  // BNE
    case 0xF0: doBranch(getFlag(flag::Z), cycles); break;   // BEQ

    // ---- flag operations ----
    case 0x18: setFlag(flag::C, false); break;              // CLC
    case 0x38: setFlag(flag::C, true); break;               // SEC
    case 0x58: setFlag(flag::I, false); break;              // CLI
    case 0x78: setFlag(flag::I, true); break;               // SEI
    case 0xB8: setFlag(flag::V, false); break;              // CLV
    case 0xD8: setFlag(flag::D, false); break;              // CLD
    case 0xF8: setFlag(flag::D, true); break;               // SED

    // ---- system ----
    case 0xEA: break;                                       // NOP
    case 0x00: {                                            // BRK
      ++pc; // BRK has a padding byte that is skipped
      serviceInterrupt(0xFFFE, true);
      break;
    }

    default:
      // Undocumented / unsupported opcode: stop deterministically with a fault instead of
      // guessing an illegal-opcode behaviour that is out of scope for this core.
      faulted_ = true;
      return cycles == 0 ? static_cast<u8>(2) : cycles;
  }

  return cycles;
}

} // namespace c64
