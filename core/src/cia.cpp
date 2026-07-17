#include "c64/cia.hpp"

namespace c64 {

Cia::Cia(Variant variant) : variant_(variant) {}

void Cia::configure(u32 cyclesPerFrame) { cyclesPerFrame_ = cyclesPerFrame ? cyclesPerFrame : 1; }

void Cia::reset() {
  pra_ = prb_ = ddra_ = ddrb_ = 0;
  pb6Out_ = pb7Out_ = 0;
  pb6Pulse_ = pb7Pulse_ = false;
  counterA_ = latchA_ = 0xFFFF;
  counterB_ = latchB_ = 0xFFFF;
  cra_ = crb_ = 0;
  intData_ = mask_ = 0;
  sdr_ = 0;
  todTenth_ = todSec_ = todMin_ = 0;
  todHr_ = 1;
  almTenth_ = almSec_ = almMin_ = almHr_ = 0;
  latchTenth_ = latchSec_ = latchMin_ = 0;
  latchHr_ = 1;
  todLatched_ = false;
  todHalted_ = true;
  todCycleAccum_ = 0;
  // Host input is preserved across a reset (it reflects current physical state, not chip state).
}

u8 Cia::bcdInc(u8 value, u8 max) {
  u8 lo = value & 0x0F;
  u8 hi = (value >> 4) & 0x0F;
  ++lo;
  if (lo > 9) {
    lo = 0;
    ++hi;
  }
  u8 result = static_cast<u8>((hi << 4) | lo);
  if (result > max) result = 0;
  return result;
}

u8 Cia::portAPins() const {
  u8 val = static_cast<u8>(((pra_ & ddra_) | (~ddra_ & 0xFF)) & portAInputs_);
  if (variant_ == Variant::Cia1) {
    val &= joy2_;  // joystick 2 shares CIA1 port A
    // Reverse keyboard scan: rows driven low on port B pull their columns low.
    const u8 pbDrive = static_cast<u8>((prb_ & ddrb_) | (~ddrb_ & 0xFF));
    for (u8 col = 0; col < 8; ++col) {
      const u8 pressedRows = static_cast<u8>(~keyboard_[col] & 0xFF);  // 1 = pressed
      if (pressedRows & static_cast<u8>(~pbDrive & 0xFF)) {
        val = static_cast<u8>(val & ~(1u << col));
      }
    }
  }
  return val;
}

u8 Cia::portBPins() const {
  u8 val = static_cast<u8>((prb_ & ddrb_) | (~ddrb_ & 0xFF));
  if (variant_ == Variant::Cia1) {
    val &= joy1_;  // joystick 1 shares CIA1 port B
    // Forward keyboard scan: for each column driven low on port A, pull its pressed rows low.
    const u8 paDrive = static_cast<u8>((pra_ & ddra_) | (~ddra_ & 0xFF));
    for (u8 col = 0; col < 8; ++col) {
      if ((paDrive & (1u << col)) == 0) val &= keyboard_[col];
    }
  }
  // Timer PB6/PB7 outputs override the port bits when enabled (PBON).
  if (cra_ & 0x02) {
    const bool level = (cra_ & 0x04) ? (pb6Out_ != 0) : pb6Pulse_;
    val = static_cast<u8>(level ? (val | 0x40) : (val & ~0x40));
  }
  if (crb_ & 0x02) {
    const bool level = (crb_ & 0x04) ? (pb7Out_ != 0) : pb7Pulse_;
    val = static_cast<u8>(level ? (val | 0x80) : (val & ~0x80));
  }
  return val;
}

u8 Cia::vicBank() const {
  const u8 paPins = static_cast<u8>((pra_ & ddra_) | (~ddra_ & 0xFF));
  return static_cast<u8>((~paPins) & 0x03);
}

void Cia::setInterrupt(u8 bit) { intData_ = static_cast<u8>(intData_ | (bit & 0x1F)); }

void Cia::tickTimers() {
  pb6Pulse_ = false;
  pb7Pulse_ = false;

  bool taUnderflow = false;
  if (cra_ & 0x01) {                 // timer A running
    if ((cra_ & 0x20) == 0) {        // INMODE = phi2 (CNT input is idle, deterministic no-count)
      if (counterA_ == 0) {
        counterA_ = latchA_;
        taUnderflow = true;
      } else {
        --counterA_;
      }
    }
  }
  if (taUnderflow) {
    setInterrupt(0x01);
    if (cra_ & 0x04) {
      pb6Out_ ^= 1;  // toggle mode
    } else {
      pb6Pulse_ = true;  // pulse mode: high for this cycle
    }
    if (cra_ & 0x08) cra_ = static_cast<u8>(cra_ & ~0x01);  // one-shot: stop
  }

  bool tbUnderflow = false;
  if (crb_ & 0x01) {                 // timer B running
    const u8 inmode = static_cast<u8>((crb_ >> 5) & 0x03);
    bool count = false;
    if (inmode == 0) {
      count = true;         // phi2
    } else if (inmode == 2) {
      count = taUnderflow;  // chain: count timer A underflows
    }
    // inmode 1 (CNT) and 3 (TA underflow while CNT high): CNT idle -> deterministic no-count.
    if (count) {
      if (counterB_ == 0) {
        counterB_ = latchB_;
        tbUnderflow = true;
      } else {
        --counterB_;
      }
    }
  }
  if (tbUnderflow) {
    setInterrupt(0x02);
    if (crb_ & 0x04) {
      pb7Out_ ^= 1;
    } else {
      pb7Pulse_ = true;
    }
    if (crb_ & 0x08) crb_ = static_cast<u8>(crb_ & ~0x01);
  }
}

void Cia::tickTod() {
  // TOD advances 10 times per second from the 50/60 Hz frame source. CRA bit7 selects the
  // divider (50 Hz -> /5, 60 Hz -> /6), so a matching setting yields exactly 10 Hz.
  const u32 framesPerTenth = (cra_ & 0x80) ? 5u : 6u;
  const u64 cyclesPerTenth = static_cast<u64>(framesPerTenth) * cyclesPerFrame_;
  ++todCycleAccum_;
  if (todCycleAccum_ < cyclesPerTenth) return;
  todCycleAccum_ -= cyclesPerTenth;
  if (todHalted_) return;

  u8 t = static_cast<u8>(todTenth_ + 1);
  bool carry = false;
  if (t > 9) {
    t = 0;
    carry = true;
  }
  todTenth_ = t;
  if (carry) {
    const u8 s = bcdInc(todSec_, 0x59);
    carry = (s == 0);
    todSec_ = s;
    if (carry) {
      const u8 mn = bcdInc(todMin_, 0x59);
      carry = (mn == 0);
      todMin_ = mn;
      if (carry) {
        // Hours 1..12 BCD with AM/PM in bit7. 12 -> 1 toggles AM/PM.
        u8 pm = static_cast<u8>(todHr_ & 0x80);
        u8 hr = static_cast<u8>(todHr_ & 0x1F);
        hr = bcdInc(hr, 0x99);
        if (hr == 0x12) {
          pm ^= 0x80;
        } else if (hr > 0x12) {
          hr = 0x01;
        }
        todHr_ = static_cast<u8>(hr | pm);
      }
    }
  }
  if (todTenth_ == almTenth_ && todSec_ == almSec_ && todMin_ == almMin_ && todHr_ == almHr_) {
    setInterrupt(0x04);
  }
}

void Cia::tickCycle() {
  tickTimers();
  tickTod();
}

u8 Cia::read(u8 reg, bool sideEffects) {
  reg = static_cast<u8>(reg & 0x0F);
  switch (reg) {
    case 0x0:
      return portAPins();
    case 0x1:
      return portBPins();
    case 0x2:
      return ddra_;
    case 0x3:
      return ddrb_;
    case 0x4:
      return static_cast<u8>(counterA_ & 0xFF);
    case 0x5:
      return static_cast<u8>((counterA_ >> 8) & 0xFF);
    case 0x6:
      return static_cast<u8>(counterB_ & 0xFF);
    case 0x7:
      return static_cast<u8>((counterB_ >> 8) & 0xFF);
    case 0x8:  // TOD 10ths (releases the read latch)
      if (todLatched_) {
        if (sideEffects) todLatched_ = false;
        return latchTenth_;
      }
      return todTenth_;
    case 0x9:
      return todLatched_ ? latchSec_ : todSec_;
    case 0xA:
      return todLatched_ ? latchMin_ : todMin_;
    case 0xB:  // TOD hours (latches the snapshot)
      if (sideEffects && !todLatched_) {
        latchTenth_ = todTenth_;
        latchSec_ = todSec_;
        latchMin_ = todMin_;
        latchHr_ = todHr_;
        todLatched_ = true;
      }
      return todLatched_ ? latchHr_ : todHr_;
    case 0xC:
      return sdr_;
    case 0xD: {  // ICR: read returns pending sources + IR flag, then clears them
      u8 value = static_cast<u8>(intData_ & 0x1F);
      if (irqAsserted()) value = static_cast<u8>(value | 0x80);
      if (sideEffects) intData_ = 0;
      return value;
    }
    case 0xE:
      return static_cast<u8>(cra_ & ~0x10);
    case 0xF:
      return static_cast<u8>(crb_ & ~0x10);
    default:
      return 0;
  }
}

void Cia::write(u8 reg, u8 value) {
  reg = static_cast<u8>(reg & 0x0F);
  switch (reg) {
    case 0x0:
      pra_ = value;
      break;
    case 0x1:
      prb_ = value;
      break;
    case 0x2:
      ddra_ = value;
      break;
    case 0x3:
      ddrb_ = value;
      break;
    case 0x4:
      latchA_ = static_cast<u16>((latchA_ & 0xFF00) | value);
      break;
    case 0x5:
      latchA_ = static_cast<u16>((latchA_ & 0x00FF) | (value << 8));
      if ((cra_ & 0x01) == 0) counterA_ = latchA_;  // load counter when stopped
      break;
    case 0x6:
      latchB_ = static_cast<u16>((latchB_ & 0xFF00) | value);
      break;
    case 0x7:
      latchB_ = static_cast<u16>((latchB_ & 0x00FF) | (value << 8));
      if ((crb_ & 0x01) == 0) counterB_ = latchB_;
      break;
    case 0x8:  // TOD/alarm 10ths (writing 10ths restarts a halted clock)
      if (crb_ & 0x80) {
        almTenth_ = static_cast<u8>(value & 0x0F);
      } else {
        todTenth_ = static_cast<u8>(value & 0x0F);
        todHalted_ = false;
      }
      break;
    case 0x9:
      if (crb_ & 0x80) {
        almSec_ = static_cast<u8>(value & 0x7F);
      } else {
        todSec_ = static_cast<u8>(value & 0x7F);
      }
      break;
    case 0xA:
      if (crb_ & 0x80) {
        almMin_ = static_cast<u8>(value & 0x7F);
      } else {
        todMin_ = static_cast<u8>(value & 0x7F);
      }
      break;
    case 0xB:  // TOD/alarm hours; writing the clock hours halts TOD until 10ths is written
      if (crb_ & 0x80) {
        almHr_ = static_cast<u8>(value & 0x9F);
      } else {
        todHr_ = static_cast<u8>(value & 0x9F);
        todHalted_ = true;
      }
      break;
    case 0xC:
      sdr_ = value;
      break;
    case 0xD:  // ICR mask: bit7 = set/clear the 1 bits
      if (value & 0x80) {
        mask_ = static_cast<u8>(mask_ | (value & 0x1F));
      } else {
        mask_ = static_cast<u8>(mask_ & ~(value & 0x1F));
      }
      break;
    case 0xE:
      if (value & 0x10) counterA_ = latchA_;  // force load strobe (bit4 does not persist)
      cra_ = static_cast<u8>(value & ~0x10);
      break;
    case 0xF:
      if (value & 0x10) counterB_ = latchB_;
      crb_ = static_cast<u8>(value & ~0x10);
      break;
    default:
      break;
  }
}

DeviceStatus Cia::status() const {
  return DeviceStatus{variant_ == Variant::Cia1 ? "cia1" : "cia2", true,
                      "6526 ports/timers/TOD/ICR modelled; serial shift limited"};
}

}  // namespace c64
