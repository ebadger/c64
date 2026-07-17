#include "c64/drive.hpp"

#include <algorithm>

namespace c64 {

DriveBus::DriveBus(IecBus& iec) : iec_(iec) {}

void DriveBus::mount(const Disk& disk) {
  disk_ = encodeGcrDisk(disk);
  mounted_ = disk.loaded;
  byteIndex_ = rotationCycle_ = 0;
  byteReady_ = false;
}

void DriveBus::unmount() {
  disk_ = GcrDisk{};
  mounted_ = false;
  byteIndex_ = rotationCycle_ = 0;
  byteReady_ = false;
}

void DriveBus::reset() {
  ram_.fill(0);
  via1_.reset();
  via2_.reset();
  headHalfTrack_ = 34;
  stepPhase_ = 0;
  rotationCycle_ = byteIndex_ = 0;
  byteReady_ = false;
  cycles_ = 0;
  iec_.setDriveVia1PortB(0, 0);
  updateViaInputs();
}

u8 DriveBus::headTrack() const {
  return static_cast<u8>(headHalfTrack_ / 2 + 1);
}

u32 DriveBus::bytePeriod() const {
  const u8 zone = static_cast<u8>((via2_.portBOutputLatch() >> 5) & 0x03);
  constexpr u32 periods[4] = {32, 30, 28, 26};
  return periods[zone];
}

void DriveBus::updateViaInputs() {
  iec_.setDriveVia1PortB(via1_.portBOutputLatch(), via1_.portBDirection());
  via1_.setPortBInputs(iec_.driveVia1PortBInputs());

  u8 portB = 0xFF;
  portB = static_cast<u8>(portB & ~0x10);  // immutable media is write-protected
  if (mounted_ && (headHalfTrack_ & 1) == 0) {
    const GcrTrack& track = disk_.tracks[headTrack() - 1];
    if (!track.sync.empty() && track.sync[byteIndex_ % track.sync.size()] != 0) {
      portB = static_cast<u8>(portB & ~0x80);  // /SYNC is active low
    }
    if (!track.bytes.empty()) via2_.setPortAInputs(track.bytes[byteIndex_ % track.bytes.size()]);
  } else {
    via2_.setPortAInputs(0xFF);
  }
  via2_.setPortBInputs(portB);
}

void DriveBus::updateStepper(u8 oldPortB, u8 newPortB) {
  const u8 oldPhase = static_cast<u8>(oldPortB & 0x03);
  const u8 newPhase = static_cast<u8>(newPortB & 0x03);
  if (newPhase == oldPhase) return;
  if (newPhase == static_cast<u8>((oldPhase + 1) & 0x03)) {
    headHalfTrack_ = std::min<i32>(68, headHalfTrack_ + 1);
  } else if (newPhase == static_cast<u8>((oldPhase + 3) & 0x03)) {
    headHalfTrack_ = std::max<i32>(0, headHalfTrack_ - 1);
  }
  stepPhase_ = newPhase;
  byteIndex_ = rotationCycle_ = 0;
  byteReady_ = false;
}

void DriveBus::tickCycle() {
  ++cycles_;
  updateViaInputs();
  if (!mounted_ || !motorOn() || (headHalfTrack_ & 1) != 0) return;

  const GcrTrack& track = disk_.tracks[headTrack() - 1];
  if (track.bytes.empty()) return;
  ++rotationCycle_;
  if (rotationCycle_ < bytePeriod()) return;
  rotationCycle_ = 0;
  byteIndex_ = static_cast<u32>((byteIndex_ + 1) % track.bytes.size());
  updateViaInputs();
  byteReady_ = track.sync[byteIndex_] == 0;
  if (byteReady_ && cpu_ != nullptr) cpu_->triggerSo();
}

u8 DriveBus::read(u16 addr, bool sideEffects) const {
  static_cast<void>(sideEffects);
  if (addr < 0x1800) return ram_[addr & 0x07FF];
  if (addr < 0x1C00) return via1_.read(static_cast<u8>(addr & 0x0F));
  if (addr < 0x2000) return via2_.read(static_cast<u8>(addr & 0x0F));
  if (addr >= 0xC000 && rom_.size() == 16384) return rom_[addr - 0xC000];
  return 0xFF;
}

void DriveBus::write(u16 addr, u8 value) {
  if (addr < 0x1800) {
    ram_[addr & 0x07FF] = value;
    return;
  }
  if (addr < 0x1C00) {
    via1_.write(static_cast<u8>(addr & 0x0F), value);
    updateViaInputs();
    return;
  }
  if (addr < 0x2000) {
    const u8 oldPortB = via2_.portBOutputLatch();
    via2_.write(static_cast<u8>(addr & 0x0F), value);
    if ((addr & 0x0F) == 0) updateStepper(oldPortB, via2_.portBOutputLatch());
    updateViaInputs();
  }
}

u8 DriveBus::readCycle(u16 addr) {
  const u8 reg = static_cast<u8>(addr & 0x0F);
  const bool consumesByte =
      addr >= 0x1C00 && addr < 0x2000 && (reg == 0x01 || reg == 0x0F);
  if (consumesByte) byteReady_ = false;
  tickCycle();
  return read(addr, true);
}

void DriveBus::writeCycle(u16 addr, u8 value) {
  tickCycle();
  write(addr, value);
}

u8 DriveBus::peek(u16 addr) const { return read(addr, false); }

void DriveBus::idleCycles(u32 count) {
  for (u32 i = 0; i < count; ++i) tickCycle();
}

Drive1541::Drive1541(IecBus& iec) : bus_(iec), cpu_(bus_) { bus_.attachCpu(&cpu_); }

void Drive1541::configure(const std::vector<u8>& rom, const TimingProfile& c64Timing) {
  bus_.setRom(rom);
  c64ClockNumerator_ = c64Timing.clockNumerator;
  c64ClockDenominator_ = c64Timing.clockDenominator;
  configured_ = rom.size() == 16384;
  reset();
}

void Drive1541::reset() {
  phase_ = 0;
  cycleBudget_ = 0;
  faulted_ = false;
  bus_.reset();
  if (configured_) cpu_.powerOn();
}

void Drive1541::tickC64Cycle() {
  if (!configured_ || faulted_) return;
  phase_ += kDriveClockHz * c64ClockDenominator_;
  while (phase_ >= c64ClockNumerator_) {
    phase_ -= c64ClockNumerator_;
    ++cycleBudget_;
  }
  if (cycleBudget_ <= 0) return;

  const StepResult step = cpu_.step();
  if (step.cycles > cpu_.busCycles()) bus_.idleCycles(step.cycles - cpu_.busCycles());
  cycleBudget_ -= step.cycles;
  if (step.stop == StepStop::IllegalOpcode) faulted_ = true;
}

}  // namespace c64
