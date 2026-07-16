#include "c64/sid.hpp"

#include <vector>

#include "test_framework.hpp"

using namespace c64;

namespace {
constexpr u64 kPhi2 = 985248;
constexpr u32 kRate = 44100;
void run(Sid& sid, u32 cycles) {
  for (u32 i = 0; i < cycles; ++i) sid.tickCycle();
}
}  // namespace

TEST(sid_open_bus_read_model_difference) {
  Sid sid6581;
  sid6581.configure(Sid::Model::Mos6581, kPhi2, kRate);
  sid6581.write(0x00, 0x42);
  CHECK_EQ(sid6581.read(0x00, true), 0x42u);  // 6581: last write on the bus

  Sid sid8580;
  sid8580.configure(Sid::Model::Mos8580, kPhi2, kRate);
  sid8580.write(0x00, 0x42);
  CHECK_EQ(sid8580.read(0x00, true), 0x00u);  // 8580: reads 0
}

TEST(sid_pot_registers) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  CHECK_EQ(sid.read(0x19, true), 0xFFu);  // POTX (no paddles)
  CHECK_EQ(sid.read(0x1A, true), 0xFFu);  // POTY
}

TEST(sid_osc3_reads_oscillator) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  // Voice 3 (base register 14): sawtooth, non-zero frequency.
  sid.write(14 + 0, 0xFF);  // freq lo
  sid.write(14 + 1, 0x40);  // freq hi
  sid.write(14 + 4, 0x21);  // control: sawtooth + gate
  const u8 a = sid.read(0x1B, true);
  run(sid, 2000);
  const u8 b = sid.read(0x1B, true);
  CHECK(a != b);  // the oscillator advanced, so OSC3 changed
}

TEST(sid_envelope_attack_and_release) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  // Voice 3: fast attack/decay, full sustain, gate on.
  sid.write(14 + 4, 0x21);  // sawtooth + gate
  sid.write(14 + 5, 0x00);  // attack=0 (fastest), decay=0
  sid.write(14 + 6, 0xF0);  // sustain=15, release=0
  CHECK_EQ(sid.read(0x1C, true), 0x00u);  // ENV3 starts at 0
  run(sid, 4000);                          // attack ramps to near max
  CHECK(sid.read(0x1C, true) > 0x80u);
  // Gate off -> release toward 0.
  sid.write(14 + 4, 0x20);  // clear gate
  run(sid, 4000);
  CHECK(sid.read(0x1C, true) < 0x40u);
}

TEST(sid_resample_rate) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  // Over 1/10 second of machine cycles, expect ~sampleRate/10 output frames.
  run(sid, static_cast<u32>(kPhi2 / 10));
  const u32 avail = sid.available();
  const u32 expected = kRate / 10;  // ~4410
  CHECK(avail > expected - 50);
  CHECK(avail < expected + 50);
}

TEST(sid_drain_consumes_buffer) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  run(sid, 10000);
  const u32 before = sid.available();
  CHECK(before > 0u);
  std::vector<float> out(before);
  const u32 got = sid.drain(out.data(), before);
  CHECK_EQ(got, before);
  CHECK_EQ(sid.available(), 0u);
  // Samples are within range.
  for (float s : out) {
    CHECK(s >= -1.0f);
    CHECK(s <= 1.0f);
  }
}

TEST(sid_pulse_waveform_output) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  // Voice 3 pulse with mid pulse-width; OSC3 should read either near 0x00 or near 0xFF.
  sid.write(14 + 0, 0x00);
  sid.write(14 + 1, 0x10);  // some frequency
  sid.write(14 + 2, 0x00);
  sid.write(14 + 3, 0x08);  // pw = 0x800 (50%)
  sid.write(14 + 4, 0x41);  // pulse + gate
  bool sawLow = false, sawHigh = false;
  for (int i = 0; i < 20000; ++i) {
    sid.tickCycle();
    const u8 o = sid.read(0x1B, true);
    if (o < 0x10) sawLow = true;
    if (o > 0xF0) sawHigh = true;
  }
  CHECK(sawLow);
  CHECK(sawHigh);
}

TEST(sid_slowest_envelope_rate_progresses) {
  // Regression: rate index 15 has a period (39063) above 0x7FFF; the envelope must still advance
  // (a 15-bit rate-counter mask would make this rate never progress).
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  sid.write(14 + 4, 0x21);  // sawtooth + gate
  sid.write(14 + 5, 0xF0);  // attack = 15 (slowest), decay = 0
  sid.write(14 + 6, 0xF0);  // sustain = 15
  CHECK_EQ(sid.read(0x1C, true), 0x00u);
  run(sid, 39063u * 3 + 100);  // enough for a few attack steps at the slowest rate
  CHECK(sid.read(0x1C, true) >= 2u);  // the envelope advanced
}

TEST(sid_test_bit_holds_oscillator) {
  Sid sid;
  sid.configure(Sid::Model::Mos6581, kPhi2, kRate);
  sid.write(14 + 0, 0xFF);
  sid.write(14 + 1, 0xFF);  // max frequency
  sid.write(14 + 4, 0x29);  // sawtooth + test(bit3) + gate
  run(sid, 1000);
  // With the test bit set, the accumulator is held at 0, so OSC3 stays 0.
  CHECK_EQ(sid.read(0x1B, true), 0x00u);
}
