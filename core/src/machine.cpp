#include "c64/machine.hpp"

namespace c64 {

Machine::Machine() : cpu_(bus_) {}

Error Machine::configure(const MachineConfig& config) {
  const TimingProfile* profile = nullptr;
  if (!timingProfileById(config.timingProfile.c_str(), &profile)) {
    return Error::make(ErrorCode::InvalidConfig,
                       "Unknown timing profile '" + config.timingProfile + "'.");
  }
  if (config.sidModel != "6581" && config.sidModel != "8580") {
    return Error::make(ErrorCode::InvalidConfig, "Unknown SID model '" + config.sidModel + "'.");
  }
  if (!config.roms.complete()) {
    return Error::make(ErrorCode::RomSetIncomplete,
                       "Machine configuration requires a complete ROM set.");
  }

  config_ = config;
  roms_ = config.roms;
  profile_ = profile;
  bus_.setRoms(roms_);
  ready_ = true;
  return reset(ResetKind::PowerOn);
}

Error Machine::requireReady() const {
  if (!ready_) {
    return Error::make(ErrorCode::InvalidState, "Machine is not configured.");
  }
  return Error::none();
}

Error Machine::reset(ResetKind kind) {
  Error e = requireReady();
  if (!e.ok()) return e;

  if (kind == ResetKind::PowerOn) {
    bus_.powerOnReset(config_.powerOnSeed);
    cpu_.powerOn();
  } else {
    bus_.warmReset();
    cpu_.reset();
  }
  totalCycles_ = 0;
  return Error::none();
}

LoadResult Machine::loadPrg(const std::vector<u8>& bytes) {
  LoadResult r;
  Error e = requireReady();
  if (!e.ok()) {
    r.error = e;
    return r;
  }
  if (bytes.size() < 3) {
    r.error = Error::make(ErrorCode::InvalidPrg,
                          "PRG must have a 2-byte load address and at least one data byte.");
    return r;
  }
  const u16 loadAddress = static_cast<u16>(bytes[0] | (bytes[1] << 8));
  const u32 dataLength = static_cast<u32>(bytes.size() - 2);
  const u32 endExclusive = static_cast<u32>(loadAddress) + dataLength;
  if (endExclusive > 0x10000u) {
    r.error = Error::make(ErrorCode::InvalidPrg, "PRG data wraps past $FFFF.");
    return r;
  }
  for (u32 i = 0; i < dataLength; ++i) {
    bus_.rawRamWrite(static_cast<u16>(loadAddress + i), bytes[i + 2]);
  }
  r.ok = true;
  r.loadAddress = loadAddress;
  r.endAddressExclusive = endExclusive;
  return r;
}

Error Machine::setProgramCounter(u16 pc) {
  Error e = requireReady();
  if (!e.ok()) return e;
  CpuState s = cpu_.state();
  s.pc = pc;
  cpu_.setState(s);
  return Error::none();
}

u64 Machine::frameSequence() const {
  if (profile_ == nullptr || profile_->cyclesPerFrame == 0) return 0;
  return totalCycles_ / profile_->cyclesPerFrame;
}

RunResult Machine::runCycles(u64 maxCycles) {
  RunResult r;
  Error e = requireReady();
  if (!e.ok()) {
    r.error = e;
    r.stopped = true;
    r.stopReason = "fault";
    return r;
  }

  u64 consumed = 0;
  while (consumed < maxCycles) {
    if (!breakpoints_.empty() && breakpoints_.count(cpu_.pc()) != 0) {
      r.stopped = true;
      r.stopReason = "breakpoint";
      break;
    }
    const StepResult step = cpu_.step();
    if (step.stop == StepStop::IllegalOpcode) {
      r.stopped = true;
      r.stopReason = "fault";
      r.error = Error::make(ErrorCode::InternalFault,
                            "Undocumented opcode $" +
                                std::string(1, "0123456789abcdef"[(step.opcode >> 4) & 0xF]) +
                                std::string(1, "0123456789abcdef"[step.opcode & 0xF]) +
                                " at $" + std::to_string(step.pc));
      break;
    }
    consumed += step.cycles;
    totalCycles_ += step.cycles;
    bus_.tickDevices(step.cycles);
    if (step.stop == StepStop::Brk) {
      r.stopped = true;
      r.stopReason = "brk";
      break;
    }
  }
  if (!r.stopped) {
    r.stopReason = "budget";
  }
  r.cyclesExecuted = consumed;
  r.frameSequence = frameSequence();
  r.audioFramesAvailable = 0;
  return r;
}

void Machine::setIrqLine(bool asserted) { cpu_.setIrqLine(asserted); }
void Machine::triggerNmi() { cpu_.triggerNmi(); }

Error Machine::mountD64(const std::vector<u8>&, u8) {
  return Error::make(ErrorCode::Unavailable,
                     "Disk drive emulation is not implemented until a later milestone.");
}

Error Machine::copyFramebuffer() {
  return Error::make(ErrorCode::Unavailable,
                     "VIC-II framebuffer is not implemented until a later milestone.");
}

Error Machine::drainAudio() {
  return Error::make(ErrorCode::Unavailable,
                     "SID audio is not implemented until a later milestone.");
}

Error Machine::setInput() {
  return Error::make(ErrorCode::Unavailable,
                     "Keyboard/joystick input is not implemented until a later milestone.");
}

}  // namespace c64
