// MOS 6581/8580 SID (Sound Interface Device).
//
// The SID is a cycle-clocked device producing deterministic mono audio. It models three voices
// (triangle/saw/pulse/noise, ring modulation, sync, gate/test, ADSR envelopes), the mixer/volume
// and filter registers, and deterministic open-bus reads. Audio is emitted by deterministic
// integer resampling from the machine clock to a configured output sample rate; browser audio
// scheduling never feeds back into machine state.
//
// Fidelity note: the digital oscillator/envelope/waveform behaviour is modelled directly. The
// analog filter and the 6581-vs-8580 differences are a deliberate deterministic APPROXIMATION,
// not an analog-perfect reproduction (see specs/IO.md). No analog-perfect claim is made.
#ifndef C64_SID_HPP
#define C64_SID_HPP

#include <array>
#include <vector>

#include "c64/device.hpp"  // DeviceStatus
#include "c64/types.hpp"

namespace c64 {

class Sid {
 public:
  enum class Model : u8 { Mos6581, Mos8580 };

  Sid();

  // phi2Hz is the (integer nominal) machine clock; sampleRate is the output rate for resampling.
  void configure(Model model, u64 phi2Hz, u32 sampleRate);
  void reset();

  // Advance one phi2 cycle: oscillators, envelopes, noise; may emit one output sample.
  void tickCycle();

  u8 read(u8 reg, bool sideEffects);
  void write(u8 reg, u8 value);

  // Copy up to maxFrames mono samples (float [-1,1]) into out; returns the number written.
  u32 drain(float* out, u32 maxFrames);
  u32 available() const;
  u64 sampleSequence() const { return sampleSequence_; }
  u32 droppedFrames() const { return dropped_; }
  u32 sampleRate() const { return sampleRate_; }

  DeviceStatus status() const;

 private:
  enum class EnvState : u8 { Attack, DecaySustain, Release };

  struct Voice {
    u32 acc = 0;      // 24-bit phase accumulator
    u32 freq = 0;     // 16-bit
    u16 pw = 0;       // 12-bit pulse width
    u8 ctrl = 0;      // control register
    u8 ad = 0;        // attack/decay
    u8 sr = 0;        // sustain/release
    u32 noiseLfsr = 0x7FFFFF;
    // Envelope.
    EnvState state = EnvState::Release;
    u8 envelope = 0;
    u16 rateCounter = 0;
    u8 expCounter = 0;
    u8 expPeriod = 1;
    bool gatePrev = false;
  };

  void advanceOscillator(int i);   // advance one voice's accumulator + noise (no sync)
  void clockEnvelope(int i);
  u16 waveformOutput(int i) const;  // 12-bit oscillator output
  float mixSample();
  void emitSampleIfDue();

  Model model_ = Model::Mos6581;
  u64 phi2Hz_ = 985248;
  u32 sampleRate_ = 44100;
  u64 resampleAccum_ = 0;

  std::array<Voice, 3> v_{};
  u8 filterCutoffLo_ = 0, filterCutoffHi_ = 0;
  u8 filterResFilt_ = 0;   // $D417
  u8 modeVol_ = 0;         // $D418
  u8 lastWrite_ = 0;       // open-bus source (6581)

  // Simple state-variable filter state (approximation).
  float filtLp_ = 0, filtBp_ = 0;

  // Output ring buffer.
  std::vector<float> buffer_;
  size_t head_ = 0, tail_ = 0, count_ = 0;
  u64 sampleSequence_ = 0;
  u32 dropped_ = 0;
};

}  // namespace c64

#endif  // C64_SID_HPP
