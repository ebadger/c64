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
}
