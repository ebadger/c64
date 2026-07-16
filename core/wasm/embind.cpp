// embind projection of the deterministic core: the v0 boundary the static web client integrates
// against. It is intentionally small and side-effect free at the edges — browser pacing, audio,
// DOM, and file pickers stay in the client. framebuffer() returns a fresh Uint8Array copy so no
// writable view into WASM memory can outlive a memory growth (see specs/EMULATOR.md). This file
// compiles only in the Emscripten build; the native build never sees it.
#include <cstddef>
#include <string>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "c64/errors.hpp"
#include "c64/machine.hpp"
#include "c64/types.hpp"

using emscripten::typed_memory_view;
using emscripten::val;

namespace {

c64::TimingProfile parseProfile(const std::string& id) {
  if (id == "ntsc-6567r8") {
    return c64::TimingProfile::Ntsc6567R8;
  }
  return c64::TimingProfile::Pal6569; // default; validity is tracked separately by isSupportedProfile
}

bool isSupportedProfile(const std::string& id) { return id == "pal-6569" || id == "ntsc-6567r8"; }

// Thin JS-facing wrapper around c64::Machine implementing the coordinated v0 contract.
class WasmMachine {
public:
  explicit WasmMachine(const std::string& profile)
      : configError_(isSupportedProfile(profile) ? std::string() : std::string("invalid-config")),
        machine_(c64::MachineConfig{parseProfile(profile), c64::RamPattern::Zero}) {}

  // An unsupported timing profile is reported through these accessors rather than a silent PAL
  // default; the client must check ok() after construction. Structured, non-throwing.
  bool ok() const { return configError_.empty(); }
  std::string configError() const { return configError_; }

  void reset() { machine_.reset(c64::ResetKind::PowerOn); }
  void setPC(unsigned address) { machine_.setPc(static_cast<c64::u16>(address & 0xFFFF)); }

  // Accepts a Uint8Array (or number[]) holding the PRG image: 2-byte load address + data.
  val loadPrg(val bytes) {
    if (!ok()) {
      return errorResult(configError_);
    }
    std::vector<c64::u8> buffer = emscripten::convertJSArrayToNumberVector<c64::u8>(bytes);
    const c64::LoadResult r = machine_.loadPrg(buffer.data(), buffer.size());
    val out = val::object();
    out.set("ok", r.ok);
    out.set("loadAddress", static_cast<unsigned>(r.loadAddress));
    out.set("endAddress", static_cast<double>(r.endAddressExclusive));
    out.set("error", r.ok ? val::null()
                          : val(std::string(c64::errorCodeName(static_cast<c64::ErrorCode>(r.errorCode)))));
    return out;
  }

  // Runs whole instructions until at least `maxCycles` cycles have executed; returns the exact
  // number of cycles run. A misconfigured machine runs nothing.
  double runCycles(unsigned maxCycles) {
    if (!ok()) {
      return 0.0;
    }
    const c64::RunResult r = machine_.runCycles(static_cast<c64::u32>(maxCycles));
    return static_cast<double>(r.cyclesExecuted);
  }

  val runFrame() {
    val out = val::object();
    if (!ok()) {
      out.set("cyclesRun", 0.0);
      out.set("frameSequence", 0.0);
      out.set("stopped", true);
      return out;
    }
    const c64::RunResult r = machine_.runFrame();
    out.set("cyclesRun", static_cast<double>(r.cyclesExecuted));
    out.set("frameSequence", static_cast<double>(r.frameSequence));
    out.set("stopped", r.stopped);
    return out;
  }

  // Returns a freshly allocated Uint8Array copy of the current indexed framebuffer.
  val framebuffer() {
    const std::vector<c64::u8>& fb = machine_.framebuffer();
    const val view = val(typed_memory_view(fb.size(), fb.data()));
    return val::global("Uint8Array").new_(view); // new Uint8Array(view) copies out of the heap
  }

  unsigned frameWidth() const { return c64::Vic::kWidth; }
  unsigned frameHeight() const { return c64::Vic::kHeight; }

  unsigned readMem(unsigned address) const {
    return machine_.readMem(static_cast<c64::u16>(address & 0xFFFF));
  }
  void writeMem(unsigned address, unsigned value) {
    machine_.writeMem(static_cast<c64::u16>(address & 0xFFFF), static_cast<c64::u8>(value & 0xFF));
  }

private:
  static val errorResult(const std::string& code) {
    val out = val::object();
    out.set("ok", false);
    out.set("loadAddress", 0u);
    out.set("endAddress", 0.0);
    out.set("error", val(code));
    return out;
  }

  std::string configError_; // declared before machine_ so the constructor init order is stable
  c64::Machine machine_;
};

} // namespace

EMSCRIPTEN_BINDINGS(c64_core) {
  emscripten::class_<WasmMachine>("Machine")
      .constructor<std::string>()
      .function("ok", &WasmMachine::ok)
      .function("configError", &WasmMachine::configError)
      .function("reset", &WasmMachine::reset)
      .function("setPC", &WasmMachine::setPC)
      .function("loadPrg", &WasmMachine::loadPrg)
      .function("runCycles", &WasmMachine::runCycles)
      .function("runFrame", &WasmMachine::runFrame)
      .function("framebuffer", &WasmMachine::framebuffer)
      .function("frameWidth", &WasmMachine::frameWidth)
      .function("frameHeight", &WasmMachine::frameHeight)
      .function("readMem", &WasmMachine::readMem)
      .function("writeMem", &WasmMachine::writeMem);
// embind projection of the deterministic core for the WebAssembly build.
//
// Only value types cross this boundary: primitives, strings, plain JS objects, and copied
// typed arrays. No raw pointer or writable WebAssembly memory view is exposed, so a memory
// growth can never invalidate a handle held by JavaScript. Errors are returned as their stable
// string codes; no C++ exception is allowed to cross into JavaScript. This file is compiled
// only for the Emscripten target (see core/CMakeLists.txt).
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include <string>
#include <vector>

#include "c64/machine.hpp"
#include "c64/rom.hpp"
#include "c64/scenarios.hpp"

using namespace emscripten;
using namespace c64;

namespace {

std::vector<u8> toBytes(const val& array) {
  return convertJSArrayToNumberVector<u8>(array);
}

val cpuStateToVal(const CpuState& s) {
  val o = val::object();
  o.set("pc", s.pc);
  o.set("a", s.a);
  o.set("x", s.x);
  o.set("y", s.y);
  o.set("sp", s.sp);
  o.set("p", s.p);
  return o;
}

// A thin JS-facing wrapper around the core Machine. Non-copyable; embind manages one heap
// instance per JS handle.
class MachineHandle {
 public:
  MachineHandle() = default;

  std::string configure(const std::string& timing, const std::string& sid, const val& basicBytes,
                        const val& kernalBytes, const val& chargenBytes, int seed) {
    RomImage basic;
    basic.bytes = toBytes(basicBytes);
    basic.source = "user-supplied";
    RomImage kernal;
    kernal.bytes = toBytes(kernalBytes);
    kernal.source = "user-supplied";
    RomImage chargen;
    chargen.bytes = toBytes(chargenBytes);
    chargen.source = "user-supplied";

    RomSetResult roms = validateRomSet(basic, kernal, chargen);
    if (!roms.ok) {
      return errorCodeId(roms.error.code);
    }
    MachineConfig cfg;
    cfg.timingProfile = timing;
    cfg.sidModel = sid;
    cfg.powerOnSeed = static_cast<u8>(seed & 0xFF);
    cfg.roms = roms.set;
    return errorCodeId(m_.configure(cfg).code);
  }

  std::string romSetId() const { return m_.ready() ? m_.roms().id : std::string(); }

  std::string reset(const std::string& kind) {
    if (kind == "warm") {
      return errorCodeId(m_.reset(ResetKind::Warm).code);
    }
    if (kind == "power-on") {
      return errorCodeId(m_.reset(ResetKind::PowerOn).code);
    }
    // Unknown kind: do not silently perform a destructive reset.
    return errorCodeId(ErrorCode::InvalidState);
  }

  val loadPrg(const val& bytes) {
    LoadResult lr = m_.loadPrg(toBytes(bytes));
    val o = val::object();
    o.set("ok", lr.ok);
    o.set("loadAddress", lr.loadAddress);
    o.set("endAddressExclusive", lr.endAddressExclusive);
    o.set("errorCode", std::string(errorCodeId(lr.error.code)));
    o.set("errorMessage", lr.error.message);
    return o;
  }

  std::string setProgramCounter(int pc) {
    return errorCodeId(m_.setProgramCounter(static_cast<u16>(pc & 0xFFFF)).code);
  }

  val runCycles(double maxCycles) {
    RunResult rr = m_.runCycles(static_cast<u64>(maxCycles));
    val o = val::object();
    o.set("cyclesExecuted", static_cast<double>(rr.cyclesExecuted));
    o.set("frameSequence", static_cast<double>(rr.frameSequence));
    o.set("audioFramesAvailable", rr.audioFramesAvailable);
    o.set("stopped", rr.stopped);
    o.set("stopReason", rr.stopReason);
    o.set("errorCode", std::string(errorCodeId(rr.error.code)));
    return o;
  }

  val cpuState() const { return cpuStateToVal(m_.cpuState()); }

  int debugPeek(int addr) const { return m_.debugPeek(static_cast<u16>(addr & 0xFFFF)); }
  int debugReadRam(int addr) const { return m_.debugReadRam(static_cast<u16>(addr & 0xFFFF)); }
  void debugWriteRam(int addr, int value) {
    m_.debugWriteRam(static_cast<u16>(addr & 0xFFFF), static_cast<u8>(value & 0xFF));
  }
  std::string regionOf(int addr) const {
    return mappedRegionId(m_.regionOf(static_cast<u16>(addr & 0xFFFF)));
  }
  int processorPort() const { return m_.processorPort(); }

  void setIrqLine(bool asserted) { m_.setIrqLine(asserted); }
  void triggerNmi() { m_.triggerNmi(); }
  void addBreakpoint(int addr) { m_.addBreakpoint(static_cast<u16>(addr & 0xFFFF)); }
  void clearBreakpoints() { m_.clearBreakpoints(); }

  bool ready() const { return m_.ready(); }

  bool vicImplemented() const { return m_.vicStatus().implemented; }
  bool sidImplemented() const { return m_.sidStatus().implemented; }
  bool cia1Implemented() const { return m_.cia1Status().implemented; }
  bool cia2Implemented() const { return m_.cia2Status().implemented; }

  // Feed the keyboard matrix (8 column bytes), joysticks, and RESTORE NMI. Active-low bits.
  std::string setInput(const val& columns, int joy1, int joy2, bool restore) {
    InputSnapshot snapshot;
    const std::vector<u8> cols = toBytes(columns);
    for (size_t i = 0; i < snapshot.keyboardColumns.size() && i < cols.size(); ++i) {
      snapshot.keyboardColumns[i] = cols[i];
    }
    snapshot.joystick1 = static_cast<u8>(joy1 & 0xFF);
    snapshot.joystick2 = static_cast<u8>(joy2 & 0xFF);
    snapshot.restorePressed = restore;
    return errorCodeId(m_.setInput(snapshot).code);
  }

  void releaseAllInput() { m_.releaseAllInput(); }

  int framebufferSize() const { return static_cast<int>(m_.framebufferSize()); }

  // Copy the framebuffer into a module-owned buffer and expose a view. The JS wrapper copies it
  // (new Uint8Array(...)) so no writable WebAssembly memory view outlives a memory growth.
  val copyFramebuffer() {
    fbBuffer_.assign(m_.framebufferSize(), 0);
    FrameInfo info = m_.copyFramebuffer(fbBuffer_.data(), static_cast<u32>(fbBuffer_.size()));
    val o = val::object();
    o.set("width", info.width);
    o.set("height", info.height);
    o.set("sequence", static_cast<double>(info.sequence));
    o.set("dirty", info.dirty);
    o.set("pixels", val(typed_memory_view(fbBuffer_.size(), fbBuffer_.data())));
    return o;
  }

  val drainAudio(int maxFrames) {
    // Cap the allocation so a pathological request cannot exhaust memory; the SID buffer holds
    // at most ~one second of samples, so this never truncates a legitimate drain.
    u32 n = static_cast<u32>(maxFrames < 0 ? 0 : maxFrames);
    if (n > (1u << 20)) n = 1u << 20;
    audioBuffer_.assign(n, 0.0f);
    AudioInfo info = m_.drainAudio(audioBuffer_.data(), n);
    val o = val::object();
    o.set("sampleRate", info.sampleRate);
    o.set("channels", info.channels);
    o.set("framesWritten", info.framesWritten);
    o.set("sequence", static_cast<double>(info.sequence));
    o.set("dropped", info.dropped);
    o.set("samples", val(typed_memory_view(static_cast<size_t>(info.framesWritten),
                                           audioBuffer_.data())));
    return o;
  }

  val mountD64(const val& bytes) {
    MediaResult r = m_.mountD64(toBytes(bytes), 8);
    val o = val::object();
    o.set("ok", r.ok);
    o.set("errorCode", std::string(errorCodeId(r.error.code)));
    o.set("errorMessage", r.error.message);
    o.set("diskName", r.metadata.diskName);
    o.set("fileCount", r.metadata.fileCount);
    return o;
  }

 private:
  Machine m_;
  std::vector<u8> fbBuffer_;
  std::vector<float> audioBuffer_;
};

std::string scenarioJson(const std::string& id) { return runScenario(id); }
std::string allScenariosJson() { return runAllScenarios(); }
val scenarioIdList() {
  val arr = val::array();
  const std::vector<std::string> ids = scenarioIds();
  for (size_t i = 0; i < ids.size(); ++i) arr.set(static_cast<int>(i), ids[i]);
  return arr;
}

}  // namespace

EMSCRIPTEN_BINDINGS(c64_core) {
  function("scenarioJson", &scenarioJson);
  function("allScenariosJson", &allScenariosJson);
  function("scenarioIds", &scenarioIdList);

  class_<MachineHandle>("Machine")
      .constructor<>()
      .function("configure", &MachineHandle::configure)
      .function("romSetId", &MachineHandle::romSetId)
      .function("reset", &MachineHandle::reset)
      .function("loadPrg", &MachineHandle::loadPrg)
      .function("setProgramCounter", &MachineHandle::setProgramCounter)
      .function("runCycles", &MachineHandle::runCycles)
      .function("cpuState", &MachineHandle::cpuState)
      .function("debugPeek", &MachineHandle::debugPeek)
      .function("debugReadRam", &MachineHandle::debugReadRam)
      .function("debugWriteRam", &MachineHandle::debugWriteRam)
      .function("regionOf", &MachineHandle::regionOf)
      .function("processorPort", &MachineHandle::processorPort)
      .function("setIrqLine", &MachineHandle::setIrqLine)
      .function("triggerNmi", &MachineHandle::triggerNmi)
      .function("addBreakpoint", &MachineHandle::addBreakpoint)
      .function("clearBreakpoints", &MachineHandle::clearBreakpoints)
      .function("ready", &MachineHandle::ready)
      .function("vicImplemented", &MachineHandle::vicImplemented)
      .function("sidImplemented", &MachineHandle::sidImplemented)
      .function("cia1Implemented", &MachineHandle::cia1Implemented)
      .function("cia2Implemented", &MachineHandle::cia2Implemented)
      .function("setInput", &MachineHandle::setInput)
      .function("releaseAllInput", &MachineHandle::releaseAllInput)
      .function("framebufferSize", &MachineHandle::framebufferSize)
      .function("copyFramebuffer", &MachineHandle::copyFramebuffer)
      .function("drainAudio", &MachineHandle::drainAudio)
      .function("mountD64", &MachineHandle::mountD64);
}
