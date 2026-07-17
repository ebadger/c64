// Machine lifecycle controller: a thin, honest layer over the committed production wrapper
// web/emulator/c64.mjs and the production WASM artifact (see specs/EMULATOR.md). Browser pacing
// lives in pacing.js; this module only manages machine state, config, load/entry, media, run
// batches, and typed-array copies. It never swallows an emulation fault into a fake success.
//
// In-app Run enters the user program at `runAddress` after loading (for basic-sys this is the
// SYS target the generated stub jumps to). The app does not tokenize+RUN BASIC in-process; the
// *downloaded* PRG still autostarts via BASIC RUN on a stock machine per specs/CODEGEN.md. This
// keeps Run deterministic and ROM-agnostic; it is documented as an honest boundary in
// specs/WEB-CLIENT.md.

import { createEmulator } from "../../emulator/c64.mjs";

/** Map a core configure/load error code to a stable UI category. */
function categoryForCode(code) {
  switch (code) {
    case "rom-size":
    case "rom-mismatch":
    case "rom-set-incomplete":
      return "rom";
    case "invalid-prg":
      return "build";
    case "invalid-d64":
    case "unsupported-media":
    case "unsupported-geometry":
    case "invalid-track-sector":
    case "chain-cycle":
    case "invalid-bam":
    case "invalid-name":
      return "media";
    default:
      return "wasm";
  }
}

export class MachineController {
  constructor(emulator) {
    this._emu = emulator;
    this._machine = null;
    this._configured = false;
    this._crashed = false;
    this._audioRate = 0;
  }

  /**
   * Load the production WASM core through the committed wrapper. `loaderUrl` is the URL of the
   * Emscripten loader (build/wasm/c64core.mjs). Rejects on a genuine startup failure so the
   * caller can render an explicit `wasm` capability error (not a fabricated ready state).
   */
  static async load(loaderUrl) {
    const emulator = await createEmulator(String(loaderUrl));
    return new MachineController(emulator);
  }

  get ready() {
    return this._configured && this._machine !== null && this._machine.ready() && !this._crashed;
  }

  get crashed() {
    return this._crashed;
  }

  /**
   * Configure and power on with a validated ROM set. Returns { ok, error } where error is a
   * categorized UI error. A prior machine is disposed first.
   * @param {{ timingProfile: string, sidModel: string,
   *           roms: {basic:Uint8Array,kernal:Uint8Array,chargen:Uint8Array,drive:?Uint8Array} }} cfg
   */
  configure({ timingProfile, sidModel, roms }) {
    this.dispose();
    this._crashed = false;
    const machine = this._emu.createMachine({
      timingProfile,
      sidModel,
      basic: roms.basic,
      kernal: roms.kernal,
      chargen: roms.chargen,
      drive: roms.drive,
    });
    if (machine.configureError !== "none") {
      const code = machine.configureError;
      machine.dispose();
      return { ok: false, error: { category: categoryForCode(code), code, message: `Machine configuration failed: ${code}.` } };
    }
    this._machine = machine;
    this._configured = true;
    this._audioRate = 0;
    return { ok: true, error: null, romSetId: machine.romSetId() };
  }

  /**
   * Reset, load the PRG, and set the entry point. See the module note for basic-sys semantics.
   * @param {Uint8Array} prg
   * @param {{ runMode: string, runAddress: number }} entry
   */
  loadAndEnter(prg, { runAddress }) {
    if (!this._machine) return { ok: false, error: notReady() };
    this._crashed = false;
    const resetErr = this._machine.reset("power-on");
    if (resetErr !== "none") return { ok: false, error: { category: "wasm", code: resetErr, message: `Reset failed: ${resetErr}.` } };
    const load = this._machine.loadPrg(prg);
    if (!load.ok) {
      const code = load.error || "invalid-prg";
      return { ok: false, error: { category: categoryForCode(code), code, message: `PRG load failed: ${code}.` } };
    }
    this._machine.setProgramCounter(runAddress & 0xffff);
    return { ok: true, error: null, loadAddress: load.loadAddress, endAddress: load.endAddressExclusive };
  }

  /** Begin execution from the configured ROM reset vector without loading a PRG or overriding PC. */
  bootBasic() {
    if (!this._machine) return { ok: false, error: notReady() };
    this._crashed = false;
    const code = this._machine.reset("power-on");
    if (code !== "none") {
      return {
        ok: false,
        error: { category: "wasm", code, message: `BASIC boot failed: ${code}.` },
      };
    }
    return { ok: true, error: null };
  }

  /**
   * Mount an immutable D64. Returns { ok, error, meta }.
   * @param {Uint8Array} bytes
   */
  mount(bytes) {
    if (!this._machine) return { ok: false, error: notReady() };
    const result = this._machine.mountD64(bytes);
    if (!result.ok) {
      const code = result.errorCode || "invalid-d64";
      return { ok: false, error: { category: "media", code, message: result.errorMessage || `Mount failed: ${code}.` } };
    }
    return { ok: true, error: null, meta: { diskName: result.diskName, fileCount: result.fileCount } };
  }

  /** Eject drive-8 media without resetting CPU/device state. */
  unmount() {
    if (!this._machine) return { ok: false, error: notReady() };
    const code = this._machine.unmountD64();
    if (code !== "none") {
      return { ok: false, error: { category: categoryForCode(code), code, message: `Eject failed: ${code}.` } };
    }
    return { ok: true, error: null };
  }

  get diskMounted() {
    return this._machine ? this._machine.diskMounted() : false;
  }

  /**
   * Run a bounded cycle batch. Returns the raw RunResult, or marks the machine crashed on a
   * fault. `brk` is a normal program halt (not an error).
   * @param {number} maxCycles
   */
  runBatch(maxCycles) {
    if (!this._machine || this._crashed) return null;
    const result = this._machine.runCycles(maxCycles);
    if (result.stopReason === "fault") this._crashed = true;
    return result;
  }

  setInput(snapshot) {
    if (this._machine) return this._machine.setInput(snapshot);
    return "invalid-state";
  }

  releaseInput() {
    if (this._machine) this._machine.releaseAllInput();
  }

  /** Copy the latest framebuffer (JS-owned Uint8Array). */
  copyFramebuffer() {
    return this._machine ? this._machine.copyFramebuffer() : null;
  }

  /** Drain up to maxFrames mono float samples (JS-owned Float32Array). */
  drainAudio(maxFrames) {
    if (!this._machine) return null;
    const audio = this._machine.drainAudio(maxFrames);
    if (audio && audio.sampleRate > 0) this._audioRate = audio.sampleRate;
    return audio;
  }

  get audioSampleRate() {
    return this._audioRate;
  }

  reset(kind = "power-on") {
    if (!this._machine) return "invalid-state";
    this._crashed = false;
    return this._machine.reset(kind);
  }

  cpuState() {
    return this._machine ? this._machine.cpuState() : null;
  }

  debugReadRam(addr) {
    return this._machine ? this._machine.debugReadRam(addr) : null;
  }

  dispose() {
    if (this._machine) {
      this._machine.dispose();
      this._machine = null;
    }
    this._configured = false;
  }
}

function notReady() {
  return { category: "wasm", code: "invalid-state", message: "The machine is not configured." };
}
