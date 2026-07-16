#include <vector>

#include "c64/machine.hpp"
#include "harness.hpp"
#include "test_framework.hpp"

using namespace c64;
using namespace c64test;

// End-to-end tests: the CPU drives the real VIC/SID/CIA devices and mounted media through the bus.

TEST(integration_cpu_writes_border_to_framebuffer) {
  Machine m;
  boot(m);
  // LDA #$0B; STA $D011 (DEN off -> whole screen border); LDA #$02; STA $D020; loop.
  loadCodeAt(m, 0xC000,
             {0xA9, 0x0B, 0x8D, 0x11, 0xD0, 0xA9, 0x02, 0x8D, 0x20, 0xD0, 0x4C, 0x0A, 0xC0});
  m.runCycles(25000);  // more than one PAL frame
  std::vector<u8> fb(m.framebufferSize(), 0xFF);
  FrameInfo info = m.copyFramebuffer(fb.data(), static_cast<u32>(fb.size()));
  CHECK(info.width > 0u);
  CHECK_EQ(fb[0], 0x02u);  // top-left border pixel is the colour the CPU wrote
}

TEST(integration_cpu_reads_keyboard) {
  Machine m;
  boot(m);
  // Press the key at column 2, row 5.
  InputSnapshot input;
  input.keyboardColumns[2] = static_cast<u8>(~(1u << 5) & 0xFF);
  m.setInput(input);
  // DDRA=out, DDRB=in, select column 2, read rows into $02.
  loadCodeAt(m, 0xC000,
             {0xA9, 0xFF, 0x8D, 0x02, 0xDC,   // LDA #$FF; STA $DC02 (DDRA)
              0xA9, 0x00, 0x8D, 0x03, 0xDC,   // LDA #$00; STA $DC03 (DDRB)
              0xA9, 0xFB, 0x8D, 0x00, 0xDC,   // LDA #$FB; STA $DC00 (select column 2)
              0xAD, 0x01, 0xDC, 0x85, 0x02,   // LDA $DC01; STA $02
              0x00});                          // BRK
  m.runCycles(200);
  CHECK_EQ(m.debugReadRam(0x02), static_cast<u8>(~(1u << 5) & 0xFF));  // row 5 low
}

TEST(integration_cpu_reads_cia_timer) {
  Machine m;
  boot(m);
  // Start CIA1 timer A continuous with latch 5, run, then read the counter (it counts down).
  loadCodeAt(m, 0xC000,
             {0xA9, 0x05, 0x8D, 0x04, 0xDC,   // LDA #$05; STA $DC04 (TA lo)
              0xA9, 0x00, 0x8D, 0x05, 0xDC,   // LDA #$00; STA $DC05 (TA hi)
              0xA9, 0x01, 0x8D, 0x0E, 0xDC,   // LDA #$01; STA $DC0E (start, continuous)
              0xEA, 0xEA, 0xEA,                // NOP x3 (timer counts)
              0xAD, 0x04, 0xDC, 0x85, 0x03,   // LDA $DC04; STA $03
              0x00});
  m.runCycles(200);
  // The timer is running and reloads at 5; the captured value is within the timer's range.
  CHECK(m.debugReadRam(0x03) <= 0x05u);
}

TEST(integration_vic_raster_irq_reaches_cpu) {
  Machine m;
  boot(m);
  // IRQ handler at $C100: INC $04; ack $D019; RTI.
  m.debugWriteRam(0xC100, 0xE6);  // INC $04
  m.debugWriteRam(0xC101, 0x04);
  m.debugWriteRam(0xC102, 0xA9);  // LDA #$01
  m.debugWriteRam(0xC103, 0x01);
  m.debugWriteRam(0xC104, 0x8D);  // STA $D019 (acknowledge)
  m.debugWriteRam(0xC105, 0x19);
  m.debugWriteRam(0xC106, 0xD0);
  m.debugWriteRam(0xC107, 0x40);  // RTI
  // Main: set raster compare = 100, enable raster IRQ, CLI, loop.
  loadCodeAt(m, 0xC000,
             {0xA9, 0x64, 0x8D, 0x12, 0xD0,   // LDA #100; STA $D012
              0xA9, 0x01, 0x8D, 0x1A, 0xD0,   // LDA #$01; STA $D01A (enable raster IRQ)
              0x58,                            // CLI
              0x4C, 0x0B, 0xC0});             // JMP loop
  m.runCycles(30000);  // more than one frame
  CHECK(m.debugReadRam(0x04) >= 1u);  // the IRQ handler ran
}

TEST(integration_cpu_produces_sid_audio) {
  Machine m;
  boot(m);
  // Program voice 1: frequency, sawtooth + gate, sustain; then loop so audio keeps generating.
  loadCodeAt(m, 0xC000,
             {0xA9, 0x00, 0x8D, 0x00, 0xD4,   // LDA #$00; STA $D400 (freq lo)
              0xA9, 0x20, 0x8D, 0x01, 0xD4,   // LDA #$20; STA $D401 (freq hi)
              0xA9, 0xF0, 0x8D, 0x06, 0xD4,   // LDA #$F0; STA $D406 (sustain)
              0xA9, 0x0F, 0x8D, 0x18, 0xD4,   // LDA #$0F; STA $D418 (max volume)
              0xA9, 0x21, 0x8D, 0x04, 0xD4,   // LDA #$21; STA $D404 (sawtooth + gate)
              0x4C, 0x19, 0xC0});             // JMP loop
  m.runCycles(50000);
  std::vector<float> audio(2048, 0.0f);
  AudioInfo info = m.drainAudio(audio.data(), 2048);
  CHECK(info.sampleRate > 0u);
  CHECK(info.framesWritten > 0u);   // audio was produced
  CHECK(info.sequence > 0u);
}

TEST(integration_load_prg_from_mounted_d64) {
  Machine m;
  boot(m);
  // Mount a disk containing PRG "PROG" that loads to $0801 with a known payload.
  const std::vector<u8> prg = {0x01, 0x08, 0x11, 0x22, 0x33, 0x44};
  MediaResult mr = m.mountD64(makeD64("PROG", prg), 8);
  CHECK(mr.ok);
  CHECK(m.diskMounted());
  // Set up the KERNAL LOAD zero page as SETNAM/SETLFS would, then JSR $FFD5.
  const char* name = "PROG";
  for (int i = 0; name[i]; ++i) m.debugWriteRam(static_cast<u16>(0x0500 + i), name[i]);
  m.debugWriteRam(0xB7, 4);      // filename length
  m.debugWriteRam(0xBB, 0x00);   // filename ptr lo
  m.debugWriteRam(0xBC, 0x05);   // filename ptr hi
  m.debugWriteRam(0xB9, 0x01);   // secondary address 1 -> use file's load address
  m.debugWriteRam(0xBA, 0x08);   // device 8
  loadCodeAt(m, 0xC000, {0x20, 0xD5, 0xFF, 0x00});  // JSR $FFD5; BRK
  m.runCycles(2000);
  // The payload was loaded to $0801..$0804.
  CHECK_EQ(m.debugReadRam(0x0801), 0x11u);
  CHECK_EQ(m.debugReadRam(0x0802), 0x22u);
  CHECK_EQ(m.debugReadRam(0x0803), 0x33u);
  CHECK_EQ(m.debugReadRam(0x0804), 0x44u);
  // Carry clear (success) and end address in X/Y = $0805.
  CHECK(!(m.cpuState().p & FlagC));
  CHECK_EQ(m.cpuState().x, 0x05u);
  CHECK_EQ(m.cpuState().y, 0x08u);
}

TEST(integration_load_missing_file_reports_error) {
  Machine m;
  boot(m);
  m.mountD64(makeD64("PROG", {0x01, 0x08, 0x11}), 8);
  const char* name = "NOPE";
  for (int i = 0; name[i]; ++i) m.debugWriteRam(static_cast<u16>(0x0500 + i), name[i]);
  m.debugWriteRam(0xB7, 4);
  m.debugWriteRam(0xBB, 0x00);
  m.debugWriteRam(0xBC, 0x05);
  m.debugWriteRam(0xB9, 0x01);
  m.debugWriteRam(0xBA, 0x08);
  loadCodeAt(m, 0xC000, {0x20, 0xD5, 0xFF, 0x00});
  m.runCycles(2000);
  CHECK(m.cpuState().p & FlagC);       // carry set = error
  CHECK_EQ(m.cpuState().a, 0x04u);     // "file not found"
}

TEST(integration_long_run_determinism) {
  // The same program from a fresh power-on must produce identical state after a long run.
  auto runOnce = [](CpuState& out, u8& fbSample) {
    Machine m;
    boot(m);
    loadCodeAt(m, 0xC000,
               {0xA9, 0x01, 0x8D, 0x20, 0xD0, 0xEE, 0x00, 0x40, 0x4C, 0x05, 0xC0});
    for (int i = 0; i < 10; ++i) m.runCycles(20000);  // ~10 frames
    out = m.cpuState();
    std::vector<u8> fb(m.framebufferSize(), 0);
    m.copyFramebuffer(fb.data(), static_cast<u32>(fb.size()));
    fbSample = fb[0];
  };
  CpuState a, b;
  u8 fa, fb;
  runOnce(a, fa);
  runOnce(b, fb);
  CHECK_EQ(a.pc, b.pc);
  CHECK_EQ(a.a, b.a);
  CHECK_EQ(fa, fb);
}
