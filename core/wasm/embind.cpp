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

  std::string mountD64(const val& bytes) {
    return errorCodeId(m_.mountD64(toBytes(bytes), 8).code);
  }
  std::string copyFramebuffer() { return errorCodeId(m_.copyFramebuffer().code); }
  std::string drainAudio() { return errorCodeId(m_.drainAudio().code); }
  std::string setInput() { return errorCodeId(m_.setInput().code); }

 private:
  Machine m_;
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
      .function("mountD64", &MachineHandle::mountD64)
      .function("copyFramebuffer", &MachineHandle::copyFramebuffer)
      .function("drainAudio", &MachineHandle::drainAudio)
      .function("setInput", &MachineHandle::setInput);
}
