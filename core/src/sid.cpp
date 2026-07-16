#include "c64/sid.hpp"

#include <cmath>

namespace c64 {

namespace {
// reSID-derived envelope rate-counter periods (in SID clocks) for the 16 ADSR nibble values.
const u16 kRatePeriod[16] = {9,    32,   63,   95,   149,  220,  267,   313,
                             392,  977,  1954, 3907, 7813, 19531, 31250, 39063};

// Exponential decay/release slowdown as a function of the current envelope level.
u8 expPeriodFor(u8 envelope) {
  switch (envelope) {
    case 0xFF: return 1;
    case 0x5D: return 2;
    case 0x36: return 4;
    case 0x1A: return 8;
    case 0x0E: return 16;
    case 0x06: return 30;
    case 0x00: return 1;
    default: return 0;  // 0 = keep current period
  }
}
}  // namespace

Sid::Sid() { buffer_.assign(44100, 0.0f); }

void Sid::configure(Model model, u64 phi2Hz, u32 sampleRate) {
  model_ = model;
  phi2Hz_ = phi2Hz ? phi2Hz : 985248;
  sampleRate_ = sampleRate ? sampleRate : 44100;
  buffer_.assign(sampleRate_, 0.0f);  // ~1 second of headroom
  reset();
}

void Sid::reset() {
  for (Voice& voice : v_) voice = Voice{};
  filterCutoffLo_ = filterCutoffHi_ = filterResFilt_ = modeVol_ = 0;
  lastWrite_ = 0;
  filtLp_ = filtBp_ = 0;
  resampleAccum_ = 0;
  head_ = tail_ = count_ = 0;
  sampleSequence_ = 0;
  dropped_ = 0;
  std::fill(buffer_.begin(), buffer_.end(), 0.0f);
}

void Sid::advanceOscillator(int i) {
  Voice& voice = v_[i];
  if (voice.ctrl & 0x08) {  // test bit: hold accumulator and reload noise
    voice.acc = 0;
    voice.noiseLfsr = 0x7FFFFF;
    return;
  }
  const u32 prev = voice.acc;
  voice.acc = (voice.acc + voice.freq) & 0xFFFFFF;
  // Noise LFSR clocks on bit19 rising edge of the accumulator.
  if (((prev & 0x080000) == 0) && ((voice.acc & 0x080000) != 0)) {
    const u32 bit0 = ((voice.noiseLfsr >> 22) ^ (voice.noiseLfsr >> 17)) & 1;
    voice.noiseLfsr = ((voice.noiseLfsr << 1) | bit0) & 0x7FFFFF;
  }
}

u16 Sid::waveformOutput(int i) const {
  const Voice& voice = v_[i];
  const u8 wave = static_cast<u8>((voice.ctrl >> 4) & 0x0F);
  const Voice& ring = v_[(i + 2) % 3];  // previous voice (n-1)

  u16 out = 0xFFF;
  bool any = false;
  if (wave & 0x01) {  // triangle
    u32 msb = voice.acc & 0x800000;
    if (voice.ctrl & 0x04) msb ^= (ring.acc & 0x800000);  // ring modulation
    u16 tri = static_cast<u16>(((msb ? ~voice.acc : voice.acc) >> 11) & 0xFFF);
    out &= tri;
    any = true;
  }
  if (wave & 0x02) {  // sawtooth
    out &= static_cast<u16>((voice.acc >> 12) & 0xFFF);
    any = true;
  }
  if (wave & 0x04) {  // pulse
    const u16 pw = static_cast<u16>(voice.pw & 0xFFF);
    const u16 sawtop = static_cast<u16>((voice.acc >> 12) & 0xFFF);
    const u16 pulse = ((voice.ctrl & 0x08) || sawtop >= pw) ? 0xFFF : 0x000;
    out &= pulse;
    any = true;
  }
  if (wave & 0x08) {  // noise: 12 bits pulled from LFSR taps
    const u32 n = voice.noiseLfsr;
    u16 noise = static_cast<u16>((((n >> 11) & 1) << 11) | (((n >> 9) & 1) << 10) |
                                 (((n >> 7) & 1) << 9) | (((n >> 5) & 1) << 8) |
                                 (((n >> 3) & 1) << 7) | (((n >> 1) & 1) << 6) |
                                 0);
    out &= noise;
    any = true;
  }
  return any ? out : 0;
}

void Sid::clockEnvelope(int i) {
  Voice& voice = v_[i];
  const bool gate = (voice.ctrl & 0x01) != 0;
  if (gate && !voice.gatePrev) {
    voice.state = EnvState::Attack;
  } else if (!gate && voice.gatePrev) {
    voice.state = EnvState::Release;
  }
  voice.gatePrev = gate;

  u8 rateIndex;
  if (voice.state == EnvState::Attack) {
    rateIndex = static_cast<u8>((voice.ad >> 4) & 0x0F);
  } else if (voice.state == EnvState::DecaySustain) {
    rateIndex = static_cast<u8>(voice.ad & 0x0F);
  } else {
    rateIndex = static_cast<u8>(voice.sr & 0x0F);
  }

  // rateCounter is a 16-bit counter that reaches the (up to 39063-cycle) period and resets. It is
  // NOT masked to 15 bits: the two slowest periods exceed 0x7FFF, so masking would make the
  // slowest rate index unreachable (it would never progress).
  voice.rateCounter = static_cast<u16>(voice.rateCounter + 1);
  if (voice.rateCounter != kRatePeriod[rateIndex]) return;
  voice.rateCounter = 0;

  if (voice.state == EnvState::Attack) {
    voice.envelope = static_cast<u8>((voice.envelope + 1) & 0xFF);
    if (voice.envelope == 0xFF) voice.state = EnvState::DecaySustain;
    return;
  }

  // Decay/sustain and release use the exponential counter.
  if (++voice.expCounter != voice.expPeriod) return;
  voice.expCounter = 0;
  const u8 sustainLevel = static_cast<u8>(((voice.sr >> 4) & 0x0F) * 0x11);
  if (voice.state == EnvState::DecaySustain) {
    if (voice.envelope != sustainLevel && voice.envelope > 0) voice.envelope--;
  } else {  // Release
    if (voice.envelope > 0) voice.envelope--;
  }
  const u8 p = expPeriodFor(voice.envelope);
  if (p != 0) voice.expPeriod = p;
}

float Sid::mixSample() {
  const bool voice3Off = (modeVol_ & 0x80) != 0;
  float sum = 0.0f;
  float filteredSum = 0.0f;
  for (int i = 0; i < 3; ++i) {
    if (i == 2 && voice3Off && ((filterResFilt_ & 0x04) == 0)) continue;  // voice 3 muted
    const i32 wave = static_cast<i32>(waveformOutput(i)) - 0x800;  // signed 12-bit
    const float voiceOut = (static_cast<float>(wave) / 2048.0f) * (v_[i].envelope / 255.0f);
    if (filterResFilt_ & (1u << i)) {
      filteredSum += voiceOut;
    } else {
      sum += voiceOut;
    }
  }

  // Approximate state-variable filter. Cutoff maps the 11-bit register to a normalized frequency;
  // the 6581 and 8580 use slightly different scaling (a deliberate, honestly-labeled approximation).
  const u16 cutoff = static_cast<u16>(((filterCutoffHi_ << 3) | (filterCutoffLo_ & 0x07)) & 0x7FF);
  const float scale = (model_ == Model::Mos8580) ? 0.85f : 1.0f;
  float fc = 0.05f + 0.9f * scale * (cutoff / 2047.0f);
  if (fc > 0.99f) fc = 0.99f;
  const float res = 1.0f - 0.7f * ((filterResFilt_ >> 4) & 0x0F) / 15.0f;
  filtBp_ += fc * (filteredSum - filtLp_ - res * filtBp_);
  filtLp_ += fc * filtBp_;
  const float hp = filteredSum - filtLp_ - res * filtBp_;

  float filterOut = 0.0f;
  if (modeVol_ & 0x10) filterOut += filtLp_;  // LP
  if (modeVol_ & 0x20) filterOut += filtBp_;  // BP
  if (modeVol_ & 0x40) filterOut += hp;       // HP

  const float volume = (modeVol_ & 0x0F) / 15.0f;
  float out = (sum + filterOut) * volume / 3.0f;
  if (out > 1.0f) out = 1.0f;
  if (out < -1.0f) out = -1.0f;
  return out;
}

void Sid::emitSampleIfDue() {
  resampleAccum_ += sampleRate_;
  if (resampleAccum_ < phi2Hz_) return;
  resampleAccum_ -= phi2Hz_;
  const float sample = mixSample();
  ++sampleSequence_;
  if (count_ == buffer_.size()) {
    // Overflow: drop the oldest already-emitted sample (presentation only; state is untouched).
    head_ = (head_ + 1) % buffer_.size();
    --count_;
    ++dropped_;
  }
  buffer_[tail_] = sample;
  tail_ = (tail_ + 1) % buffer_.size();
  ++count_;
}

void Sid::tickCycle() {
  // Advance all three accumulators, then apply hard sync: voice n resets when its sync source
  // (voice n-1) overflows this cycle (accumulator bit23 rising 0->1). Edge detection uses each
  // source's pre-advance MSB, so sync is correctly triggered (not a no-op).
  bool oldMsb[3];
  for (int i = 0; i < 3; ++i) oldMsb[i] = (v_[i].acc & 0x800000) != 0;
  for (int i = 0; i < 3; ++i) advanceOscillator(i);
  bool overflow[3];
  for (int i = 0; i < 3; ++i) overflow[i] = !oldMsb[i] && ((v_[i].acc & 0x800000) != 0);
  for (int i = 0; i < 3; ++i) {
    if ((v_[i].ctrl & 0x02) && overflow[(i + 2) % 3]) v_[i].acc = 0;  // hard sync reset
  }
  clockEnvelope(0);
  clockEnvelope(1);
  clockEnvelope(2);
  emitSampleIfDue();
}

u8 Sid::read(u8 reg, bool sideEffects) {
  (void)sideEffects;
  reg = static_cast<u8>(reg & 0x1F);
  switch (reg) {
    case 0x19:  // POTX
    case 0x1A:  // POTY (no paddles connected)
      return 0xFF;
    case 0x1B:  // OSC3: top 8 bits of voice 3 waveform
      return static_cast<u8>((waveformOutput(2) >> 4) & 0xFF);
    case 0x1C:  // ENV3: voice 3 envelope value
      return v_[2].envelope;
    default:
      // Write-only registers: 6581 returns the last value written (bus capacitance); 8580 reads 0.
      return (model_ == Model::Mos6581) ? lastWrite_ : 0x00;
  }
}

void Sid::write(u8 reg, u8 value) {
  reg = static_cast<u8>(reg & 0x1F);
  lastWrite_ = value;
  if (reg < 0x15) {
    const int i = reg / 7;
    const int r = reg % 7;
    Voice& voice = v_[i];
    switch (r) {
      case 0: voice.freq = (voice.freq & 0xFF00) | value; break;
      case 1: voice.freq = (voice.freq & 0x00FF) | (value << 8); break;
      case 2: voice.pw = static_cast<u16>((voice.pw & 0x0F00) | value); break;
      case 3: voice.pw = static_cast<u16>((voice.pw & 0x00FF) | ((value & 0x0F) << 8)); break;
      case 4: voice.ctrl = value; break;
      case 5: voice.ad = value; break;
      case 6: voice.sr = value; break;
      default: break;
    }
    return;
  }
  switch (reg) {
    case 0x15: filterCutoffLo_ = value; break;
    case 0x16: filterCutoffHi_ = value; break;
    case 0x17: filterResFilt_ = value; break;
    case 0x18: modeVol_ = value; break;
    default: break;
  }
}

u32 Sid::drain(float* out, u32 maxFrames) {
  u32 written = 0;
  while (written < maxFrames && count_ > 0) {
    out[written++] = buffer_[head_];
    head_ = (head_ + 1) % buffer_.size();
    --count_;
  }
  return written;
}

u32 Sid::available() const { return static_cast<u32>(count_); }

DeviceStatus Sid::status() const {
  return DeviceStatus{"sid",
                      true,
                      model_ == Model::Mos6581
                          ? "6581 voices/ADSR/waveforms + approximate filter (not analog-perfect)"
                          : "8580 voices/ADSR/waveforms + approximate filter (not analog-perfect)"};
}

}  // namespace c64
