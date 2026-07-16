#include "c64/scenarios.hpp"

#include <cstdint>

#include "c64/bus.hpp"
#include "c64/cpu.hpp"
#include "c64/machine.hpp"
#include "c64/rom.hpp"
#include "c64/timing.hpp"

namespace c64 {
namespace {

// Minimal deterministic JSON writer. Keys are emitted in call order, so identical C++ code
// produces byte-identical output on native and WebAssembly builds.
class Json {
 public:
  Json() { out_.reserve(256); }

  Json& beginObject() { punct('{'); needComma_ = false; return *this; }
  Json& endObject() { out_.push_back('}'); needComma_ = true; return *this; }
  Json& beginArray() { punct('['); needComma_ = false; return *this; }
  Json& endArray() { out_.push_back(']'); needComma_ = true; return *this; }

  Json& key(const char* k) {
    comma();
    quote(k);
    out_.push_back(':');
    needComma_ = false;
    return *this;
  }

  Json& str(const char* v) { comma(); quote(v); needComma_ = true; return *this; }
  Json& str(const std::string& v) { return str(v.c_str()); }
  Json& num(std::uint64_t v) { comma(); out_ += std::to_string(v); needComma_ = true; return *this; }
  Json& boolean(bool v) { comma(); out_ += v ? "true" : "false"; needComma_ = true; return *this; }
  // Insert an already-formed JSON fragment as a value.
  Json& raw(const std::string& fragment) { comma(); out_ += fragment; needComma_ = true; return *this; }

  const std::string& str() const { return out_; }

 private:
  void punct(char c) { comma(); out_.push_back(c); }
  void comma() {
    if (needComma_) out_.push_back(',');
    needComma_ = false;
  }
  void quote(const char* s) {
    out_.push_back('"');
    for (const char* p = s; *p; ++p) {
      if (*p == '"' || *p == '\\') out_.push_back('\\');
      out_.push_back(*p);
    }
    out_.push_back('"');
  }

  std::string out_;
  bool needComma_ = false;
};

// Build a synthetic (legally-clean) machine with chosen interrupt vectors.
Error configureSynthetic(Machine& m, u16 resetVec, u16 irqVec, u16 nmiVec,
                         const char* timing = "pal-6569", u8 seed = 0) {
  MachineConfig cfg;
  cfg.timingProfile = timing;
  cfg.sidModel = "6581";
  cfg.powerOnSeed = seed;
  cfg.roms = syntheticRomSet(resetVec, irqVec, nmiVec);
  return m.configure(cfg);
}

void writeCpuState(Json& j, const CpuState& s) {
  j.beginObject();
  j.key("pc").num(s.pc);
  j.key("a").num(s.a);
  j.key("x").num(s.x);
  j.key("y").num(s.y);
  j.key("sp").num(s.sp);
  j.key("p").num(s.p);
  j.endObject();
}

// ---- Scenarios ----

std::string scenTimingProfiles() {
  Json j;
  j.beginObject().key("profiles").beginArray();
  const TimingProfile* profiles[2] = {&palProfile(), &ntscProfile()};
  for (const TimingProfile* p : profiles) {
    j.beginObject();
    j.key("name").str(p->name);
    j.key("cyclesPerLine").num(p->cyclesPerLine);
    j.key("rasterLines").num(p->rasterLines);
    j.key("cyclesPerFrame").num(p->cyclesPerFrame);
    j.key("clockNumerator").num(p->clockNumerator);
    j.key("clockDenominator").num(p->clockDenominator);
    j.endObject();
  }
  j.endArray().endObject();
  return j.str();
}

std::string scenRomIdentity() {
  RomSet set = syntheticRomSet(0xFCE2, 0xFF48, 0xFE43);
  Json j;
  j.beginObject();
  j.key("id").str(set.id);
  j.key("descriptors").beginArray();
  for (int i = 0; i < 3; ++i) {
    const RomDescriptor& d = set.descriptors[i];
    j.beginObject();
    j.key("role").str(romRoleId(d.role));
    j.key("size").num(d.size);
    j.key("sha256").str(d.sha256);
    j.key("source").str(d.source);
    j.endObject();
  }
  j.endArray().endObject();
  return j.str();
}

std::string scenRomErrors() {
  Json j;
  j.beginObject().key("cases").beginArray();

  auto record = [&](const char* label, const RomSetResult& r) {
    j.beginObject();
    j.key("case").str(label);
    j.key("ok").boolean(r.ok);
    j.key("errorCode").str(errorCodeId(r.error.code));
    j.endObject();
  };

  RomImage basic;
  basic.bytes.assign(kBasicRomSize, 0x11);
  RomImage kernal;
  kernal.bytes.assign(kKernalRomSize, 0x22);
  RomImage chargen;
  chargen.bytes.assign(kChargenRomSize, 0x33);

  record("valid", validateRomSet(basic, kernal, chargen));

  RomImage emptyKernal;  // missing role
  record("missing-kernal", validateRomSet(basic, emptyKernal, chargen));

  RomImage shortBasic;
  shortBasic.bytes.assign(kBasicRomSize - 1, 0x11);
  record("wrong-size-basic", validateRomSet(shortBasic, kernal, chargen));

  j.endArray().endObject();
  return j.str();
}

std::string scenResetVectors() {
  Machine m;
  Error e = configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  Json j;
  j.beginObject();
  j.key("configureError").str(errorCodeId(e.code));
  j.key("state");
  writeCpuState(j, m.cpuState());
  j.key("processorPort").num(m.processorPort());
  j.key("dataDirection").num(m.dataDirection());
  m.reset(ResetKind::Warm);
  j.key("warmResetPc").num(m.cpuState().pc);
  j.endObject();
  return j.str();
}

// Trace a program loaded at $C000 in direct mode.
std::string traceProgram(const std::vector<u8>& code, u32 steps, const char* timing = "pal-6569") {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200, timing);
  std::vector<u8> prg;
  prg.push_back(0x00);
  prg.push_back(0xC0);  // load address $C000
  prg.insert(prg.end(), code.begin(), code.end());
  LoadResult lr = m.loadPrg(prg);
  m.setProgramCounter(0xC000);

  Json j;
  j.beginObject();
  j.key("loadAddress").num(lr.loadAddress);
  j.key("endAddressExclusive").num(lr.endAddressExclusive);
  j.key("steps").beginArray();
  u64 totalCycles = 0;
  for (u32 i = 0; i < steps; ++i) {
    const CpuState before = m.cpuState();
    RunResult rr = m.runCycles(1);  // one instruction (>=1 cycle) at a time
    const CpuState after = m.cpuState();
    j.beginObject();
    j.key("i").num(i);
    j.key("beforePc").num(before.pc);
    j.key("cycles").num(rr.cyclesExecuted);
    j.key("stopReason").str(rr.stopReason);
    j.key("after");
    writeCpuState(j, after);
    j.endObject();
    totalCycles += rr.cyclesExecuted;
    if (rr.stopReason == "brk" || rr.stopReason == "fault") break;
  }
  j.endArray();
  j.key("totalCycles").num(totalCycles);
  j.endObject();
  return j.str();
}

std::string scenCpuTraceBasic() {
  // Exercise loads, transfers, arithmetic, store, and a taken branch loop.
  const std::vector<u8> code = {
      0xA9, 0x05,        // LDA #$05
      0xA2, 0x03,        // LDX #$03
      0x18,              // CLC
      0x69, 0x01,        // ADC #$01   -> A=$06
      0xCA,              // DEX
      0xD0, 0xFB,        // BNE -5 (back to CLC)
      0x85, 0x10,        // STA $10
      0x00,              // BRK
  };
  return traceProgram(code, 40);
}

std::string scenPageCrossCycles() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  // Seed RAM operands: $12FF and $1300 used by LDA abs,X across a page.
  m.debugWriteRam(0x12FF, 0xAA);
  m.debugWriteRam(0x1300, 0xBB);
  const std::vector<u8> code = {
      0xA2, 0x00,        // LDX #$00
      0xBD, 0xFF, 0x12,  // LDA $12FF,X  (no cross)  -> 4 cycles
      0xA2, 0x01,        // LDX #$01
      0xBD, 0xFF, 0x12,  // LDA $12FF,X  (crosses to $1300) -> 5 cycles
      0x00,              // BRK
  };
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);

  Json j;
  j.beginObject().key("instructions").beginArray();
  for (int i = 0; i < 4; ++i) {
    RunResult rr = m.runCycles(1);
    j.beginObject();
    j.key("cycles").num(rr.cyclesExecuted);
    j.key("a").num(m.cpuState().a);
    j.endObject();
  }
  j.endArray().endObject();
  return j.str();
}

std::string scenRmw() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  m.debugWriteRam(0x40, 0x7F);
  const std::vector<u8> code = {
      0xE6, 0x40,        // INC $40   -> $80, N=1
      0x06, 0x40,        // ASL $40   -> $00, C=1, Z=1
      0x00,              // BRK
  };
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);

  Json j;
  j.beginObject().key("steps").beginArray();
  for (int i = 0; i < 2; ++i) {
    RunResult rr = m.runCycles(1);
    j.beginObject();
    j.key("cycles").num(rr.cyclesExecuted);
    j.key("mem40").num(m.debugReadRam(0x40));
    j.key("p").num(m.cpuState().p);
    j.endObject();
  }
  j.endArray().endObject();
  return j.str();
}

std::string scenDecimal() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  // SED; CLC; LDA #$05; ADC #$05 -> $10 ; store A and P.
  const std::vector<u8> code = {
      0xF8,              // SED
      0x18,              // CLC
      0xA9, 0x05,        // LDA #$05
      0x69, 0x05,        // ADC #$05  -> A=$10 (BCD)
      0x85, 0x20,        // STA $20
      0x08,              // PHP
      0x68,              // PLA
      0x85, 0x21,        // STA $21   (status)
      0xD8,              // CLD
      0x38,              // SEC       (no borrow)
      0xA9, 0x00,        // LDA #$00
      0xF8,              // SED
      0xE9, 0x01,        // SBC #$01  -> A=$99 (BCD), borrow
      0x85, 0x22,        // STA $22
      0x00,              // BRK
  };
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(1000);

  Json j;
  j.beginObject();
  j.key("adcResult").num(m.debugReadRam(0x20));
  j.key("adcStatus").num(m.debugReadRam(0x21));
  j.key("sbcResult").num(m.debugReadRam(0x22));
  j.endObject();
  return j.str();
}

std::string scenBusBanking() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  // Seed RAM shadow bytes under ROM windows so we can tell RAM from ROM reads.
  m.debugWriteRam(0xA000, 0x5A);
  m.debugWriteRam(0xE000, 0x5B);
  m.debugWriteRam(0xD000, 0x5C);

  const u16 probes[] = {0x0001, 0x8000, 0xA000, 0xD000, 0xD400, 0xD800,
                        0xDC00, 0xDE00, 0xE000};
  const u8 ports[] = {0x37, 0x36, 0x35, 0x34, 0x30};

  Json j;
  j.beginObject().key("banks").beginArray();
  for (u8 port : ports) {
    // Drive the processor port ($01) through the bus with a tiny program so banking updates
    // exactly as hardware would (there is no debug bus-write API by design).
    std::vector<u8> code = {0xA9, port, 0x85, 0x01, 0x00};  // LDA #port; STA $01; BRK
    std::vector<u8> prg = {0x00, 0xC0};
    prg.insert(prg.end(), code.begin(), code.end());
    m.loadPrg(prg);
    m.setProgramCounter(0xC000);
    m.runCycles(20);

    j.beginObject();
    j.key("port").num(m.processorPort());
    j.key("loram").boolean(m.regionOf(0xA000) == MappedRegion::BasicRom);
    j.key("regions").beginArray();
    for (u16 addr : probes) {
      j.beginObject();
      j.key("addr").num(addr);
      j.key("region").str(mappedRegionId(m.regionOf(addr)));
      j.key("read").num(m.debugPeek(addr));
      j.endObject();
    }
    j.endArray();
    j.endObject();
  }
  j.endArray().endObject();
  return j.str();
}

std::string scenInterrupts() {
  Machine m;
  // IRQ handler at $C100 (RTI), NMI handler at $C200 (RTI).
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  m.debugWriteRam(0xC100, 0x40);  // RTI
  m.debugWriteRam(0xC200, 0x40);  // RTI
  // Main program at $C000: CLI; NOP loop.
  std::vector<u8> code = {0x58, 0xEA, 0xEA, 0xEA, 0xEA, 0x00};  // CLI; NOP*4; BRK
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);

  Json j;
  j.beginObject();

  m.runCycles(2);  // CLI executed (I cleared, effect delayed one instruction)
  m.setIrqLine(true);
  // NMOS delay: the instruction after CLI runs before the pending IRQ is taken.
  RunResult delayed = m.runCycles(1);  // delayed NOP runs, no IRQ yet
  j.key("delayedPc").num(m.cpuState().pc);
  j.key("delayedCycles").num(delayed.cyclesExecuted);
  RunResult afterIrq = m.runCycles(1);  // now services IRQ (7 cycles)
  j.key("irqEntryPc").num(m.cpuState().pc);
  j.key("irqEntryCycles").num(afterIrq.cyclesExecuted);
  j.key("irqSp").num(m.cpuState().sp);
  m.setIrqLine(false);
  m.runCycles(1);  // RTI
  j.key("afterRtiPc").num(m.cpuState().pc);

  m.triggerNmi();
  RunResult afterNmi = m.runCycles(1);
  j.key("nmiEntryPc").num(m.cpuState().pc);
  j.key("nmiEntryCycles").num(afterNmi.cyclesExecuted);

  j.endObject();
  return j.str();
}

std::string scenPrgLoad() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);

  Json j;
  j.beginObject().key("cases").beginArray();

  // Valid load at $0801.
  {
    std::vector<u8> prg = {0x01, 0x08, 0xDE, 0xAD, 0xBE, 0xEF};
    LoadResult lr = m.loadPrg(prg);
    j.beginObject();
    j.key("case").str("valid");
    j.key("ok").boolean(lr.ok);
    j.key("loadAddress").num(lr.loadAddress);
    j.key("endAddressExclusive").num(lr.endAddressExclusive);
    j.key("byte0").num(m.debugReadRam(0x0801));
    j.key("byte3").num(m.debugReadRam(0x0804));
    j.endObject();
  }
  // Too short.
  {
    std::vector<u8> prg = {0x01, 0x08};
    LoadResult lr = m.loadPrg(prg);
    j.beginObject();
    j.key("case").str("too-short");
    j.key("ok").boolean(lr.ok);
    j.key("errorCode").str(errorCodeId(lr.error.code));
    j.endObject();
  }
  // Overflow past $FFFF.
  {
    std::vector<u8> prg = {0xFF, 0xFF, 0x01, 0x02, 0x03};
    LoadResult lr = m.loadPrg(prg);
    j.beginObject();
    j.key("case").str("overflow");
    j.key("ok").boolean(lr.ok);
    j.key("errorCode").str(errorCodeId(lr.error.code));
    j.endObject();
  }

  j.endArray().endObject();
  return j.str();
}

std::string scenDeterminism() {
  // Run the same program twice from a fresh power-on; final state must match.
  const std::vector<u8> code = {
      0xA9, 0x2A, 0x85, 0x30, 0xAA, 0xE8, 0x86, 0x31, 0x00,  // LDA;STA;TAX;INX;STX;BRK
  };
  auto runOnce = [&](CpuState& outState, u8& mem30, u8& mem31) {
    Machine m;
    configureSynthetic(m, 0xC000, 0xC100, 0xC200);
    std::vector<u8> prg = {0x00, 0xC0};
    prg.insert(prg.end(), code.begin(), code.end());
    m.loadPrg(prg);
    m.setProgramCounter(0xC000);
    m.runCycles(1000);
    outState = m.cpuState();
    mem30 = m.debugReadRam(0x30);
    mem31 = m.debugReadRam(0x31);
  };
  CpuState s1, s2;
  u8 a30, a31, b30, b31;
  runOnce(s1, a30, a31);
  runOnce(s2, b30, b31);

  Json j;
  j.beginObject();
  j.key("firstA").num(s1.a);
  j.key("firstX").num(s1.x);
  j.key("mem30").num(a30);
  j.key("mem31").num(a31);
  j.key("identical").boolean(s1.pc == s2.pc && s1.a == s2.a && s1.x == s2.x && s1.y == s2.y &&
                             s1.sp == s2.sp && s1.p == s2.p && a30 == b30 && a31 == b31);
  j.endObject();
  return j.str();
}

std::string scenDeviceStatus() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  Json j;
  j.beginObject();
  const DeviceStatus devices[4] = {m.vicStatus(), m.sidStatus(), m.cia1Status(), m.cia2Status()};
  j.key("devices").beginArray();
  for (const DeviceStatus& d : devices) {
    j.beginObject();
    j.key("id").str(d.id);
    j.key("implemented").boolean(d.implemented);
    j.endObject();
  }
  j.endArray();
  // Implemented device APIs: framebuffer/audio metadata and a rejected malformed mount.
  j.key("framebufferSize").num(m.framebufferSize());
  j.key("frameWidth").num(m.frameInfo().width);
  j.key("frameHeight").num(m.frameInfo().height);
  InputSnapshot input;
  j.key("setInput").str(errorCodeId(m.setInput(input).code));
  j.key("mountMalformed").str(errorCodeId(m.mountD64(std::vector<u8>(10, 0), 8).error.code));
  j.endObject();
  return j.str();
}

// --- Device integration scenarios (integer-only outputs for byte-identical native/WASM parity;
//     SID float audio is validated by native unit tests + a WASM smoke test, not byte-parity). ---

// Minimal valid D64 with one PRG file, mirroring src/d64.js layout (for the load-trap scenario).
std::vector<u8> buildScenarioD64(const char* name, const std::vector<u8>& prg) {
  auto sectorsIn = [](int t) {
    if (t >= 1 && t <= 17) return 21;
    if (t >= 18 && t <= 24) return 19;
    if (t >= 25 && t <= 30) return 18;
    if (t >= 31 && t <= 35) return 17;
    return 0;
  };
  auto off = [&](int t, int s) {
    int cnt = 0;
    for (int i = 1; i < t; ++i) cnt += sectorsIn(i);
    return (cnt + s) * 256;
  };
  std::vector<u8> img(174848, 0);
  const int o0 = off(1, 0);
  img[o0] = 0;
  img[o0 + 1] = static_cast<u8>(prg.size() + 1);
  for (size_t i = 0; i < prg.size(); ++i) img[o0 + 2 + i] = prg[i];
  const int dir = off(18, 1);
  img[dir] = 0;
  img[dir + 1] = 0xFF;
  img[dir + 2] = 0x82;
  img[dir + 3] = 1;
  img[dir + 4] = 0;
  for (int i = 0; i < 16; ++i) img[dir + 5 + i] = 0xA0;
  for (int i = 0; name[i]; ++i) img[dir + 5 + i] = static_cast<u8>(name[i]);
  img[dir + 30] = 1;
  const int bam = off(18, 0);
  img[bam] = 18;
  img[bam + 1] = 1;
  img[bam + 2] = 0x41;
  for (int i = 0; i < 16; ++i) img[bam + 0x90 + i] = 0xA0;
  img[bam + 0xA2] = 'I';
  img[bam + 0xA3] = 'D';
  return img;
}

std::string vicFrameScenario(const char* timing) {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200, timing);
  // Set DEN off (whole screen border) and border colour to 6; loop.
  const std::vector<u8> code = {0xA9, 0x0B, 0x8D, 0x11, 0xD0, 0xA9, 0x06,
                                0x8D, 0x20, 0xD0, 0x4C, 0x0A, 0xC0};
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(40000);  // ~2 frames
  std::vector<u8> fb(m.framebufferSize(), 0);
  FrameInfo info = m.copyFramebuffer(fb.data(), static_cast<u32>(fb.size()));
  Json j;
  j.beginObject();
  j.key("frameWidth").num(info.width);
  j.key("frameHeight").num(info.height);
  j.key("frameSequence").num(info.sequence);
  j.key("borderTopLeft").num(fb[0]);
  j.key("borderCenter").num(fb[fb.size() / 2]);
  j.endObject();
  return j.str();
}

std::string scenVicFramePal() { return vicFrameScenario("pal-6569"); }
std::string scenVicFrameNtsc() { return vicFrameScenario("ntsc-6567r8"); }

std::string scenCiaTimer() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  // Start CIA1 timer A one-shot (latch 4), run past underflow, capture the ICR into $10.
  const std::vector<u8> code = {
      0xA9, 0x04, 0x8D, 0x04, 0xDC,  // LDA #4; STA $DC04 (TA lo)
      0xA9, 0x00, 0x8D, 0x05, 0xDC,  // LDA #0; STA $DC05 (TA hi)
      0xA9, 0x09, 0x8D, 0x0E, 0xDC,  // LDA #$09; STA $DC0E (start, one-shot)
      0xEA, 0xEA, 0xEA, 0xEA, 0xEA,  // NOPs
      0xAD, 0x0D, 0xDC, 0x85, 0x10,  // LDA $DC0D (ICR); STA $10
      0x00};
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(300);
  Json j;
  j.beginObject();
  j.key("icr").num(m.debugReadRam(0x10));
  j.endObject();
  return j.str();
}

std::string scenLoadTrap() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  const std::vector<u8> filePrg = {0x01, 0x08, 0x11, 0x22, 0x33, 0x44};
  m.mountD64(buildScenarioD64("PROG", filePrg), 8);
  const char* name = "PROG";
  for (int i = 0; name[i]; ++i) m.debugWriteRam(static_cast<u16>(0x0500 + i), name[i]);
  m.debugWriteRam(0xB7, 4);
  m.debugWriteRam(0xBB, 0x00);
  m.debugWriteRam(0xBC, 0x05);
  m.debugWriteRam(0xB9, 0x01);
  m.debugWriteRam(0xBA, 0x08);
  std::vector<u8> prg = {0x00, 0xC0, 0x20, 0xD5, 0xFF, 0x00};  // JSR $FFD5; BRK
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(3000);
  Json j;
  j.beginObject();
  j.key("mounted").boolean(m.diskMounted());
  j.key("byte0801").num(m.debugReadRam(0x0801));
  j.key("byte0804").num(m.debugReadRam(0x0804));
  j.key("carrySet").boolean((m.cpuState().p & FlagC) != 0);
  j.key("endX").num(m.cpuState().x);
  j.key("endY").num(m.cpuState().y);
  j.endObject();
  return j.str();
}

std::string scenKeyboardInput() {
  Machine m;
  configureSynthetic(m, 0xC000, 0xC100, 0xC200);
  InputSnapshot input;
  input.keyboardColumns[2] = static_cast<u8>(~(1u << 5) & 0xFF);  // key at column 2, row 5
  m.setInput(input);
  const std::vector<u8> code = {
      0xA9, 0xFF, 0x8D, 0x02, 0xDC,  // DDRA = output
      0xA9, 0x00, 0x8D, 0x03, 0xDC,  // DDRB = input
      0xA9, 0xFB, 0x8D, 0x00, 0xDC,  // select column 2
      0xAD, 0x01, 0xDC, 0x85, 0x10,  // read rows -> $10
      0x00};
  std::vector<u8> prg = {0x00, 0xC0};
  prg.insert(prg.end(), code.begin(), code.end());
  m.loadPrg(prg);
  m.setProgramCounter(0xC000);
  m.runCycles(300);
  Json j;
  j.beginObject();
  j.key("rowRead").num(m.debugReadRam(0x10));
  j.endObject();
  return j.str();
}

struct Scenario {
  const char* id;
  std::string (*run)();
};

const Scenario kScenarios[] = {
    {"timing-profiles", scenTimingProfiles},
    {"rom-identity", scenRomIdentity},
    {"rom-errors", scenRomErrors},
    {"reset-vectors", scenResetVectors},
    {"cpu-trace-basic", scenCpuTraceBasic},
    {"page-cross-cycles", scenPageCrossCycles},
    {"rmw", scenRmw},
    {"decimal", scenDecimal},
    {"bus-banking", scenBusBanking},
    {"interrupts", scenInterrupts},
    {"prg-load", scenPrgLoad},
    {"determinism", scenDeterminism},
    {"device-status", scenDeviceStatus},
    {"vic-frame-pal", scenVicFramePal},
    {"vic-frame-ntsc", scenVicFrameNtsc},
    {"cia-timer", scenCiaTimer},
    {"keyboard-input", scenKeyboardInput},
    {"load-trap", scenLoadTrap},
};

}  // namespace

std::vector<std::string> scenarioIds() {
  std::vector<std::string> ids;
  for (const Scenario& s : kScenarios) ids.push_back(s.id);
  return ids;
}

std::string runScenario(const std::string& id) {
  for (const Scenario& s : kScenarios) {
    if (id == s.id) return s.run();
  }
  return "{\"error\":\"unknown-scenario\"}";
}

std::string runAllScenarios() {
  Json j;
  j.beginArray();
  for (const Scenario& s : kScenarios) {
    j.beginObject();
    j.key("id").str(s.id);
    j.key("result").raw(s.run());
    j.endObject();
  }
  j.endArray();
  return j.str();
}

}  // namespace c64
