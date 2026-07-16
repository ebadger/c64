#include <chrono>
#include <vector>

#include "c64/machine.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

// Performance guard: frame and audio generation must scale LINEARLY with executed cycles, not
// superlinearly (an accidental O(n^2) in rendering/audio would show up here). Wall-clock time is
// used only for MEASUREMENT and is never fed into the machine (determinism is preserved); the
// count-based checks are fully deterministic.

namespace {
struct RunStats {
  double elapsedNs = 0;
  u64 frames = 0;
  u64 audioSamples = 0;
};

RunStats runFor(u64 cycles) {
  Machine m;
  boot(m);
  // A VIC-active loop that also gates a SID voice, so both the renderer and the audio path run.
  loadCodeAt(m, 0xC000,
             {0xA9, 0x21, 0x8D, 0x04, 0xD4,   // LDA #$21; STA $D404 (voice1 sawtooth + gate)
              0xA9, 0x0F, 0x8D, 0x18, 0xD4,   // LDA #$0F; STA $D418 (max volume)
              0x4C, 0x0A, 0xC0});             // JMP loop
  const auto t0 = std::chrono::steady_clock::now();
  m.runCycles(cycles);
  const auto t1 = std::chrono::steady_clock::now();
  RunStats s;
  s.elapsedNs = std::chrono::duration<double, std::nano>(t1 - t0).count();
  s.frames = m.frameSequence();
  std::vector<float> audio(4096, 0.0f);
  u64 total = 0;
  for (;;) {  // drain all queued audio to count produced samples
    AudioInfo info = m.drainAudio(audio.data(), 4096);
    total += info.framesWritten;
    if (info.framesWritten < 4096) break;
  }
  s.audioSamples = total;
  return s;
}
}  // namespace

TEST(perf_frame_audio_scale_linearly) {
  const u64 n = 200000;  // ~10 PAL frames
  runFor(n);             // warm up (caches, first-touch allocation)
  const RunStats a = runFor(n);
  const RunStats b = runFor(2 * n);

  // Deterministic count-based linearity: 2x cycles -> ~2x frames and ~2x audio samples.
  CHECK(a.frames > 0u);
  CHECK(a.audioSamples > 0u);
  CHECK(b.frames >= a.frames * 3 / 2);   // at least 1.5x
  CHECK(b.frames <= a.frames * 5 / 2);   // at most 2.5x
  CHECK(b.audioSamples >= a.audioSamples * 3 / 2);
  CHECK(b.audioSamples <= a.audioSamples * 5 / 2);

  // Timing guard (measurement only): doubling the work must not more-than-triple the time.
  // Linear execution gives ~2x; a quadratic regression would give ~4x. Generous tolerance keeps
  // this robust across machines while still catching gross superlinearity.
  if (a.elapsedNs > 100000.0) {  // only assert when the baseline is large enough to be meaningful
    CHECK(b.elapsedNs < a.elapsedNs * 3.0);
  }
}
