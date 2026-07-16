#include "c64/machine.hpp"

namespace c64 {

Machine::Machine(const MachineConfig& config) : config_(config), vic_(config.profile), cpu_(bus_) {
  bus_.attachVic(&vic_);
  reset(ResetKind::PowerOn);
}

void Machine::reset(ResetKind kind) {
  bus_.reset(kind, config_.ramPattern);
  vic_.reset();
  cpu_.reset(kind); // reads the $FFFC vector (RAM without a KERNAL ROM); callers use setPc for direct mode
  frameSequence_ = 0;
}

LoadResult Machine::loadPrg(const u8* data, std::size_t length) {
  LoadResult result;
  if (data == nullptr || length < 3) {
    result.errorCode = static_cast<int>(ErrorCode::InvalidPrg);
    return result;
  }
  const u16 loadAddress = static_cast<u16>(data[0] | (data[1] << 8));
  const std::size_t payload = length - 2;
  const u32 endExclusive = static_cast<u32>(loadAddress) + static_cast<u32>(payload);
  if (endExclusive > 0x10000) {
    result.errorCode = static_cast<int>(ErrorCode::InvalidPrg);
    return result;
  }
  for (std::size_t i = 0; i < payload; ++i) {
    bus_.loadRam(static_cast<u16>(loadAddress + i), data[2 + i]);
  }
  result.ok = true;
  result.loadAddress = loadAddress;
  result.endAddressExclusive = endExclusive;
  return result;
}

RunResult Machine::runCycles(u32 maxCycles) {
  RunResult result;
  u64 executed = 0;
  while (executed < maxCycles) {
    if (cpu_.faulted()) {
      result.stopped = true;
      result.stopReason = StopReason::Fault;
      break;
    }
    const u8 consumed = cpu_.step();
    executed += consumed;
    vic_.tick(consumed);
    if (cpu_.faulted()) {
      result.stopped = true;
      result.stopReason = StopReason::Fault;
      break;
    }
  }
  frameSequence_ = vic_.frameSequence();
  result.cyclesExecuted = executed;
  result.frameSequence = frameSequence_;
  if (!result.stopped) {
    result.stopReason = StopReason::Budget;
  }
  return result;
}

RunResult Machine::runFrame() { return runCycles(vic_.cyclesPerFrame()); }

const std::vector<u8>& Machine::framebuffer() {
  vic_.renderInto(framebuffer_);
  return framebuffer_;
}

FrameInfo Machine::frameInfo() const {
  FrameInfo info;
  info.sequence = vic_.frameSequence();
  info.width = Vic::kWidth;
  info.height = Vic::kHeight;
  return info;
}

} // namespace c64
