#include "c64/cpu.hpp"

#include <initializer_list>

namespace c64 {
namespace {

// Mnemonics (documented NMOS set plus the supported stable undocumented families).
enum M : u8 {
  ILL = 0, LDA, LDX, LDY, STA, STX, STY, TAX, TAY, TXA, TYA, TSX, TXS, PHA, PLA, PHP, PLP,
  AND, ORA, EOR, BIT, ADC, SBC, CMP, CPX, CPY, INC, DEC, INX, INY, DEX, DEY, ASL, LSR, ROL,
  ROR, JMP, JSR, RTS, RTI, BPL, BMI, BVC, BVS, BCC, BCS, BNE, BEQ, CLC, SEC, CLI, SEI, CLV,
  CLD, SED, NOP, BRK, LAX, SAX, DCP, ISC, SLO, RLA, SRE, RRA
};

// Addressing modes.
enum AM : u8 { IMP, ACC, IMM, ZP, ZPX, ZPY, ABS, ABX, ABY, IND, IZX, IZY, REL };

struct Dec {
  u8 m = ILL;
  u8 mode = IMP;
  u8 cycles = 2;
  bool cross = false;  // add +1 when an indexed read crosses a page boundary
  bool documented = false;
};

struct DecodeTable {
  Dec e[256];
  DecodeTable() {
    auto set = [&](u8 op, M m, AM mode, u8 cyc, bool cross = false) {
      e[op] = Dec{static_cast<u8>(m), static_cast<u8>(mode), cyc, cross, true};
    };
    auto setU = [&](u8 op, M m, AM mode, u8 cyc, bool cross = false) {
      e[op] = Dec{static_cast<u8>(m), static_cast<u8>(mode), cyc, cross, false};
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

    // Stable undocumented NOP variants. Operand-addressed forms still perform their read.
    for (u8 op : std::initializer_list<u8>{0x1A, 0x3A, 0x5A, 0x7A, 0xDA, 0xFA})
      setU(op, NOP, IMP, 2);
    for (u8 op : std::initializer_list<u8>{0x80, 0x82, 0x89, 0xC2, 0xE2})
      setU(op, NOP, IMM, 2);
    for (u8 op : std::initializer_list<u8>{0x04, 0x44, 0x64}) setU(op, NOP, ZP, 3);
    for (u8 op : std::initializer_list<u8>{0x14, 0x34, 0x54, 0x74, 0xD4, 0xF4})
      setU(op, NOP, ZPX, 4);
    setU(0x0C, NOP, ABS, 4);
    for (u8 op : std::initializer_list<u8>{0x1C, 0x3C, 0x5C, 0x7C, 0xDC, 0xFC})
      setU(op, NOP, ABX, 4, true);

    // Stable load/store combinations.
    setU(0xA3, LAX, IZX, 6); setU(0xA7, LAX, ZP, 3); setU(0xAF, LAX, ABS, 4);
    setU(0xB3, LAX, IZY, 5, true); setU(0xB7, LAX, ZPY, 4);
    setU(0xBF, LAX, ABY, 4, true);
    setU(0x83, SAX, IZX, 6); setU(0x87, SAX, ZP, 3); setU(0x8F, SAX, ABS, 4);
    setU(0x97, SAX, ZPY, 4);

    // Stable read-modify-write combinations.
    auto setRmw = [&](M m, u8 izx, u8 zp, u8 abs, u8 izy, u8 zpx, u8 aby, u8 abx) {
      setU(izx, m, IZX, 8); setU(zp, m, ZP, 5); setU(abs, m, ABS, 6);
      setU(izy, m, IZY, 8); setU(zpx, m, ZPX, 6); setU(aby, m, ABY, 7);
      setU(abx, m, ABX, 7);
    };
    setRmw(SLO, 0x03, 0x07, 0x0F, 0x13, 0x17, 0x1B, 0x1F);
    setRmw(RLA, 0x23, 0x27, 0x2F, 0x33, 0x37, 0x3B, 0x3F);
    setRmw(SRE, 0x43, 0x47, 0x4F, 0x53, 0x57, 0x5B, 0x5F);
    setRmw(RRA, 0x63, 0x67, 0x6F, 0x73, 0x77, 0x7B, 0x7F);
    setRmw(DCP, 0xC3, 0xC7, 0xCF, 0xD3, 0xD7, 0xDB, 0xDF);
    setRmw(ISC, 0xE3, 0xE7, 0xEF, 0xF3, 0xF7, 0xFB, 0xFF);

    setU(0xEB, SBC, IMM, 2);
  }
};

const Dec& decode(u8 op) {
  static const DecodeTable table;
  return table.e[op];
}

}  // namespace

CpuOpcodeInfo cpuOpcodeInfo(u8 opcode) {
  const Dec& d = decode(opcode);
  return CpuOpcodeInfo{d.documented, d.m != ILL, d.cycles, d.cross};
}

Cpu::Cpu(CpuBus& bus) : bus_(bus) {}

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
  soPending_ = false;
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
  soPending_ = false;
}

StepResult Cpu::step() {
  busCycles_ = 0;
  if (soPending_) {
    p_ = static_cast<u8>(p_ | FlagV);
    soPending_ = false;
  }

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
    case LAX: a_ = x_ = read(ea); setZN(a_); break;
    case STA: write(ea, a_); break;
    case STX: write(ea, x_); break;
    case STY: write(ea, y_); break;
    case SAX: write(ea, static_cast<u8>(a_ & x_)); break;
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
    case DCP: {
      u8 m = read(ea);
      write(ea, m);
      m = static_cast<u8>(m - 1);
      write(ea, m);
      compare(a_, m);
      break;
    }
    case ISC: {
      u8 m = read(ea);
      write(ea, m);
      m = static_cast<u8>(m + 1);
      write(ea, m);
      sbc(m);
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
    case SLO: {
      u8 m = read(ea);
      write(ea, m);
      setFlag(FlagC, (m & 0x80) != 0);
      m = static_cast<u8>(m << 1);
      write(ea, m);
      a_ = static_cast<u8>(a_ | m);
      setZN(a_);
      break;
    }
    case RLA: {
      const u8 cin = (p_ & FlagC) ? 1 : 0;
      u8 m = read(ea);
      write(ea, m);
      setFlag(FlagC, (m & 0x80) != 0);
      m = static_cast<u8>((m << 1) | cin);
      write(ea, m);
      a_ = static_cast<u8>(a_ & m);
      setZN(a_);
      break;
    }
    case SRE: {
      u8 m = read(ea);
      write(ea, m);
      setFlag(FlagC, (m & 0x01) != 0);
      m = static_cast<u8>(m >> 1);
      write(ea, m);
      a_ = static_cast<u8>(a_ ^ m);
      setZN(a_);
      break;
    }
    case RRA: {
      const u8 cin = (p_ & FlagC) ? 0x80 : 0;
      u8 m = read(ea);
      write(ea, m);
      setFlag(FlagC, (m & 0x01) != 0);
      m = static_cast<u8>((m >> 1) | cin);
      write(ea, m);
      adc(m);
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
    case NOP:
      if (mode != IMP) static_cast<void>(read(ea));
      break;
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
