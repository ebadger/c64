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
  return c64::TimingProfile::Pal6569; // default; the client passes a validated profile id
}

// Thin JS-facing wrapper around c64::Machine implementing the coordinated v0 contract.
class WasmMachine {
public:
  explicit WasmMachine(const std::string& profile)
      : machine_(c64::MachineConfig{parseProfile(profile), c64::RamPattern::Zero}) {}

  void reset() { machine_.reset(c64::ResetKind::PowerOn); }
  void setPC(unsigned address) { machine_.setPc(static_cast<c64::u16>(address & 0xFFFF)); }

  // Accepts a Uint8Array (or number[]) holding the PRG image: 2-byte load address + data.
  val loadPrg(val bytes) {
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
  // number of cycles run.
  double runCycles(unsigned maxCycles) {
    const c64::RunResult r = machine_.runCycles(static_cast<c64::u32>(maxCycles));
    return static_cast<double>(r.cyclesExecuted);
  }

  val runFrame() {
    const c64::RunResult r = machine_.runFrame();
    val out = val::object();
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
  c64::Machine machine_;
};

} // namespace

EMSCRIPTEN_BINDINGS(c64_core) {
  emscripten::class_<WasmMachine>("Machine")
      .constructor<std::string>()
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
