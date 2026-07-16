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

void Cpu::reset(ResetKind kind) {
  if (kind == ResetKind::PowerOn) {
    a = 0;
    x = 0;
    y = 0;
    s = 0xFD;
    p = flag::U | flag::I;
  } else {
    // Warm reset preserves the register file; the reset micro-sequence performs three
    // suppressed stack accesses, leaving the stack pointer three lower, and sets I.
    s = static_cast<u8>(s - 3);
    p = static_cast<u8>(p | flag::U | flag::I);
  }
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
    // NMOS read-modify-write writes the unmodified value back (dummy write) before the final
    // value; on side-effecting I/O this second-write timing is observable.
    case 0xE6: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o + 1); wr(ad, v); setZN(v); break; }  // INC zp
    case 0xF6: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o + 1); wr(ad, v); setZN(v); break; }
    case 0xEE: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o + 1); wr(ad, v); setZN(v); break; }
    case 0xFE: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o + 1); wr(ad, v); setZN(v); break; }
    case 0xC6: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o - 1); wr(ad, v); setZN(v); break; }  // DEC zp
    case 0xD6: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o - 1); wr(ad, v); setZN(v); break; }
    case 0xCE: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o - 1); wr(ad, v); setZN(v); break; }
    case 0xDE: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); const u8 v = static_cast<u8>(o - 1); wr(ad, v); setZN(v); break; }
    case 0xE8: ++x; setZN(x); break;                        // INX
    case 0xC8: ++y; setZN(y); break;                        // INY
    case 0xCA: --x; setZN(x); break;                        // DEX
    case 0x88: --y; setZN(y); break;                        // DEY

    // ---- shifts / rotates (memory forms perform the NMOS dummy write) ----
    case 0x0A: a = doASL(a); break;                         // ASL A
    case 0x06: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); wr(ad, doASL(o)); break; }
    case 0x16: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); wr(ad, doASL(o)); break; }
    case 0x0E: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); wr(ad, doASL(o)); break; }
    case 0x1E: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); wr(ad, doASL(o)); break; }
    case 0x4A: a = doLSR(a); break;                         // LSR A
    case 0x46: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); wr(ad, doLSR(o)); break; }
    case 0x56: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); wr(ad, doLSR(o)); break; }
    case 0x4E: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); wr(ad, doLSR(o)); break; }
    case 0x5E: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); wr(ad, doLSR(o)); break; }
    case 0x2A: a = doROL(a); break;                         // ROL A
    case 0x26: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROL(o)); break; }
    case 0x36: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROL(o)); break; }
    case 0x2E: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROL(o)); break; }
    case 0x3E: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); wr(ad, doROL(o)); break; }
    case 0x6A: a = doROR(a); break;                         // ROR A
    case 0x66: { const u16 ad = amZp(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROR(o)); break; }
    case 0x76: { const u16 ad = amZpX(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROR(o)); break; }
    case 0x6E: { const u16 ad = amAbs(); const u8 o = rd(ad); wr(ad, o); wr(ad, doROR(o)); break; }
    case 0x7E: { const u16 ad = amAbsX(false); const u8 o = rd(ad); wr(ad, o); wr(ad, doROR(o)); break; }

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
// Mnemonics (documented NMOS set only).
enum M : u8 {
  ILL = 0, LDA, LDX, LDY, STA, STX, STY, TAX, TAY, TXA, TYA, TSX, TXS, PHA, PLA, PHP, PLP,
  AND, ORA, EOR, BIT, ADC, SBC, CMP, CPX, CPY, INC, DEC, INX, INY, DEX, DEY, ASL, LSR, ROL,
  ROR, JMP, JSR, RTS, RTI, BPL, BMI, BVC, BVS, BCC, BCS, BNE, BEQ, CLC, SEC, CLI, SEI, CLV,
  CLD, SED, NOP, BRK
};

// Addressing modes.
enum AM : u8 { IMP, ACC, IMM, ZP, ZPX, ZPY, ABS, ABX, ABY, IND, IZX, IZY, REL };

struct Dec {
  u8 m = ILL;
  u8 mode = IMP;
  u8 cycles = 2;
  bool cross = false;  // add +1 when an indexed read crosses a page boundary
};

struct DecodeTable {
  Dec e[256];
  DecodeTable() {
    auto set = [&](u8 op, M m, AM mode, u8 cyc, bool cross = false) {
      e[op] = Dec{static_cast<u8>(m), static_cast<u8>(mode), cyc, cross};
    };
    // Load / store
    set(0xA9, LDA, IMM, 2); set(0xA5, LDA, ZP, 3); set(0xB5, LDA, ZPX, 4);
    set(0xAD, LDA, ABS, 4); set(0xBD, LDA, ABX, 4, true); set(0xB9, LDA, ABY, 4, true);
    set(0xA1, LDA, IZX, 6); set(0xB1, LDA, IZY, 5, true);
    set(0xA2, LDX, IMM, 2); set(0xA6, LDX, ZP, 3); set(0xB6, LDX, ZPY, 4);
    set(0xAE, LDX, ABS, 4); set(0xBE, LDX, ABY, 4, true);
    set(0xA0, LDY, IMM, 2); set(0xA4, LDY, ZP, 3); set(0xB4, LDY, ZPX, 4);
    set(0xAC, LDY, ABS, 4); set(0xBC, LDY, ABX, 4, true);
    set(0x85, STA, ZP, 3); set(0x95, STA, ZPX, 4); set(0x8D, STA, ABS, 4);
    set(0x9D, STA, ABX, 5); set(0x99, STA, ABY, 5); set(0x81, STA, IZX, 6);
    set(0x91, STA, IZY, 6);
    set(0x86, STX, ZP, 3); set(0x96, STX, ZPY, 4); set(0x8E, STX, ABS, 4);
    set(0x84, STY, ZP, 3); set(0x94, STY, ZPX, 4); set(0x8C, STY, ABS, 4);
    // Transfers
    set(0xAA, TAX, IMP, 2); set(0xA8, TAY, IMP, 2); set(0x8A, TXA, IMP, 2);
    set(0x98, TYA, IMP, 2); set(0xBA, TSX, IMP, 2); set(0x9A, TXS, IMP, 2);
    // Stack
    set(0x48, PHA, IMP, 3); set(0x68, PLA, IMP, 4); set(0x08, PHP, IMP, 3);
    set(0x28, PLP, IMP, 4);
    // Logic
    set(0x29, AND, IMM, 2); set(0x25, AND, ZP, 3); set(0x35, AND, ZPX, 4);
    set(0x2D, AND, ABS, 4); set(0x3D, AND, ABX, 4, true); set(0x39, AND, ABY, 4, true);
    set(0x21, AND, IZX, 6); set(0x31, AND, IZY, 5, true);
    set(0x09, ORA, IMM, 2); set(0x05, ORA, ZP, 3); set(0x15, ORA, ZPX, 4);
    set(0x0D, ORA, ABS, 4); set(0x1D, ORA, ABX, 4, true); set(0x19, ORA, ABY, 4, true);
    set(0x01, ORA, IZX, 6); set(0x11, ORA, IZY, 5, true);
    set(0x49, EOR, IMM, 2); set(0x45, EOR, ZP, 3); set(0x55, EOR, ZPX, 4);
    set(0x4D, EOR, ABS, 4); set(0x5D, EOR, ABX, 4, true); set(0x59, EOR, ABY, 4, true);
    set(0x41, EOR, IZX, 6); set(0x51, EOR, IZY, 5, true);
    set(0x24, BIT, ZP, 3); set(0x2C, BIT, ABS, 4);
    // Arithmetic / comparison
    set(0x69, ADC, IMM, 2); set(0x65, ADC, ZP, 3); set(0x75, ADC, ZPX, 4);
    set(0x6D, ADC, ABS, 4); set(0x7D, ADC, ABX, 4, true); set(0x79, ADC, ABY, 4, true);
    set(0x61, ADC, IZX, 6); set(0x71, ADC, IZY, 5, true);
    set(0xE9, SBC, IMM, 2); set(0xE5, SBC, ZP, 3); set(0xF5, SBC, ZPX, 4);
    set(0xED, SBC, ABS, 4); set(0xFD, SBC, ABX, 4, true); set(0xF9, SBC, ABY, 4, true);
    set(0xE1, SBC, IZX, 6); set(0xF1, SBC, IZY, 5, true);
    set(0xC9, CMP, IMM, 2); set(0xC5, CMP, ZP, 3); set(0xD5, CMP, ZPX, 4);
    set(0xCD, CMP, ABS, 4); set(0xDD, CMP, ABX, 4, true); set(0xD9, CMP, ABY, 4, true);
    set(0xC1, CMP, IZX, 6); set(0xD1, CMP, IZY, 5, true);
    set(0xE0, CPX, IMM, 2); set(0xE4, CPX, ZP, 3); set(0xEC, CPX, ABS, 4);
    set(0xC0, CPY, IMM, 2); set(0xC4, CPY, ZP, 3); set(0xCC, CPY, ABS, 4);
    // Increment / decrement (RMW on memory)
    set(0xE6, INC, ZP, 5); set(0xF6, INC, ZPX, 6); set(0xEE, INC, ABS, 6);
    set(0xFE, INC, ABX, 7);
    set(0xC6, DEC, ZP, 5); set(0xD6, DEC, ZPX, 6); set(0xCE, DEC, ABS, 6);
    set(0xDE, DEC, ABX, 7);
    set(0xE8, INX, IMP, 2); set(0xC8, INY, IMP, 2); set(0xCA, DEX, IMP, 2);
    set(0x88, DEY, IMP, 2);
    // Shifts / rotates
    set(0x0A, ASL, ACC, 2); set(0x06, ASL, ZP, 5); set(0x16, ASL, ZPX, 6);
    set(0x0E, ASL, ABS, 6); set(0x1E, ASL, ABX, 7);
    set(0x4A, LSR, ACC, 2); set(0x46, LSR, ZP, 5); set(0x56, LSR, ZPX, 6);
    set(0x4E, LSR, ABS, 6); set(0x5E, LSR, ABX, 7);
    set(0x2A, ROL, ACC, 2); set(0x26, ROL, ZP, 5); set(0x36, ROL, ZPX, 6);
    set(0x2E, ROL, ABS, 6); set(0x3E, ROL, ABX, 7);
    set(0x6A, ROR, ACC, 2); set(0x66, ROR, ZP, 5); set(0x76, ROR, ZPX, 6);
    set(0x6E, ROR, ABS, 6); set(0x7E, ROR, ABX, 7);
    // Jumps / subroutines
    set(0x4C, JMP, ABS, 3); set(0x6C, JMP, IND, 5);
    set(0x20, JSR, ABS, 6); set(0x60, RTS, IMP, 6); set(0x40, RTI, IMP, 6);
    // Branches
    set(0x10, BPL, REL, 2); set(0x30, BMI, REL, 2); set(0x50, BVC, REL, 2);
    set(0x70, BVS, REL, 2); set(0x90, BCC, REL, 2); set(0xB0, BCS, REL, 2);
    set(0xD0, BNE, REL, 2); set(0xF0, BEQ, REL, 2);
    // Status flags
    set(0x18, CLC, IMP, 2); set(0x38, SEC, IMP, 2); set(0x58, CLI, IMP, 2);
    set(0x78, SEI, IMP, 2); set(0xB8, CLV, IMP, 2); set(0xD8, CLD, IMP, 2);
    set(0xF8, SED, IMP, 2);
    // System
    set(0xEA, NOP, IMP, 2); set(0x00, BRK, IMP, 7);
  }
};

const Dec& decode(u8 op) {
  static const DecodeTable table;
  return table.e[op];
}

}  // namespace

CpuOpcodeInfo cpuOpcodeInfo(u8 opcode) {
  const Dec& d = decode(opcode);
  return CpuOpcodeInfo{d.m != ILL, d.cycles, d.cross};
}

Cpu::Cpu(Bus& bus) : bus_(bus) {}

u16 Cpu::read16(u16 addr) {
  const u8 lo = read(addr);
  const u8 hi = read(static_cast<u16>(addr + 1));
  return static_cast<u16>(lo | (hi << 8));
}

u16 Cpu::peekVector(u16 addr) {
  const u8 lo = bus_.peek(addr);
  const u8 hi = bus_.peek(static_cast<u16>(addr + 1));
  return static_cast<u16>(lo | (hi << 8));
}

void Cpu::push(u8 v) {
  write(static_cast<u16>(0x0100 + sp_), v);
  sp_ = static_cast<u8>(sp_ - 1);
}

u8 Cpu::pull() {
  sp_ = static_cast<u8>(sp_ + 1);
  return read(static_cast<u16>(0x0100 + sp_));
}

void Cpu::setZN(u8 v) {
  setFlag(FlagZ, v == 0);
  setFlag(FlagN, (v & 0x80) != 0);
}

void Cpu::compare(u8 reg, u8 value) {
  const u16 t = static_cast<u16>(reg) - value;
  setFlag(FlagC, reg >= value);
  setZN(static_cast<u8>(t));
}

void Cpu::adc(u8 value) {
  const int carryIn = (p_ & FlagC) ? 1 : 0;
  if (p_ & FlagD) {
    // NMOS decimal ADC (Bruce Clark algorithm).
    int al = (a_ & 0x0F) + (value & 0x0F) + carryIn;
    if (al >= 0x0A) al = ((al + 0x06) & 0x0F) + 0x10;
    int a = (a_ & 0xF0) + (value & 0xF0) + al;
    setFlag(FlagN, (a & 0x80) != 0);
    setFlag(FlagV, ((a_ ^ a) & ~(a_ ^ value) & 0x80) != 0);
    if (a >= 0xA0) a += 0x60;
    setFlag(FlagC, a >= 0x100);
    const u16 bin = static_cast<u16>(static_cast<int>(a_) + value + carryIn);
    setFlag(FlagZ, (bin & 0xFF) == 0);
    a_ = static_cast<u8>(a & 0xFF);
  } else {
    const u16 sum = static_cast<u16>(static_cast<int>(a_) + value + carryIn);
    const u8 r = static_cast<u8>(sum);
    setFlag(FlagC, sum > 0xFF);
    setFlag(FlagV, ((a_ ^ r) & (value ^ r) & 0x80) != 0);
    a_ = r;
    setZN(a_);
  }
}

void Cpu::sbc(u8 value) {
  const int carryIn = (p_ & FlagC) ? 1 : 0;
  const int borrow = 1 - carryIn;
  const int bin = static_cast<int>(a_) - value - borrow;
  // N, V, Z, C are computed from the binary result on NMOS in both modes.
  setFlag(FlagC, bin >= 0);
  setFlag(FlagZ, (bin & 0xFF) == 0);
  setFlag(FlagN, (bin & 0x80) != 0);
  setFlag(FlagV, ((a_ ^ value) & (a_ ^ (bin & 0xFF)) & 0x80) != 0);
  if (p_ & FlagD) {
    int al = (a_ & 0x0F) - (value & 0x0F) - borrow;
    if (al < 0) al = ((al - 0x06) & 0x0F) - 0x10;
    int a = (a_ & 0xF0) - (value & 0xF0) + al;
    if (a < 0) a -= 0x60;
    a_ = static_cast<u8>(a & 0xFF);
  } else {
    a_ = static_cast<u8>(bin & 0xFF);
  }
}

void Cpu::branch(bool take, i8 offset, u32& cycles) {
  if (!take) return;
  cycles += 1;
  const u16 target = static_cast<u16>(pc_ + offset);
  if ((target & 0xFF00) != (pc_ & 0xFF00)) cycles += 1;
  pc_ = target;
}

void Cpu::serviceInterrupt(u16 vectorAddress, bool fromBrk) {
  // Hardware order: push PCH, PCL, and status first, then read the interrupt vector last. The
  // vector read is therefore the final bus access, which matters for open-bus behaviour.
  push(static_cast<u8>((pc_ >> 8) & 0xFF));
  push(static_cast<u8>(pc_ & 0xFF));
  u8 pushed = static_cast<u8>(p_ | FlagU);
  if (fromBrk) {
    pushed = static_cast<u8>(pushed | FlagB);
  } else {
    pushed = static_cast<u8>(pushed & ~FlagB);
  }
  push(pushed);
  setFlag(FlagI, true);
  pc_ = read16(vectorAddress);
}

void Cpu::powerOn() {
  a_ = x_ = y_ = 0;
  reset();
}

void Cpu::reset() {
  sp_ = 0xFD;
  p_ = FlagI | FlagU;
  extIrq_ = false;
  devIrq_ = false;
  nmiPending_ = false;
  iPollDelay_ = false;
  iPollValue_ = false;
  busCycles_ = 0;
  // The reset vector fetch does not tick devices: reset also resets the device clocks, so the
  // machine starts with the CPU and devices both at cycle 0.
  pc_ = peekVector(0xFFFC);
}

CpuState Cpu::state() const {
  CpuState s;
  s.pc = pc_;
  s.a = a_;
  s.x = x_;
  s.y = y_;
  s.sp = sp_;
  s.p = static_cast<u8>(p_ | FlagU);
  return s;
}

void Cpu::setState(const CpuState& s) {
  pc_ = s.pc;
  a_ = s.a;
  x_ = s.x;
  y_ = s.y;
  sp_ = s.sp;
  p_ = static_cast<u8>(s.p | FlagU);
}

StepResult Cpu::step() {
  busCycles_ = 0;

  // Effective I flag for this instruction's interrupt poll. CLI/SEI/PLP defer their I-flag
  // change by one instruction (NMOS quirk), so the poll here can use the pre-change value.
  bool effectiveI = (p_ & FlagI) != 0;
  if (iPollDelay_) {
    effectiveI = iPollValue_;
    iPollDelay_ = false;
  }

  // Service interrupts before fetching. NMI edge takes priority over a level IRQ.
  if (nmiPending_) {
    nmiPending_ = false;
    serviceInterrupt(0xFFFA, false);
    return StepResult{7, StepStop::None, 0, pc_};
  }
  if (irqAsserted() && !effectiveI) {
    serviceInterrupt(0xFFFE, false);
    return StepResult{7, StepStop::None, 0, pc_};
  }

  const u16 instrPc = pc_;
  const u8 opcode = fetch();
  const Dec& d = decode(opcode);
  if (d.m == ILL) {
    pc_ = instrPc;  // rewind; do not execute an undocumented opcode
    return StepResult{0, StepStop::IllegalOpcode, opcode, instrPc};
  }

  const AM mode = static_cast<AM>(d.mode);
  u32 cycles = d.cycles;
  u16 ea = 0;
  bool crossed = false;
  switch (mode) {
    case IMM:
      ea = pc_++;
      break;
    case ZP:
      ea = fetch();
      break;
    case ZPX:
      ea = static_cast<u8>(fetch() + x_);
      break;
    case ZPY:
      ea = static_cast<u8>(fetch() + y_);
      break;
    case ABS: {
      const u16 lo = fetch();
      const u16 hi = fetch();
      ea = static_cast<u16>(lo | (hi << 8));
      break;
    }
    case ABX: {
      const u16 lo = fetch();
      const u16 hi = fetch();
      const u16 base = static_cast<u16>(lo | (hi << 8));
      ea = static_cast<u16>(base + x_);
      crossed = ((base ^ ea) & 0xFF00) != 0;
      break;
    }
    case ABY: {
      const u16 lo = fetch();
      const u16 hi = fetch();
      const u16 base = static_cast<u16>(lo | (hi << 8));
      ea = static_cast<u16>(base + y_);
      crossed = ((base ^ ea) & 0xFF00) != 0;
      break;
    }
    case IND: {
      const u16 lo = fetch();
      const u16 hi = fetch();
      const u16 ptr = static_cast<u16>(lo | (hi << 8));
      // NMOS JMP (ind) page-boundary bug: the high byte is fetched from the same page.
      const u16 hiAddr = static_cast<u16>((ptr & 0xFF00) | ((ptr + 1) & 0x00FF));
      ea = static_cast<u16>(read(ptr) | (read(hiAddr) << 8));
      break;
    }
    case IZX: {
      const u8 zp = static_cast<u8>(fetch() + x_);
      const u16 lo = read(zp);
      const u16 hi = read(static_cast<u8>(zp + 1));
      ea = static_cast<u16>(lo | (hi << 8));
      break;
    }
    case IZY: {
      const u8 zp = fetch();
      const u16 lo = read(zp);
      const u16 hi = read(static_cast<u8>(zp + 1));
      const u16 base = static_cast<u16>(lo | (hi << 8));
      ea = static_cast<u16>(base + y_);
      crossed = ((base ^ ea) & 0xFF00) != 0;
      break;
    }
    default:  // IMP, ACC, REL
      break;
  }
  if (d.cross && crossed) cycles += 1;

  StepStop stop = StepStop::None;
  switch (static_cast<M>(d.m)) {
    case LDA: a_ = read(ea); setZN(a_); break;
    case LDX: x_ = read(ea); setZN(x_); break;
    case LDY: y_ = read(ea); setZN(y_); break;
    case STA: write(ea, a_); break;
    case STX: write(ea, x_); break;
    case STY: write(ea, y_); break;
    case TAX: x_ = a_; setZN(x_); break;
    case TAY: y_ = a_; setZN(y_); break;
    case TXA: a_ = x_; setZN(a_); break;
    case TYA: a_ = y_; setZN(a_); break;
    case TSX: x_ = sp_; setZN(x_); break;
    case TXS: sp_ = x_; break;
    case PHA: push(a_); break;
    case PHP: push(static_cast<u8>(p_ | FlagB | FlagU)); break;
    case PLA: a_ = pull(); setZN(a_); break;
    case PLP:
      // NMOS: the I-flag change is deferred one instruction for interrupt polling.
      iPollValue_ = (p_ & FlagI) != 0;
      iPollDelay_ = true;
      p_ = static_cast<u8>((pull() & ~FlagB) | FlagU);
      break;
    case AND: a_ = static_cast<u8>(a_ & read(ea)); setZN(a_); break;
    case ORA: a_ = static_cast<u8>(a_ | read(ea)); setZN(a_); break;
    case EOR: a_ = static_cast<u8>(a_ ^ read(ea)); setZN(a_); break;
    case BIT: {
      const u8 m = read(ea);
      setFlag(FlagZ, (a_ & m) == 0);
      p_ = static_cast<u8>((p_ & ~(FlagN | FlagV)) | (m & (FlagN | FlagV)));
      break;
    }
    case ADC: adc(read(ea)); break;
    case SBC: sbc(read(ea)); break;
    case CMP: compare(a_, read(ea)); break;
    case CPX: compare(x_, read(ea)); break;
    case CPY: compare(y_, read(ea)); break;
    case INC: {
      u8 m = read(ea);
      write(ea, m);  // RMW dummy write
      m = static_cast<u8>(m + 1);
      write(ea, m);
      setZN(m);
      break;
    }
    case DEC: {
      u8 m = read(ea);
      write(ea, m);
      m = static_cast<u8>(m - 1);
      write(ea, m);
      setZN(m);
      break;
    }
    case INX: x_ = static_cast<u8>(x_ + 1); setZN(x_); break;
    case INY: y_ = static_cast<u8>(y_ + 1); setZN(y_); break;
    case DEX: x_ = static_cast<u8>(x_ - 1); setZN(x_); break;
    case DEY: y_ = static_cast<u8>(y_ - 1); setZN(y_); break;
    case ASL: {
      if (mode == ACC) {
        setFlag(FlagC, (a_ & 0x80) != 0);
        a_ = static_cast<u8>(a_ << 1);
        setZN(a_);
      } else {
        u8 m = read(ea);
        write(ea, m);
        setFlag(FlagC, (m & 0x80) != 0);
        m = static_cast<u8>(m << 1);
        write(ea, m);
        setZN(m);
      }
      break;
    }
    case LSR: {
      if (mode == ACC) {
        setFlag(FlagC, (a_ & 0x01) != 0);
        a_ = static_cast<u8>(a_ >> 1);
        setZN(a_);
      } else {
        u8 m = read(ea);
        write(ea, m);
        setFlag(FlagC, (m & 0x01) != 0);
        m = static_cast<u8>(m >> 1);
        write(ea, m);
        setZN(m);
      }
      break;
    }
    case ROL: {
      const u8 cin = (p_ & FlagC) ? 1 : 0;
      if (mode == ACC) {
        setFlag(FlagC, (a_ & 0x80) != 0);
        a_ = static_cast<u8>((a_ << 1) | cin);
        setZN(a_);
      } else {
        u8 m = read(ea);
        write(ea, m);
        setFlag(FlagC, (m & 0x80) != 0);
        m = static_cast<u8>((m << 1) | cin);
        write(ea, m);
        setZN(m);
      }
      break;
    }
    case ROR: {
      const u8 cin = (p_ & FlagC) ? 0x80 : 0;
      if (mode == ACC) {
        setFlag(FlagC, (a_ & 0x01) != 0);
        a_ = static_cast<u8>((a_ >> 1) | cin);
        setZN(a_);
      } else {
        u8 m = read(ea);
        write(ea, m);
        setFlag(FlagC, (m & 0x01) != 0);
        m = static_cast<u8>((m >> 1) | cin);
        write(ea, m);
        setZN(m);
      }
      break;
    }
    case JMP: pc_ = ea; break;
    case JSR: {
      const u16 ret = static_cast<u16>(pc_ - 1);
      push(static_cast<u8>((ret >> 8) & 0xFF));
      push(static_cast<u8>(ret & 0xFF));
      pc_ = ea;
      break;
    }
    case RTS: {
      const u8 lo = pull();
      const u8 hi = pull();
      pc_ = static_cast<u16>((lo | (hi << 8)) + 1);
      break;
    }
    case RTI: {
      p_ = static_cast<u8>((pull() & ~FlagB) | FlagU);
      const u8 lo = pull();
      const u8 hi = pull();
      pc_ = static_cast<u16>(lo | (hi << 8));
      break;
    }
    case BPL: branch(!(p_ & FlagN), static_cast<i8>(fetch()), cycles); break;
    case BMI: branch((p_ & FlagN) != 0, static_cast<i8>(fetch()), cycles); break;
    case BVC: branch(!(p_ & FlagV), static_cast<i8>(fetch()), cycles); break;
    case BVS: branch((p_ & FlagV) != 0, static_cast<i8>(fetch()), cycles); break;
    case BCC: branch(!(p_ & FlagC), static_cast<i8>(fetch()), cycles); break;
    case BCS: branch((p_ & FlagC) != 0, static_cast<i8>(fetch()), cycles); break;
    case BNE: branch(!(p_ & FlagZ), static_cast<i8>(fetch()), cycles); break;
    case BEQ: branch((p_ & FlagZ) != 0, static_cast<i8>(fetch()), cycles); break;
    case CLC: setFlag(FlagC, false); break;
    case SEC: setFlag(FlagC, true); break;
    case CLI:
      iPollValue_ = (p_ & FlagI) != 0;
      iPollDelay_ = true;
      setFlag(FlagI, false);
      break;
    case SEI:
      iPollValue_ = (p_ & FlagI) != 0;
      iPollDelay_ = true;
      setFlag(FlagI, true);
      break;
    case CLV: setFlag(FlagV, false); break;
    case CLD: setFlag(FlagD, false); break;
    case SED: setFlag(FlagD, true); break;
    case NOP: break;
    case BRK: {
      pc_ = static_cast<u16>(pc_ + 1);  // BRK is 2 bytes; skip the signature byte
      serviceInterrupt(0xFFFE, true);
      stop = StepStop::Brk;
      break;
    }
    default:
      // Unreachable: ILL handled above.
      pc_ = instrPc;
      return StepResult{0, StepStop::IllegalOpcode, opcode, instrPc};
  }

  return StepResult{cycles, stop, opcode, instrPc};
}

}  // namespace c64
