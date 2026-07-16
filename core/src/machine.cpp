#include "c64/machine.hpp"

namespace c64 {

Machine::Machine() : cpu_(bus_) { bus_.attachCpu(&cpu_); }

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
  if (!romSetIdentityMatches(config.roms)) {
    return Error::make(ErrorCode::RomMismatch,
                       "ROM set identity/digests are inconsistent with its bytes.");
  }

  config_ = config;
  roms_ = config.roms;
  profile_ = profile;
  bus_.setRoms(roms_);
  const Sid::Model sidModel =
      (config.sidModel == "8580") ? Sid::Model::Mos8580 : Sid::Model::Mos6581;
  bus_.configureDevices(*profile_, sidModel, config.sampleRate ? config.sampleRate : 44100);
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
    // High-level LOAD trap: intercept a JSR to the KERNAL LOAD vector when media is mounted.
    if (disk_.loaded && cpu_.pc() == 0xFFD5) {
      serviceLoadTrap();
      continue;
    }
    if (!breakpoints_.empty() && breakpoints_.count(cpu_.pc()) != 0) {
      r.stopped = true;
      r.stopReason = "breakpoint";
      break;
    }
    const u64 beforeCycle = bus_.cycleCount();
    const StepResult step = cpu_.step();
    if (step.stop == StepStop::IllegalOpcode) {
      // The opcode fetch already ticked one device cycle; account for it, then stop.
      const u64 faultDelta = bus_.cycleCount() - beforeCycle;
      consumed += faultDelta;
      totalCycles_ += faultDelta;
      r.stopped = true;
      r.stopReason = "fault";
      r.error = Error::make(ErrorCode::InternalFault,
                            "Undocumented opcode $" +
                                std::string(1, "0123456789abcdef"[(step.opcode >> 4) & 0xF]) +
                                std::string(1, "0123456789abcdef"[step.opcode & 0xF]) +
                                " at $" + std::to_string(step.pc));
      break;
    }
    // Tick the instruction's internal (non-bus) cycles so devices advance exactly once per CPU
    // cycle. busCycles() <= step.cycles for every documented instruction, so this never
    // under-runs; BA/AEC stalls added inside readCycle() are reflected in the cycle counter.
    const u32 busUsed = cpu_.busCycles();
    if (step.cycles > busUsed) bus_.idleCycles(step.cycles - busUsed);
    const u64 delta = bus_.cycleCount() - beforeCycle;
    consumed += delta;
    totalCycles_ += delta;
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
  r.audioFramesAvailable = bus_.sid().available();
  return r;
}

void Machine::setIrqLine(bool asserted) { cpu_.setIrqLine(asserted); }
void Machine::triggerNmi() { cpu_.triggerNmi(); }

Error Machine::setInput(const InputSnapshot& snapshot) {
  Error e = requireReady();
  if (!e.ok()) return e;
  bus_.cia1().setKeyboard(snapshot.keyboardColumns);
  bus_.cia1().setJoysticks(snapshot.joystick1, snapshot.joystick2);
  // RESTORE is wired to the NMI line through a monostable; model it as a rising-edge NMI.
  if (snapshot.restorePressed && !restorePrev_) cpu_.triggerNmi();
  restorePrev_ = snapshot.restorePressed;
  return Error::none();
}

void Machine::releaseAllInput() {
  InputSnapshot released;  // default: nothing pressed, joysticks centred
  bus_.cia1().setKeyboard(released.keyboardColumns);
  bus_.cia1().setJoysticks(released.joystick1, released.joystick2);
  restorePrev_ = false;
}

u32 Machine::framebufferSize() const {
  return static_cast<u32>(bus_.vic().fbWidth()) * bus_.vic().fbHeight();
}

FrameInfo Machine::frameInfo() const { return bus_.vic().frameInfo(); }

FrameInfo Machine::copyFramebuffer(u8* dest, u32 destLen) {
  const FrameInfo info = bus_.vic().frameInfo();
  if (dest != nullptr) {
    const u32 n = framebufferSize() < destLen ? framebufferSize() : destLen;
    const u8* src = bus_.vic().framebuffer();
    for (u32 i = 0; i < n; ++i) dest[i] = src[i];
  }
  bus_.vic().clearDirty();  // dropping/consuming a completed frame never changes machine state
  return info;
}

AudioInfo Machine::drainAudio(float* dest, u32 maxFrames) {
  AudioInfo info;
  info.sampleRate = bus_.sid().sampleRate();
  info.channels = 1;
  info.framesWritten = (dest != nullptr) ? bus_.sid().drain(dest, maxFrames) : 0;
  info.sequence = bus_.sid().sampleSequence();
  info.dropped = bus_.sid().droppedFrames();
  return info;
}

MediaResult Machine::mountD64(const std::vector<u8>& bytes, u8 driveNumber) {
  MediaResult r;
  Error e = requireReady();
  if (!e.ok()) {
    r.error = e;
    return r;
  }
  if (driveNumber != 8) {
    r.error = Error::make(ErrorCode::UnsupportedMedia,
                          "Only drive 8 is supported by the high-level IEC drive model.");
    return r;
  }
  Disk parsed;
  MediaResult parseResult = parseD64(bytes, parsed);
  if (!parseResult.ok) return parseResult;  // malformed media is never mounted
  disk_ = std::move(parsed);
  return parseResult;
}

// --- High-level LOAD trap ---------------------------------------------------------------------

void Machine::rtsFromTrap(CpuState& st) {
  // Pull the JSR return address off the stack and continue after it (RTS semantics).
  u8 sp = st.sp;
  sp = static_cast<u8>(sp + 1);
  const u8 lo = bus_.rawRamRead(static_cast<u16>(0x0100 + sp));
  sp = static_cast<u8>(sp + 1);
  const u8 hi = bus_.rawRamRead(static_cast<u16>(0x0100 + sp));
  st.sp = sp;
  st.pc = static_cast<u16>((lo | (hi << 8)) + 1);
  cpu_.setState(st);
}

bool Machine::findFile(const std::vector<u8>& pattern, size_t& outIndex) const {
  // CBM name matching: '*' matches the rest, '?' matches any single character. An empty pattern
  // or a lone '*' loads the first file. Without a '*' the lengths must match exactly.
  const bool loadFirst = pattern.empty() || (pattern.size() == 1 && pattern[0] == '*');
  for (size_t f = 0; f < disk_.files.size(); ++f) {
    const DiskFile& file = disk_.files[f];
    if ((file.fileType & 0x0F) != 0x02) continue;  // PRG only
    if (loadFirst) {
      outIndex = f;
      return true;
    }
    bool match = true;
    bool star = false;
    size_t i = 0;
    for (; i < pattern.size(); ++i) {
      if (pattern[i] == '*') {  // '*' (PETSCII 0x2A) matches the remainder
        star = true;
        break;
      }
      if (i >= file.nameLen) {
        match = false;
        break;
      }
      if (pattern[i] != 0x3F /* '?' */ && pattern[i] != file.name[i]) {
        match = false;
        break;
      }
    }
    if (match && !star && i != file.nameLen) match = false;  // exact length when no '*'
    if (match) {
      outIndex = f;
      return true;
    }
  }
  return false;
}

std::vector<u8> Machine::buildDirectoryListing() const {
  // A minimal, LISTable BASIC directory program loaded at $0801. Line 0 is the disk header;
  // each subsequent line's line-number is the file's block count and its text is the quoted name.
  std::vector<u8> prg;
  prg.push_back(0x01);
  prg.push_back(0x08);  // load address $0801
  u16 addr = 0x0801;

  auto emitLine = [&](u16 lineNum, const std::vector<u8>& text) {
    // Reserve link (2) + line number (2) + text + terminator (1).
    const u16 lineLen = static_cast<u16>(5 + text.size());
    const u16 nextAddr = static_cast<u16>(addr + lineLen);
    prg.push_back(static_cast<u8>(nextAddr & 0xFF));
    prg.push_back(static_cast<u8>((nextAddr >> 8) & 0xFF));
    prg.push_back(static_cast<u8>(lineNum & 0xFF));
    prg.push_back(static_cast<u8>((lineNum >> 8) & 0xFF));
    for (u8 c : text) prg.push_back(c);
    prg.push_back(0x00);
    addr = nextAddr;
  };

  // Header line: reverse-video header with the disk name and id.
  std::vector<u8> header;
  header.push_back(0x12);  // RVS ON
  header.push_back(0x22);  // quote
  for (u8 i = 0; i < disk_.metadata.diskNameLen; ++i) header.push_back(disk_.metadata.petsciiName[i]);
  header.push_back(0x22);  // quote
  header.push_back(0x20);
  header.push_back(disk_.metadata.diskId0);
  header.push_back(disk_.metadata.diskId1);
  emitLine(0, header);

  for (const DiskFile& file : disk_.files) {
    std::vector<u8> text;
    text.push_back(0x20);
    text.push_back(0x22);  // quote
    for (u8 i = 0; i < file.nameLen; ++i) text.push_back(file.name[i]);
    text.push_back(0x22);  // quote
    text.push_back(0x20);
    // File type suffix (PRG for PRG entries).
    const char* suffix = ((file.fileType & 0x0F) == 0x02) ? "PRG" : "SEQ";
    for (const char* p = suffix; *p; ++p) text.push_back(static_cast<u8>(*p));
    emitLine(file.blocks, text);
  }
  // Program terminator: a zero link word.
  prg.push_back(0x00);
  prg.push_back(0x00);
  return prg;
}

bool Machine::serviceLoadTrap() {
  CpuState st = cpu_.state();
  const u8 device = bus_.rawRamRead(0xBA);
  if (device != 8 || !disk_.loaded) {
    st.p = static_cast<u8>(st.p | FlagC);  // carry set = error
    st.a = 5;                              // KERNAL "device not present"
    rtsFromTrap(st);
    return true;
  }
  const u8 sa = bus_.rawRamRead(0xB9);
  const u8 nameLen = bus_.rawRamRead(0xB7);
  const u16 namePtr = static_cast<u16>(bus_.rawRamRead(0xBB) | (bus_.rawRamRead(0xBC) << 8));
  std::vector<u8> fname;
  for (u8 i = 0; i < nameLen; ++i) fname.push_back(bus_.rawRamRead(static_cast<u16>(namePtr + i)));

  std::vector<u8> prg;
  if (fname.size() == 1 && fname[0] == 0x24 /* '$' */) {
    prg = buildDirectoryListing();
  } else {
    size_t index = 0;
    if (!findFile(fname, index)) {
      st.p = static_cast<u8>(st.p | FlagC);
      st.a = 4;  // KERNAL "file not found"
      rtsFromTrap(st);
      return true;
    }
    Error err = Error::none();
    if (!extractFile(disk_, index, prg, err)) {
      st.p = static_cast<u8>(st.p | FlagC);
      st.a = 4;
      rtsFromTrap(st);
      return true;
    }
  }

  // Load address: secondary address != 0 uses the file's 2-byte header; SA==0 uses X/Y.
  const u16 loadAddr = (sa != 0) ? static_cast<u16>(prg[0] | (prg[1] << 8))
                                 : static_cast<u16>(st.x | (st.y << 8));
  u32 end = loadAddr;
  for (size_t i = 2; i < prg.size(); ++i) {
    bus_.rawRamWrite(static_cast<u16>(loadAddr + (i - 2)), prg[i]);
    end = loadAddr + static_cast<u32>(i - 1);
  }
  st.x = static_cast<u8>(end & 0xFF);
  st.y = static_cast<u8>((end >> 8) & 0xFF);
  st.p = static_cast<u8>(st.p & ~FlagC);  // carry clear = success
  st.a = 0;
  rtsFromTrap(st);
  return true;
}

}  // namespace c64
